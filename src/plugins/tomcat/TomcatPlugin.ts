import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { ChildProcess } from 'child_process';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

import { ok, err, type Result } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type {
  ServerConfig,
  DeploymentConfig,
  TomcatPluginConfig,
  StartMode,
  OperationContext,
  FileChangeBatch,
  Logger,
} from '@core/types';
import { DEPLOY_BACKUP_MAX_KEPT, DEPLOY_NAME_PATTERN } from '../../constants';
import { ProcessSpawner } from '@infra/process';
import { PortScanner } from '@infra/ports';
import { copyDir, ensureDir, exists } from '@infra/fs';

import type {
  IServerPlugin,
  PluginCapabilities,
  DetectReport,
  StartResult,
  StatusReport,
  HealthReport,
  DeployPlan,
  DeployResult,
  LogSources,
} from '../interfaces/IServerPlugin';

// ── Constants ───────────────────────────────────────────────────────────────

const TOMCAT_CAPABILITIES: PluginCapabilities = {
  supportsDebugAttach: true,
  supportsExplodedDeploy: true,
  supportsWarDeploy: true,
  supportsIncrementalDeploy: true,
  supportsLogFollow: true,
  supportsAutoDetect: true,
  supportsMultipleInstances: true,
};

/** Directories seeded from CATALINA_HOME on instancePath initialization. */
const INSTANCE_SEED_DIRS = ['conf'] as const;
/** Directories created empty on instancePath initialization. */
const INSTANCE_EMPTY_DIRS = ['logs', 'temp', 'work', 'webapps'] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

function isWindows(): boolean {
  return os.platform() === 'win32';
}

function catalinaScript(): string {
  return isWindows() ? 'catalina.bat' : 'catalina.sh';
}

async function tryRm(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch { /* best effort */ }
}

// ── TomcatPlugin ────────────────────────────────────────────────────────────

export class TomcatPlugin implements IServerPlugin {
  readonly type = 'tomcat' as const;
  readonly displayName = 'Apache Tomcat';

  private readonly logger: Logger;
  private readonly spawner: ProcessSpawner;
  private readonly portScanner: PortScanner;
  /** Track running child processes by serverId for stop(). */
  private readonly childProcesses = new Map<string, ChildProcess>();

  constructor(logger: Logger) {
    this.logger = logger;
    this.spawner = new ProcessSpawner(logger);
    this.portScanner = new PortScanner();
  }

  getCapabilities(): PluginCapabilities {
    return TOMCAT_CAPABILITIES;
  }

  // ── Detection ───────────────────────────────────────────────────────

  async detectInstallation(homePath: string): Promise<Result<DetectReport, JsmError>> {
    const checks: DetectReport['checks'] = [];
    const warnings: string[] = [];

    // Check 1: bin/catalina.sh or .bat
    const scriptPath = path.join(homePath, 'bin', catalinaScript());
    const scriptExists = await exists(scriptPath);
    checks.push({
      id: 'catalina-script',
      ok: scriptExists,
      message: scriptExists
        ? `Found ${catalinaScript()}`
        : `Missing ${catalinaScript()} at ${scriptPath}`,
    });

    // Check 2: lib/catalina.jar
    const jarPath = path.join(homePath, 'lib', 'catalina.jar');
    const jarExists = await exists(jarPath);
    checks.push({
      id: 'catalina-jar',
      ok: jarExists,
      message: jarExists ? 'Found catalina.jar' : `Missing catalina.jar at ${jarPath}`,
    });

    // Check 3: conf/server.xml
    const serverXmlPath = path.join(homePath, 'conf', 'server.xml');
    const serverXmlExists = await exists(serverXmlPath);
    checks.push({
      id: 'server-xml',
      ok: serverXmlExists,
      message: serverXmlExists
        ? 'Found conf/server.xml'
        : `Missing conf/server.xml at ${serverXmlPath}`,
    });

    const allOk = checks.every(c => c.ok);

    // Try to detect version from RELEASE-NOTES
    let version: string | undefined;
    try {
      const releaseNotes = await fs.readFile(path.join(homePath, 'RELEASE-NOTES'), 'utf-8');
      const match = /Apache Tomcat Version (\d+\.\d+\.\d+)/i.exec(releaseNotes);
      if (match) version = match[1];
    } catch {
      if (allOk) warnings.push('Could not detect Tomcat version from RELEASE-NOTES');
    }

    return ok({ ok: allOk, version, checks, warnings });
  }

