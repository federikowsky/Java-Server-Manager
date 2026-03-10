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
  ConfigSource,
  DetectReport,
  StartResult,
  StatusReport,
  HealthReport,
  DeployPlan,
  DeployResult,
  LogSources,
} from '../interfaces/IServerPlugin';
import { TomcatStartupMonitor } from './TomcatStartupMonitor';

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
const TOMCAT_STARTUP_LISTENER_CLASS = 'com.githubcopilot.jsm.tomcat.StartupLifecycleListener';
const TOMCAT_STARTUP_LISTENER_FILENAME = 'jsm-tomcat-startup-listener.jar';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const XML_DECLARATION_PATTERN = /^\s*<\?xml\b/i;
const TOMCAT_STARTUP_LISTENER_PATTERN = new RegExp(`<Listener\\b[^>]*\\bclassName=["']${TOMCAT_STARTUP_LISTENER_CLASS.replace(/\./g, '\\.')}["']`, 'i');
const TOMCAT_XML_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  commentPropName: '#comment',
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
};
const TOMCAT_XML_BUILDER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  commentPropName: '#comment',
  format: true,
  suppressEmptyNode: false,
};

export interface TomcatPluginOptions {
  startupListenerJarPath?: string;
}

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

async function existingConfigSources(candidates: ConfigSource[]): Promise<ConfigSource[]> {
  const available = await Promise.all(
    candidates.map(async candidate => ({
      candidate,
      exists: await exists(candidate.path),
    })),
  );

  return available.filter(entry => entry.exists).map(entry => entry.candidate);
}

function parseTomcatXml(xml: string): unknown[] {
  return new XMLParser(TOMCAT_XML_PARSER_OPTIONS).parse(xml.replace(/<!DOCTYPE[^>]*>/gi, ''));
}

function buildTomcatXml(nodes: unknown[]): string {
  const xml = new XMLBuilder(TOMCAT_XML_BUILDER_OPTIONS).build(nodes);
  return XML_DECLARATION_PATTERN.test(xml) ? xml : `${XML_DECLARATION}\n${xml}`;
}

function hasStartupListenerRegistration(xml: string): boolean {
  return TOMCAT_STARTUP_LISTENER_PATTERN.test(xml);
}

// ── TomcatPlugin ────────────────────────────────────────────────────────────

export class TomcatPlugin implements IServerPlugin {
  readonly type = 'tomcat' as const;
  readonly displayName = 'Apache Tomcat';

  private readonly logger: Logger;
  private readonly spawner: ProcessSpawner;
  private readonly portScanner: PortScanner;
  private readonly startupListenerJarPath?: string;
  /** Track running child processes by serverId for stop(). */
  private readonly childProcesses = new Map<string, ChildProcess>();

