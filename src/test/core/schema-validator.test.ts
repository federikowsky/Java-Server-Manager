import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaValidator } from '@core/validation/SchemaValidator';
import schema from '../../../data/jsm.servers.schema.json';

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

  it('returns error for unknown schema ID', () => {
    const result = validator.validate({}, 'nonexistent');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Unknown schema');
  });
});
