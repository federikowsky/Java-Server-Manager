import * as path from 'path';
import * as vscode from 'vscode';
import {
  serverDraftToCreateServerRequest,
} from '@core/authoring';
import type { ServerAuthoringDraft } from '@core/authoring';
import type { HookConfig, ServerConfig, ServerId } from '@core/types';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import { createCancellationTokenSource } from '@core/ops';
import type { ServerLifecycle } from '@app/server/ServerLifecycle';
import type { ServerDiscoveryService } from '@app/server/ServerDiscoveryService';
import type { HookRunner } from '@app/hooks';
import { makeWorkspaceServerKey, type WorkspaceServiceRegistry, type WorkspaceScope } from '@app/config';
import type { WorkspaceServiceEntry } from '@app/config';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { ConfigSource } from '@plugins/interfaces/IServerPlugin';
import type { SchemaValidator } from '@core/validation/SchemaValidator';
import { normalizeHookList, validateHookList } from '@ui/webviews/hookForm';
import { exists } from '@infra/fs';
import { CURRENT_WORKSPACE_CONFIG_VERSION } from '@infra/fs/ConfigRepo';
import { HOOK_PHASE_BUDGET_MS } from '../../constants';
import type { ServerTreeViewProvider } from '@ui/tree/ServerTreeViewProvider';
import {
  isServerNode,
  registerMany,
  runQueuedActionWithProgressResult,
  showErr,
  showSuccess,
} from './shared';
import * as fs from 'fs/promises';
import type { ServerLogChannel } from '@ui/channels/ServerLogChannel';
import type { DashboardNavigationTarget } from '@ui/webviews/protocol';

type ServerCommandArg = {
  serverId: string;
  workspaceFolderUri: string;
  serverKey?: string;
  serverConfig?: ServerConfig;
};

type HookTestCommandArg = ServerCommandArg & {
  hook: HookConfig;
  targetDeploymentId?: string;
};

type ServerCommandContext = {
  arg: ServerCommandArg;
  serverKey: ServerId;
  label: string;
  resolvedConfig: ServerConfig | undefined;
};

type ServerQueueAction = (context: ServerCommandContext) => Result<void, JsmError>;

type ImportPlanEntry = {
  source: ServerConfig;
  planned: ServerConfig;
};

export interface ServerCommandsDeps {
  lifecycle: ServerLifecycle;
  pluginRegistry: PluginRegistry;
  logChannel: ServerLogChannel;
  hookRunner?: HookRunner;
  workspaceRegistry?: WorkspaceServiceRegistry;
  configService?: {
    getServer(serverId: string): ServerConfig | undefined;
    reload(): Promise<Result<unknown, JsmError>>;
  };
  provisioningService?: {
    removeServer(serverId: string): Promise<Result<void, JsmError>>;
  };
  discoveryService?: ServerDiscoveryService;
  treeProvider: ServerTreeViewProvider;
  schemaValidator?: SchemaValidator;
  openDashboard?: (target?: DashboardNavigationTarget) => void;
}

async function pickWorkspaceScope(scopes: WorkspaceScope[]): Promise<WorkspaceScope | undefined> {
  if (scopes.length === 0) return undefined;
  if (scopes.length === 1) return scopes[0];

  return vscode.window.showQuickPick(
    scopes.map(scope => ({
      label: scope.name,
      description: scope.fsPath,
      scope,
    })),
    {
      placeHolder: 'Select the workspace folder that will own this server',
      ignoreFocusOut: true,
    },
  ).then(selection => selection?.scope);
}

async function revealFolder(targetPath: string): Promise<void> {
  await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(targetPath));
}

async function openConfigFile(targetPath: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
  await vscode.window.showTextDocument(document, { preview: false });
}

async function revealFolderSafely(targetPath: string): Promise<Result<void, JsmError>> {
  try {
    await revealFolder(targetPath);
    return ok(undefined);
  } catch (e) {
    return err(JsmError.fromUnknown(e, ErrorCode.InvalidConfig));
  }
}

