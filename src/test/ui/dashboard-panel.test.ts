import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@core/types/logger';

const mocked = vi.hoisted(() => ({
  buildDashboardPanelHtml: vi.fn(() => '<html></html>'),
  buildDashboardSyncStatePayload: vi.fn(() => ({
    servers: [],
    runtimeStates: {},
	    deploymentStates: {},
	    templates: [],
	    operationHistory: {},
	    autosyncDiagnostics: {},
	    capabilities: {},
    workspaceFolders: [],
    settings: {
      defaultHttpPort: 8080,
      defaultDebugPort: 5005,
	      defaultJavaHome: '',
	      showStatusInSidebar: true,
	      localTelemetryEnabled: false,
	    },
    workspaceTrusted: true,
  })),
  buildServerFormSchema: vi.fn(() => ({ title: 'Server Form', sections: [] })),
  buildTemplateFormSchema: vi.fn(() => ({ title: 'Template Form', sections: [] })),
  fetchHookTaskOptions: vi.fn(async () => [{ value: 'task:build', label: 'Build task' }]),
  areHookTaskOptionsEqual: vi.fn((a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)),
  submitServerConfigForm: vi.fn(async () => undefined),
  submitTemplateConfigForm: vi.fn(async () => ({ ok: false as const })),
  deleteServerWithConfirm: vi.fn(async () => undefined),
  saveTemplateFromWebview: vi.fn(async () => ({ ok: true })),
  deleteTemplateWithConfirm: vi.fn(async () => ({ ok: false })),
  serverConfigToFormData: vi.fn((config: { name: string; type: string }) => ({
    name: config.name,
    pluginType: config.type,
  })),
  templateToServerFormData: vi.fn((template: { runtimeHomePath?: string }) => ({
    runtimeHomePath: template.runtimeHomePath ?? '/runtime',
  })),
  configUpdate: vi.fn(async () => undefined),
  configGet: vi.fn((_key: string, fallback?: unknown) => fallback),
  showWarningMessage: vi.fn(),
  showOpenDialog: vi.fn(),
  showInformationMessage: vi.fn(),
  showQuickPick: vi.fn(),
  withProgress: vi.fn(async (
    _options: unknown,
    task: (progress: { report: ReturnType<typeof vi.fn> }, token: {
      isCancellationRequested: boolean;
      onCancellationRequested: (listener: () => void) => { dispose: ReturnType<typeof vi.fn> };
    }) => unknown,
  ) => task(
    { report: vi.fn() },
    {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: vi.fn() }),
    },
  )),
  createWebviewPanel: vi.fn(),
  executeCommand: vi.fn(),
  postMessage: vi.fn(),
  panelReveal: vi.fn(),
  panelDispose: vi.fn(),
  messageSubscriptionDispose: vi.fn(),
  panelSubscriptionDispose: vi.fn(),
  webviewMessageHandler: undefined as undefined | ((raw: unknown) => unknown),
  panelDisposeHandler: undefined as undefined | (() => void),
  busListeners: new Map<string, Array<(payload: unknown) => void>>(),
  busDisposables: [] as Array<{ dispose: ReturnType<typeof vi.fn> }>,
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      update: mocked.configUpdate,
      get: mocked.configGet,
    })),
    isTrusted: true,
  },
  window: {
    showWarningMessage: mocked.showWarningMessage,
    showOpenDialog: mocked.showOpenDialog,
    showInformationMessage: mocked.showInformationMessage,
    showQuickPick: mocked.showQuickPick,
    withProgress: mocked.withProgress,
    createWebviewPanel: (...args: unknown[]) => mocked.createWebviewPanel(...args),
  },
  commands: {
    executeCommand: mocked.executeCommand,
  },
  ConfigurationTarget: {
    Global: 1,
  },
  ProgressLocation: {
    Notification: 15,
  },
  ViewColumn: {
    One: 1,
  },
  Uri: {
    joinPath: vi.fn((base: { fsPath: string; path: string }, ...segments: string[]) => ({
      fsPath: [base.fsPath, ...segments].join('/'),
      path: [base.path, ...segments].join('/'),
    })),
    file: (path: string) => ({ fsPath: path, path }),
  },
}));

