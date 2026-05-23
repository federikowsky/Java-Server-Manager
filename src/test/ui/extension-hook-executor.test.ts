import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { ErrorCode } from '@core/errors/codes';

const mocked = vi.hoisted(() => {
  const taskTerminate = vi.fn();
  return {
    stopError: new Error('stop-after-hook-executor'),
    capturedExecutor: undefined as unknown,
    fetchTasks: vi.fn(async () => [{ name: 'Build Task' }]),
    taskTerminate,
    executeTask: vi.fn(async () => ({ id: 'task-execution-1', terminate: taskTerminate })),
    onDidEndTaskProcess: undefined as undefined | ((event: { execution: unknown; exitCode?: number }) => void),
    taskListenerDispose: vi.fn(),
    spawnShell: vi.fn(),
    kill: vi.fn(),
    createOutputChannel: vi.fn(() => ({
      append: vi.fn(),
      appendLine: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
    })),
  };
});

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{
      name: 'ws1',
      uri: {
        fsPath: '/ws1',
        toString: () => 'file:///ws1',
      },
    }, {
      name: 'ws2',
      uri: {
        fsPath: '/ws2',
        toString: () => 'file:///ws2',
      },
    }],
    isTrusted: true,
  },
  window: {
    createOutputChannel: (...args: unknown[]) => mocked.createOutputChannel(...args),
  },
  tasks: {
    fetchTasks: (...args: unknown[]) => mocked.fetchTasks(...args),
    executeTask: (...args: unknown[]) => mocked.executeTask(...args),
    onDidEndTaskProcess: (listener: (event: { execution: unknown; exitCode?: number }) => void) => {
      mocked.onDidEndTaskProcess = listener;
      return { dispose: mocked.taskListenerDispose };
    },
  },
}));

vi.mock('@infra/logging', () => ({
  Logger: class {
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    debug = vi.fn();
    child = vi.fn(() => this);
  },
  RingBuffer: class {},
}));

vi.mock('@infra/process', () => ({
  ProcessSpawner: class {
    spawnShell = (...args: unknown[]) => mocked.spawnShell(...args);
    kill = (...args: unknown[]) => mocked.kill(...args);
  },
}));

vi.mock('@infra/ports', () => ({
  PortScanner: class {},
}));

vi.mock('@infra/pid', () => ({
  PidManager: class {},
}));

