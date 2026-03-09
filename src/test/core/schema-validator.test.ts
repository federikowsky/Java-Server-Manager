import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaValidator } from '@core/validation/SchemaValidator';
import schema from '../../../data/jsm.servers.schema.json';

describe('SchemaValidator', () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    validator = new SchemaValidator();
    validator.addSchema('workspace', schema);
  });

  it('accepts a valid minimal config', () => {
    const data = {
      schemaVersion: 1,
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
      schemaVersion: 1,
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
      schemaVersion: 1,
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
      schemaVersion: 1,
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