vi.mock('@core/authoring', () => ({
  serverConfigToFormData: (...args: unknown[]) => mocked.serverConfigToFormData(...args),
  templateToServerFormData: (...args: unknown[]) => mocked.templateToServerFormData(...args),
  validateHookList: (value: unknown) => {
    const hook = Array.isArray(value) ? value[0] as Record<string, unknown> | undefined : undefined;
    if (!hook || typeof hook['id'] !== 'string') {
      return [{ field: 'hook[0].id', message: 'Hook ID is required.' }];
    }
    if ((hook['kind'] ?? 'command') === 'command') {
      const command = hook['command'] as Record<string, unknown> | undefined;
      if (!command || typeof command['line'] !== 'string' || command['line'].trim().length === 0) {
        return [{ field: 'hook[0].command.line', message: 'Command line is required.' }];
      }
    }
    return [];
  },
}));

vi.mock('@ui/webviews/hookTaskOptions', () => ({
  fetchHookTaskOptions: (...args: unknown[]) => mocked.fetchHookTaskOptions(...args),
  areHookTaskOptionsEqual: (...args: unknown[]) => mocked.areHookTaskOptionsEqual(...args),
}));

vi.mock('@ui/webviews/panels/dashboard/buildDashboardPanelHtml', () => ({
  buildDashboardPanelHtml: (...args: unknown[]) => mocked.buildDashboardPanelHtml(...args),
}));

vi.mock('@ui/webviews/panels/dashboard/buildServerFormSchema', () => ({
  buildServerFormSchema: (...args: unknown[]) => mocked.buildServerFormSchema(...args),
}));

vi.mock('@ui/webviews/panels/dashboard/buildTemplateFormSchema', () => ({
  buildTemplateFormSchema: (...args: unknown[]) => mocked.buildTemplateFormSchema(...args),
}));

vi.mock('@ui/webviews/panels/dashboard/buildDashboardSyncStatePayload', () => ({
  buildDashboardSyncStatePayload: (...args: unknown[]) => mocked.buildDashboardSyncStatePayload(...args),
}));

vi.mock('@ui/webviews/panels/dashboard/dashboardPanelFormSubmit', () => ({
  submitServerConfigForm: (...args: unknown[]) => mocked.submitServerConfigForm(...args),
  submitTemplateConfigForm: (...args: unknown[]) => mocked.submitTemplateConfigForm(...args),
}));

vi.mock('@ui/webviews/panels/dashboard/dashboardPanelTemplateCrud', () => ({
  deleteServerWithConfirm: (...args: unknown[]) => mocked.deleteServerWithConfirm(...args),
  saveTemplateFromWebview: (...args: unknown[]) => mocked.saveTemplateFromWebview(...args),
  deleteTemplateWithConfirm: (...args: unknown[]) => mocked.deleteTemplateWithConfirm(...args),
}));

const { DashboardPanel } = await import('@ui/webviews/panels/DashboardPanel');
const { WEBVIEW_PROTOCOL_VERSION } = await import('@ui/webviews/protocol');

