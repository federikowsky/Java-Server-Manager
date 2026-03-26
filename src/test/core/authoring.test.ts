import { describe, expect, it } from 'vitest';
import {
  applyTemplateToServerDraft,
  applyServerDraftToConfig,
  createServerDraft,
  deploymentDraftToConfig,
  formDataToDeploymentDraft,
  formDataToServerDraft,
  serverConfigToDraft,
  serverDraftToCreateServerRequest,
  templateToServerDraftDefaults,
} from '@core/authoring';
import type { DeploymentConfig, HookConfig, HookEvent, ServerConfig, ServerTemplate } from '@core/types';

function makeHook(id = 'hook-1', event: HookEvent = 'lifecycle.start'): HookConfig {
  return {
    id,
    enabled: true,
    phase: 'pre',
    event,
    kind: 'command',
    timeoutMs: 60_000,
    continueOnError: false,
    command: {
      mode: 'shell',
      line: 'echo ready',
    },
  };
}

function makeServer(): ServerConfig {
  return {
    id: 'srv-1',
    name: 'My Tomcat',
    type: 'tomcat',
    runtime: { id: 'rt-1', homePath: '/opt/tomcat', version: '10.1.18' },
    instancePath: '/tmp/jsm/instances/srv-1',
    javaHome: '/Library/Java/JavaVirtualMachines/jdk-21',
    host: '127.0.0.1',
    ports: { http: 8080, debug: 5005 },
    run: { env: {}, vmArgs: ['-Xmx512m'] },
    debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
    deployments: [],
    autosync: {
      enabled: true,
      debounceMs: 400,
      maxBatchFiles: 200,
      maxBatchBytes: 20_000_000,
      stormBackoffMs: 2000,
      ignoreGlobs: ['**/.git/**'],
    },
    hooks: [makeHook()],
    pluginConfig: {
      type: 'tomcat',
      shutdownPort: 8005,
      disableAjp: true,
      ssl: {
        enabled: true,
        port: 8443,
        keystorePath: '/tmp/server.p12',
        keystorePassword: 'secret',
        keystoreType: 'PKCS12',
        clientAuth: false,
      },
    },
  };
}

