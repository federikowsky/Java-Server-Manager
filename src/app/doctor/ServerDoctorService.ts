import * as fs from 'fs/promises';
import * as path from 'path';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { Result } from '@core/result';
import { ok } from '@core/result';
import type { ServerConfig, ServerState, TrustGate } from '@core/types';
import type { TomcatPluginConfig } from '@core/types';

export type ServerDoctorSeverity = 'pass' | 'info' | 'warning' | 'error';

export interface ServerDoctorFinding {
  id: string;
  severity: ServerDoctorSeverity;
  message: string;
  details?: string;
  suggestedFix?: string[];
}

export interface ServerDoctorReport {
  serverId: string;
  serverName: string;
  generatedAt: string;
  summary: {
    passes: number;
    infos: number;
    warnings: number;
    errors: number;
  };
  findings: ServerDoctorFinding[];
}

export interface ServerDoctorInspectRequest {
  config: ServerConfig;
  workspaceFolderFsPath?: string;
  serverState?: ServerState;
}

export interface ServerDoctorPortProbe {
  isPortFree(port: number, host?: string): Promise<boolean>;
}

const LOCAL_PROBE_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function javaExecutableName(): string {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveWorkspacePath(sourcePath: string, workspaceFolderFsPath?: string): string {
  if (path.isAbsolute(sourcePath) || !workspaceFolderFsPath) {
    return sourcePath;
  }
  return path.resolve(workspaceFolderFsPath, sourcePath);
}

function resolveProbeHost(host: string): string {
  const candidate = host.trim() || '127.0.0.1';
  if (candidate === '0.0.0.0' || candidate === '::') {
    return '127.0.0.1';
  }
  return LOCAL_PROBE_HOSTS.has(candidate) ? candidate : '127.0.0.1';
}

export class ServerDoctorService {
  private readonly pluginRegistry: PluginRegistry;
  private readonly portProbe: ServerDoctorPortProbe;
  private readonly trustGate?: TrustGate;

  constructor(deps: {
    pluginRegistry: PluginRegistry;
    portProbe: ServerDoctorPortProbe;
    trustGate?: TrustGate;
  }) {
    this.pluginRegistry = deps.pluginRegistry;
    this.portProbe = deps.portProbe;
    this.trustGate = deps.trustGate;
  }

  async inspect(request: ServerDoctorInspectRequest): Promise<Result<ServerDoctorReport, never>> {
    const findings: ServerDoctorFinding[] = [];
    const { config } = request;

    findings.push(this.trustFinding());
    await this.inspectPlugin(config, findings);
    await this.inspectPaths(request, findings);
    await this.inspectPorts(request, findings);

    return ok({
      serverId: config.id,
      serverName: config.name,
      generatedAt: new Date().toISOString(),
      summary: this.summarize(findings),
      findings,
    });
  }

  private trustFinding(): ServerDoctorFinding {
    if (this.trustGate && !this.trustGate.isTrusted()) {
      return {
        id: 'trust.workspace',
        severity: 'error',
        message: 'Workspace trust is not granted.',
        suggestedFix: ['Grant workspace trust before starting, deploying, or running build hooks.'],
      };
    }

    return {
      id: 'trust.workspace',
      severity: 'pass',
      message: 'Workspace trust allows local server management.',
    };
  }

  private async inspectPlugin(config: ServerConfig, findings: ServerDoctorFinding[]): Promise<void> {
    const plugin = this.pluginRegistry.get(config.type);
    if (!plugin) {
      findings.push({
        id: `plugin.${config.type}`,
        severity: 'error',
        message: `No plugin is registered for server type '${config.type}'.`,
        suggestedFix: ['Install or enable the matching server plugin.'],
      });
      return;
    }

    findings.push({
      id: `plugin.${config.type}`,
      severity: 'pass',
      message: `Plugin '${config.type}' is registered.`,
    });

    const detectResult = await plugin.detectInstallation(config.runtime.homePath);
    if (detectResult.ok) {
      for (const check of detectResult.value.checks) {
        findings.push({
          id: `runtime.${check.id}`,
          severity: check.ok ? 'pass' : 'error',
          message: check.message,
          suggestedFix: check.ok ? undefined : [check.message],
        });
      }
      for (const warning of detectResult.value.warnings) {
        findings.push({
          id: 'runtime.warning',
          severity: 'warning',
          message: warning,
        });
      }
    }

    const validateResult = await plugin.validateConfig(config);
    findings.push(validateResult.ok
      ? {
        id: 'config.validation',
        severity: 'pass',
        message: 'Plugin configuration validation passed.',
      }
      : {
        id: 'config.validation',
        severity: 'error',
        message: validateResult.error.message,
        details: validateResult.error.details,
        suggestedFix: validateResult.error.suggestedFix,
      });
  }

  private async inspectPaths(
    request: ServerDoctorInspectRequest,
    findings: ServerDoctorFinding[],
  ): Promise<void> {
    const { config, workspaceFolderFsPath } = request;
    const javaPath = path.join(config.javaHome, 'bin', javaExecutableName());
    findings.push(await this.pathFinding({
      id: 'path.javaHome',
      targetPath: javaPath,
      passMessage: `Java executable found at ${javaPath}.`,
      failMessage: `Java executable not found at ${javaPath}.`,
      suggestedFix: ['Update JAVA_HOME to a JDK installation that contains bin/java.'],
    }));

    findings.push(await this.pathFinding({
      id: 'path.instancePath',
      targetPath: config.instancePath,
      passMessage: `Instance directory exists at ${config.instancePath}.`,
      failMessage: `Instance directory is missing at ${config.instancePath}.`,
      suggestedFix: ['Recreate the server instance or edit the server to use an existing managed instance path.'],
    }));

    for (const dep of config.deployments) {
      const sourcePath = resolveWorkspacePath(dep.sourcePath, workspaceFolderFsPath);
      findings.push(await this.pathFinding({
        id: `deployment.${dep.id}.source`,
        targetPath: sourcePath,
        passMessage: `Deployment source exists for '${dep.deployName}'.`,
        failMessage: `Deployment source for '${dep.deployName}' is missing at ${sourcePath}.`,
        suggestedFix: ['Build the artifact or edit the deployment source path.'],
      }));

      if (dep.build?.enabled && dep.build.kind === 'command' && dep.build.command?.cwd) {
        const cwdPath = resolveWorkspacePath(dep.build.command.cwd, workspaceFolderFsPath);
        findings.push(await this.pathFinding({
          id: `deployment.${dep.id}.build.cwd`,
          targetPath: cwdPath,
          passMessage: `Build working directory exists for '${dep.deployName}'.`,
          failMessage: `Build working directory for '${dep.deployName}' is missing at ${cwdPath}.`,
          suggestedFix: ['Edit the deployment build working directory or leave it empty to use the workspace folder.'],
        }));
      }
    }
  }

  private async pathFinding(args: {
    id: string;
    targetPath: string;
    passMessage: string;
    failMessage: string;
    suggestedFix: string[];
  }): Promise<ServerDoctorFinding> {
    const exists = await pathExists(args.targetPath);
    return exists
      ? { id: args.id, severity: 'pass', message: args.passMessage }
      : {
        id: args.id,
        severity: 'error',
        message: args.failMessage,
        suggestedFix: args.suggestedFix,
      };
  }

  private async inspectPorts(
    request: ServerDoctorInspectRequest,
    findings: ServerDoctorFinding[],
  ): Promise<void> {
    const { config } = request;
    const probeHost = resolveProbeHost(config.host);
    await this.inspectPort({
      id: 'port.http',
      label: 'HTTP',
      port: config.ports.http,
      host: probeHost,
      serverState: request.serverState,
      findings,
    });

    if (config.ports.debug !== undefined) {
      await this.inspectPort({
        id: 'port.debug',
        label: 'Debug',
        port: config.ports.debug,
        host: resolveProbeHost(config.debug.bind),
        serverState: request.serverState,
        findings,
      });
    }

    const ssl = (config.pluginConfig as TomcatPluginConfig | undefined)?.ssl;
    if (ssl?.enabled) {
      await this.inspectPort({
        id: 'port.ssl',
        label: 'HTTPS',
        port: ssl.port,
        host: probeHost,
        serverState: request.serverState,
        findings,
      });
    }
  }

  private async inspectPort(args: {
    id: string;
    label: string;
    port: number;
    host: string;
    serverState?: ServerState;
    findings: ServerDoctorFinding[];
  }): Promise<void> {
    if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
      args.findings.push({
        id: args.id,
        severity: 'error',
        message: `${args.label} port must be an integer between 1 and 65535.`,
        suggestedFix: ['Edit the server port configuration.'],
      });
      return;
    }

    const free = await this.portProbe.isPortFree(args.port, args.host);
    if (free) {
      args.findings.push({
        id: args.id,
        severity: 'pass',
        message: `${args.label} port ${args.port} is available on ${args.host}.`,
      });
      return;
    }

    if (args.serverState === 'running') {
      args.findings.push({
        id: args.id,
        severity: 'info',
        message: `${args.label} port ${args.port} is in use while the server is already running.`,
      });
      return;
    }

    args.findings.push({
      id: args.id,
      severity: 'error',
      message: `${args.label} port ${args.port} is already in use on ${args.host}.`,
      suggestedFix: ['Stop the process using the port or edit the server port.'],
    });
  }

  private summarize(findings: ServerDoctorFinding[]): ServerDoctorReport['summary'] {
    return {
      passes: findings.filter(finding => finding.severity === 'pass').length,
      infos: findings.filter(finding => finding.severity === 'info').length,
      warnings: findings.filter(finding => finding.severity === 'warning').length,
      errors: findings.filter(finding => finding.severity === 'error').length,
    };
  }
}