  // ── Config Validation ───────────────────────────────────────────────

  async validateConfig(config: ServerConfig): Promise<Result<void, JsmError>> {
    const errors: string[] = [];

    if (!config.runtime.homePath) errors.push('runtime.homePath is required');
    if (!config.instancePath) errors.push('instancePath is required');
    if (!config.javaHome) errors.push('javaHome is required');
    if (!config.ports.http || config.ports.http < 1 || config.ports.http > 65535) {
      errors.push('ports.http must be 1–65535');
    }
    if (!config.ports.debug || config.ports.debug < 1 || config.ports.debug > 65535) {
      errors.push('ports.debug must be 1–65535');
    }

    // Validate javaHome has bin/java
    const javaExe = isWindows() ? 'java.exe' : 'java';
    const javaPath = path.join(config.javaHome, 'bin', javaExe);
    if (!(await exists(javaPath))) {
      errors.push(`Java executable not found at ${javaPath}`);
    }

    // Validate homePath looks like a Tomcat installation
    const scriptPath = path.join(config.runtime.homePath, 'bin', catalinaScript());
    if (!(await exists(scriptPath))) {
      errors.push(`Tomcat installation not found: missing ${catalinaScript()}`);
    }

    // Validate deployments
    for (const dep of config.deployments) {
      if (!DEPLOY_NAME_PATTERN.test(dep.deployName)) {
        errors.push(`Deployment '${dep.deployName}' has invalid characters`);
      }
    }

    if (errors.length > 0) {
      return err(new JsmError({
        code: ErrorCode.ValidationFailed,
        message: 'Tomcat configuration validation failed',
        details: errors.join('; '),
        suggestedFix: errors,
      }));
    }

    return ok(undefined);
  }

  // ── Instance Path Initialization (§7.7, §12.3) ─────────────────────

  /**
   * Initialize a CATALINA_BASE instance directory from CATALINA_HOME.
   * Copies conf/, creates empty dirs, patches server.xml ports, removes AJP.
   */
  async initializeInstancePath(
    homePath: string,
    instancePath: string,
    config: ServerConfig,
  ): Promise<Result<void, JsmError>> {
    try {
      // Seed directories from CATALINA_HOME
      for (const dir of INSTANCE_SEED_DIRS) {
        const src = path.join(homePath, dir);
        const dest = path.join(instancePath, dir);
        if (await exists(src)) {
          await copyDir(src, dest);
        }
      }

      // Create empty directories
      for (const dir of INSTANCE_EMPTY_DIRS) {
        await ensureDir(path.join(instancePath, dir));
      }

      // Patch server.xml
      const serverXmlPath = path.join(instancePath, 'conf', 'server.xml');
      if (await exists(serverXmlPath)) {
        const patchResult = await this.patchServerXml(serverXmlPath, config);
        if (!patchResult.ok) return patchResult;
      }

      this.logger.info(`TomcatPlugin: initialized instance at ${instancePath}`);
      return ok(undefined);
    } catch (cause) {
      return err(new JsmError({
        code: ErrorCode.DeployFailed,
        message: `Failed to initialize instance path: ${instancePath}`,
        details: cause instanceof Error ? cause.message : String(cause),
        suggestedFix: ['Check permissions on instance path', 'Verify CATALINA_HOME structure'],
        cause,
      }));
    }
  }

  // ── Server.xml Patching (XXE-safe XML parser, §7.7) ────────────────

  private async patchServerXml(
    serverXmlPath: string,
    config: ServerConfig,
  ): Promise<Result<void, JsmError>> {
    try {
      const xml = await fs.readFile(serverXmlPath, 'utf-8');

      // XXE protection: strip DOCTYPE declarations before parsing
      const sanitized = xml.replace(/<!DOCTYPE[^>]*>/gi, '');

      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        preserveOrder: true,
        commentPropName: '#comment',
        processEntities: false,
        // Do not parse tag values as number/boolean
        parseTagValue: false,
        parseAttributeValue: false,
      });

      const parsed = parser.parse(sanitized);

      // Patch ports and remove AJP connectors
      this.patchServerElement(parsed, config);