describe('authoring adapters', () => {
  it('round-trips editable server fields through draft application', () => {
    const existing = makeServer();
    const draft = serverConfigToDraft(existing);

    const updated = applyServerDraftToConfig(draft, existing);

    expect(updated).toEqual(existing);
  });

  it('converts flat server form data into a create request', () => {
    const draft = formDataToServerDraft({
      name: 'Draft Server',
      type: 'tomcat',
      'runtime.homePath': '/opt/tomcat',
      javaHome: '/jdk-21',
      host: '0.0.0.0',
      'ports.http': 9090,
      'ports.debug': 6006,
      'debug.bind': 'localhost',
      'run.vmArgs': ['-Xmx1g'],
      hooks: [makeHook('hook-2')],
      'pluginConfig.ssl.enabled': true,
      'pluginConfig.ssl.port': 9443,
      'pluginConfig.ssl.keystorePath': '/tmp/ssl.p12',
      'pluginConfig.ssl.keystorePassword': 'top-secret',
    });
    const request = serverDraftToCreateServerRequest(draft);

    expect(request).toMatchObject({
      name: 'Draft Server',
      runtimeHomePath: '/opt/tomcat',
      javaHome: '/jdk-21',
      host: '0.0.0.0',
      httpPort: 9090,
      debugPort: 6006,
      debugBind: 'localhost',
      vmArgs: ['-Xmx1g'],
    });
    expect(request.hooks).toHaveLength(1);
    expect(request.pluginConfig).toMatchObject({
      type: 'tomcat',
      ssl: {
        enabled: true,
        port: 9443,
        keystorePath: '/tmp/ssl.p12',
      },
    });
  });

  it('converts deployment draft form data into deployment config', () => {
    const draft = formDataToDeploymentDraft({
      type: 'exploded',
      sourcePath: '/workspace/app',
      deployName: 'myapp',
      syncMode: 'auto',
      hotReload: true,
      ignoreGlobs: ['**/*.tmp'],
      healthCheckPath: '/health',
      healthCheckTimeoutMs: 7500,
      hooks: [makeHook('hook-3', 'deploy.full')],
    }, { id: 'dep-1' });
    const config = deploymentDraftToConfig(draft, 'dep-1');

    expect(config).toEqual<DeploymentConfig>({
      id: 'dep-1',
      type: 'exploded',
      sourcePath: '/workspace/app',
      deployName: 'myapp',
      syncMode: 'auto',
      hotReload: true,
      ignoreGlobs: ['**/*.tmp'],
      hooks: [makeHook('hook-3', 'deploy.full')],
      healthCheckPath: '/health',
      healthCheckTimeoutMs: 7500,
    });
  });

  it('projects template defaults into a create-ready server draft', () => {
    const template: ServerTemplate = {
      id: 'tpl-1',
      name: 'Tomcat Template',
      pluginType: 'tomcat',
      serverDefaults: {
        runtime: { homePath: '/opt/tomcat' },
        javaHome: '/jdk-21',
        host: '127.0.0.1',
        ports: { http: 8181, debug: 5006 },
        run: { vmArgs: ['-Xmx768m'] },
        debug: { bind: 'localhost' },
        hooks: [makeHook('hook-4')],
      },
    };

    const defaults = templateToServerDraftDefaults(template);
    const request = serverDraftToCreateServerRequest({
      name: 'From Template',
      type: defaults.type ?? 'tomcat',
      runtimeHomePath: defaults.runtimeHomePath ?? '',
      javaHome: defaults.javaHome ?? '',
      host: defaults.host ?? '127.0.0.1',
      httpPort: defaults.httpPort ?? 8080,
      debugPort: defaults.debugPort,
      debugBind: defaults.debugBind ?? '127.0.0.1',
      vmArgs: defaults.vmArgs ?? [],
      hooks: defaults.hooks ?? [],
      pluginConfig: defaults.pluginConfig,
    });

    expect(request).toMatchObject({
      name: 'From Template',
      runtimeHomePath: '/opt/tomcat',
      javaHome: '/jdk-21',
      httpPort: 8181,
      debugPort: 5006,
      debugBind: 'localhost',
      vmArgs: ['-Xmx768m'],
    });
    expect(request.hooks).toHaveLength(1);
  });

  it('applies template defaults through the shared authoring contract', () => {
    const template: ServerTemplate = {
      id: 'tpl-2',
      name: 'Secure Tomcat',
      pluginType: 'tomcat',
      serverDefaults: {
        runtime: { homePath: '/opt/secure-tomcat' },
        javaHome: '/jdk-21',
        host: 'localhost',
        ports: { http: 8443, debug: 5007 },
        run: { vmArgs: ['-Xmx1g'] },
        debug: { bind: 'localhost' },
        hooks: [makeHook('hook-5')],
        pluginConfig: {
          type: 'tomcat',
          shutdownPort: 8005,
          disableAjp: true,
          ssl: {
            enabled: true,
            port: 9443,
            keystorePath: '/tmp/secure.p12',
            keystorePassword: 'secret',
            keystoreType: 'PKCS12',
            clientAuth: false,
          },
        },
      },
    };

    const draft = applyTemplateToServerDraft({
      template,
      defaults: {
        defaultJavaHome: '/jdk-default',
        defaultHttpPort: 8080,
        defaultDebugPort: 5005,
      },
      overrides: {
        name: 'User Named Server',
      },
    });

    expect(draft).toMatchObject({
      name: 'User Named Server',
      type: 'tomcat',
      runtimeHomePath: '/opt/secure-tomcat',
      javaHome: '/jdk-21',
      host: 'localhost',
      httpPort: 8443,
      debugPort: 5007,
      debugBind: 'localhost',
      vmArgs: ['-Xmx1g'],
    });
    expect(draft.hooks).toHaveLength(1);
    expect(draft.pluginConfig).toMatchObject({
      type: 'tomcat',
      ssl: {
        enabled: true,
        port: 9443,
      },
    });
  });

  it('resets template-controlled fields when switching templates while preserving user overrides', () => {
    const templateA: ServerTemplate = {
      id: 'tpl-a',
      name: 'Template A',
      pluginType: 'tomcat',
      serverDefaults: {
        runtime: { homePath: '/opt/template-a' },
        ports: { http: 8181 },
        hooks: [makeHook('hook-a')],
      },
    };
    const templateB: ServerTemplate = {
      id: 'tpl-b',
      name: 'Template B',
      pluginType: 'tomcat',
      serverDefaults: {
        runtime: { homePath: '/opt/template-b' },
        ports: { http: 8282 },
        hooks: [makeHook('hook-b')],
      },
    };

    const firstDraft = applyTemplateToServerDraft({
      template: templateA,
      overrides: { name: 'Keep Me' },
    });
    const switchedDraft = applyTemplateToServerDraft({
      template: templateB,
      overrides: { name: firstDraft.name },
    });

    expect(switchedDraft.name).toBe('Keep Me');
    expect(switchedDraft.runtimeHomePath).toBe('/opt/template-b');
    expect(switchedDraft.httpPort).toBe(8282);
    expect(switchedDraft.hooks).toEqual([makeHook('hook-b')]);
  });

  it('creates a scratch draft from canonical creation defaults', () => {
    const draft = createServerDraft({
      defaults: {
        defaultJavaHome: '/jdk-default',
        defaultHttpPort: 8180,
        defaultDebugPort: 5100,
      },
      fallbackType: 'tomcat',
      overrides: {
        name: 'Scratch Server',
      },
    });

    expect(draft).toMatchObject({
      name: 'Scratch Server',
      type: 'tomcat',
      javaHome: '/jdk-default',
      host: '127.0.0.1',
      httpPort: 8180,
      debugPort: 5100,
      debugBind: '127.0.0.1',
      vmArgs: [],
      hooks: [],
    });
  });
});
