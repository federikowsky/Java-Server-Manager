import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { TomcatPlugin } from '@plugins/tomcat/TomcatPlugin';
import { TomcatStartupMonitor } from '@plugins/tomcat/TomcatStartupMonitor';
import type { ServerConfig, DeploymentConfig, OperationContext } from '@core/types';
import type { Logger } from '@core/types/logger';

// ── Helpers ─────────────────────────────────────────────────────────────────

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
  plugin = new TomcatPlugin(noopLogger());
});

afterEach(async () => {
  await plugin.dispose();
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
    plugin = new TomcatPlugin(noopLogger(), { serverXmlTemplatePath: templatePath });
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
