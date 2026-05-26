import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaValidator } from '@core/validation/SchemaValidator';
import schema from '../../schema/jsm.servers.schema.json';

describe('SchemaValidator', () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    validator = new SchemaValidator();
    validator.registerBuiltInSchemas(schema as Record<string, unknown> & {
      definitions?: Record<string, unknown>;
    });
  });

  it('accepts a valid single server config', () => {
    const server = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Test',
      type: 'tomcat',
      runtime: { id: 'r1', homePath: '/opt/tomcat' },
      instancePath: '/tmp/base',
      javaHome: '/usr/lib/jvm/java-17',
      host: '127.0.0.1',
      ports: { http: 8080, debug: 5005 },
      run: { env: {}, vmArgs: [] },
      debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
      deployments: [],
      autosync: {
        enabled: true,
        debounceMs: 400,
        maxBatchFiles: 200,
        maxBatchBytes: 20000000,
        stormBackoffMs: 2000,
        ignoreGlobs: [],
      },
      hooks: [],
    };

    const result = validator.validate(server, 'server-config');
    expect(result.ok).toBe(true);
  });

  it('accepts a shell-based hook config', () => {
    const server = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Hook Test',
      type: 'tomcat',
      runtime: { id: 'r1', homePath: '/opt/tomcat' },
      instancePath: '/tmp/base',
      javaHome: '/usr/lib/jvm/java-17',
      host: '127.0.0.1',
      ports: { http: 8080, debug: 5005 },
      run: { env: {}, vmArgs: [] },
      debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
      deployments: [],
      autosync: {
        enabled: true,
        debounceMs: 400,
        maxBatchFiles: 200,
        maxBatchBytes: 20000000,
        stormBackoffMs: 2000,
        ignoreGlobs: [],
      },
      hooks: [{
        id: 'hook-shell-1',
        enabled: true,
        phase: 'pre',
        event: 'lifecycle.start',
        kind: 'command',
        timeoutMs: 60000,
        continueOnError: false,
        command: {
          mode: 'shell',
          line: 'npm run build && npm test',
        },
      }],
    };

    const result = validator.validate(server, 'server-config');
    expect(result.ok).toBe(true);
  });

  it('accepts a valid minimal config', () => {
    const data = {
      version: 1,
      servers: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test',
        type: 'tomcat',
        runtime: { id: 'r1', homePath: '/opt/tomcat' },
        instancePath: '/tmp/base',
        javaHome: '/usr/lib/jvm/java-17',
        host: '127.0.0.1',
        ports: { http: 8080, debug: 5005 },
        run: { env: {}, vmArgs: [] },
        debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
        deployments: [],
        autosync: {
          enabled: true,
          debounceMs: 400,
          maxBatchFiles: 200,
          maxBatchBytes: 20000000,
          stormBackoffMs: 2000,
          ignoreGlobs: [],
        },
        hooks: [],
      }],
    };
    const result = validator.validate(data, 'workspace');
    expect(result.ok).toBe(true);
  });

  it('accepts a legacy unversioned workspace config', () => {
    const data = {
      servers: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test',
        type: 'tomcat',
        runtime: { id: 'r1', homePath: '/opt/tomcat' },
        instancePath: '/tmp/base',
        javaHome: '/usr/lib/jvm/java-17',
        host: '127.0.0.1',
        ports: { http: 8080, debug: 5005 },
        run: { env: {}, vmArgs: [] },
        debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
        deployments: [],
        autosync: {
          enabled: true,
          debounceMs: 400,
          maxBatchFiles: 200,
          maxBatchBytes: 20000000,
          stormBackoffMs: 2000,
          ignoreGlobs: [],
        },
        hooks: [],
      }],
    };
    const result = validator.validate(data, 'workspace');
    expect(result.ok).toBe(true);
  });

  it('rejects unsupported workspace config versions', () => {
    const data = {
      version: 999,
      servers: [],
    };
    const result = validator.validate(data, 'workspace');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details).toContain('version');
  });

  it('rejects config with invalid port number', () => {
    const data = {
      servers: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test',
        type: 'tomcat',
        runtime: { id: 'r1', homePath: '/opt/tomcat' },
        instancePath: '/tmp/base',
        javaHome: '/usr/lib/jvm/java-17',
        host: '127.0.0.1',
        ports: { http: 99999, debug: 5005 },
        run: { env: {}, vmArgs: [] },
        debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
        deployments: [],
        autosync: {
          enabled: true,
          debounceMs: 400,
          maxBatchFiles: 200,
          maxBatchBytes: 20000000,
          stormBackoffMs: 2000,
          ignoreGlobs: [],
        },
        hooks: [],
      }],
    };
    const result = validator.validate(data, 'workspace');
    expect(result.ok).toBe(false);
  });

  it('rejects invalid debug.bind value', () => {
    const data = {
      servers: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test',
        type: 'tomcat',
        runtime: { id: 'r1', homePath: '/opt/tomcat' },
        instancePath: '/tmp/base',
        javaHome: '/usr/lib/jvm/java-17',
        host: '127.0.0.1',
        ports: { http: 8080, debug: 5005 },
        run: { env: {}, vmArgs: [] },
        debug: { enabled: true, bind: '0.0.0.0', attachDelayMs: 1000 },
        deployments: [],
        autosync: {
          enabled: true,
          debounceMs: 400,
          maxBatchFiles: 200,
          maxBatchBytes: 20000000,
          stormBackoffMs: 2000,
          ignoreGlobs: [],
        },
        hooks: [],
      }],
    };
    const result = validator.validate(data, 'workspace');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details).toContain('bind');
  });

  it('rejects invalid deployName pattern', () => {
    const data = {
      servers: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test',
        type: 'tomcat',
        runtime: { id: 'r1', homePath: '/opt/tomcat' },
        instancePath: '/tmp/base',
        javaHome: '/usr/lib/jvm/java-17',
        host: '127.0.0.1',
        ports: { http: 8080, debug: 5005 },
        run: { env: {}, vmArgs: [] },
        debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
        deployments: [{
          id: '550e8400-e29b-41d4-a716-446655440001',
          type: 'war',
          sourcePath: '/app/target/app.war',
          deployName: '../evil',
          syncMode: 'manual',
          hotReload: false,
          ignoreGlobs: [],
          hooks: [],
        }],
        autosync: {
          enabled: true,
          debounceMs: 400,
          maxBatchFiles: 200,
          maxBatchBytes: 20000000,
          stormBackoffMs: 2000,
          ignoreGlobs: [],
        },
        hooks: [],
      }],
    };
    const result = validator.validate(data, 'workspace');
    expect(result.ok).toBe(false);
  });

  it('accepts deployment build config when explicitly configured', () => {
    const data = {
      servers: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test',
        type: 'tomcat',
        runtime: { id: 'r1', homePath: '/opt/tomcat' },
        instancePath: '/tmp/base',
        javaHome: '/usr/lib/jvm/java-17',
        host: '127.0.0.1',
        ports: { http: 8080, debug: 5005 },
        run: { env: {}, vmArgs: [] },
        debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
        deployments: [{
          id: '550e8400-e29b-41d4-a716-446655440001',
          type: 'war',
          sourcePath: '/app/target/app.war',
          deployName: 'app',
          syncMode: 'manual',
          hotReload: false,
          ignoreGlobs: [],
          build: {
            enabled: true,
            kind: 'command',
            trigger: 'manual',
            timeoutMs: 120000,
            command: {
              mode: 'shell',
              line: 'mvn package',
              cwd: '/app',
              env: {
                MAVEN_OPTS: '-Xmx1g',
              },
            },
          },
          hooks: [],
        }],
        autosync: {
          enabled: true,
          debounceMs: 400,
          maxBatchFiles: 200,
          maxBatchBytes: 20000000,
          stormBackoffMs: 2000,
          ignoreGlobs: [],
        },
        hooks: [],
      }],
    };

    const result = validator.validate(data, 'workspace');
    expect(result.ok).toBe(true);
  });

  it('accepts deployment readiness gate when explicitly configured with a health path', () => {
    const data = {
      servers: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test',
        type: 'tomcat',
        runtime: { id: 'r1', homePath: '/opt/tomcat' },
        instancePath: '/tmp/base',
        javaHome: '/usr/lib/jvm/java-17',
        host: '127.0.0.1',
        ports: { http: 8080, debug: 5005 },
        run: { env: {}, vmArgs: [] },
        debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
        deployments: [{
          id: '550e8400-e29b-41d4-a716-446655440001',
          type: 'war',
          sourcePath: '/app/target/app.war',
          deployName: 'app',
          syncMode: 'manual',
          hotReload: false,
          ignoreGlobs: [],
          healthCheckPath: '/app/health',
          readinessGate: {
            enabled: true,
            trigger: 'postDeployAndStart',
          },
          hooks: [],
        }],
        autosync: {
          enabled: true,
          debounceMs: 400,
          maxBatchFiles: 200,
          maxBatchBytes: 20000000,
          stormBackoffMs: 2000,
          ignoreGlobs: [],
        },
        hooks: [],
      }],
    };

    const result = validator.validate(data, 'workspace');
    expect(result.ok).toBe(true);
  });

  it('rejects enabled readiness gate without a health path', () => {
    const data = {
      servers: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test',
        type: 'tomcat',
        runtime: { id: 'r1', homePath: '/opt/tomcat' },
        instancePath: '/tmp/base',
        javaHome: '/usr/lib/jvm/java-17',
        host: '127.0.0.1',
        ports: { http: 8080, debug: 5005 },
        run: { env: {}, vmArgs: [] },
        debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
        deployments: [{
          id: '550e8400-e29b-41d4-a716-446655440001',
          type: 'war',
          sourcePath: '/app/target/app.war',
          deployName: 'app',
          syncMode: 'manual',
          hotReload: false,
          ignoreGlobs: [],
          readinessGate: {
            enabled: true,
            trigger: 'postDeploy',
          },
          hooks: [],
        }],
        autosync: {
          enabled: true,
          debounceMs: 400,
          maxBatchFiles: 200,
          maxBatchBytes: 20000000,
          stormBackoffMs: 2000,
          ignoreGlobs: [],
        },
        hooks: [],
      }],
    };

    const result = validator.validate(data, 'workspace');
    expect(result.ok).toBe(false);
  });

  it('rejects command build config without a command line', () => {
    const data = {
      servers: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test',
        type: 'tomcat',
        runtime: { id: 'r1', homePath: '/opt/tomcat' },
        instancePath: '/tmp/base',
        javaHome: '/usr/lib/jvm/java-17',
        host: '127.0.0.1',
        ports: { http: 8080, debug: 5005 },
        run: { env: {}, vmArgs: [] },
        debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
        deployments: [{
          id: '550e8400-e29b-41d4-a716-446655440001',
          type: 'war',
          sourcePath: '/app/target/app.war',
          deployName: 'app',
          syncMode: 'manual',
          hotReload: false,
          ignoreGlobs: [],
          build: {
            enabled: true,
            kind: 'command',
            trigger: 'manual',
            timeoutMs: 120000,
            command: {
              mode: 'shell',
              line: '',
            },
          },
          hooks: [],
        }],
        autosync: {
          enabled: true,
          debounceMs: 400,
          maxBatchFiles: 200,
          maxBatchBytes: 20000000,
          stormBackoffMs: 2000,
          ignoreGlobs: [],
        },
        hooks: [],
      }],
    };

    const result = validator.validate(data, 'workspace');
    expect(result.ok).toBe(false);
  });

  it('returns error for unknown schema ID', () => {
    const result = validator.validate({}, 'nonexistent');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Unknown schema');
  });
});