  constructor(logger: Logger, options: TomcatPluginOptions = {}) {
    this.logger = logger;
    this.spawner = new ProcessSpawner(logger);
    this.portScanner = new PortScanner();
    this.startupListenerJarPath = options.startupListenerJarPath;
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
      const parsed = parseTomcatXml(await fs.readFile(serverXmlPath, 'utf-8'));

      // Patch ports and remove AJP connectors
      this.patchServerElement(parsed, config);

      await fs.writeFile(serverXmlPath, buildTomcatXml(parsed), 'utf-8');

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
    let startupMonitor: TomcatStartupMonitor | undefined;

    if (this.startupListenerJarPath) {
      const prepareResult = await this.prepareStartupListener(config);
      if (!prepareResult.ok) {
        return prepareResult;
      }

      try {
        startupMonitor = await TomcatStartupMonitor.create({
          serverKey: config.id,
          serverName: config.name,
          logger: this.logger,
        });
      } catch (cause) {
        return err(new JsmError({
          code: ErrorCode.Unknown,
          message: `Failed to initialize Tomcat startup callback for ${config.name}`,
          details: cause instanceof Error ? cause.message : String(cause),
          cause,
        }));
      }
    }

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

    if (startupMonitor) {
      const callbackVmArgs = [
        `-Djsm.startup.callback.url=${startupMonitor.callbackUrl}`,
        `-Djsm.startup.callback.token=${startupMonitor.token}`,
        `-Djsm.startup.callback.startupId=${startupMonitor.startupId}`,
        `-Djsm.startup.callback.serverKey=${config.id}`,
      ];
      const existing = env['JAVA_OPTS'] ?? '';
      env['JAVA_OPTS'] = (existing + ' ' + callbackVmArgs.join(' ')).trim();
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
      await startupMonitor?.dispose();
      return err(new JsmError({
        code: ErrorCode.ProcessSpawnFailed,
        message: 'Failed to spawn Tomcat process',
        suggestedFix: ['Check JAVA_HOME is valid', 'Check Tomcat scripts have execute permission'],
      }));
    }

    startupMonitor?.bindProcess(child);

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
      startupMonitor,
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

  async getConfigSources(config: ServerConfig): Promise<Result<ConfigSource[], JsmError>> {
    const candidateSpecs: ConfigSource[] = [
      {
        id: 'instance-server-xml',
        title: 'server.xml',
        kind: 'file',
        path: path.join(config.instancePath, 'conf', 'server.xml'),
        description: 'Instance config',
        detail: 'Active connector and service configuration for this instance',
      },
      {
        id: 'instance-web-xml',
        title: 'web.xml',
        kind: 'file',
        path: path.join(config.instancePath, 'conf', 'web.xml'),
        description: 'Instance config',
        detail: 'Default web application configuration for this instance',
      },
      {
        id: 'instance-context-xml',
        title: 'context.xml',
        kind: 'file',
        path: path.join(config.instancePath, 'conf', 'context.xml'),
        description: 'Instance config',
        detail: 'Default context configuration for this instance',
      }
      // {
      //   id: 'runtime-server-xml',
      //   title: 'server.xml',
      //   kind: 'file',
      //   path: path.join(config.runtime.homePath, 'conf', 'server.xml'),
      //   description: 'Runtime config',
      //   detail: 'Original runtime connector and service configuration',
      // },
      // {
      //   id: 'runtime-web-xml',
      //   title: 'web.xml',
      //   kind: 'file',
      //   path: path.join(config.runtime.homePath, 'conf', 'web.xml'),
      //   description: 'Runtime config',
      //   detail: 'Original runtime default web application configuration',
      // },
      // {
      //   id: 'runtime-context-xml',
      //   title: 'context.xml',
      //   kind: 'file',
      //   path: path.join(config.runtime.homePath, 'conf', 'context.xml'),
      //   description: 'Runtime config',
      //   detail: 'Original runtime default context configuration',
      // },
    ];

    const dedupedCandidates = new Map<string, ConfigSource>();
    for (const candidate of candidateSpecs) {
      if (!dedupedCandidates.has(candidate.path)) {
        dedupedCandidates.set(candidate.path, candidate);
      }
    }

    return ok(await existingConfigSources([...dedupedCandidates.values()]));
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

  private async prepareStartupListener(config: ServerConfig): Promise<Result<void, JsmError>> {
    if (!this.startupListenerJarPath) {
      return ok(undefined);
    }

    if (!(await exists(this.startupListenerJarPath))) {
      return err(new JsmError({
        code: ErrorCode.SourceNotFound,
        message: `Tomcat startup listener asset not found: ${this.startupListenerJarPath}`,
      }));
    }

    const libDir = path.join(config.instancePath, 'lib');
    const serverXmlPath = path.join(config.instancePath, 'conf', 'server.xml');

    if (!(await exists(serverXmlPath))) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Tomcat instance server.xml not found at ${serverXmlPath}`,
        suggestedFix: ['Initialize the Tomcat instance path before starting the server'],
      }));
    }

    try {
      await ensureDir(libDir);
      await fs.copyFile(
        this.startupListenerJarPath,
        path.join(libDir, TOMCAT_STARTUP_LISTENER_FILENAME),
      );
    } catch (cause) {
      return err(new JsmError({
        code: ErrorCode.ConfigWriteFailed,
        message: `Failed to stage Tomcat startup listener for ${config.name}`,
        details: cause instanceof Error ? cause.message : String(cause),
        cause,
      }));
    }

    return this.ensureStartupListenerRegistration(serverXmlPath);
  }

  private async ensureStartupListenerRegistration(serverXmlPath: string): Promise<Result<void, JsmError>> {
    try {
      const xml = await fs.readFile(serverXmlPath, 'utf-8');
      if (hasStartupListenerRegistration(xml)) {
        return ok(undefined);
      }

      const parsed = parseTomcatXml(xml);
      this.ensureServerListenerRegistration(parsed);

      await fs.writeFile(serverXmlPath, buildTomcatXml(parsed), 'utf-8');
      return ok(undefined);
    } catch (cause) {
      return err(new JsmError({
        code: ErrorCode.ConfigWriteFailed,
        message: `Failed to register Tomcat startup listener in ${serverXmlPath}`,
        details: cause instanceof Error ? cause.message : String(cause),
        cause,
      }));
    }
  }

  private ensureServerListenerRegistration(nodes: unknown[]): void {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const obj = node as Record<string, unknown>;

      if ('Server' in obj && Array.isArray(obj['Server'])) {
        const children = obj['Server'] as Array<Record<string, unknown>>;
        const alreadyRegistered = children.some((child) => {
          if (!child || typeof child !== 'object' || !('Listener' in child)) {
            return false;
          }

          const attrs = (child[':@'] ?? {}) as Record<string, string>;
          return attrs['@_className'] === TOMCAT_STARTUP_LISTENER_CLASS;
        });

        if (!alreadyRegistered) {
          children.unshift({
            Listener: [],
            ':@': { '@_className': TOMCAT_STARTUP_LISTENER_CLASS },
          });
        }

        return;
      }
    }
  }
}