async function openConfigFileSafely(targetPath: string): Promise<Result<void, JsmError>> {
  try {
    await openConfigFile(targetPath);
    return ok(undefined);
  } catch (e) {
    return err(JsmError.fromUnknown(e, ErrorCode.InvalidConfig));
  }
}

async function resolveConfigSources(
  pluginRegistry: PluginRegistry,
  config: ServerConfig,
): Promise<Result<ConfigSource[], JsmError>> {
  const plugin = pluginRegistry.get(config.type);
  if (!plugin) {
    return err(new JsmError({
      code: ErrorCode.InvalidConfig,
      message: `No plugin registered for server type '${config.type}'.`,
    }));
  }

  if (!plugin.getConfigSources) {
    return ok([]);
  }

  return plugin.getConfigSources(config);
}

function resolveServerKey(
  workspaceRegistry: WorkspaceServiceRegistry | undefined,
  arg: ServerCommandArg,
): ServerId {
  if (typeof arg.serverKey === 'string' && arg.serverKey.length > 0) {
    return arg.serverKey as ServerId;
  }
  if (workspaceRegistry) {
    return makeWorkspaceServerKey(arg.workspaceFolderUri, arg.serverId);
  }
  return arg.serverId as ServerId;
}

function getContextConfig(
  context: ServerCommandContext,
  options: { allowInlineConfig?: boolean } = {},
): ServerConfig | undefined {
  return context.resolvedConfig ?? (options.allowInlineConfig ? context.arg.serverConfig : undefined);
}

function serverConfigNotFoundError(): JsmError {
  return new JsmError({
    code: ErrorCode.InvalidConfig,
    message: 'Server configuration not found.',
  });
}

function serverSelectionRequiredError(actionLabel: string): JsmError {
  return new JsmError({
    code: ErrorCode.InvalidConfig,
    message: `${actionLabel} requires a server selected in the Java Server Manager view.`,
  });
}

async function pickConfigSource(
  candidates: ConfigSource[],
  serverName: string,
): Promise<ConfigSource | undefined> {
  if (candidates.length === 0) {
    return undefined;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const picked = await vscode.window.showQuickPick(
    candidates.map(candidate => ({
      label: candidate.title,
      description: candidate.description,
      detail: candidate.path,
      candidate,
    })),
    {
      placeHolder: `Open a configuration file for '${serverName}'`,
      ignoreFocusOut: true,
    },
  );

  return picked?.candidate;
}

async function writeExportFile(
  filePath: string,
  configs: ServerConfig[],
): Promise<Result<void, JsmError>> {
  try {
    await fs.writeFile(
      filePath,
      JSON.stringify({ version: CURRENT_WORKSPACE_CONFIG_VERSION, servers: configs }, null, 2),
      'utf8',
    );
    return ok(undefined);
  } catch (e) {
    return err(JsmError.fromUnknown(e));
  }
}

async function readImportedServerConfigs(
  filePath: string,
  schemaValidator: SchemaValidator,
): Promise<Result<ServerConfig[], JsmError>> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (e) {
    return err(JsmError.fromUnknown(e));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return err(new JsmError({
      code: ErrorCode.InvalidConfig,
      message: 'Invalid JSON.',
    }));
  }

  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { servers?: unknown }).servers)) {
    return err(new JsmError({
      code: ErrorCode.InvalidConfig,
      message: 'Invalid format: expected { servers: [...] }.',
    }));
  }

  const validationResult = schemaValidator.validate(parsed, 'workspace');
  if (!validationResult.ok) {
    return err(validationResult.error);
  }

  return ok((parsed as { servers: ServerConfig[] }).servers);
}

