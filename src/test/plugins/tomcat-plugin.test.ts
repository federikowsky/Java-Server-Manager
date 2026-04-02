import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { TomcatPlugin } from '@plugins/tomcat/TomcatPlugin';
import { TomcatStartupMonitor } from '@plugins/tomcat/TomcatStartupMonitor';
import type { ServerConfig, DeploymentConfig, OperationContext, FileChangeBatch } from '@core/types';
import type { KeyValueStore } from '@core/types';
import type { Logger } from '@core/types/logger';

// ── Helpers ─────────────────────────────────────────────────────────────────

function mockKeyValueStore(): KeyValueStore {
  const data = new Map<string, unknown>();
  return {
    get: <T>(key: string) => data.get(key) as T | undefined,
    set: async <T>(key: string, value: T) => { data.set(key, value); },
    delete: async (key: string) => { data.delete(key); },
  };
}

function spyKeyValueStore(initialEntries: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initialEntries));
  const get = vi.fn(<T>(key: string) => data.get(key) as T | undefined);
  const set = vi.fn(async <T>(key: string, value: T) => { data.set(key, value); });
  const remove = vi.fn(async (key: string) => { data.delete(key); });
  return {
    data,
    get,
    set,
    delete: remove,
    store: {
      get,
      set,
      delete: remove,
    } satisfies KeyValueStore,
  };
}

function noopLogger(): Logger {
  const noop = () => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => noopLogger(),
  };
}

function dummyCtx(serverId = 'srv-1'): OperationContext {
  return {
    operationId: 'op-1' as OperationContext['operationId'],
    serverId: serverId as OperationContext['serverId'],
    kind: 'DeployFull',
    startedAt: Date.now(),
    timeoutMs: 30_000,
    cancel: {
      isCancelled: false,
      onCancelled: () => ({ dispose: () => {} }),
    },
    progress: { report: () => {} },
    output: { append: () => {}, appendLine: () => {}, clear: () => {} },
  };
}

let tmpDir: string;
let plugin: TomcatPlugin;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-tomcat-test-'));
  plugin = new TomcatPlugin(noopLogger(), { keyValueStore: mockKeyValueStore() });
});

