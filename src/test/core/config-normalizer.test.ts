import { describe, it, expect } from 'vitest';
import { migrateV0toV1, shellSplit } from '@core/policy/ConfigNormalizer';

describe('shellSplit', () => {
  it('splits simple whitespace-separated args', () => {
    expect(shellSplit('-Xmx512m -Xms256m')).toEqual(['-Xmx512m', '-Xms256m']);
  });

  it('respects double quotes', () => {
    expect(shellSplit('-Dpath="/my dir/lib" -Xmx1g')).toEqual(['-Dpath=/my dir/lib', '-Xmx1g']);
  });

  it('respects single quotes', () => {
    expect(shellSplit("-Dfoo='bar baz'")).toEqual(['-Dfoo=bar baz']);
  });

  it('handles empty string', () => {
    expect(shellSplit('')).toEqual([]);
  });

  it('handles multiple spaces', () => {
    expect(shellSplit('a   b  c')).toEqual(['a', 'b', 'c']);
  });
});

describe('migrateV0toV1', () => {
  it('migrates a minimal v0 server', () => {
    const legacy = {
      servers: [{
        id: '00000000-0000-0000-0000-000000000001',
        name: 'My Tomcat',
        serverHome: '/opt/tomcat',
        port: 9090,
        javaHome: '/usr/lib/jvm/java-17',
      }],
    };

    const result = migrateV0toV1(legacy, '/workspace');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.schemaVersion).toBe(1);
    expect(result.value.servers).toHaveLength(1);
    const s = result.value.servers[0];
    expect(s.name).toBe('My Tomcat');
    expect(s.runtime.homePath).toBe('/opt/tomcat');
    expect(s.ports.http).toBe(9090);
    expect(s.ports.debug).toBe(5005);
    expect(s.type).toBe('tomcat');
    expect(s.debug.bind).toBe('127.0.0.1');
    expect(s.autosync.enabled).toBe(true);
  });

  it('migrates vmArgs string to array', () => {
    const legacy = {
      servers: [{
        name: 'Test',
        vmArgs: '-Xmx512m -Xms256m',
        javaHome: '/jdk',
      }],
    };
    const result = migrateV0toV1(legacy, '/ws');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.servers[0].run.vmArgs).toEqual(['-Xmx512m', '-Xms256m']);
  });

  it('migrates preStartCmd and postStopCmd to disabled hooks', () => {
    const legacy = {
      servers: [{
        name: 'HookServer',
        javaHome: '/jdk',
        preStartCmd: '/usr/bin/prepare.sh',
        postStopCmd: '/usr/bin/cleanup.sh',
      }],
    };
    const result = migrateV0toV1(legacy, '/ws');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hooks = result.value.servers[0].hooks;
    expect(hooks).toHaveLength(2);
    expect(hooks[0].enabled).toBe(false);
    expect(hooks[0].phase).toBe('pre');
    expect(hooks[0].event).toBe('lifecycle.start');
    expect(hooks[0].command?.exe).toBe('/usr/bin/prepare.sh');
    expect(hooks[1].phase).toBe('post');
    expect(hooks[1].event).toBe('lifecycle.stop');
  });

  it('preserves unknown fields under x-extra', () => {
    const legacy = {
      servers: [{
        name: 'Test',
        javaHome: '/jdk',
        customField: 'custom-value',
      }],
    };
    const result = migrateV0toV1(legacy, '/ws');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = result.value.servers[0] as Record<string, unknown>;
    expect(s['x-extra']).toEqual({ customField: 'custom-value' });
  });

  it('sets autoSync: false → autosync.enabled: false', () => {
    const legacy = {
      servers: [{ name: 'Test', javaHome: '/jdk', autoSync: false }],
    };
    const result = migrateV0toV1(legacy, '/ws');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.servers[0].autosync.enabled).toBe(false);
  });

  it('returns error for non-object input', () => {
    const result = migrateV0toV1(null, '/ws');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MigrationFailed');
  });

  it('is idempotent', () => {
    const legacy = {
      servers: [{
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Test',
        javaHome: '/jdk',
        serverHome: '/tomcat',
      }],
    };
    const first = migrateV0toV1(legacy, '/ws');
    const second = migrateV0toV1(legacy, '/ws');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // Same servers, same structure (UUIDs for runtime.id differ but structure is same)
    expect(first.value.servers[0].name).toBe(second.value.servers[0].name);
    expect(first.value.schemaVersion).toBe(second.value.schemaVersion);
  });
});