vi.mock('@core/events/EventBus', () => ({
  EventBus: class {
    on = vi.fn(() => ({ dispose: vi.fn() }));
    emit = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock('@core/validation/SchemaValidator', () => ({
  SchemaValidator: class {
    registerBuiltInSchemas = vi.fn();
  },
}));

vi.mock('@plugins/registry/PluginRegistry', () => ({
  PluginRegistry: class {
    register = vi.fn();
  },
}));

vi.mock('@plugins/tomcat/TomcatPlugin', () => ({
  TomcatPlugin: class {},
}));

vi.mock('@ui/adapters', () => ({
  OutputSinkAdapter: class {},
  MementoAdapter: class {},
  DebugAdapter: class {
    onDidChangeSession = vi.fn(() => ({ dispose: vi.fn() }));
    dispose = vi.fn();
  },
  FileWatcherAdapter: class {},
}));

vi.mock('@ui/channels', () => ({
  ServerLogChannel: class {
    dispose = vi.fn();
    getChannel = vi.fn(() => ({
      append: vi.fn(),
      appendLine: vi.fn(),
      clear: vi.fn(),
    }));
    appendLine = vi.fn();
    detach = vi.fn();
  },
}));

vi.mock('@ui/tree', () => ({
  ServerTreeViewProvider: class {},
}));

vi.mock('@ui/webviews/panels/DashboardPanel', () => ({
  DashboardPanel: class {},
}));

vi.mock('@ui/commands', () => ({
  registerServerCommands: vi.fn(() => []),
  registerDeploymentCommands: vi.fn(() => []),
}));

vi.mock('@app/hooks', () => ({
  HookRunner: class {
    constructor(args: { executor: unknown }) {
      mocked.capturedExecutor = args.executor;
      throw mocked.stopError;
    }
  },
}));

const { activate } = await import('../../extension.ts');

function makeContext() {
  return {
    extensionUri: { fsPath: '/ext', path: '/ext' },
    storageUri: { fsPath: '/storage', path: '/storage' },
    globalState: {},
    workspaceState: {},
    subscriptions: [],
  };
}

function makeRequest(timeoutMs = 100) {
  return {
    phase: 'pre',
    event: 'lifecycle.start',
    hook: {
      id: 'hook-task',
      enabled: true,
      phase: 'pre',
      event: 'lifecycle.start',
      kind: 'vscodeTask',
      timeoutMs,
      continueOnError: false,
      vscodeTask: { taskName: 'Build Task' },
    },
    parent: {
      operationId: 'op-1',
      serverId: 'srv-1',
      kind: 'LifecycleStart',
      startedAt: Date.now(),
      timeoutMs: 10_000,
      cancel: {
        isCancelled: false,
        onCancelled: () => ({ dispose: () => {} }),
      },
      progress: { report: vi.fn() },
      output: {
        append: vi.fn(),
        appendLine: vi.fn(),
        clear: vi.fn(),
      },
    },
    cancel: {
      isCancelled: false,
      onCancelled: () => ({ dispose: () => {} }),
    },
  };
}

function makeCommandRequest() {
  const request = makeRequest(100);
  return {
    ...request,
    hook: {
      ...request.hook,
      kind: 'command',
      vscodeTask: undefined,
      command: { mode: 'shell', line: 'echo hook' },
    },
    parent: {
      ...request.parent,
      serverId: 'file:///ws2::srv-1',
    },
  };
}

async function captureExecutor() {
  mocked.capturedExecutor = undefined;

  await expect(activate(makeContext() as never)).rejects.toBe(mocked.stopError);
  expect(mocked.capturedExecutor).toBeDefined();

  return mocked.capturedExecutor as {
    runCommand: (request: ReturnType<typeof makeCommandRequest>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
    runVscodeTask: (request: ReturnType<typeof makeRequest>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
  };
}

describe('extension hook executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.fetchTasks.mockResolvedValue([{ name: 'Build Task' }]);
    mocked.executeTask.mockResolvedValue({ id: 'task-execution-1', terminate: mocked.taskTerminate });
    mocked.spawnShell.mockReset();
    mocked.kill.mockReset();
    mocked.onDidEndTaskProcess = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns timeout and disposes the task listener when no matching end event arrives', async () => {
    vi.useFakeTimers();
    const executor = await captureExecutor();

    const promise = executor.runVscodeTask(makeRequest(100));
    await vi.advanceTimersByTimeAsync(101);
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error?.code).toBe(ErrorCode.Timeout);
    }
    expect(mocked.taskTerminate).toHaveBeenCalledOnce();
    expect(mocked.taskListenerDispose).toHaveBeenCalledOnce();
  });

  it('ignores unrelated task end events until the internal timeout expires', async () => {
    vi.useFakeTimers();
    const executor = await captureExecutor();

    let settled = false;
    const promise = executor.runVscodeTask(makeRequest(100)).then(result => {
      settled = true;
      return result;
    });

    mocked.onDidEndTaskProcess?.({ execution: { id: 'other-execution' }, exitCode: 0 });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(101);
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error?.code).toBe(ErrorCode.Timeout);
    }
    expect(mocked.taskListenerDispose).toHaveBeenCalledOnce();
  });

  it('resolves success when the matching task exits with code 0', async () => {
    const executor = await captureExecutor();
    const taskExecution = { id: 'task-execution-1' };
    mocked.executeTask.mockResolvedValue(taskExecution);

    const promise = executor.runVscodeTask(makeRequest(100));
    await vi.waitFor(() => {
      expect(mocked.onDidEndTaskProcess).toBeTypeOf('function');
    });
    mocked.onDidEndTaskProcess?.({ execution: taskExecution, exitCode: 0 });
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(mocked.taskListenerDispose).toHaveBeenCalledOnce();
  });

  it('preserves the existing non-zero exit code failure behavior', async () => {
    const executor = await captureExecutor();
    const taskExecution = { id: 'task-execution-1' };
    mocked.executeTask.mockResolvedValue(taskExecution);

    const promise = executor.runVscodeTask(makeRequest(100));
    await vi.waitFor(() => {
      expect(mocked.onDidEndTaskProcess).toBeTypeOf('function');
    });
    mocked.onDidEndTaskProcess?.({ execution: taskExecution, exitCode: 17 });
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error?.code).toBe(ErrorCode.HookFailed);
      expect(result.error?.message).toContain('exit code 17');
    }
    expect(mocked.taskListenerDispose).toHaveBeenCalledOnce();
  });

  it('returns HookFailed when executeTask throws without leaving a pending listener behind', async () => {
    const executor = await captureExecutor();
    mocked.executeTask.mockRejectedValue(new Error('task service disconnected'));

    const result = await executor.runVscodeTask(makeRequest(100));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error?.code).toBe(ErrorCode.HookFailed);
      expect(result.error?.message).toContain('task service disconnected');
    }
    expect(mocked.onDidEndTaskProcess).toBeUndefined();
    expect(mocked.taskListenerDispose).not.toHaveBeenCalled();
  });

  it('defaults command hook cwd to the owning multi-root workspace folder', async () => {
    const executor = await captureExecutor();
    mocked.spawnShell.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & { pid: number };
      child.pid = 1234;
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });

    const result = await executor.runCommand(makeCommandRequest());

    expect(result.ok).toBe(true);
    expect(mocked.spawnShell).toHaveBeenCalledWith(expect.objectContaining({
      line: 'echo hook',
      cwd: '/ws2',
    }));
  });
});