afterEach(async () => {
  await plugin.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Helper to create a fake Tomcat home ─────────────────────────────────────

async function createFakeTomcatHome(homePath: string): Promise<void> {
  const script = os.platform() === 'win32' ? 'catalina.bat' : 'catalina.sh';
  await fs.mkdir(path.join(homePath, 'bin'), { recursive: true });
  await fs.writeFile(path.join(homePath, 'bin', script), '#!/bin/sh\necho ok', { mode: 0o755 });
  await fs.mkdir(path.join(homePath, 'lib'), { recursive: true });
  await fs.writeFile(path.join(homePath, 'lib', 'catalina.jar'), 'fake-jar');
  await fs.mkdir(path.join(homePath, 'conf'), { recursive: true });
  await fs.writeFile(
    path.join(homePath, 'conf', 'server.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<Server port="8005" shutdown="SHUTDOWN">
  <Service name="Catalina">
    <Connector port="8080" protocol="HTTP/1.1" />
    <Connector port="8009" protocol="AJP/1.3" />
    <Engine name="Catalina" defaultHost="localhost">
      <Host name="localhost" appBase="webapps" />
    </Engine>
  </Service>
</Server>`,
  );
  await fs.writeFile(
    path.join(homePath, 'RELEASE-NOTES'),
    'Apache Tomcat Version 10.1.28\nSome release notes...',
  );
}

function fakeConfig(
  homePath: string,
  instancePath: string,
  overrides: Partial<ServerConfig> = {},
): ServerConfig {
  return {
    id: 'srv-1' as ServerConfig['id'],
    name: 'Test Tomcat',
    type: 'tomcat',
    runtime: { id: 'rt-1', homePath },
    instancePath,
    javaHome: path.join(tmpDir, 'java'),
    host: '127.0.0.1',
    ports: { http: 9080, debug: 5005 },
    run: { env: {}, vmArgs: [] },
    debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
    deployments: [],
    autosync: {
      enabled: true,
      debounceMs: 400,
      maxBatchFiles: 200,
      maxBatchBytes: 20_000_000,
      stormBackoffMs: 2000,
      ignoreGlobs: [],
    },
    hooks: [],
    pluginConfig: { type: 'tomcat', shutdownPort: 8005, disableAjp: true },
    ...overrides,
  } as ServerConfig;
}

function fakeDeployment(
  deployName: string,
  overrides: Partial<DeploymentConfig> = {},
): DeploymentConfig {
  return {
    id: 'dep-1' as DeploymentConfig['id'],
    type: 'exploded',
    sourcePath: path.join(tmpDir, 'source-app'),
    deployName,
    syncMode: 'auto',
    hotReload: true,
    ignoreGlobs: [],
    hooks: [],
    ...overrides,
  };
}

function incrementalPlan(instancePath: string, deployName: string) {
  return {
    targetRoot: path.join(instancePath, 'webapps'),
    targetPath: path.join(instancePath, 'webapps', deployName),
    strategy: 'incremental-dir' as const,
    notes: [],
  };
}

function fileChangeBatch(changes: FileChangeBatch['changes']): FileChangeBatch {
  return {
    changes,
    totalFiles: changes.length,
    totalBytes: changes.reduce((sum, change) => sum + (change.sizeBytes ?? 0), 0),
  };
}

type FakeChildProcess = ChildProcess & {
  emitExit: (code: number | null, signal?: string | null) => void;
};

function createFakeChildProcess(pid = 1234): FakeChildProcess {
  const child = new EventEmitter() as FakeChildProcess;
  Object.assign(child, {
    pid,
    emitExit: (code: number | null, signal: string | null = null) => {
      child.emit('exit', code, signal);
    },
  });
  return child;
}

// ── Detection Tests ─────────────────────────────────────────────────────────

describe('TomcatPlugin — detection', () => {
  it('detects a valid Tomcat installation', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);

    const result = await plugin.detectInstallation(homePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ok).toBe(true);
      expect(result.value.version).toBe('10.1.28');
      expect(result.value.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    }
  });

  it('returns ok:false for an empty directory', async () => {
    const emptyDir = path.join(tmpDir, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });

    const result = await plugin.detectInstallation(emptyDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ok).toBe(false);
      expect(result.value.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true);
    }
  });

  it('returns capabilities', () => {
    const caps = plugin.getCapabilities();
    expect(caps.supportsDebugAttach).toBe(true);
    expect(caps.supportsWarDeploy).toBe(true);
    expect(caps.supportsIncrementalDeploy).toBe(true);
  });
});

// ── Config Validation Tests ─────────────────────────────────────────────────

describe('TomcatPlugin — validateConfig', () => {
  it('passes valid config', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);

    // Create fake JAVA_HOME
    const javaHome = path.join(tmpDir, 'java');
    const javaExe = os.platform() === 'win32' ? 'java.exe' : 'java';
    await fs.mkdir(path.join(javaHome, 'bin'), { recursive: true });
    await fs.writeFile(path.join(javaHome, 'bin', javaExe), 'fake', { mode: 0o755 });

    const config = fakeConfig(homePath, path.join(tmpDir, 'instance'), {
      javaHome,
    });
    const result = await plugin.validateConfig(config);
    expect(result.ok).toBe(true);
  });

  it('fails when javaHome has no bin/java', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const config = fakeConfig(homePath, path.join(tmpDir, 'instance'));

    const result = await plugin.validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('validation failed');
    }
  });

  it('fails when SSL port equals HTTP port', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const javaHome = path.join(tmpDir, 'java');
    const javaExe = os.platform() === 'win32' ? 'java.exe' : 'java';
    await fs.mkdir(path.join(javaHome, 'bin'), { recursive: true });
    await fs.writeFile(path.join(javaHome, 'bin', javaExe), 'fake', { mode: 0o755 });

    const config = fakeConfig(homePath, path.join(tmpDir, 'instance'), {
      javaHome,
      ports: { http: 8443, debug: 5005 },
      pluginConfig: {
        type: 'tomcat',
        shutdownPort: 8005,
        disableAjp: true,
        ssl: {
          enabled: true,
          port: 8443,
          keystorePath: '/fake/keystore.p12',
          keystorePassword: 'changeit',
          keystoreType: 'PKCS12',
          clientAuth: false,
        },
      },
    });

    const result = await plugin.validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.details).toContain('SSL port must differ from HTTP port');
    }
  });

  it('fails when SSL enabled but keystorePath is empty', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const javaHome = path.join(tmpDir, 'java');
    const javaExe = os.platform() === 'win32' ? 'java.exe' : 'java';
    await fs.mkdir(path.join(javaHome, 'bin'), { recursive: true });
    await fs.writeFile(path.join(javaHome, 'bin', javaExe), 'fake', { mode: 0o755 });

    const config = fakeConfig(homePath, path.join(tmpDir, 'instance'), {
      javaHome,
      pluginConfig: {
        type: 'tomcat',
        shutdownPort: 8005,
        disableAjp: true,
        ssl: {
          enabled: true,
          port: 8443,
          keystorePath: '',
          keystorePassword: 'changeit',
          keystoreType: 'PKCS12',
          clientAuth: false,
        },
      },
    });

    const result = await plugin.validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.details).toContain('Keystore path is required');
    }
  });

  it('fails when clientAuth enabled but truststorePath is empty', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const javaHome = path.join(tmpDir, 'java');
    const javaExe = os.platform() === 'win32' ? 'java.exe' : 'java';
    await fs.mkdir(path.join(javaHome, 'bin'), { recursive: true });
    await fs.writeFile(path.join(javaHome, 'bin', javaExe), 'fake', { mode: 0o755 });

    // Create a fake keystore file
    const keystorePath = path.join(tmpDir, 'keystore.p12');
    await fs.writeFile(keystorePath, 'fake-keystore');

    const config = fakeConfig(homePath, path.join(tmpDir, 'instance'), {
      javaHome,
      pluginConfig: {
        type: 'tomcat',
        shutdownPort: 8005,
        disableAjp: true,
        ssl: {
          enabled: true,
          port: 8443,
          keystorePath,
          keystorePassword: 'changeit',
          keystoreType: 'PKCS12',
          clientAuth: true,
          truststorePath: '',
        },
      },
    });

    const result = await plugin.validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.details).toContain('Truststore path is required');
    }
  });

  it('passes validation with valid SSL config', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const javaHome = path.join(tmpDir, 'java');
    const javaExe = os.platform() === 'win32' ? 'java.exe' : 'java';
    await fs.mkdir(path.join(javaHome, 'bin'), { recursive: true });
    await fs.writeFile(path.join(javaHome, 'bin', javaExe), 'fake', { mode: 0o755 });

    // Create fake keystore file
    const keystorePath = path.join(tmpDir, 'keystore.p12');
    await fs.writeFile(keystorePath, 'fake-keystore');

    const config = fakeConfig(homePath, path.join(tmpDir, 'instance'), {
      javaHome,
      pluginConfig: {
        type: 'tomcat',
        shutdownPort: 8005,
        disableAjp: true,
        ssl: {
          enabled: true,
          port: 8443,
          keystorePath,
          keystorePassword: 'changeit',
          keystoreType: 'PKCS12',
          clientAuth: false,
        },
      },
    });

    const result = await plugin.validateConfig(config);
    expect(result.ok).toBe(true);
  });

  it('reports supportsSsl capability', () => {
    const caps = plugin.getCapabilities();
    expect(caps.supportsSsl).toBe(true);
  });
});

describe('TomcatPlugin — getConfigSources', () => {
  it('returns only existing config files for the Tomcat server', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    const instancePath = path.join(tmpDir, 'instance');
    await createFakeTomcatHome(homePath);
    await fs.mkdir(path.join(instancePath, 'conf'), { recursive: true });
    await fs.writeFile(path.join(instancePath, 'conf', 'web.xml'), '<web-app/>');

    const config = fakeConfig(homePath, instancePath);
    const result = await plugin.getConfigSources(config);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((source: { path: string }) => source.path)).toEqual([
        path.join(instancePath, 'conf', 'web.xml'),
      ]);
    }
  });
});

// ── Deploy Plan Tests ───────────────────────────────────────────────────────

describe('TomcatPlugin — planDeploy', () => {
  it('plans WAR deployment as copy-war', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    const instancePath = path.join(tmpDir, 'instance');
    const config = fakeConfig(homePath, instancePath);
    const dep: DeploymentConfig = {
      id: 'dep-1' as DeploymentConfig['id'],
      type: 'war',
      sourcePath: '/some/app.war',
      deployName: 'myapp',
      syncMode: 'manual',
      hotReload: false,
      ignoreGlobs: [],
      hooks: [],
    };

    const result = await plugin.planDeploy(dummyCtx(), config, dep);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.strategy).toBe('copy-war');
      expect(result.value.targetPath).toBe(path.join(instancePath, 'webapps', 'myapp.war'));
      expect(result.value.targetRoot).toBe(path.join(instancePath, 'webapps'));
    }
  });

  it('plans exploded deployment as copy-dir', async () => {
    const instancePath = path.join(tmpDir, 'instance');
    const config = fakeConfig(path.join(tmpDir, 'home'), instancePath);
    const dep: DeploymentConfig = {
      id: 'dep-2' as DeploymentConfig['id'],
      type: 'exploded',
      sourcePath: '/some/app',
      deployName: 'myapp',
      syncMode: 'auto',
      hotReload: false,
      ignoreGlobs: [],
      hooks: [],
    };

    const result = await plugin.planDeploy(dummyCtx(), config, dep);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.strategy).toBe('copy-dir');
      expect(result.value.targetPath).toBe(path.join(instancePath, 'webapps', 'myapp'));
    }
  });
});

// ── Instance Path Init + server.xml template ───────────────────────────────

/** Minimal server.xml template with placeholders (ports passed via JVM args at start). */
const MINIMAL_SERVER_XML_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<Server port="\${shutdown.port}" shutdown="\${shutdown.command}">
  <Listener className="com.githubcopilot.jsm.tomcat.StartupLifecycleListener" />
  <Service name="Catalina">
    <Connector port="\${http.port}" protocol="HTTP/1.1" />
    <Engine name="Catalina" defaultHost="localhost">
      <Host name="localhost" appBase="webapps" />
    </Engine>
  </Service>
</Server>`;

async function createTemplateFile(dir: string): Promise<string> {
  const p = path.join(dir, 'server.xml.template');
  await fs.writeFile(p, MINIMAL_SERVER_XML_TEMPLATE, 'utf-8');
  return p;
}

describe('TomcatPlugin — initializeInstancePath', () => {
  it('seeds conf/ and creates required directories', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const instancePath = path.join(tmpDir, 'instance');
    const config = fakeConfig(homePath, instancePath);

    const result = await plugin.initializeInstancePath(homePath, instancePath, config);
    expect(result.ok).toBe(true);

    // Verify directories
    for (const dir of ['conf', 'logs', 'temp', 'work', 'webapps']) {
      const stat = await fs.stat(path.join(instancePath, dir));
      expect(stat.isDirectory()).toBe(true);
    }

    // Verify server.xml was copied from home
    const serverXml = await fs.readFile(path.join(instancePath, 'conf', 'server.xml'), 'utf-8');
    expect(serverXml.length).toBeGreaterThan(0);
  });

  it('overwrites server.xml with template when serverXmlTemplatePath is set', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const instancePath = path.join(tmpDir, 'instance');
    const templatePath = await createTemplateFile(tmpDir);
    plugin = new TomcatPlugin(noopLogger(), { serverXmlTemplatePath: templatePath, keyValueStore: mockKeyValueStore() });
    const config = fakeConfig(homePath, instancePath, {
      ports: { http: 9999, debug: 5005 },
    });

    await plugin.initializeInstancePath(homePath, instancePath, config);
    const xml = await fs.readFile(path.join(instancePath, 'conf', 'server.xml'), 'utf-8');

    // Template uses placeholders; port is passed at start via -Dhttp.port=
    expect(xml).toContain('${http.port}');
    expect(xml).toContain('${shutdown.port}');
    expect(xml).not.toContain('AJP');
  });

  it('keeps AJP when no template (server.xml from home)', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const instancePath = path.join(tmpDir, 'instance');
    const config = fakeConfig(homePath, instancePath, {
      pluginConfig: { type: 'tomcat', shutdownPort: 8005, disableAjp: false },
    });

    await plugin.initializeInstancePath(homePath, instancePath, config);
    const xml = await fs.readFile(path.join(instancePath, 'conf', 'server.xml'), 'utf-8');

    expect(xml).toContain('AJP');
  });

  it('removes AJP when no template and disableAjp is true', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const instancePath = path.join(tmpDir, 'instance');
    const config = fakeConfig(homePath, instancePath, {
      pluginConfig: { type: 'tomcat', shutdownPort: 8005, disableAjp: true },
    });

    await plugin.initializeInstancePath(homePath, instancePath, config);
    const xml = await fs.readFile(path.join(instancePath, 'conf', 'server.xml'), 'utf-8');

    expect(xml).not.toContain('AJP');
  });

  it('removes AJP from template server.xml when disableAjp is true', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const instancePath = path.join(tmpDir, 'instance');
    const templatePath = path.join(tmpDir, 'server.xml.template');
    await fs.writeFile(
      templatePath,
      `<?xml version="1.0" encoding="UTF-8"?>
<Server port="\${shutdown.port}" shutdown="\${shutdown.command}">
  <Service name="Catalina">
    <Connector port="\${http.port}" protocol="HTTP/1.1" />
    <Connector port="8009" protocol="AJP/1.3" />
    <Engine name="Catalina" defaultHost="localhost">
      <Host name="localhost" appBase="webapps" />
    </Engine>
  </Service>
</Server>`,
      'utf-8',
    );
    plugin = new TomcatPlugin(noopLogger(), {
      serverXmlTemplatePath: templatePath,
      keyValueStore: mockKeyValueStore(),
    });

    await plugin.initializeInstancePath(homePath, instancePath, fakeConfig(homePath, instancePath));
    const xml = await fs.readFile(path.join(instancePath, 'conf', 'server.xml'), 'utf-8');

    expect(xml).toContain('${http.port}');
    expect(xml).not.toContain('AJP');
  });

  it('fails initializeInstancePath when disableAjp is true and Catalina service is missing', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    await fs.writeFile(
      path.join(homePath, 'conf', 'server.xml'),
      '<?xml version="1.0" encoding="UTF-8"?><Server><Service name="Other"><Engine/></Service></Server>',
      'utf-8',
    );
    const instancePath = path.join(tmpDir, 'instance');

    const result = await plugin.initializeInstancePath(homePath, instancePath, fakeConfig(homePath, instancePath));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DeployFailed');
      expect(result.error.details).toContain('<Service name="Catalina"> not found');
    }
  });

  it('stages the startup listener jar when template has listener', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const instancePath = path.join(tmpDir, 'instance');
    const listenerAsset = path.join(tmpDir, 'listener.jar');
    const templatePath = await createTemplateFile(tmpDir);
    await fs.writeFile(listenerAsset, 'listener-binary');

    plugin = new TomcatPlugin(noopLogger(), {
      startupListenerJarPath: listenerAsset,
      serverXmlTemplatePath: templatePath,
      keyValueStore: mockKeyValueStore(),
    });
    const config = fakeConfig(homePath, instancePath);

    await plugin.initializeInstancePath(homePath, instancePath, config);

    const firstResult = await plugin['prepareStartupListener'](config);
    expect(firstResult.ok).toBe(true);

    const secondResult = await plugin['prepareStartupListener'](config);
    expect(secondResult.ok).toBe(true);

    const stagedJar = await fs.readFile(path.join(instancePath, 'lib', 'jsm-tomcat-startup-listener.jar'), 'utf-8');
    const xml = await fs.readFile(path.join(instancePath, 'conf', 'server.xml'), 'utf-8');

    expect(stagedJar).toBe('listener-binary');
    expect((xml.match(/com\.githubcopilot\.jsm\.tomcat\.StartupLifecycleListener/g) ?? [])).toHaveLength(1);
  });
});