async function buildImportPlan(
  entry: WorkspaceServiceEntry,
  serverConfigs: ServerConfig[],
): Promise<Result<ImportPlanEntry[], JsmError>> {
  const plan: ImportPlanEntry[] = [];
  for (const serverConfig of serverConfigs) {
    const planResult = await entry.provisioningService.planDuplicateServer(serverConfig, { keepName: true });
    if (!planResult.ok) {
      return err(new JsmError({
        code: planResult.error.code,
        message: `Cannot import server '${serverConfig.name}': ${planResult.error.message}`,
        details: planResult.error.details,
        cause: planResult.error,
      }));
    }
    plan.push({ source: serverConfig, planned: planResult.value });
  }

  const validateResult = entry.configService.validateServerCandidates(plan.map(item => item.planned));
  if (!validateResult.ok) {
    return err(validateResult.error);
  }

  return ok(plan);
}

function formatImportPlanDetails(plan: ImportPlanEntry[], scope: WorkspaceScope): string {
  const previewLimit = 8;
  const lines = plan.slice(0, previewLimit).map(item =>
    `- ${item.source.name} -> ${item.planned.name} (${item.source.type}, `
    + `${item.source.deployments.length} deployment(s))`,
  );
  if (plan.length > previewLimit) {
    lines.push(`- ...and ${plan.length - previewLimit} more server(s)`);
  }

  return [
    `Workspace: ${scope.name}`,
    '',
    'JSM will create new managed instances from this import. Existing servers are not modified.',
    '',
    ...lines,
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatHookValidationFailure(errors: Array<{ field: string; message: string }>): string {
  const preview = errors.slice(0, 3).map(error => `${error.field}: ${error.message}`);
  if (errors.length > 3) {
    preview.push(`...and ${errors.length - 3} more issue(s)`);
  }
  return preview.join('; ');
}

export function registerServerCommands(
  deps: ServerCommandsDeps,
): vscode.Disposable[] {
  const {
    lifecycle,
    pluginRegistry,
    logChannel,
    hookRunner,
    workspaceRegistry,
    configService,
    provisioningService,
    treeProvider,
    schemaValidator,
    openDashboard,
  } = deps;

  const resolveServer = (workspaceFolderUri: string, serverId: string) => workspaceRegistry
    ? workspaceRegistry.getServer({ workspaceFolderUri, serverId })
    : configService?.getServer(serverId);
  const createContext = (arg: ServerCommandArg): ServerCommandContext => {
    const resolvedConfig = resolveServer(arg.workspaceFolderUri, arg.serverId);
    return {
      arg,
      serverKey: resolveServerKey(workspaceRegistry, arg),
      label: arg.serverConfig?.name ?? resolvedConfig?.name ?? arg.serverId,
      resolvedConfig,
    };
  };

  const requireContextConfig = (
    context: ServerCommandContext,
    options: { allowInlineConfig?: boolean } = {},
  ): ServerConfig | undefined => {
    const config = getContextConfig(context, options);
    if (!config) {
      showErr(serverConfigNotFoundError());
    }
    return config;
  };

  const requireServerCommandArg = (
    arg: unknown,
    actionLabel: string,
  ): ServerCommandArg | undefined => {
    if (isServerNode(arg)) {
      return arg as ServerCommandArg;
    }

    showErr(serverSelectionRequiredError(actionLabel));
    return undefined;
  };

  const requireHookTestArg = (arg: unknown): HookTestCommandArg | undefined => {
    const resolvedArg = requireServerCommandArg(arg, 'Testing a hook');
    if (!resolvedArg || !isRecord(arg) || !isRecord(arg['hook'])) {
      const error = new JsmError({
        code: ErrorCode.InvalidConfig,
        message: 'Testing a hook requires a server context and a hook definition.',
      });
      showErr(error);
      return undefined;
    }

    const targetDeploymentId = arg['targetDeploymentId'];
    if (targetDeploymentId !== undefined && (typeof targetDeploymentId !== 'string' || targetDeploymentId.trim().length === 0)) {
      const error = new JsmError({
        code: ErrorCode.InvalidConfig,
        message: 'Hook test deployment target is invalid.',
      });
      showErr(error);
      return undefined;
    }

    const hookErrors = validateHookList([arg['hook']], 'hook');
    if (hookErrors.length > 0) {
      const error = new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Hook cannot be tested until it is valid: ${formatHookValidationFailure(hookErrors)}`,
      });
      showErr(error);
      return undefined;
    }

    const [hook] = normalizeHookList([arg['hook']]);
    return {
      ...resolvedArg,
      hook,
      ...(targetDeploymentId ? { targetDeploymentId } : {}),
    };
  };

  const runQueueAction = async (
    context: ServerCommandContext,
    title: string,
    action: ServerQueueAction,
  ): Promise<boolean> => {
    const result = await runQueuedActionWithProgressResult(
      { title, serverKey: context.serverKey },
      lifecycle,
      () => action(context),
    );
    if (!result.ok) {
      showErr(result.error);
      return false;
    }
    return true;
  };

  const prepareDeploymentsIfNeeded = async (context: ServerCommandContext): Promise<boolean> => {
    if (!context.resolvedConfig?.deployments.length) {
      return true;
    }

    return runQueueAction(
      context,
      `Preparing deployments for ${context.label}...`,
      () => lifecycle.enqueueDeployUndeployed(context.serverKey),
    );
  };

  const runServerQueueCommand = async (
    arg: unknown,
    options: {
      actionLabel: string;
      title: (context: ServerCommandContext) => string;
      action: ServerQueueAction;
      prepareDeployments?: boolean;
      onSuccess?: (context: ServerCommandContext) => void;
    },
  ): Promise<void> => {
    const resolvedArg = requireServerCommandArg(arg, options.actionLabel);
    if (!resolvedArg) return;
    const context = createContext(resolvedArg);
    if (options.prepareDeployments && !await prepareDeploymentsIfNeeded(context)) {
      return;
    }

    const completed = await runQueueAction(context, options.title(context), options.action);
    if (completed) {
      options.onSuccess?.(context);
    }
  };

  const openDashboardTarget = (target: DashboardNavigationTarget): void => {
    if (openDashboard) {
      openDashboard(target);
      return;
    }
    void vscode.commands.executeCommand('jsm.dashboard.open', target);
  };

  const refreshRunningServerState = async (): Promise<void> => {
    const runningOrStartingKeys = lifecycle.getServerKeysInState('running', 'starting');
    for (const serverKey of runningOrStartingKeys) {
      lifecycle.refreshStatus(serverKey);
    }

    if (!workspaceRegistry) {
      return;
    }

    await Promise.all(
      runningOrStartingKeys.map(async serverKey => {
        const record = workspaceRegistry.getServerRecordByKey(serverKey);
        if (!record?.config) return;
        const enqueued = lifecycle.enqueueRunDeploymentHealthChecks(serverKey);
        if (!enqueued.ok) return;
        await lifecycle.waitUntilQueueIdle(serverKey);
      }),
    );
  };

  const getWorkspaceEntry = (workspaceFolderUri: string) => {
    const entry = workspaceRegistry?.getEntry(workspaceFolderUri);
    if (entry) {
      return entry;
    }

    showErr(new JsmError({
      code: ErrorCode.InvalidConfig,
      message: 'Workspace not found.',
      details: workspaceFolderUri,
    }));
    return undefined;
  };

  return registerMany([
    ['jsm.server.add', async (arg: unknown) => {
      if (arg && typeof arg === 'object' && 'workspaceFolderUri' in arg) {
        const draftArg = arg as { draft?: unknown; workspaceFolderUri: string };
        if (!workspaceRegistry) {
          return { ok: false, message: 'Workspace registry not available' };
        }
        const entry = workspaceRegistry.getEntry(draftArg.workspaceFolderUri);
        if (!entry) {
          return { ok: false, message: 'Workspace not found.' };
        }

        const request = draftArg.draft && typeof draftArg.draft === 'object'
          ? serverDraftToCreateServerRequest(draftArg.draft as ServerAuthoringDraft)
          : undefined;
        if (!request) {
          return { ok: false, message: 'Invalid server draft payload.' };
        }

        const result = await entry.provisioningService.createServer(request);
        if (!result.ok) {
          return { ok: false, message: result.error.message };
        }

        treeProvider.requestRefresh();
        return {
          ok: true,
          message: `Server "${result.value.name}" created.`,
          data: {
            serverId: result.value.id,
            serverKey: makeWorkspaceServerKey(draftArg.workspaceFolderUri, result.value.id),
            workspaceFolderUri: draftArg.workspaceFolderUri,
          },
        };
      }

      const nav: DashboardNavigationTarget = { type: 'new-server', globalTab: 'home' };
      openDashboardTarget(nav);
      return undefined;
    }],

    ['jsm.hook.test', async (arg: unknown) => {
      const resolvedArg = requireHookTestArg(arg);
      if (!resolvedArg) {
        return { ok: false, message: 'Invalid hook test request.' };
      }

      if (!hookRunner) {
        const error = new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Hook testing is not available in this session.',
        });
        showErr(error);
        return { ok: false, message: error.message };
      }

      const context = createContext(resolvedArg);
      const config = requireContextConfig(context);
      if (!config) {
        return { ok: false, message: serverConfigNotFoundError().message };
      }

      const confirmation = await vscode.window.showWarningMessage(
        `Run hook "${resolvedArg.hook.id}" for "${context.label}" now? This may execute local commands or VS Code tasks.`,
        { modal: true },
        'Run Hook',
      );
      if (confirmation !== 'Run Hook') {
        return { ok: false, message: 'Hook test cancelled.' };
      }

      const cancellation = createCancellationTokenSource();
      const channel = logChannel.getChannel(context.serverKey, context.label);
      logChannel.showLogs(context.serverKey, context.label);
      channel.appendLine(`[JSM] Testing hook "${resolvedArg.hook.id}" (${resolvedArg.hook.phase} ${resolvedArg.hook.event})`);

      const timeoutMs = Math.max(
        1000,
        Math.min(resolvedArg.hook.timeoutMs ?? 60_000, HOOK_PHASE_BUDGET_MS),
      );

      const runResult = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Testing hook ${resolvedArg.hook.id}...`,
          cancellable: true,
        },
        async (_progress, token) => {
          const subscription = token.onCancellationRequested(() => {
            cancellation.cancel();
          });
          try {
            return await hookRunner.runHooks({
              parent: {
                operationId: `hook-test-${Date.now()}`,
                serverId: context.serverKey,
                kind: 'StatusRefresh',
                startedAt: Date.now(),
                timeoutMs,
                cancel: cancellation.token,
                progress: {
                  report: message => channel.appendLine(message),
                },
                output: {
                  append: text => channel.append(text),
                  appendLine: text => channel.appendLine(text),
                  clear: () => {},
                },
                ...(resolvedArg.targetDeploymentId ? { targetDeploymentId: resolvedArg.targetDeploymentId } : {}),
              },
              phase: resolvedArg.hook.phase,
              event: resolvedArg.hook.event,
              hooks: [{ ...resolvedArg.hook, enabled: true }],
              targetDeploymentId: resolvedArg.targetDeploymentId,
            });
          } finally {
            subscription.dispose();
          }
        },
      );

      if (!runResult.ok) {
        channel.appendLine(`[JSM] Hook test failed: ${runResult.error.message}`);
        showErr(runResult.error);
        return { ok: false, message: runResult.error.message };
      }

      if (runResult.value.failed > 0) {
        const error = runResult.value.errors[0] ?? new JsmError({
          code: ErrorCode.HookFailed,
          message: `Hook "${resolvedArg.hook.id}" failed.`,
        });
        channel.appendLine(`[JSM] Hook test failed: ${error.message}`);
        showErr(error);
        return { ok: false, message: error.message };
      }

      const message = `Hook "${resolvedArg.hook.id}" completed.`;
      channel.appendLine(`[JSM] ${message}`);
      showSuccess(message);
      return { ok: true, message };
    }],

    ['jsm.server.startRun', async (arg: unknown) => runServerQueueCommand(arg, {
      actionLabel: 'Starting a server',
      title: context => `Starting ${context.label}...`,
      action: context => lifecycle.start(context.serverKey, 'run'),
      prepareDeployments: true,
    })],

    ['jsm.server.startDebug', async (arg: unknown) => runServerQueueCommand(arg, {
      actionLabel: 'Starting a server in debug mode',
      title: context => `Starting ${context.label} (debug)...`,
      action: context => lifecycle.start(context.serverKey, 'debug'),
      prepareDeployments: true,
    })],

    ['jsm.server.stop', async (arg: unknown) => runServerQueueCommand(arg, {
      actionLabel: 'Stopping a server',
      title: context => `Stopping ${context.label}...`,
      action: context => lifecycle.stop(context.serverKey),
    })],

    ['jsm.server.restartRun', async (arg: unknown) => runServerQueueCommand(arg, {
      actionLabel: 'Restarting a server',
      title: context => `Restarting ${context.label}...`,
      action: context => lifecycle.restart(context.serverKey, 'run'),
    })],

    ['jsm.server.restartDebug', async (arg: unknown) => runServerQueueCommand(arg, {
      actionLabel: 'Restarting a server in debug mode',
      title: context => `Restarting ${context.label} (debug)...`,
      action: context => lifecycle.restart(context.serverKey, 'debug'),
    })],

    ['jsm.server.attachDebug', async (arg: unknown) => {
      const resolvedArg = requireServerCommandArg(arg, 'Attaching the debugger');
      if (!resolvedArg) return;
      const context = createContext(resolvedArg);
      const result = await lifecycle.attachDebug(context.serverKey);
      if (!result.ok) showErr(result.error);
      else showSuccess('Debugger attached.');
    }],

    ['jsm.server.detachDebug', async (arg: unknown) => {
      const resolvedArg = requireServerCommandArg(arg, 'Detaching the debugger');
      if (!resolvedArg) return;
      const context = createContext(resolvedArg);
      const result = await lifecycle.detachDebug(context.serverKey);
      if (!result.ok) showErr(result.error);
      else showSuccess('Debugger detached.');
    }],

    ['jsm.server.cancelOperation', (arg: unknown) => {
      const resolvedArg = requireServerCommandArg(arg, 'Cancelling an operation');
      if (!resolvedArg) return;
      lifecycle.cancel(createContext(resolvedArg).serverKey);
    }],

    ['jsm.server.showLogs', (arg: unknown) => {
      const resolvedArg = requireServerCommandArg(arg, 'Opening server logs');
      if (!resolvedArg) return;
      const context = createContext(resolvedArg);
      logChannel.showLogs(context.serverKey, context.label);
    }],

    ['jsm.server.edit', (arg: unknown) => {
      const resolvedArg = requireServerCommandArg(arg, 'Editing a server');
      if (!resolvedArg) return;
      const serverKey = resolveServerKey(workspaceRegistry, resolvedArg);
      openDashboardTarget({
        type: 'server',
        id: serverKey,
        serverId: resolvedArg.serverId,
        serverKey,
        workspaceFolderUri: resolvedArg.workspaceFolderUri,
        globalTab: 'home',
      });
    }],

    ['jsm.server.duplicate', async (arg: unknown) => {
      const resolvedArg = requireServerCommandArg(arg, 'Duplicating a server');
      if (!resolvedArg) return;

      if (!workspaceRegistry) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Duplicate server is only available when using workspace registry.',
        }));
        return;
      }

      const entry = getWorkspaceEntry(resolvedArg.workspaceFolderUri);
      if (!entry) {
        return;
      }

      const context = createContext(resolvedArg);
      const sourceConfig = requireContextConfig(context, { allowInlineConfig: true });
      if (!sourceConfig) {
        return;
      }

      const result = await entry.provisioningService.duplicateServer(sourceConfig);
      if (!result.ok) {
        showErr(result.error);
        return;
      }
      showSuccess(`Server "${result.value.name}" added with its own instance.`);
      treeProvider.requestRefresh();
    }],

    ['jsm.server.remove', async (arg: unknown) => {
      const resolvedArg = requireServerCommandArg(arg, 'Removing a server');
      if (!resolvedArg) return;
      const context = createContext(resolvedArg);
      const answer = await vscode.window.showWarningMessage(
        `Remove server "${context.label}"? This cannot be undone.`,
        { modal: true },
        'Remove',
      );
      if (answer !== 'Remove') return;

      const result = workspaceRegistry
        ? await workspaceRegistry.getEntry(context.arg.workspaceFolderUri)?.provisioningService.removeServer(context.arg.serverId)
        : await provisioningService?.removeServer(context.arg.serverId);
      if (!result) return;
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Server "${context.label}" removed.`);
      treeProvider.requestRefresh();
    }],

    ['jsm.server.openFolder', async (arg: unknown) => {
      const resolvedArg = requireServerCommandArg(arg, 'Opening a server folder');
      if (!resolvedArg) return;
      const context = createContext(resolvedArg);
      const config = requireContextConfig(context, { allowInlineConfig: true });
      if (!config) {
        return;
      }

      const configuredPath = config.instancePath.trim();
      if (!configuredPath) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: `Folder path is missing for server '${config.name}'.`,
        }));
        return;
      }

      if (await exists(configuredPath)) {
        const revealResult = await revealFolderSafely(configuredPath);
        if (!revealResult.ok) {
          showErr(revealResult.error);
        }
        return;
      }

      const fallbackPath = path.dirname(configuredPath);
      if (fallbackPath && fallbackPath !== configuredPath && await exists(fallbackPath)) {
        const revealResult = await revealFolderSafely(fallbackPath);
        if (!revealResult.ok) {
          showErr(revealResult.error);
        }
        return;
      }

      showErr(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Folder is not accessible for server '${config.name}'.`,
        details: configuredPath,
      }));
    }],

    ['jsm.server.openConfig', async (arg: unknown) => {
      const resolvedArg = requireServerCommandArg(arg, 'Opening server configuration');
      if (!resolvedArg) return;
      const context = createContext(resolvedArg);
      const config = requireContextConfig(context, { allowInlineConfig: true });
      if (!config) {
        return;
      }

      const sourcesResult = await resolveConfigSources(pluginRegistry, config);
      if (!sourcesResult.ok) {
        showErr(sourcesResult.error);
        return;
      }

      const candidates = sourcesResult.value;
      if (candidates.length === 0) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: `No editable configuration files were found for server '${config.name}'.`,
          details: `The '${config.type}' plugin did not expose any existing config files for this server.`,
        }));
        return;
      }

      const picked = await pickConfigSource(candidates, config.name);
      if (!picked) {
        return;
      }

      const openResult = await openConfigFileSafely(picked.path);
      if (!openResult.ok) {
        showErr(openResult.error);
      }
    }],

    ['jsm.server.redeployAll', async (arg: unknown) => {
      const resolvedArg = requireServerCommandArg(arg, 'Redeploying all applications');
      if (!resolvedArg) return;
      const context = createContext(resolvedArg);
      const config = requireContextConfig(context, { allowInlineConfig: true });
      if (!config || config.deployments.length === 0) return;
      const completed = await runQueueAction(
        context,
        `Redeploying all applications on ${config.name}...`,
        () => lifecycle.enqueueRedeployAll(context.serverKey),
      );
      if (completed) {
        showSuccess(`Redeploy All completed for "${config.name}".`);
      }
    }],

    ['jsm.view.refresh', async () => {
      const result = workspaceRegistry
        ? await workspaceRegistry.reloadAll()
        : await configService?.reload();
      if (!result) return;
      if (!result.ok) { showErr(result.error); return; }
      await refreshRunningServerState();
      treeProvider.forceRefresh();
    }],

    ['jsm.server.export', async () => {
      if (!workspaceRegistry) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Export is only available when using workspace registry.',
        }));
        return;
      }
      const scope = await pickWorkspaceScope(workspaceRegistry.getWorkspaceScopes());
      if (!scope) return;
      const records = workspaceRegistry.getServers(scope.uri);
      const configs = records.map(r => r.config);
      if (configs.length === 0) {
        void vscode.window.showInformationMessage('JSM: No servers to export in this workspace.');
        return;
      }
      const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
      const saveUri = await vscode.window.showSaveDialog({
        filters: { JSON: ['json'] },
        defaultUri: defaultUri ? vscode.Uri.joinPath(defaultUri, 'jsm.servers.export.json') : undefined,
      });
      if (!saveUri) return;
      const writeResult = await writeExportFile(saveUri.fsPath, configs);
      if (!writeResult.ok) {
        showErr(writeResult.error);
        return;
      }
      showSuccess(`Config exported to ${saveUri.fsPath}.`);
    }],

    ['jsm.server.import', async () => {
      if (!workspaceRegistry) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Import is only available when using workspace registry.',
        }));
        return;
      }
      if (!schemaValidator) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Import requires schema validator.',
        }));
        return;
      }
      const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: false,
        filters: { JSON: ['json'] },
        defaultUri: defaultUri ?? undefined,
      });
      if (!uris?.length) return;
      const fileUri = uris[0];
      const readResult = await readImportedServerConfigs(fileUri.fsPath, schemaValidator);
      if (!readResult.ok) {
        showErr(readResult.error);
        return;
      }
      const serverConfigs = readResult.value;
      if (serverConfigs.length === 0) {
        void vscode.window.showInformationMessage('JSM: No servers in file.');
        return;
      }
      const scope = await pickWorkspaceScope(workspaceRegistry.getWorkspaceScopes());
      if (!scope) return;
      const entry = workspaceRegistry.getEntry(scope.uri);
      if (!entry) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Workspace not found.',
        }));
        return;
      }
      const planResult = await buildImportPlan(entry, serverConfigs);
      if (!planResult.ok) {
        showErr(planResult.error);
        return;
      }

      const plan = planResult.value;
      const confirmation = await vscode.window.showWarningMessage(
        `Import ${plan.length} server(s) into workspace "${scope.name}"?`,
        {
          modal: true,
          detail: formatImportPlanDetails(plan, scope),
        },
        'Import',
      );
      if (confirmation !== 'Import') {
        return;
      }

      let imported = 0;
      let importError: JsmError | undefined;
      for (const item of plan) {
        const result = await entry.provisioningService.provisionPlannedDuplicate(item.source, item.planned);
        if (!result.ok) {
          importError = result.error;
          break;
        }
        imported += 1;
      }
      if (importError) {
        if (imported > 0) {
          void vscode.window.showWarningMessage(
            `JSM: Imported ${imported} server(s) into workspace "${scope.name}" before import stopped: ${importError.message}`,
          );
          treeProvider.requestRefresh();
          return;
        }
        showErr(importError);
        return;
      }
      if (imported > 0) {
        showSuccess(`Imported ${imported} server(s) into workspace "${scope.name}".`);
        treeProvider.requestRefresh();
      }
    }],
  ]);
}