function flushPromises(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function mockLogger(): Logger {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger & { child: ReturnType<typeof vi.fn> };
  logger.child.mockReturnValue(logger);
  return logger;
}

function makeServerRecord() {
  return {
    workspaceFolderUri: 'file:///ws',
    workspaceFolderName: 'Workspace',
    workspaceFolderFsPath: '/ws',
    serverId: 'srv-1',
    serverKey: 'file:///ws::srv-1',
    config: {
      id: 'srv-1',
      name: 'Primary Server',
      type: 'tomcat',
      runtime: { homePath: '/runtime' },
      deployments: [],
    },
  };
}

function makeDeps(trusted: boolean) {
  return {
    extensionUri: { fsPath: '/ext', path: '/ext' },
    workspaceRegistry: {
      getAllServers: vi.fn(() => []),
      getWorkspaceScopes: vi.fn(() => []),
      removeServer: vi.fn(async () => ({ ok: true })),
      updateServer: vi.fn(async () => ({ ok: true })),
    },
    lifecycle: {
      getRuntime: vi.fn(() => undefined),
    },
	    templateService: {
	      get: vi.fn(),
	      listScoped: vi.fn(() => []),
	      save: vi.fn(async () => ({ ok: true })),
	      delete: vi.fn(async () => ({ ok: true })),
	    },
	    localTelemetry: {
	      clear: vi.fn(async () => undefined),
	    },
	    pluginRegistry: {
      getSupportedTypes: vi.fn(() => []),
      get: vi.fn(() => undefined),
    },
    discoveryService: {
      discover: vi.fn(async () => []),
    },
    deployService: {
      getDeploymentState: vi.fn(() => 'undeployed'),
    },
    logger: mockLogger(),
    bus: {
      on: vi.fn((event: string, listener: (payload: unknown) => void) => {
        const listeners = mocked.busListeners.get(event) ?? [];
        listeners.push(listener);
        mocked.busListeners.set(event, listeners);

        const disposable = {
          dispose: vi.fn(() => {
            const remaining = (mocked.busListeners.get(event) ?? []).filter(item => item !== listener);
            mocked.busListeners.set(event, remaining);
          }),
        };
        mocked.busDisposables.push(disposable);
        return disposable;
      }),
    },
    trustGate: {
      isTrusted: vi.fn(() => trusted),
    },
  };
}

function setupPanel(trusted = true) {
  const deps = makeDeps(trusted);
  const panel = new DashboardPanel(deps as any);
  return { deps, panel };
}

async function emitWebviewMessage(message: Record<string, unknown>): Promise<void> {
  if (!mocked.webviewMessageHandler) {
    throw new Error('Webview message handler not registered');
  }

  await mocked.webviewMessageHandler(message);
  await flushPromises();
}

function emitBus(event: string, payload: unknown): void {
  for (const listener of mocked.busListeners.get(event) ?? []) {
    listener(payload);
  }
}

function postedCommands(): string[] {
  return mocked.postMessage.mock.calls.map(([message]) => (message as { command: string }).command);
}

describe('DashboardPanel host boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.busListeners.clear();
    mocked.busDisposables = [];
    mocked.webviewMessageHandler = undefined;
    mocked.panelDisposeHandler = undefined;

    mocked.buildDashboardSyncStatePayload.mockReturnValue({
      servers: [],
      runtimeStates: {},
	      deploymentStates: {},
	      operationHistory: {},
	      autosyncDiagnostics: {},
	      templates: [],
      capabilities: {},
      workspaceFolders: [],
      settings: {
        defaultHttpPort: 8080,
        defaultDebugPort: 5005,
	        defaultJavaHome: '',
	        showStatusInSidebar: true,
	        localTelemetryEnabled: false,
	      },
      workspaceTrusted: true,
    });
    mocked.buildServerFormSchema.mockReturnValue({ title: 'Server Form', sections: [] });
    mocked.buildTemplateFormSchema.mockReturnValue({ title: 'Template Form', sections: [] });
    mocked.fetchHookTaskOptions.mockResolvedValue([{ value: 'task:build', label: 'Build task' }]);
    mocked.areHookTaskOptionsEqual.mockImplementation((a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b));
    mocked.submitServerConfigForm.mockResolvedValue(undefined);
    mocked.submitTemplateConfigForm.mockResolvedValue({ ok: false });
    mocked.deleteTemplateWithConfirm.mockResolvedValue({ ok: false });

    mocked.createWebviewPanel.mockImplementation(() => ({
      webview: {
        html: '',
        postMessage: mocked.postMessage,
        onDidReceiveMessage: vi.fn((listener: (raw: unknown) => unknown, _thisArg?: unknown, disposables?: { dispose: () => void }[]) => {
          mocked.webviewMessageHandler = listener;
          const disposable = { dispose: mocked.messageSubscriptionDispose };
          disposables?.push(disposable);
          return disposable;
        }),
      },
      reveal: (...args: unknown[]) => mocked.panelReveal(...args),
      onDidDispose: vi.fn((listener: () => void, _thisArg?: unknown, disposables?: { dispose: () => void }[]) => {
        mocked.panelDisposeHandler = listener;
        const disposable = { dispose: mocked.panelSubscriptionDispose };
        disposables?.push(disposable);
        return disposable;
      }),
      dispose: () => {
        mocked.panelDispose();
        mocked.panelDisposeHandler?.();
      },
    }));
  });

  it('blocks settings writes when the workspace is untrusted', async () => {
    const { panel } = setupPanel(false);

    const result = await (panel as any).handleSettingsSave({
      defaultHttpPort: 8180,
      defaultDebugPort: 5100,
      defaultJavaHome: '/jdk',
    });

    expect(result).toEqual({
      ok: false,
      message: 'Grant workspace trust to modify JSM settings.',
    });
    expect(mocked.configUpdate).not.toHaveBeenCalled();
  });

  it('allows settings writes when the workspace is trusted', async () => {
    const { panel } = setupPanel(true);

    const result = await (panel as any).handleSettingsSave({
      defaultHttpPort: 8180,
      defaultDebugPort: 5100,
      defaultJavaHome: '/jdk',
      showStatusInSidebar: false,
    });

    expect(result).toEqual({ ok: true });
    expect(mocked.configUpdate).toHaveBeenCalledTimes(4);
    expect(mocked.configUpdate).toHaveBeenCalledWith(
      'ui.showStatusInSidebar',
      false,
      1,
    );
  });

  it('clears local telemetry when the opt-in setting is disabled', async () => {
    const { deps, panel } = setupPanel(true);

    const result = await (panel as any).handleSettingsSave({
      localTelemetryEnabled: false,
    });

    expect(result).toEqual({ ok: true });
    expect(mocked.configUpdate).toHaveBeenCalledWith(
      'telemetry.localMetrics.enabled',
      false,
      1,
    );
    expect(deps.localTelemetry.clear).toHaveBeenCalledOnce();
  });

  it('queues navigation until ready, then resets form state and flushes host messages', async () => {
    const { panel } = setupPanel();
    panel.show({ type: 'server', id: 'srv-1' });
    await flushPromises();

    (panel as any).currentFormId = 'jsm.serverForm';
    (panel as any).currentFormMode = 'edit';
    (panel as any).currentFormTargetId = 'srv-1';
    (panel as any).currentFormTargetWorkspaceFolderUri = 'file:///ws';
    (panel as any).currentFormTargetScope = 'workspace';

    expect(mocked.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: 'navigate' }),
    );

    await emitWebviewMessage({ v: WEBVIEW_PROTOCOL_VERSION, command: 'ready' });

    expect(postedCommands()).toEqual(
      expect.arrayContaining(['syncState', 'navigate', 'hookOptions']),
    );
    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'navigate',
      target: expect.objectContaining({
        type: 'server',
        id: 'srv-1',
        globalTab: 'home',
      }),
    }));
    expect((panel as any).currentFormId).toBeUndefined();
    expect((panel as any).currentFormMode).toBeUndefined();
    expect((panel as any).currentFormTargetId).toBeUndefined();
    expect((panel as any).currentFormTargetWorkspaceFolderUri).toBeUndefined();
    expect((panel as any).currentFormTargetScope).toBeUndefined();
  });

  it('posts command results for allowed executeCommand requests', async () => {
    const { panel } = setupPanel();
    panel.show();
    await flushPromises();

    mocked.executeCommand.mockResolvedValue({
      ok: true,
      message: 'completed',
      data: { serverId: 'srv-1' },
    });

    await emitWebviewMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.server.showLogs',
      args: [{ serverId: 'srv-1' }],
      requestId: 'req-1',
    });

    expect(mocked.executeCommand).toHaveBeenCalledWith('jsm.server.showLogs', { serverId: 'srv-1' });
    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'commandResult',
      requestId: 'req-1',
      ok: true,
      message: 'completed',
      data: { serverId: 'srv-1' },
    }));
  });

  it('allows deployment log commands from the dashboard boundary', async () => {
    const { panel } = setupPanel();
    panel.show();
    await flushPromises();

    mocked.executeCommand.mockResolvedValue({ ok: true });

    await emitWebviewMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.deployment.openLogs',
      args: [{
        serverId: 'srv-1',
        serverKey: 'file:///ws::srv-1',
        workspaceFolderUri: 'file:///ws',
        deploymentId: 'dep-1',
      }],
      requestId: 'req-logs',
    });

    expect(mocked.executeCommand).toHaveBeenCalledWith('jsm.deployment.openLogs', {
      serverId: 'srv-1',
      serverKey: 'file:///ws::srv-1',
      workspaceFolderUri: 'file:///ws',
      deploymentId: 'dep-1',
    });
    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'commandResult',
      requestId: 'req-logs',
      ok: true,
    }));
  });

  it('allows deployment rollback commands from the dashboard boundary', async () => {
    const { panel } = setupPanel();
    panel.show();
    await flushPromises();

    mocked.executeCommand.mockResolvedValue({ ok: true });

    await emitWebviewMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.deployment.rollback',
      args: [{
        serverId: 'srv-1',
        serverKey: 'file:///ws::srv-1',
        workspaceFolderUri: 'file:///ws',
        deploymentId: 'dep-1',
      }],
      requestId: 'req-rollback',
    });

    expect(mocked.executeCommand).toHaveBeenCalledWith('jsm.deployment.rollback', {
      serverId: 'srv-1',
      serverKey: 'file:///ws::srv-1',
      workspaceFolderUri: 'file:///ws',
      deploymentId: 'dep-1',
    });
    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'commandResult',
      requestId: 'req-rollback',
      ok: true,
    }));
  });

  it('allows validated hook test commands from the dashboard boundary', async () => {
    const { panel } = setupPanel();
    panel.show();
    await flushPromises();

    mocked.executeCommand.mockResolvedValue({ ok: true, message: 'Hook "hook-1" completed.' });

    const arg = {
      serverId: 'srv-1',
      serverKey: 'file:///ws::srv-1',
      workspaceFolderUri: 'file:///ws',
      hook: {
        id: 'hook-1',
        enabled: true,
        phase: 'pre',
        event: 'lifecycle.start',
        kind: 'command',
        timeoutMs: 60000,
        continueOnError: false,
        command: { mode: 'shell', line: 'echo hook' },
      },
    };

    await emitWebviewMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.hook.test',
      args: [arg],
      requestId: 'req-hook-test',
    });

    expect(mocked.executeCommand).toHaveBeenCalledWith('jsm.hook.test', arg);
    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'commandResult',
      requestId: 'req-hook-test',
      ok: true,
      message: 'Hook "hook-1" completed.',
    }));
  });

  it('rejects invalid hook test payloads before they can execute commands', async () => {
    const { panel } = setupPanel();
    panel.show();
    await flushPromises();

    await emitWebviewMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.hook.test',
      args: [{
        serverId: 'srv-1',
        serverKey: 'file:///ws::srv-1',
        workspaceFolderUri: 'file:///ws',
        hook: {
          id: 'hook-1',
          enabled: true,
          phase: 'pre',
          event: 'lifecycle.start',
          kind: 'command',
          timeoutMs: 60000,
          continueOnError: false,
          command: { mode: 'shell', line: '' },
        },
      }],
      requestId: 'req-hook-invalid',
    });

    expect(mocked.executeCommand).not.toHaveBeenCalledWith('jsm.hook.test', expect.anything());
    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'commandResult',
      requestId: 'req-hook-invalid',
      ok: false,
      message: 'Invalid arguments for dashboard command.',
    }));
  });

  it('allows dashboard refresh without arguments', async () => {
    const { panel } = setupPanel();
    panel.show();
    await flushPromises();

    mocked.executeCommand.mockResolvedValue(undefined);

    await emitWebviewMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.view.refresh',
      args: [],
      requestId: 'req-refresh',
    });

    expect(mocked.executeCommand).toHaveBeenCalledWith('jsm.view.refresh');
    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'commandResult',
      requestId: 'req-refresh',
      ok: true,
    }));
  });

  it('allows port assistant requests from the dashboard boundary', async () => {
    const { panel } = setupPanel();
    panel.show();
    await flushPromises();

    mocked.executeCommand.mockResolvedValue({
      ok: true,
      message: 'Port 8080 is available on 127.0.0.1.',
      data: { field: 'httpPort', port: 8080, free: true },
    });

    await emitWebviewMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.port.suggest',
      args: [{ field: 'httpPort', port: 8080, host: '127.0.0.1' }],
      requestId: 'req-port',
    });

    expect(mocked.executeCommand).toHaveBeenCalledWith('jsm.port.suggest', {
      field: 'httpPort',
      port: 8080,
      host: '127.0.0.1',
    });
    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'commandResult',
      requestId: 'req-port',
      ok: true,
      message: 'Port 8080 is available on 127.0.0.1.',
    }));
  });

  it('rejects malformed port assistant requests before command execution', async () => {
    const { panel } = setupPanel();
    panel.show();
    await flushPromises();

    await emitWebviewMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.port.suggest',
      args: [{ field: 'httpPort', port: 70000, host: '127.0.0.1' }],
      requestId: 'req-port-invalid',
    });

    expect(mocked.executeCommand).not.toHaveBeenCalledWith('jsm.port.suggest', expect.anything());
    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'commandResult',
      requestId: 'req-port-invalid',
      ok: false,
      message: 'Invalid arguments for dashboard command.',
    }));
  });

  it('rejects executeCommand ids that are not explicitly allowed by the dashboard host boundary', async () => {
    const { panel } = setupPanel();
    panel.show();
    await flushPromises();

    await emitWebviewMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'workbench.action.openSettings',
      args: ['security.workspace.trust.enabled'],
      requestId: 'req-denied',
    });

    expect(mocked.executeCommand).not.toHaveBeenCalled();
    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'commandResult',
      requestId: 'req-denied',
      ok: false,
      message: expect.stringContaining('not available'),
    }));
  });

  it('rejects allowed executeCommand ids when their argument shape is invalid', async () => {
    const { panel } = setupPanel();
    panel.show();
    await flushPromises();

    await emitWebviewMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.server.stop',
      args: [{ workspaceFolderUri: 'file:///ws' }],
      requestId: 'req-invalid',
    });

    expect(mocked.executeCommand).not.toHaveBeenCalled();
    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'commandResult',
      requestId: 'req-invalid',
      ok: false,
      message: expect.stringContaining('Invalid arguments'),
    }));
  });

  it('posts error and failed commandResult when executeCommand throws', async () => {
    const { panel } = setupPanel();
    panel.show();
    await flushPromises();

    mocked.executeCommand.mockRejectedValue(new Error('boom'));

    await emitWebviewMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.server.showLogs',
      args: [{ serverId: 'srv-1' }],
      requestId: 'req-2',
    });

    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'error',
      message: expect.stringContaining('boom'),
    }));
    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'commandResult',
      requestId: 'req-2',
      ok: false,
      message: expect.stringContaining('boom'),
    }));
  });

  it('routes internal schema requests through the host and initializes server form context', async () => {
    const { deps, panel } = setupPanel();
    const record = makeServerRecord();
    deps.workspaceRegistry.getAllServers.mockReturnValue([record]);
    deps.pluginRegistry.get.mockReturnValue({
      getUIMetadata: vi.fn(() => ({ title: 'Tomcat' })),
      getCapabilities: vi.fn(() => ({ supportsSsl: true })),
    });

    panel.show();
    await flushPromises();

    await emitWebviewMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.internal.requestServerSchema',
      args: ['edit', 'srv-1', 'file:///ws'],
    });

    expect(mocked.buildServerFormSchema).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'edit',
      supportsSsl: true,
    }));
    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'init',
      formId: 'jsm.serverForm',
      mode: 'edit',
      data: { name: 'Primary Server', pluginType: 'tomcat' },
      targetId: 'srv-1',
      targetWorkspaceFolderUri: 'file:///ws',
    }));
    expect((panel as any).currentFormId).toBe('jsm.serverForm');
    expect((panel as any).currentFormTargetId).toBe('srv-1');
    expect((panel as any).currentFormTargetWorkspaceFolderUri).toBe('file:///ws');
  });

  it('does not open built-in gallery templates in edit mode', async () => {
    const { deps, panel } = setupPanel();
    deps.templateService.listScoped.mockReturnValue([{
      key: 'gallery:gallery.tomcat.local-dev',
      scope: 'gallery',
      template: {
        id: 'gallery.tomcat.local-dev',
        name: 'Tomcat Local Dev',
        pluginType: 'tomcat',
        serverDefaults: {},
      },
    }]);

    panel.show();
    await flushPromises();
    mocked.postMessage.mockClear();

    await emitWebviewMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.internal.requestTemplateSchema',
      args: ['edit', 'gallery.tomcat.local-dev'],
    });

    expect(mocked.buildTemplateFormSchema).not.toHaveBeenCalled();
    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'error',
      message: 'Built-in gallery templates cannot be edited.',
    }));
    expect((panel as any).currentFormId).toBeUndefined();
    expect((panel as any).currentFormTargetScope).toBeUndefined();
  });

  it('does not delete built-in gallery templates', async () => {
    const { deps, panel } = setupPanel();
    deps.templateService.listScoped.mockReturnValue([{
      key: 'gallery:gallery.tomcat.local-dev',
      scope: 'gallery',
      template: {
        id: 'gallery.tomcat.local-dev',
        name: 'Tomcat Local Dev',
        pluginType: 'tomcat',
        serverDefaults: {},
      },
    }]);

    const result = await (panel as any).handleTemplateDelete('gallery.tomcat.local-dev');

    expect(result).toEqual({
      ok: false,
      message: 'Built-in gallery templates cannot be deleted.',
    });
    expect(mocked.showWarningMessage).not.toHaveBeenCalled();
    expect(deps.templateService.delete).not.toHaveBeenCalled();
  });

  it('always posts submitFinished even when submit handling throws', async () => {
    const { panel } = setupPanel();
    panel.show();
    await flushPromises();

    (panel as any).currentFormId = 'jsm.serverForm';
    mocked.submitServerConfigForm.mockRejectedValue(new Error('submit boom'));

    await emitWebviewMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'submit',
      data: { name: 'Updated Server' },
    });

    expect(mocked.submitServerConfigForm).toHaveBeenCalledWith(expect.objectContaining({
      lastSubmittedData: { name: 'Updated Server' },
    }));
    expect(postedCommands()).toEqual(
      expect.arrayContaining(['error', 'submitFinished']),
    );
    expect(mocked.postMessage.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      command: 'submitFinished',
    }));
  });

  it('clears active form session state on cancel', async () => {
    const { panel } = setupPanel();
    panel.show();
    await flushPromises();

    (panel as any).currentFormId = 'jsm.templateForm';
    (panel as any).currentFormMode = 'edit';
    (panel as any).currentFormTargetId = 'tpl-1';
    (panel as any).currentFormTargetWorkspaceFolderUri = 'file:///ws';
    (panel as any).currentFormTargetScope = 'global';

    await emitWebviewMessage({ v: WEBVIEW_PROTOCOL_VERSION, command: 'cancel' });

    expect((panel as any).currentFormId).toBeUndefined();
    expect((panel as any).currentFormMode).toBeUndefined();
    expect((panel as any).currentFormTargetId).toBeUndefined();
    expect((panel as any).currentFormTargetWorkspaceFolderUri).toBeUndefined();
    expect((panel as any).currentFormTargetScope).toBeUndefined();
  });

  it('posts configChanged and syncState when ConfigChanged is emitted', async () => {
    const { panel } = setupPanel();
    panel.show();
    await flushPromises();
    mocked.postMessage.mockClear();

    emitBus('ConfigChanged', { source: 'test', workspaceFolderUri: 'file:///ws' });

    expect(postedCommands()).toEqual(['configChanged', 'syncState']);
  });

  it('triggers syncState for inventory events', async () => {
    const { panel } = setupPanel();
    panel.show();
    await flushPromises();
    mocked.postMessage.mockClear();

    emitBus('ServerAdded', { serverId: 'srv-1', workspaceFolderUri: 'file:///ws' });

    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'syncState',
    }));
  });

  it('forwards runtime and deployment state events without changing payload shape', async () => {
    const { deps, panel } = setupPanel();
    deps.lifecycle.getRuntime.mockReturnValue({ getState: () => 'running' });
    panel.show();
    await flushPromises();
    mocked.postMessage.mockClear();

    emitBus('ServerStateChanged', { serverId: 'file:///ws::srv-1' });
    emitBus('DeploymentStateChanged', {
      serverId: 'file:///ws::srv-1',
      deploymentId: 'dep-1',
      state: 'deployed',
    });

    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'serverStateChanged',
      serverKey: 'file:///ws::srv-1',
      state: 'running',
    }));
    expect(mocked.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'deploymentStateChanged',
      serverKey: 'file:///ws::srv-1',
      deploymentId: 'dep-1',
      state: 'deployed',
    }));
  });

  it('disposes registered bus listeners when the panel is disposed', () => {
    const { panel } = setupPanel();

    expect(mocked.busDisposables).toHaveLength(9);

    panel.dispose();

    for (const disposable of mocked.busDisposables) {
      expect(disposable.dispose).toHaveBeenCalled();
    }
  });
});
