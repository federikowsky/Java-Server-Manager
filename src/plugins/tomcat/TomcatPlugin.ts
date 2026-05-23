import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { ChildProcess } from 'child_process';

import { ok, err, type Result } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import { throwIfCancelled } from '@core/ops';
import type {
  ServerConfig,
  ServerId,
  DeploymentConfig,
  TomcatPluginConfig,
  StartMode,
  OperationContext,
  FileChangeBatch,
  Logger,
  KeyValueStore,
} from '@core/types';
import { DEPLOY_BACKUP_MAX_KEPT, DEPLOY_NAME_PATTERN, DEFAULT_TRUSTSTORE_TYPE } from '../../constants';
import { ProcessSpawner } from '@infra/process';
import { PortScanner } from '@infra/ports';
import { copyDir, ensureDir, exists } from '@infra/fs';

import type {
  IServerPlugin,
  PluginCapabilities,
  PluginUIMetadata,
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
import { TomcatServerXmlService } from './TomcatServerXmlService';

// ── Constants ───────────────────────────────────────────────────────────────

const TOMCAT_CAPABILITIES: PluginCapabilities = {
  supportsDebugAttach: true,
  supportsExplodedDeploy: true,
  supportsWarDeploy: true,
  supportsIncrementalDeploy: true,
  supportsHotReload: true,
  supportsLogFollow: true,
  supportsAutoDetect: true,
  supportsSsl: true,
  supportsMultipleInstances: true,
};

/** Directories seeded from CATALINA_HOME on instancePath initialization. */
const INSTANCE_SEED_DIRS = ['conf'] as const;
/** Directories created empty on instancePath initialization. */
const INSTANCE_EMPTY_DIRS = ['logs', 'temp', 'work', 'webapps'] as const;
const TOMCAT_STARTUP_LISTENER_FILENAME = 'jsm-tomcat-startup-listener.jar';
const TOMCAT_STARTUP_LISTENER_CLASS = 'com.githubcopilot.jsm.tomcat.StartupLifecycleListener';
const DEFAULT_SHUTDOWN_PORT = 8005;
const DEFAULT_SHUTDOWN_COMMAND = 'SHUTDOWN';
const SHUTDOWN_PORT_KEY_PREFIX = 'jsm.tomcat.shutdownPort.';

export interface TomcatPluginOptions {
  startupListenerJarPath?: string;
  /** Path to server.xml template with ${http.port}, ${shutdown.port}, ${shutdown.command}. */
  serverXmlTemplatePath?: string;
  /** Optional: persists dynamic shutdown port so stop works after reload. */
  keyValueStore: KeyValueStore;
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

/** JVM system properties for Tomcat connector/shutdown (template placeholders). */
function tomcatConfigVmArgs(config: ServerConfig, shutdownPortOverride?: number): string[] {
  const pluginConfig = config.pluginConfig as TomcatPluginConfig | undefined;
  const shutdownPort = shutdownPortOverride ?? pluginConfig?.shutdownPort ?? DEFAULT_SHUTDOWN_PORT;
  const args = [
    `-Dhttp.port=${config.ports.http}`,
    `-Dshutdown.port=${shutdownPort}`,
    `-Dshutdown.command=${DEFAULT_SHUTDOWN_COMMAND}`,
  ];

  if (pluginConfig?.ssl?.enabled) {
    args.push(`-Dhttps.port=${pluginConfig.ssl.port}`);
  }

  return args;
}

// ── TomcatPlugin ────────────────────────────────────────────────────────────

export class TomcatPlugin implements IServerPlugin {
  readonly type = 'tomcat' as const;
  readonly displayName = 'Apache Tomcat';

  private readonly logger: Logger;
  private readonly spawner: ProcessSpawner;
  private readonly portScanner: PortScanner;
  private readonly startupListenerJarPath?: string;
  private readonly serverXmlTemplatePath?: string;
  private readonly keyValueStore: KeyValueStore;
  private readonly serverXmlService: TomcatServerXmlService;
  /** Track running child processes by serverId for stop(). */
  private readonly childProcesses = new Map<string, ChildProcess>();

  constructor(logger: Logger, options: TomcatPluginOptions) {
    this.logger = logger;
    this.spawner = new ProcessSpawner(logger);
    this.portScanner = new PortScanner();
    this.startupListenerJarPath = options.startupListenerJarPath;
    this.serverXmlTemplatePath = options.serverXmlTemplatePath;
    this.keyValueStore = options.keyValueStore;
    this.serverXmlService = new TomcatServerXmlService(logger);
  }

  getCapabilities(): PluginCapabilities {
    return TOMCAT_CAPABILITIES;
  }

  getUIMetadata(): PluginUIMetadata {
    return {
      displayName: 'Tomcat',
      runtimeHomeLabel: 'CATALINA_HOME',
      runtimeHomeHelp: 'Absolute path to the Tomcat installation directory.',
      defaultName: 'My Tomcat',
      discoveryEnvVars: ['CATALINA_HOME', 'TOMCAT_HOME'],
      discoveryPaths: [
        '/opt/tomcat',
        '/usr/local/tomcat',
        '/opt/homebrew/Cellar/tomcat',
        '~/tomcat',
      ],
      discoveryDescription: 'Automatically detect Tomcat installations via environment variables and common paths.',
      hotReloadDescription: 'Applies file changes and triggers Tomcat context reload without full redeploy. Only affects files outside WEB-INF/ and META-INF/.',
    };
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
    if (config.ports.debug !== undefined && (config.ports.debug < 1 || config.ports.debug > 65535)) {
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

    // Validate SSL configuration
    const ssl = (config.pluginConfig as TomcatPluginConfig | undefined)?.ssl;
    if (ssl?.enabled) {
      if (ssl.port === config.ports.http) {
        errors.push('SSL port must differ from HTTP port');
      }
      if (!ssl.keystorePath) {
        errors.push('Keystore path is required when SSL is enabled');
      }
      if (!ssl.keystorePassword) {
        errors.push('Keystore password is required when SSL is enabled');
      }
      if (ssl.clientAuth && !ssl.truststorePath) {
        errors.push('Truststore path is required when client authentication is enabled');
      }
      if (ssl.truststorePath && !ssl.truststorePassword) {
        errors.push('Truststore password is required when truststore path is provided');
      }
      // Check keystore file exists
      if (ssl.keystorePath && !(await exists(ssl.keystorePath))) {
        errors.push(`Keystore file not found: ${ssl.keystorePath}`);
      }
      // Check truststore file exists
      if (ssl.truststorePath && !(await exists(ssl.truststorePath))) {
        errors.push(`Truststore file not found: ${ssl.truststorePath}`);
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
   * Copies conf/, creates empty dirs. If serverXmlTemplatePath is set, overwrites
   * conf/server.xml with the template (port/shutdown passed later via JVM args).
   */
  async initializeInstancePath(
    homePath: string,
    instancePath: string,
    config: ServerConfig,
  ): Promise<Result<void, JsmError>> {
    try {
      const pluginConfig = config.pluginConfig as TomcatPluginConfig | undefined;
      const ssl = pluginConfig?.ssl;
      const disableAjp = pluginConfig?.disableAjp ?? true;

      for (const dir of INSTANCE_SEED_DIRS) {
        const src = path.join(homePath, dir);
        const dest = path.join(instancePath, dir);
        if (await exists(src)) {
          await copyDir(src, dest);
        }
      }

      for (const dir of INSTANCE_EMPTY_DIRS) {
        await ensureDir(path.join(instancePath, dir));
      }

      const serverXmlDest = path.join(instancePath, 'conf', 'server.xml');
      if (this.serverXmlTemplatePath && await exists(this.serverXmlTemplatePath)) {
        const serverXml = await fs.readFile(this.serverXmlTemplatePath, 'utf-8');

        // Copy keystore/truststore files if SSL enabled
        if (ssl?.enabled) {
          const keystoreExt = ssl.keystoreType === 'JKS' ? 'jks' : 'p12';
          const keystoreDest = path.join(instancePath, 'conf', `keystore.${keystoreExt}`);
          await fs.copyFile(ssl.keystorePath, keystoreDest);
          this.logger.info(`TomcatPlugin: copied keystore to ${keystoreDest}`);

          if (ssl.clientAuth && ssl.truststorePath) {
            const truststoreExt = (ssl.truststoreType ?? DEFAULT_TRUSTSTORE_TYPE) === 'JKS' ? 'jks' : 'p12';
            const truststoreDest = path.join(instancePath, 'conf', `truststore.${truststoreExt}`);
            await fs.copyFile(ssl.truststorePath, truststoreDest);
            this.logger.info(`TomcatPlugin: copied truststore to ${truststoreDest}`);
          }
        }

        // Patch server.xml via service (SSL connector injection/removal)
        const patchedXml = this.serverXmlService.patchConnectors(serverXml, { disableAjp, ssl });
        await fs.writeFile(serverXmlDest, patchedXml, 'utf-8');
        this.logger.info('TomcatPlugin: applied server.xml template (ports via JVM args)');
      } else if (disableAjp && await exists(serverXmlDest)) {
        const serverXml = await fs.readFile(serverXmlDest, 'utf-8');
        const patchedXml = this.serverXmlService.patchAjp(serverXml, true);
        await fs.writeFile(serverXmlDest, patchedXml, 'utf-8');
      }

      this.logger.info(`TomcatPlugin: initialized instance at ${instancePath}`);
      return ok(undefined);
    } catch (cause) {
      return err(new JsmError({
        code: ErrorCode.DeployFailed,
        message: `Failed to initialize instance path: ${instancePath}`,
        details: cause instanceof JsmError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : String(cause),
        suggestedFix: ['Check permissions on instance path', 'Verify CATALINA_HOME structure'],
        cause,
      }));
    }
  }

  async start(
    ctx: OperationContext,
    config: ServerConfig,
    mode: StartMode,
  ): Promise<Result<StartResult, JsmError>> {
    const script = this.getCatalinaScriptPath(config);

    if (!(await exists(script))) {
      return err(new JsmError({
        code: ErrorCode.ScriptNotExecutable,
        message: `Catalina script not found: ${script}`,
        suggestedFix: ['Check the Tomcat home path'],
      }));
    }

    const env = this.createCatalinaEnv(config, { includeRunEnv: true });
    const shutdownPort = await this.reserveShutdownPort(ctx, config);
    this.appendCatalinaOpts(env, config, shutdownPort, config.run.vmArgs);

    const startupMonitorResult = await this.createStartupMonitor(ctx.serverId, config);
    if (!startupMonitorResult.ok) {
      return startupMonitorResult;
    }
    const startupMonitor = startupMonitorResult.value;

    const args = this.buildStartArgs(env, config, mode);
    this.applyStartupMonitorJavaOpts(env, ctx.serverId, startupMonitor);

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
    this.trackChildProcess(ctx.serverId, child);

    const result = this.buildStartResult(config, mode, child.pid, startupMonitor);

    this.logger.info(`TomcatPlugin: started ${config.name} (PID ${child.pid}, mode=${mode})`);
    return ok(result);
  }

  // ── Lifecycle: Stop ─────────────────────────────────────────────────

  async stop(
    ctx: OperationContext,
    config: ServerConfig,
  ): Promise<Result<void, JsmError>> {
    this.throwIfCancelled(ctx, `Stop operation for '${config.name}' was cancelled before Tomcat shutdown.`);
    ctx.progress.report('Stopping Tomcat...');

    // Try graceful stop via catalina.sh stop
    const script = this.getCatalinaScriptPath(config);
    const env = this.createCatalinaEnv(config);
    const shutdownPort = this.resolveShutdownPortForStop(ctx, config);
    this.appendCatalinaOpts(env, config, shutdownPort);

    const exitCode = await this.invokeStopCommand(ctx, config, script, env);

    // Also kill the tracked child process if still running
    this.cleanupTrackedChildProcess(ctx.serverId);

    if (exitCode !== 0 && exitCode !== null) {
      this.logger.warn(`TomcatPlugin: stop script exited with code ${exitCode}`);
    }
    await this.keyValueStore.delete(SHUTDOWN_PORT_KEY_PREFIX + ctx.serverId);

    this.logger.info(`TomcatPlugin: stopped ${config.name}`);
    return ok(undefined);
  }

  // ── Deploy: Plan (§10.1, §10.2) ────────────────────────────────────

  async planDeploy(
    ctx: OperationContext,
    config: ServerConfig,
    dep: DeploymentConfig,
  ): Promise<Result<DeployPlan, JsmError>> {
    this.throwIfCancelled(ctx, `Deployment planning for '${dep.deployName}' was cancelled.`);
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
    this.throwIfCancelled(ctx, `Full deployment for '${dep.deployName}' was cancelled before copying artifacts.`);
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

      this.throwIfCancelled(ctx, `Full deployment for '${dep.deployName}' was cancelled before activating the staged artifact.`);

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

    const syncResult = await this.applyFileChanges(ctx, changes, plan.targetPath, {
      cancellationMessage: `Incremental deployment for '${dep.deployName}' was cancelled.`,
      failureMessage: `Incremental deploy failed for ${dep.deployName}`,
    });
    if (!syncResult.ok) {
      return syncResult;
    }

    this.logger.debug(`TomcatPlugin: incremental sync ${changes.changes.length} files for ${dep.deployName}`);
    return ok(undefined);
  }

  // ── Hot Reload ──────────────────────────────────────────────────────

  async hotReload(
    ctx: OperationContext,
    config: ServerConfig,
    dep: DeploymentConfig,
    changes: FileChangeBatch,
    plan: DeployPlan,
  ): Promise<Result<void, JsmError>> {
    if (plan.strategy !== 'incremental-dir') {
      return err(new JsmError({
        code: ErrorCode.Unsupported,
        message: 'Hot-reload only supports exploded directories',
      }));
    }

    ctx.progress.report(`Hot-reloading ${dep.deployName} (${changes.changes.length} files)...`);

    const copyResult = await this.applyFileChanges(ctx, changes, plan.targetPath, {
      cancellationMessage: `Hot reload for '${dep.deployName}' was cancelled.`,
      failureMessage: `Hot-reload file copy failed for ${dep.deployName}`,
    });
    if (!copyResult.ok) {
      return copyResult;
    }
    this.logger.debug(`TomcatPlugin: copied ${changes.changes.length} files for hot-reload of ${dep.deployName}`);

    // Step 2: Trigger Tomcat reload via Manager API or context.xml touch
    this.throwIfCancelled(ctx, `Hot reload for '${dep.deployName}' was cancelled before triggering the reload step.`);
    const reloadResult = await this.triggerContextReload(config, dep);
    if (!reloadResult.ok) {
      return reloadResult;
    }

    this.logger.info(`TomcatPlugin: hot-reload triggered for ${dep.deployName}`);
    return ok(undefined);
  }

  /**
   * Trigger Tomcat context reload via Manager API or context.xml touch.
   * Falls back to touch-based reload if Manager is not available.
   */
  private async triggerContextReload(
    config: ServerConfig,
    dep: DeploymentConfig,
  ): Promise<Result<void, JsmError>> {
    const managerResult = await this.callManagerReload(config, dep);
    if (managerResult.ok) {
      return ok(undefined);
    }

    this.logger.debug(`Manager reload failed for ${dep.deployName}, falling back to touch: ${managerResult.error.message}`);
    return this.touchContextXml(config, dep);
  }

  /**
   * Call Tomcat Manager /reload endpoint.
   * Requires manager-script role and credentials.
   */
  private async callManagerReload(
    config: ServerConfig,
    dep: DeploymentConfig,
  ): Promise<Result<void, JsmError>> {
    const managerUrl = `http://${config.host}:${config.ports.http}/manager/text`;
    const reloadUrl = `${managerUrl}/reload?path=/${dep.deployName}`;

    // Get credentials from environment or plugin config
    const username = config.run.env['JSM_MANAGER_USER'] ?? 'manager';
    const password = config.run.env['JSM_MANAGER_PASS'];

    if (!password) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: 'Tomcat Manager password not configured (set JSM_MANAGER_PASS env var)',
      }));
    }

    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    const timeoutMs = 10000;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(reloadUrl, {
        method: 'GET',
        headers: { 'Authorization': `Basic ${auth}` },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text();
        return err(new JsmError({
          code: ErrorCode.DeployFailed,
          message: `Manager reload failed: ${response.status} ${response.statusText}`,
          details: body,
        }));
      }

      const body = await response.text();
      if (!body.startsWith('OK')) {
        return err(new JsmError({
          code: ErrorCode.DeployFailed,
          message: `Manager reload rejected: ${body}`,
        }));
      }

      return ok(undefined);
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') {
        return err(new JsmError({
          code: ErrorCode.Timeout,
          message: 'Manager reload timed out',
        }));
      }
      return err(JsmError.fromUnknown(cause, ErrorCode.DeployFailed));
    }
  }

  /**
   * Touch context.xml to trigger Tomcat auto-deploy reload.
   * This is a fallback when Manager API is not available.
   */
  private async touchContextXml(
    config: ServerConfig,
    dep: DeploymentConfig,
  ): Promise<Result<void, JsmError>> {
    const reloadTarget = await this.resolveReloadTouchTarget(config, dep);
    if (!reloadTarget) {
      return err(new JsmError({
        code: ErrorCode.DeployFailed,
        message: `Neither context.xml nor webapp directory found for ${dep.deployName}`,
      }));
    }

    return this.touchReloadTarget(reloadTarget);
  }

  // ── Undeploy ────────────────────────────────────────────────────────

  async undeploy(
    ctx: OperationContext,
    config: ServerConfig,
    dep: DeploymentConfig,
  ): Promise<Result<void, JsmError>> {
    this.throwIfCancelled(ctx, `Undeploy for '${dep.deployName}' was cancelled before removing artifacts.`);
    ctx.progress.report(`Undeploying ${dep.deployName}...`);

    const targetRoot = path.join(config.instancePath, 'webapps');
    const targets = [
      path.join(targetRoot, dep.deployName),           // exploded dir
      path.join(targetRoot, `${dep.deployName}.war`),  // WAR file
    ];

    try {
      for (const target of targets) {
        this.throwIfCancelled(ctx, `Undeploy for '${dep.deployName}' was cancelled.`);
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

  private throwIfCancelled(ctx: OperationContext, message: string): void {
    throwIfCancelled(ctx.cancel, message);
  }

  // ── Status ──────────────────────────────────────────────────────────

  async getStatus(
    ctx: OperationContext,
    config: ServerConfig,
  ): Promise<Result<StatusReport, JsmError>> {
    const tracked = this.childProcesses.get(ctx.serverId);

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
      this.childProcesses.delete(ctx.serverId);
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

    return ok(undefined);
  }

  private getCatalinaScriptPath(config: ServerConfig): string {
    return path.join(config.runtime.homePath, 'bin', catalinaScript());
  }

  private async applyFileChanges(
    ctx: OperationContext,
    changes: FileChangeBatch,
    targetPath: string,
    options: {
      cancellationMessage: string;
      failureMessage: string;
    },
  ): Promise<Result<void, JsmError>> {
    try {
      const ensuredDirs = new Set<string>();
      for (const change of changes.changes) {
        this.throwIfCancelled(ctx, options.cancellationMessage);
        const targetFile = path.join(targetPath, change.relativePath);

        switch (change.type) {
          case 'add':
          case 'change':
            {
              const targetDir = path.dirname(targetFile);
              if (!ensuredDirs.has(targetDir)) {
                await ensureDir(targetDir);
                ensuredDirs.add(targetDir);
              }
            }
            await fs.copyFile(change.path, targetFile);
            break;
          case 'delete':
            await tryRm(targetFile);
            break;
        }
      }

      return ok(undefined);
    } catch (cause) {
      return err(new JsmError({
        code: ErrorCode.DeployFailed,
        message: options.failureMessage,
        details: cause instanceof Error ? cause.message : String(cause),
        cause,
      }));
    }
  }

  private async resolveReloadTouchTarget(
    config: ServerConfig,
    dep: DeploymentConfig,
  ): Promise<string | undefined> {
    const contextXmlPath = path.join(
      config.instancePath, 'conf', 'Catalina', 'localhost', `${dep.deployName}.xml`
    );
    if (await exists(contextXmlPath)) {
      return contextXmlPath;
    }

    const webappPath = path.join(config.instancePath, 'webapps', dep.deployName);
    if (await exists(webappPath)) {
      return webappPath;
    }

    return undefined;
  }

  private async touchReloadTarget(targetPath: string): Promise<Result<void, JsmError>> {
    try {
      const now = new Date();
      await fs.utimes(targetPath, now, now);
      this.logger.debug(`TomcatPlugin: touched ${targetPath} for reload`);
      return ok(undefined);
    } catch (cause) {
      return err(JsmError.fromUnknown(cause, ErrorCode.DeployFailed));
    }
  }

  private createCatalinaEnv(
    config: ServerConfig,
    options: { includeRunEnv?: boolean } = {},
  ): Record<string, string> {
    return {
      CATALINA_HOME: config.runtime.homePath,
      CATALINA_BASE: config.instancePath,
      JAVA_HOME: config.javaHome,
      ...(options.includeRunEnv ? config.run.env : {}),
    };
  }

  private configuredShutdownPort(config: ServerConfig): number {
    return (config.pluginConfig as TomcatPluginConfig | undefined)?.shutdownPort ?? DEFAULT_SHUTDOWN_PORT;
  }

  private async reserveShutdownPort(ctx: OperationContext, config: ServerConfig): Promise<number> {
    let shutdownPort = this.configuredShutdownPort(config);
    const free = await this.portScanner.findFreePort(shutdownPort);
    if (free !== null) {
      shutdownPort = free;
      await this.keyValueStore.set(SHUTDOWN_PORT_KEY_PREFIX + ctx.serverId, free);
    }
    return shutdownPort;
  }

  private resolveShutdownPortForStop(ctx: OperationContext, config: ServerConfig): number {
    let shutdownPort = this.configuredShutdownPort(config);
    const saved = this.keyValueStore.get<number>(SHUTDOWN_PORT_KEY_PREFIX + ctx.serverId);
    if (saved !== undefined) {
      shutdownPort = saved;
    }
    return shutdownPort;
  }

  private appendCatalinaOpts(
    env: Record<string, string>,
    config: ServerConfig,
    shutdownPort: number,
    additionalVmArgs: string[] = [],
  ): void {
    const catOpts = tomcatConfigVmArgs(config, shutdownPort);
    if (additionalVmArgs.length > 0) {
      catOpts.push(...additionalVmArgs);
    }
    if (catOpts.length > 0) {
      env['CATALINA_OPTS'] = ((env['CATALINA_OPTS'] ?? '') + ' ' + catOpts.join(' ')).trim();
    }
  }

  private async createStartupMonitor(
    serverKey: ServerId,
    config: ServerConfig,
  ): Promise<Result<TomcatStartupMonitor | undefined, JsmError>> {
    if (!this.startupListenerJarPath) {
      return ok(undefined);
    }

    if (!(await exists(this.startupListenerJarPath))) {
      return err(new JsmError({
        code: ErrorCode.SourceNotFound,
        message: `Tomcat startup listener asset not found: ${this.startupListenerJarPath}`,
      }));
    }

    const listenerConfiguredResult = await this.isStartupListenerConfigured(config);
    if (!listenerConfiguredResult.ok) {
      return listenerConfiguredResult;
    }
    if (!listenerConfiguredResult.value) {
      return ok(undefined);
    }

    const prepareResult = await this.prepareStartupListener(config);
    if (!prepareResult.ok) {
      return prepareResult;
    }

    try {
      return ok(await TomcatStartupMonitor.create({
        serverKey,
        serverName: config.name,
        logger: this.logger,
      }));
    } catch (cause) {
      return err(new JsmError({
        code: ErrorCode.Unknown,
        message: `Failed to initialize Tomcat startup callback for ${config.name}`,
        details: cause instanceof Error ? cause.message : String(cause),
        cause,
      }));
    }
  }

  private async isStartupListenerConfigured(
    config: ServerConfig,
  ): Promise<Result<boolean, JsmError>> {
    const serverXmlPath = path.join(config.instancePath, 'conf', 'server.xml');

    if (!(await exists(serverXmlPath))) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Tomcat instance server.xml not found at ${serverXmlPath}`,
        suggestedFix: ['Initialize the Tomcat instance path before starting the server'],
      }));
    }

    try {
      const serverXml = await fs.readFile(serverXmlPath, 'utf-8');
      return ok(serverXml.includes(TOMCAT_STARTUP_LISTENER_CLASS));
    } catch (cause) {
      return err(new JsmError({
        code: ErrorCode.ConfigReadFailed,
        message: `Failed to inspect Tomcat instance server.xml for ${config.name}`,
        details: cause instanceof Error ? cause.message : String(cause),
        cause,
      }));
    }
  }

  private buildStartArgs(
    env: Record<string, string>,
    config: ServerConfig,
    mode: StartMode,
  ): string[] {
    if (mode === 'debug') {
      const bind = config.debug.bind || '127.0.0.1';
      const debugPort = config.ports.debug ?? 5005;
      env['JPDA_ADDRESS'] = `${bind}:${debugPort}`;
      env['JPDA_TRANSPORT'] = 'dt_socket';
      return ['jpda', 'run'];
    }

    return ['run'];
  }

  private applyStartupMonitorJavaOpts(
    env: Record<string, string>,
    serverKey: ServerId,
    startupMonitor: TomcatStartupMonitor | undefined,
  ): void {
    if (!startupMonitor) {
      return;
    }

    const callbackVmArgs = [
      `-Djsm.startup.callback.url=${startupMonitor.callbackUrl}`,
      `-Djsm.startup.callback.token=${startupMonitor.token}`,
      `-Djsm.startup.callback.startupId=${startupMonitor.startupId}`,
      `-Djsm.startup.callback.serverKey=${serverKey}`,
    ];
    const existing = env['JAVA_OPTS'] ?? '';
    env['JAVA_OPTS'] = (existing + ' ' + callbackVmArgs.join(' ')).trim();
  }

  private trackChildProcess(serverId: string, child: ChildProcess): void {
    this.childProcesses.set(serverId, child);
    child.on('exit', (code, signal) => {
      this.childProcesses.delete(serverId);
      this.logger.info(`TomcatPlugin: process exited for ${serverId}`, { code, signal });
    });
  }

  private buildStartResult(
    config: ServerConfig,
    mode: StartMode,
    pid: number,
    startupMonitor: TomcatStartupMonitor | undefined,
  ): StartResult {
    const hints: string[] = [];
    const result: StartResult = {
      pid,
      httpUrl: `http://${config.host}:${config.ports.http}`,
      hints,
      startupMonitor,
    };

    if (mode === 'debug') {
      const debugPort = config.ports.debug ?? 5005;
      result.debugPort = debugPort;
      hints.push(`Debug port: ${debugPort}`);
    }

    return result;
  }

  private async invokeStopCommand(
    ctx: OperationContext,
    config: ServerConfig,
    script: string,
    env: Record<string, string>,
  ): Promise<number | null> {
    return new Promise<number | null>((resolve) => {
      const child = this.spawner.spawn({
        exe: script,
        args: ['stop'],
        env,
        onData: (chunk) => ctx.output.appendLine(chunk),
        onExit: (code) => resolve(code),
      });

      const timeout = config.timeouts?.stopMs ?? 20_000;
      const timer = setTimeout(() => {
        this.spawner.kill(child.pid!, true);
        resolve(null);
      }, timeout);

      child.on('exit', () => clearTimeout(timer));
    });
  }

  private cleanupTrackedChildProcess(serverId: string): void {
    const tracked = this.childProcesses.get(serverId);
    if (tracked?.pid) {
      this.spawner.kill(tracked.pid);
      this.childProcesses.delete(serverId);
    }
  }
}