      const builder = new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        preserveOrder: true,
        commentPropName: '#comment',
        format: true,
        suppressEmptyNode: false,
      });

      const output = '<?xml version="1.0" encoding="UTF-8"?>\n' + builder.build(parsed);
      await fs.writeFile(serverXmlPath, output, 'utf-8');

      return ok(undefined);
    } catch (cause) {
      return err(new JsmError({
        code: ErrorCode.DeployFailed,
        message: `Failed to patch server.xml at ${serverXmlPath}`,
        details: cause instanceof Error ? cause.message : String(cause),
        suggestedFix: ['Check server.xml is valid XML', 'Restore from Tomcat installation'],
        cause,
      }));
    }
  }

  /**
   * Walk the parsed XML tree (preserveOrder format) to:
   * - Set <Server port="..."> to the shutdown port
   * - Set HTTP Connector port to config.ports.http
   * - Remove AJP Connectors if disableAjp is true
   */
  private patchServerElement(
    nodes: unknown[],
    config: ServerConfig,
  ): void {
    const pluginConfig = config.pluginConfig as TomcatPluginConfig | undefined;
    const shutdownPort = pluginConfig?.shutdownPort ?? 8005;
    const disableAjp = pluginConfig?.disableAjp ?? true;

    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const obj = node as Record<string, unknown>;

      // Patch <Server> element shutdown port
      if ('Server' in obj && Array.isArray(obj['Server'])) {
        const attrs = obj[':@'] as Record<string, string> | undefined;
        if (attrs?.['@_port']) {
          attrs['@_port'] = String(shutdownPort);
        }
        // Recurse into Server children
        this.patchServerElement(obj['Server'] as unknown[], config);
      }

      // Patch <Service> — recurse to find Connectors
      if ('Service' in obj && Array.isArray(obj['Service'])) {
        const children = obj['Service'] as unknown[];
        this.patchServiceChildren(children, config, disableAjp);
      }
    }
  }

  private patchServiceChildren(
    children: unknown[],
    config: ServerConfig,
    disableAjp: boolean,
  ): void {
    // Collect indices of AJP connectors to remove
    const removeIndices: number[] = [];

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child || typeof child !== 'object') continue;
      const obj = child as Record<string, unknown>;

      if ('Connector' in obj) {
        const attrs = (obj[':@'] ?? {}) as Record<string, string>;
        const protocol = (attrs['@_protocol'] ?? '').toLowerCase();

        if (protocol.includes('ajp') && disableAjp) {
          removeIndices.push(i);
          this.logger.info('TomcatPlugin: removing AJP connector from server.xml');
        } else if (!protocol.includes('ajp')) {
          // HTTP connector — set port
          attrs['@_port'] = String(config.ports.http);
        }
      }

      // Recurse into nested elements (Engine, Host, etc.)
      for (const key of Object.keys(obj)) {
        if (key.startsWith(':@') || key.startsWith('#')) continue;
        if (Array.isArray(obj[key])) {
          this.patchServiceChildren(obj[key] as unknown[], config, disableAjp);
        }
      }
    }

    // Remove AJP connectors in reverse order to preserve indices
    for (let i = removeIndices.length - 1; i >= 0; i--) {
      children.splice(removeIndices[i], 1);
    }
  }

  // ── Lifecycle: Start (§12.1, §12.2) ────────────────────────────────

  async start(
    ctx: OperationContext,
    config: ServerConfig,
    mode: StartMode,
  ): Promise<Result<StartResult, JsmError>> {
    const script = path.join(config.runtime.homePath, 'bin', catalinaScript());

    if (!(await exists(script))) {
      return err(new JsmError({
        code: ErrorCode.ScriptNotExecutable,
        message: `Catalina script not found: ${script}`,
        suggestedFix: ['Check the Tomcat home path'],
      }));
    }

    const env: Record<string, string> = {
      CATALINA_HOME: config.runtime.homePath,
      CATALINA_BASE: config.instancePath,
      JAVA_HOME: config.javaHome,
      ...config.run.env,
    };

    const args: string[] = [];

    if (mode === 'debug') {
      // §12.1: Debug MUST bind to localhost. JPDA_ADDRESS = bind:port
      const bind = config.debug.bind || '127.0.0.1';
      env['JPDA_ADDRESS'] = `${bind}:${config.ports.debug}`;
      env['JPDA_TRANSPORT'] = 'dt_socket';
      args.push('jpda', 'run');
    } else {
      args.push('run');
    }

    // Add JVM args via JAVA_OPTS
    if (config.run.vmArgs.length > 0) {
      const existing = env['JAVA_OPTS'] ?? '';
      env['JAVA_OPTS'] = (existing + ' ' + config.run.vmArgs.join(' ')).trim();
    }

    ctx.progress.report('Starting Tomcat...');

    const child = this.spawner.spawn({
      exe: script,
      args,
      cwd: config.run.cwd ?? config.instancePath,
      env,
      onData: (chunk) => ctx.output.appendLine(chunk),
    });

    if (!child.pid) {
      return err(new JsmError({
        code: ErrorCode.ProcessSpawnFailed,
        message: 'Failed to spawn Tomcat process',
        suggestedFix: ['Check JAVA_HOME is valid', 'Check Tomcat scripts have execute permission'],
      }));
    }

    this.childProcesses.set(config.id, child);

    // Handle process exit
    child.on('exit', (code, signal) => {
      this.childProcesses.delete(config.id);
      this.logger.info(`TomcatPlugin: process exited for ${config.id}`, { code, signal });
    });

    const hints: string[] = [];
    const result: StartResult = {
      pid: child.pid,
      httpUrl: `http://${config.host}:${config.ports.http}`,
      hints,
    };

    if (mode === 'debug') {
      result.debugPort = config.ports.debug;
      hints.push(`Debug port: ${config.ports.debug}`);
    }

    this.logger.info(`TomcatPlugin: started ${config.name} (PID ${child.pid}, mode=${mode})`);
    return ok(result);
  }

  // ── Lifecycle: Stop ─────────────────────────────────────────────────

  async stop(
    ctx: OperationContext,
    config: ServerConfig,
  ): Promise<Result<void, JsmError>> {
    ctx.progress.report('Stopping Tomcat...');

    // Try graceful stop via catalina.sh stop
    const script = path.join(config.runtime.homePath, 'bin', catalinaScript());
    const env: Record<string, string> = {
      CATALINA_HOME: config.runtime.homePath,
      CATALINA_BASE: config.instancePath,
      JAVA_HOME: config.javaHome,
    };

    const exitCode = await new Promise<number | null>((resolve) => {
      const child = this.spawner.spawn({
        exe: script,
        args: ['stop'],
        env,
        onData: (chunk) => ctx.output.appendLine(chunk),
        onExit: (code) => resolve(code),
      });

      // Timeout for the stop command itself
      const timeout = config.timeouts?.stopMs ?? 20_000;
      const timer = setTimeout(() => {
        this.spawner.kill(child.pid!, true);
        resolve(null);
      }, timeout);

      child.on('exit', () => clearTimeout(timer));
    });

    // Also kill the tracked child process if still running
    const tracked = this.childProcesses.get(config.id);
    if (tracked?.pid) {
      this.spawner.kill(tracked.pid);
      this.childProcesses.delete(config.id);
    }

    if (exitCode !== 0 && exitCode !== null) {
      this.logger.warn(`TomcatPlugin: stop script exited with code ${exitCode}`);
    }

    this.logger.info(`TomcatPlugin: stopped ${config.name}`);
    return ok(undefined);
  }

  // ── Deploy: Plan (§10.1, §10.2) ────────────────────────────────────

  async planDeploy(
    _ctx: OperationContext,
    config: ServerConfig,
    dep: DeploymentConfig,
  ): Promise<Result<DeployPlan, JsmError>> {
    const targetRoot = path.join(config.instancePath, 'webapps');
    let strategy: DeployPlan['strategy'];
    let targetPath: string;
    const notes: string[] = [];

    if (dep.type === 'war') {
      strategy = 'copy-war';
      targetPath = path.join(targetRoot, `${dep.deployName}.war`);
      notes.push('WAR deployment: full copy');
    } else {
      strategy = 'copy-dir';
      targetPath = path.join(targetRoot, dep.deployName);
      notes.push('Exploded deployment: directory copy');
    }

    return ok({ targetRoot, targetPath, strategy, notes });
  }

  // ── Deploy: Full (§10.3 atomicity) ─────────────────────────────────

  async deployFull(
    ctx: OperationContext,
    _config: ServerConfig,
    dep: DeploymentConfig,
    plan: DeployPlan,
  ): Promise<Result<DeployResult, JsmError>> {
    ctx.progress.report(`Deploying ${dep.deployName}...`);

    const sourcePath = dep.sourcePath;
    if (!(await exists(sourcePath))) {
      return err(new JsmError({
        code: ErrorCode.SourceNotFound,
        message: `Source not found: ${sourcePath}`,
        suggestedFix: ['Check that the source path exists', 'Build the project first'],
      }));
    }

    await ensureDir(plan.targetRoot);

    const timestamp = Date.now();
    const stagingPath = `${plan.targetPath}.staging.${timestamp}`;
    const backupPath = `${plan.targetPath}.backup.${timestamp}`;
    const warnings: string[] = [];

    try {
      // Step 1: Copy source to staging
      if (plan.strategy === 'copy-war') {
        await fs.copyFile(sourcePath, stagingPath);
      } else {
        await copyDir(sourcePath, stagingPath);
      }

      // Step 2: Backup existing target
      const targetExists = await exists(plan.targetPath);
      if (targetExists) {
        await fs.rename(plan.targetPath, backupPath);
      }

      // Step 3: Rename staging to target (atomic on POSIX)
      await fs.rename(stagingPath, plan.targetPath);

      // Step 4: Clean up backup
      if (targetExists) {
        await tryRm(backupPath);
      }

      // Step 5: Prune old backups (§10.3 — keep at most DEPLOY_BACKUP_MAX_KEPT)
      await this.pruneBackups(plan.targetPath);

      ctx.progress.report(`Deployed ${dep.deployName}`);
      this.logger.info(`TomcatPlugin: deployed ${dep.deployName} via ${plan.strategy}`);

      return ok({
        strategy: plan.strategy,
        deployedPath: plan.targetPath,
        warnings,
      });
    } catch (cause) {
      // Rollback: restore backup, clean up staging
      try {
        const hasBackup = await exists(backupPath);
        if (hasBackup) {
          await tryRm(plan.targetPath);
          await fs.rename(backupPath, plan.targetPath);
        }
      } catch {
        /* best effort rollback */
      }
      await tryRm(stagingPath);

      return err(new JsmError({
        code: ErrorCode.DeployFailed,
        message: `Failed to deploy ${dep.deployName}`,
        details: cause instanceof Error ? cause.message : String(cause),
        suggestedFix: ['Check disk space', 'Check permissions on webapps/'],
        cause,
      }));
    }
  }

  // ── Deploy: Incremental ─────────────────────────────────────────────

  async deployIncremental(
    ctx: OperationContext,
    _config: ServerConfig,
    dep: DeploymentConfig,
    changes: FileChangeBatch,
    plan: DeployPlan,
  ): Promise<Result<void, JsmError>> {
    if (plan.strategy !== 'incremental-dir') {
      return err(new JsmError({
        code: ErrorCode.Unsupported,
        message: 'Incremental deploy only supports exploded directories',
      }));
    }

    ctx.progress.report(`Syncing ${changes.changes.length} files for ${dep.deployName}...`);

    try {
      for (const change of changes.changes) {
        const targetFile = path.join(plan.targetPath, change.relativePath);

        switch (change.type) {
          case 'add':
          case 'change':
            await ensureDir(path.dirname(targetFile));
            await fs.copyFile(change.path, targetFile);
            break;
          case 'delete':
            await tryRm(targetFile);
            break;
        }
      }

      this.logger.debug(`TomcatPlugin: incremental sync ${changes.changes.length} files for ${dep.deployName}`);
      return ok(undefined);
    } catch (cause) {
      return err(new JsmError({
        code: ErrorCode.DeployFailed,
        message: `Incremental deploy failed for ${dep.deployName}`,
        details: cause instanceof Error ? cause.message : String(cause),
        cause,
      }));
    }
  }

  // ── Undeploy ────────────────────────────────────────────────────────

  async undeploy(
    ctx: OperationContext,
    config: ServerConfig,
    dep: DeploymentConfig,
  ): Promise<Result<void, JsmError>> {
    ctx.progress.report(`Undeploying ${dep.deployName}...`);

    const targetRoot = path.join(config.instancePath, 'webapps');
    const targets = [
      path.join(targetRoot, dep.deployName),           // exploded dir
      path.join(targetRoot, `${dep.deployName}.war`),  // WAR file
    ];

    try {
      for (const target of targets) {
        if (await exists(target)) {
          await fs.rm(target, { recursive: true, force: true });
          this.logger.info(`TomcatPlugin: removed ${target}`);
        }
      }
      return ok(undefined);
    } catch (cause) {
      return err(new JsmError({
        code: ErrorCode.UndeployFailed,
        message: `Failed to undeploy ${dep.deployName}`,
        details: cause instanceof Error ? cause.message : String(cause),
        cause,
      }));
    }
  }

  // ── Status ──────────────────────────────────────────────────────────

  async getStatus(
    _ctx: OperationContext,
    config: ServerConfig,
  ): Promise<Result<StatusReport, JsmError>> {
    const tracked = this.childProcesses.get(config.id);

    // Check if we have a tracked process
    if (tracked?.pid) {
      let isAlive = false;
      try {
        process.kill(tracked.pid, 0);
        isAlive = true;
      } catch {
        // process is gone
      }

      if (isAlive) {
        // Probe HTTP port to differentiate starting vs running
        const httpUp = await this.portScanner.probe(config.ports.http, config.host);
        return ok({
          state: httpUp ? 'running' : 'starting',
          pid: tracked.pid,
          httpPort: httpUp ? config.ports.http : undefined,
        });
      }

      // Process is gone — clean up
      this.childProcesses.delete(config.id);
    }

    return ok({ state: 'stopped' });
  }

  // ── Health Check ────────────────────────────────────────────────────

  async healthCheck(
    _ctx: OperationContext,
    config: ServerConfig,
  ): Promise<Result<HealthReport, JsmError>> {
    const start = Date.now();
    const up = await this.portScanner.probe(config.ports.http, config.host);
    const latencyMs = Date.now() - start;

    return ok({ ok: up, latencyMs });
  }

  // ── Log Sources ─────────────────────────────────────────────────────

  async getLogSources(config: ServerConfig): Promise<Result<LogSources, JsmError>> {
    const logsDir = path.join(config.instancePath, 'logs');
    const catalinaOut = path.join(logsDir, 'catalina.out');

    const primary = (await exists(catalinaOut))
      ? { id: 'catalina-out', title: 'Catalina Log', kind: 'file' as const, path: catalinaOut }
      : undefined;

    // Discover additional log files
    const others: LogSources['others'] = [];
    try {
      const entries = await fs.readdir(logsDir);
      for (const entry of entries) {
        if (entry === 'catalina.out') continue;
        if (entry.endsWith('.log')) {
          others.push({
            id: entry,
            title: entry,
            kind: 'file',
            path: path.join(logsDir, entry),
          });
        }
      }
    } catch {
      // logs/ may not exist yet
    }

    return ok({ primary, others });
  }

  // ── Defaults ────────────────────────────────────────────────────────

  getDefaultConfig(): Partial<ServerConfig> {
    return {
      host: '127.0.0.1',
      ports: { http: 8080, debug: 5005 },
      run: { env: {}, vmArgs: [] },
      debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
      autosync: {
        enabled: true,
        debounceMs: 400,
        maxBatchFiles: 200,
        maxBatchBytes: 20_000_000,
        stormBackoffMs: 2000,
        ignoreGlobs: ['**/.git/**', '**/node_modules/**', '**/*.class'],
      },
      pluginConfig: {
        type: 'tomcat',
        shutdownPort: 8005,
        disableAjp: true,
      },
    };
  }

  // ── Dispose ─────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    for (const [id, child] of this.childProcesses) {
      if (child.pid) {
        this.spawner.kill(child.pid);
      }
      this.childProcesses.delete(id);
    }
  }

  // ── Private Helpers ─────────────────────────────────────────────────

  /** Remove old backup files/dirs, keeping at most DEPLOY_BACKUP_MAX_KEPT per target. */
  private async pruneBackups(targetPath: string): Promise<void> {
    const dir = path.dirname(targetPath);
    const baseName = path.basename(targetPath);
    const prefix = `${baseName}.backup.`;

    try {
      const entries = await fs.readdir(dir);
      const backups = entries
        .filter(e => e.startsWith(prefix))
        .sort()
        .reverse();

      // Keep the most recent N, remove the rest
      for (let i = DEPLOY_BACKUP_MAX_KEPT; i < backups.length; i++) {
        await tryRm(path.join(dir, backups[i]));
        this.logger.debug(`TomcatPlugin: pruned old backup ${backups[i]}`);
      }
    } catch {
      // dir listing failed — skip pruning
    }
  }
}