describe('TomcatStartupMonitor', () => {
  it('resolves started outcome from authenticated callback', async () => {
    const monitor = await TomcatStartupMonitor.create({
      serverKey: 'srv-1',
      serverName: 'Test Tomcat',
      logger: noopLogger(),
    });

    try {
      const response = await fetch(monitor.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: monitor.token,
          startupId: monitor.startupId,
          status: 'started',
        }),
      });

      expect(response.status).toBe(204);
      await expect(monitor.waitForOutcome(500)).resolves.toEqual({ state: 'started', message: undefined });
    } finally {
      await monitor.dispose();
    }
  });

  it('fails fast when the bound process exits before callback', async () => {
    const monitor = await TomcatStartupMonitor.create({
      serverKey: 'srv-1',
      serverName: 'Test Tomcat',
      logger: noopLogger(),
    });

    try {
      const child = {
        on: (_event: string, handler: (code: number | null, signal: string | null) => void) => {
          handler(1, null);
        },
        off: () => undefined,
      } as unknown as NodeJS.Process;

      monitor.bindProcess(child as never);

      await expect(monitor.waitForOutcome(500)).resolves.toMatchObject({
        state: 'failed',
        error: expect.objectContaining({ code: 'ProcessSpawnFailed' }),
      });
    } finally {
      await monitor.dispose();
    }
  });
});

// ── Runtime Lifecycle ──────────────────────────────────────────────────────

describe('TomcatPlugin — runtime lifecycle', () => {
  it('returns ScriptNotExecutable when the catalina script is missing', async () => {
    const config = fakeConfig(path.join(tmpDir, 'missing-home'), path.join(tmpDir, 'instance'));

    const result = await plugin.start(dummyCtx(), config, 'run');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ScriptNotExecutable');
      expect(result.error.message).toContain('Catalina script not found');
    }
  });

  it('returns startup listener preparation errors before spawning', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const store = spyKeyValueStore();
    plugin = new TomcatPlugin(noopLogger(), {
      keyValueStore: store.store,
      startupListenerJarPath: path.join(tmpDir, 'missing-listener.jar'),
    });

    const spawnSpy = vi.spyOn(plugin['spawner'], 'spawn');
    const config = fakeConfig(homePath, path.join(tmpDir, 'instance'));

    const result = await plugin.start(dummyCtx(), config, 'run');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SourceNotFound');
      expect(result.error.message).toContain('Tomcat startup listener asset not found');
    }
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('falls back to non-monitor startup when the listener jar exists but server.xml does not wire StartupLifecycleListener', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    const instancePath = path.join(tmpDir, 'instance');
    const listenerJarPath = path.join(tmpDir, 'listener.jar');
    await createFakeTomcatHome(homePath);
    await fs.mkdir(path.join(instancePath, 'conf'), { recursive: true });
    await fs.copyFile(path.join(homePath, 'conf', 'server.xml'), path.join(instancePath, 'conf', 'server.xml'));
    await fs.writeFile(listenerJarPath, 'listener-jar');

    const child = createFakeChildProcess(4320);
    const store = spyKeyValueStore();
    plugin = new TomcatPlugin(noopLogger(), {
      keyValueStore: store.store,
      startupListenerJarPath: listenerJarPath,
    });

    vi.spyOn(plugin['portScanner'], 'findFreePort').mockResolvedValue(8123);
    const monitorCreateSpy = vi.spyOn(TomcatStartupMonitor, 'create');
    const spawnSpy = vi.spyOn(plugin['spawner'], 'spawn').mockImplementation((opts) => {
      expect(opts.env?.['CATALINA_OPTS'] ?? '').not.toContain('-Djsm.startup.callback.url=');
      return child;
    });

    const result = await plugin.start(dummyCtx(), fakeConfig(homePath, instancePath), 'run');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startupMonitor).toBeUndefined();
    }
    expect(monitorCreateSpy).not.toHaveBeenCalled();
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    child.emitExit(0);
  });

  it('returns the startup monitor when StartupLifecycleListener is wired in server.xml', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    const instancePath = path.join(tmpDir, 'instance');
    const listenerJarPath = path.join(tmpDir, 'listener.jar');
    await createFakeTomcatHome(homePath);
    await fs.mkdir(path.join(instancePath, 'conf'), { recursive: true });
    await fs.writeFile(
      path.join(instancePath, 'conf', 'server.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
<Server port="8005" shutdown="SHUTDOWN">
  <Listener className="com.githubcopilot.jsm.tomcat.StartupLifecycleListener" />
  <Service name="Catalina">
    <Connector port="8080" protocol="HTTP/1.1" />
  </Service>
</Server>`,
    );
    await fs.writeFile(listenerJarPath, 'listener-jar');

    const child = createFakeChildProcess(4325);
    const store = spyKeyValueStore();
    plugin = new TomcatPlugin(noopLogger(), {
      keyValueStore: store.store,
      startupListenerJarPath: listenerJarPath,
    });

    vi.spyOn(plugin['portScanner'], 'findFreePort').mockResolvedValue(8124);
    const startupMonitor = {
      callbackUrl: 'http://127.0.0.1:3001/callback',
      token: 'token-1',
      startupId: 'startup-1',
      bindProcess: vi.fn(),
      waitForOutcome: vi.fn(),
      dispose: vi.fn(async () => {}),
    } as unknown as TomcatStartupMonitor;
    const monitorCreateSpy = vi.spyOn(TomcatStartupMonitor, 'create').mockResolvedValue(startupMonitor);
    const spawnSpy = vi.spyOn(plugin['spawner'], 'spawn').mockImplementation((opts) => {
      expect(opts.env?.['JAVA_OPTS']).toContain('-Djsm.startup.callback.url=http://127.0.0.1:3001/callback');
      expect(opts.env?.['JAVA_OPTS']).toContain('-Djsm.startup.callback.token=token-1');
      expect(opts.env?.['JAVA_OPTS']).toContain('-Djsm.startup.callback.startupId=startup-1');
      return child;
    });

    const result = await plugin.start(dummyCtx(), fakeConfig(homePath, instancePath), 'run');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startupMonitor).toBe(startupMonitor);
    }
    expect(monitorCreateSpy).toHaveBeenCalledOnce();
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect((startupMonitor as { bindProcess: ReturnType<typeof vi.fn> }).bindProcess).toHaveBeenCalledWith(child);
    child.emitExit(0);
  });

  it('shapes debug start env and JPDA args without changing startup behavior', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const child = createFakeChildProcess(4321);
    const store = spyKeyValueStore();
    plugin = new TomcatPlugin(noopLogger(), { keyValueStore: store.store });

    vi.spyOn(plugin['portScanner'], 'findFreePort').mockResolvedValue(8123);
    const spawnSpy = vi.spyOn(plugin['spawner'], 'spawn').mockImplementation((opts) => {
      expect(opts.args).toEqual(['jpda', 'run']);
      expect(opts.cwd).toBe(path.join(tmpDir, 'instance'));
      expect(opts.env).toMatchObject({
        CATALINA_HOME: homePath,
        CATALINA_BASE: path.join(tmpDir, 'instance'),
        JAVA_HOME: path.join(tmpDir, 'java'),
        APP_ENV: 'test',
        JPDA_ADDRESS: '0.0.0.0:6006',
        JPDA_TRANSPORT: 'dt_socket',
      });
      expect(opts.env?.['CATALINA_OPTS']).toContain('-Dexisting=true');
      expect(opts.env?.['CATALINA_OPTS']).toContain('-Dhttp.port=9080');
      expect(opts.env?.['CATALINA_OPTS']).toContain('-Dshutdown.port=8123');
      expect(opts.env?.['CATALINA_OPTS']).toContain('-Xmx512m');
      return child;
    });

    const config = fakeConfig(homePath, path.join(tmpDir, 'instance'), {
      ports: { http: 9080, debug: 6006 },
      debug: { enabled: true, bind: '0.0.0.0', attachDelayMs: 1000 },
      run: {
        env: { APP_ENV: 'test', CATALINA_OPTS: '-Dexisting=true' },
        vmArgs: ['-Xmx512m'],
      },
    });

    const result = await plugin.start(dummyCtx(), config, 'debug');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pid).toBe(4321);
      expect(result.value.debugPort).toBe(6006);
      expect(result.value.hints).toContain('Debug port: 6006');
    }
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(store.set).toHaveBeenCalledWith('jsm.tomcat.shutdownPort.srv-1', 8123);
    child.emitExit(0);
  });

  it('persists the reserved shutdown port on start', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const child = createFakeChildProcess(4322);
    const store = spyKeyValueStore();
    plugin = new TomcatPlugin(noopLogger(), { keyValueStore: store.store });

    vi.spyOn(plugin['portScanner'], 'findFreePort').mockResolvedValue(8111);
    vi.spyOn(plugin['spawner'], 'spawn').mockImplementation((opts) => {
      expect(opts.env?.['CATALINA_OPTS']).toContain('-Dshutdown.port=8111');
      return child;
    });

    const result = await plugin.start(dummyCtx(), fakeConfig(homePath, path.join(tmpDir, 'instance')), 'run');

    expect(result.ok).toBe(true);
    expect(store.set).toHaveBeenCalledWith('jsm.tomcat.shutdownPort.srv-1', 8111);
    child.emitExit(0);
  });

  it('starts scanning from the configured shutdown port instead of the default port', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const child = createFakeChildProcess(4323);
    const store = spyKeyValueStore();
    plugin = new TomcatPlugin(noopLogger(), { keyValueStore: store.store });

    const findFreePortSpy = vi.spyOn(plugin['portScanner'], 'findFreePort').mockResolvedValue(9010);
    vi.spyOn(plugin['spawner'], 'spawn').mockImplementation((opts) => {
      expect(opts.env?.['CATALINA_OPTS']).toContain('-Dshutdown.port=9010');
      return child;
    });

    const config = fakeConfig(homePath, path.join(tmpDir, 'instance'), {
      pluginConfig: { type: 'tomcat', shutdownPort: 9010, disableAjp: true },
    });
    const result = await plugin.start(dummyCtx(), config, 'run');

    expect(result.ok).toBe(true);
    expect(findFreePortSpy).toHaveBeenCalledWith(9010);
    expect(store.set).toHaveBeenCalledWith('jsm.tomcat.shutdownPort.srv-1', 9010);
    child.emitExit(0);
  });

  it('retrieves the saved shutdown port during stop and clears it afterwards', async () => {
    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const store = spyKeyValueStore({ 'jsm.tomcat.shutdownPort.srv-1': 8123 });
    plugin = new TomcatPlugin(noopLogger(), { keyValueStore: store.store });

    const child = createFakeChildProcess(9876);
    const spawnSpy = vi.spyOn(plugin['spawner'], 'spawn').mockImplementation((opts) => {
      expect(opts.args).toEqual(['stop']);
      expect(opts.env?.['CATALINA_OPTS']).toContain('-Dshutdown.port=8123');
      queueMicrotask(() => {
        opts.onExit?.(0, null);
        child.emitExit(0);
      });
      return child;
    });

    const result = await plugin.stop(dummyCtx(), fakeConfig(homePath, path.join(tmpDir, 'instance')));

    expect(result.ok).toBe(true);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(store.get).toHaveBeenCalledWith('jsm.tomcat.shutdownPort.srv-1');
    expect(store.delete).toHaveBeenCalledWith('jsm.tomcat.shutdownPort.srv-1');
  });

  it('forces the stop command to exit on timeout and cleans up the tracked child', async () => {
    vi.useFakeTimers();

    const homePath = path.join(tmpDir, 'tomcat-home');
    await createFakeTomcatHome(homePath);
    const stopCommandChild = createFakeChildProcess(4501);
    const trackedChild = createFakeChildProcess(4502);
    const killSpy = vi.spyOn(plugin['spawner'], 'kill').mockReturnValue(true);
    vi.spyOn(plugin['spawner'], 'spawn').mockReturnValue(stopCommandChild);

    const config = fakeConfig(homePath, path.join(tmpDir, 'instance'), {
      timeouts: { stopMs: 25 },
    });
    plugin['childProcesses'].set(config.id, trackedChild);

    const stopPromise = plugin.stop(dummyCtx(), config);
    await vi.advanceTimersByTimeAsync(26);
    const result = await stopPromise;

    expect(result.ok).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(4501, true);
    expect(killSpy).toHaveBeenCalledWith(4502);
    expect(plugin['childProcesses'].has(config.id)).toBe(false);
  });

  it('reports running when the tracked child is alive and the HTTP port responds', async () => {
    const config = fakeConfig(path.join(tmpDir, 'home'), path.join(tmpDir, 'instance'));
    const child = createFakeChildProcess(5101);
    plugin['childProcesses'].set(config.id, child);

    vi.spyOn(process, 'kill').mockImplementation(() => true);
    vi.spyOn(plugin['portScanner'], 'probe').mockResolvedValue(true);

    const result = await plugin.getStatus(dummyCtx(), config);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        state: 'running',
        pid: 5101,
        httpPort: config.ports.http,
      });
    }
    plugin['childProcesses'].clear();
  });

  it('reports starting when the tracked child is alive but the HTTP port is not ready', async () => {
    const config = fakeConfig(path.join(tmpDir, 'home'), path.join(tmpDir, 'instance'));
    const child = createFakeChildProcess(5102);
    plugin['childProcesses'].set(config.id, child);

    vi.spyOn(process, 'kill').mockImplementation(() => true);
    vi.spyOn(plugin['portScanner'], 'probe').mockResolvedValue(false);

    const result = await plugin.getStatus(dummyCtx(), config);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        state: 'starting',
        pid: 5102,
        httpPort: undefined,
      });
    }
    plugin['childProcesses'].clear();
  });

  it('reports stopped and clears stale tracked children when the process is gone', async () => {
    const config = fakeConfig(path.join(tmpDir, 'home'), path.join(tmpDir, 'instance'));
    const child = createFakeChildProcess(5103);
    plugin['childProcesses'].set(config.id, child);

    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('no such process');
    });
    const probeSpy = vi.spyOn(plugin['portScanner'], 'probe');

    const result = await plugin.getStatus(dummyCtx(), config);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ state: 'stopped' });
    }
    expect(plugin['childProcesses'].has(config.id)).toBe(false);
    expect(probeSpy).not.toHaveBeenCalled();
  });

  it('reports health using the HTTP probe and records latency', async () => {
    const config = fakeConfig(path.join(tmpDir, 'home'), path.join(tmpDir, 'instance'));
    const probeSpy = vi.spyOn(plugin['portScanner'], 'probe').mockResolvedValue(true);

    const result = await plugin.healthCheck(dummyCtx(), config);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ok).toBe(true);
      expect(result.value.latencyMs).toBeGreaterThanOrEqual(0);
    }
    expect(probeSpy).toHaveBeenCalledWith(config.ports.http, config.host);
  });
});

// ── Incremental Deploy + Hot Reload ────────────────────────────────────────

describe('TomcatPlugin — incremental deploy and hot reload', () => {
  it('applies incremental add/change/delete file changes', async () => {
    const instancePath = path.join(tmpDir, 'instance');
    const targetPath = path.join(instancePath, 'webapps', 'myapp');
    await fs.mkdir(path.join(targetPath, 'nested'), { recursive: true });
    await fs.writeFile(path.join(targetPath, 'changed.txt'), 'before-change');
    await fs.writeFile(path.join(targetPath, 'delete.txt'), 'before-delete');

    const sourceRoot = path.join(tmpDir, 'changes');
    await fs.mkdir(path.join(sourceRoot, 'nested'), { recursive: true });
    const addedFile = path.join(sourceRoot, 'nested', 'added.txt');
    const changedFile = path.join(sourceRoot, 'changed.txt');
    await fs.writeFile(addedFile, 'added-content');
    await fs.writeFile(changedFile, 'changed-content');

    const config = fakeConfig(path.join(tmpDir, 'home'), instancePath);
    const dep = fakeDeployment('myapp');
    const plan = incrementalPlan(instancePath, dep.deployName);
    const changes = fileChangeBatch([
      { type: 'add', path: addedFile, relativePath: 'nested/added.txt' },
      { type: 'change', path: changedFile, relativePath: 'changed.txt' },
      { type: 'delete', path: path.join(sourceRoot, 'delete.txt'), relativePath: 'delete.txt' },
    ]);

    const result = await plugin.deployIncremental(dummyCtx(), config, dep, changes, plan);

    expect(result.ok).toBe(true);
    await expect(fs.readFile(path.join(targetPath, 'nested', 'added.txt'), 'utf-8')).resolves.toBe('added-content');
    await expect(fs.readFile(path.join(targetPath, 'changed.txt'), 'utf-8')).resolves.toBe('changed-content');
    await expect(fs.access(path.join(targetPath, 'delete.txt'))).rejects.toThrow();
  });

  it('hot-reloads via Manager when reload returns OK', async () => {
    const instancePath = path.join(tmpDir, 'instance');
    const targetPath = path.join(instancePath, 'webapps', 'myapp');
    await fs.mkdir(targetPath, { recursive: true });

    const sourceFile = path.join(tmpDir, 'updated.txt');
    await fs.writeFile(sourceFile, 'updated-content');

    const config = fakeConfig(path.join(tmpDir, 'home'), instancePath, {
      run: {
        env: { JSM_MANAGER_USER: 'admin', JSM_MANAGER_PASS: 'secret' },
        vmArgs: [],
      },
    });
    const dep = fakeDeployment('myapp');
    const plan = incrementalPlan(instancePath, dep.deployName);
    const changes = fileChangeBatch([
      { type: 'add', path: sourceFile, relativePath: 'updated.txt' },
    ]);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('OK - Reloaded', { status: 200, statusText: 'OK' }),
    );

    const result = await plugin.hotReload(dummyCtx(), config, dep, changes, plan);

    expect(result.ok).toBe(true);
    await expect(fs.readFile(path.join(targetPath, 'updated.txt'), 'utf-8')).resolves.toBe('updated-content');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:9080/manager/text/reload?path=/myapp',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}`,
        },
      }),
    );
  });

  it('falls back to touching context.xml when Manager reload fails', async () => {
    const instancePath = path.join(tmpDir, 'instance');
    const contextDir = path.join(instancePath, 'conf', 'Catalina', 'localhost');
    await fs.mkdir(contextDir, { recursive: true });
    const contextXml = path.join(contextDir, 'myapp.xml');
    const earlier = new Date(Date.now() - 60_000);
    await fs.writeFile(contextXml, '<Context />');
    await fs.utimes(contextXml, earlier, earlier);

    const config = fakeConfig(path.join(tmpDir, 'home'), instancePath, {
      run: {
        env: { JSM_MANAGER_PASS: 'secret' },
        vmArgs: [],
      },
    });
    const dep = fakeDeployment('myapp');
    const plan = incrementalPlan(instancePath, dep.deployName);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Manager unavailable', { status: 500, statusText: 'Server Error' }),
    );

    const result = await plugin.hotReload(dummyCtx(), config, dep, fileChangeBatch([]), plan);

    expect(result.ok).toBe(true);
    const stat = await fs.stat(contextXml);
    expect(stat.mtimeMs).toBeGreaterThan(earlier.getTime());
  });

  it('reports Manager reload timeout as Timeout', async () => {
    vi.useFakeTimers();

    const config = fakeConfig(path.join(tmpDir, 'home'), path.join(tmpDir, 'instance'), {
      run: {
        env: { JSM_MANAGER_PASS: 'secret' },
        vmArgs: [],
      },
    });
    const dep = fakeDeployment('myapp');

    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';
        reject(abortError);
      });
    }) as Promise<Response>);

    const promise = plugin['callManagerReload'](config, dep);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('Timeout');
      expect(result.error.message).toBe('Manager reload timed out');
    }
  });

  it('reports missing Manager password as InvalidConfig', async () => {
    const config = fakeConfig(path.join(tmpDir, 'home'), path.join(tmpDir, 'instance'));
    const dep = fakeDeployment('myapp');

    const result = await plugin['callManagerReload'](config, dep);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('InvalidConfig');
      expect(result.error.message).toContain('Tomcat Manager password not configured');
    }
  });

  it('returns DeployFailed when touching the reload target fails', async () => {
    const instancePath = path.join(tmpDir, 'instance');
    const contextDir = path.join(instancePath, 'conf', 'Catalina', 'localhost');
    await fs.mkdir(contextDir, { recursive: true });
    await fs.writeFile(path.join(contextDir, 'myapp.xml'), '<Context />');

    const targetSpy = vi.spyOn(plugin as unknown as { resolveReloadTouchTarget: () => Promise<string | undefined> }, 'resolveReloadTouchTarget')
      .mockResolvedValue(path.join(tmpDir, 'missing-target'));
    const result = await plugin['touchContextXml'](fakeConfig(path.join(tmpDir, 'home'), instancePath), fakeDeployment('myapp'));

    expect(targetSpy).toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DeployFailed');
    }
  });

  it('cancels hot reload before triggering the reload step', async () => {
    const instancePath = path.join(tmpDir, 'instance');
    const targetPath = path.join(instancePath, 'webapps', 'myapp');
    await fs.mkdir(targetPath, { recursive: true });

    const sourceFile = path.join(tmpDir, 'cancelled.txt');
    await fs.writeFile(sourceFile, 'copied-before-cancel');

    let checks = 0;
    const ctx: OperationContext = {
      ...dummyCtx(),
      cancel: {
        get isCancelled() {
          checks += 1;
          return checks >= 2;
        },
        onCancelled: () => ({ dispose: () => {} }),
      },
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const config = fakeConfig(path.join(tmpDir, 'home'), instancePath, {
      run: {
        env: { JSM_MANAGER_PASS: 'secret' },
        vmArgs: [],
      },
    });
    const dep = fakeDeployment('myapp');
    const plan = incrementalPlan(instancePath, dep.deployName);
    const changes = fileChangeBatch([
      { type: 'add', path: sourceFile, relativePath: 'cancelled.txt' },
    ]);

    await expect(plugin.hotReload(ctx, config, dep, changes, plan)).rejects.toMatchObject({
      code: 'Cancelled',
      message: "Hot reload for 'myapp' was cancelled before triggering the reload step.",
    });
    await expect(fs.readFile(path.join(targetPath, 'cancelled.txt'), 'utf-8')).resolves.toBe('copied-before-cancel');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Deploy Full (atomicity) ─────────────────────────────────────────────────

describe('TomcatPlugin — deployFull', () => {
  it('deploys an exploded directory with staging/swap', async () => {
    const instancePath = path.join(tmpDir, 'instance');
    await fs.mkdir(path.join(instancePath, 'webapps'), { recursive: true });

    // Create source
    const sourcePath = path.join(tmpDir, 'source-app');
    await fs.mkdir(sourcePath, { recursive: true });
    await fs.writeFile(path.join(sourcePath, 'index.html'), '<h1>Hello</h1>');

    const config = fakeConfig(path.join(tmpDir, 'home'), instancePath);
    const dep: DeploymentConfig = {
      id: 'dep-1' as DeploymentConfig['id'],
      type: 'exploded',
      sourcePath,
      deployName: 'myapp',
      syncMode: 'manual',
      hotReload: false,
      ignoreGlobs: [],
      hooks: [],
    };
    const plan = {
      targetRoot: path.join(instancePath, 'webapps'),
      targetPath: path.join(instancePath, 'webapps', 'myapp'),
      strategy: 'copy-dir' as const,
      notes: [],
    };

    const result = await plugin.deployFull(dummyCtx(), config, dep, plan);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.strategy).toBe('copy-dir');
      expect(result.value.deployedPath).toBe(plan.targetPath);
    }

    // Verify files deployed
    const deployed = await fs.readFile(path.join(plan.targetPath, 'index.html'), 'utf-8');
    expect(deployed).toBe('<h1>Hello</h1>');
  });

  it('deploys a WAR file', async () => {
    const instancePath = path.join(tmpDir, 'instance');
    await fs.mkdir(path.join(instancePath, 'webapps'), { recursive: true });

    // Create fake WAR
    const sourcePath = path.join(tmpDir, 'app.war');
    await fs.writeFile(sourcePath, 'PK-fake-war-content');

    const config = fakeConfig(path.join(tmpDir, 'home'), instancePath);
    const dep: DeploymentConfig = {
      id: 'dep-2' as DeploymentConfig['id'],
      type: 'war',
      sourcePath,
      deployName: 'myapp',
      syncMode: 'manual',
      hotReload: false,
      ignoreGlobs: [],
      hooks: [],
    };
    const plan = {
      targetRoot: path.join(instancePath, 'webapps'),
      targetPath: path.join(instancePath, 'webapps', 'myapp.war'),
      strategy: 'copy-war' as const,
      notes: [],
    };

    const result = await plugin.deployFull(dummyCtx(), config, dep, plan);
    expect(result.ok).toBe(true);

    const content = await fs.readFile(plan.targetPath, 'utf-8');
    expect(content).toBe('PK-fake-war-content');
  });

  it('returns error when source does not exist', async () => {
    const config = fakeConfig(path.join(tmpDir, 'home'), path.join(tmpDir, 'instance'));
    const dep: DeploymentConfig = {
      id: 'dep-3' as DeploymentConfig['id'],
      type: 'exploded',
      sourcePath: path.join(tmpDir, 'nonexistent'),
      deployName: 'missing',
      syncMode: 'manual',
      hotReload: false,
      ignoreGlobs: [],
      hooks: [],
    };
    const plan = {
      targetRoot: path.join(tmpDir, 'instance', 'webapps'),
      targetPath: path.join(tmpDir, 'instance', 'webapps', 'missing'),
      strategy: 'copy-dir' as const,
      notes: [],
    };

    const result = await plugin.deployFull(dummyCtx(), config, dep, plan);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SourceNotFound');
    }
  });
});

// ── Undeploy ────────────────────────────────────────────────────────────────

describe('TomcatPlugin — undeploy', () => {
  it('removes an exploded deployment', async () => {
    const instancePath = path.join(tmpDir, 'instance');
    const webapps = path.join(instancePath, 'webapps');
    const appDir = path.join(webapps, 'myapp');
    await fs.mkdir(appDir, { recursive: true });
    await fs.writeFile(path.join(appDir, 'index.html'), 'hello');

    const config = fakeConfig(path.join(tmpDir, 'home'), instancePath);
    const dep: DeploymentConfig = {
      id: 'dep-1' as DeploymentConfig['id'],
      type: 'exploded',
      sourcePath: '/any',
      deployName: 'myapp',
      syncMode: 'manual',
      hotReload: false,
      ignoreGlobs: [],
      hooks: [],
    };

    const result = await plugin.undeploy(dummyCtx(), config, dep);
    expect(result.ok).toBe(true);

    // Both possible paths should be gone
    await expect(fs.access(appDir)).rejects.toThrow();
  });
});

// ── Log Sources ─────────────────────────────────────────────────────────────

describe('TomcatPlugin — getLogSources', () => {
  it('finds catalina.out as primary log', async () => {
    const instancePath = path.join(tmpDir, 'instance');
    const logsDir = path.join(instancePath, 'logs');
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(path.join(logsDir, 'catalina.out'), 'log data');
    await fs.writeFile(path.join(logsDir, 'localhost.2024-01-01.log'), 'access log');

    const config = fakeConfig(path.join(tmpDir, 'home'), instancePath);
    const result = await plugin.getLogSources(config);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.primary?.id).toBe('catalina-out');
      expect(result.value.others.length).toBe(1);
      expect(result.value.others[0].id).toBe('localhost.2024-01-01.log');
    }
  });

  it('returns no primary when catalina.out is missing', async () => {
    const instancePath = path.join(tmpDir, 'instance');
    await fs.mkdir(path.join(instancePath, 'logs'), { recursive: true });

    const config = fakeConfig(path.join(tmpDir, 'home'), instancePath);
    const result = await plugin.getLogSources(config);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.primary).toBeUndefined();
    }
  });
});

// ── Default Config ──────────────────────────────────────────────────────────

describe('TomcatPlugin — getDefaultConfig', () => {
  it('returns sensible defaults', () => {
    const defaults = plugin.getDefaultConfig();
    expect(defaults.ports?.http).toBe(8080);
    expect(defaults.ports?.debug).toBe(5005);
    expect(defaults.debug?.bind).toBe('127.0.0.1');
    expect(defaults.pluginConfig).toEqual({
      type: 'tomcat',
      shutdownPort: 8005,
      disableAjp: true,
    });
  });
});
