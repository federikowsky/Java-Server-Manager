import { describe, expect, it, vi } from 'vitest';
import {
  ENVIRONMENT_PROFILES_EXPORT_KIND,
  ENVIRONMENT_PROFILES_EXPORT_VERSION,
  EnvironmentProfileService,
} from '@app/env';
import type { KeyValueStore, Logger, SecretStore, ServerConfig } from '@core/types';
import { ErrorCode } from '@core/errors/codes';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function memoryStore(): KeyValueStore {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn(<T>(key: string): T | undefined => data.get(key) as T | undefined),
    set: vi.fn(async <T>(key: string, value: T) => { data.set(key, value); }),
    delete: vi.fn(async (key: string) => { data.delete(key); }),
  };
}

function memorySecretStore(): SecretStore {
  const data = new Map<string, string>();
  return {
    get: vi.fn(async (key: string): Promise<string | undefined> => data.get(key)),
    set: vi.fn(async (key: string, value: string) => { data.set(key, value); }),
    delete: vi.fn(async (key: string) => { data.delete(key); }),
  };
}

function makeService() {
  const metadataStore = memoryStore();
  const secretStore = memorySecretStore();
  return {
    metadataStore,
    secretStore,
    service: new EnvironmentProfileService({
      metadataStore,
      secretStore,
      logger: mockLogger(),
      trustGate: { isTrusted: () => true },
    }),
  };
}

function makeServer(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id: 'srv-1',
    name: 'Local Tomcat',
    type: 'tomcat',
    runtime: { id: 'rt-1', homePath: '/opt/tomcat' },
    instancePath: '/tmp/jsm/srv-1',
    javaHome: '/opt/java',
    host: '127.0.0.1',
    ports: { http: 8080, debug: 5005 },
    run: { env: {}, vmArgs: [] },
    debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
    deployments: [],
    autosync: { enabled: true, debounceMs: 400, maxBatchFiles: 200, maxBatchBytes: 20_000_000, stormBackoffMs: 2000, ignoreGlobs: [] },
    hooks: [],
    ...overrides,
  };
}

describe('EnvironmentProfileService', () => {
  it('stores secret values outside profile metadata and exports only safe placeholders', async () => {
    const { service, secretStore } = makeService();

    const upsertResult = await service.upsertProfile({
      id: 'team-local',
      name: 'Team Local',
      variables: {
        APP_ENV: { secret: false, value: 'local' },
        JSM_MANAGER_PASS: { secret: true, value: 'super-secret' },
      },
    });

    expect(upsertResult.ok).toBe(true);
    expect(secretStore.set).toHaveBeenCalledWith(expect.stringContaining('team-local'), 'super-secret');

    const listed = await service.listProfiles();
    expect(listed).toEqual([{
      id: 'team-local',
      name: 'Team Local',
      variables: {
        APP_ENV: { secret: false, value: 'local', hasValue: true, required: false },
        JSM_MANAGER_PASS: { secret: true, hasValue: true, required: true },
      },
    }]);

    const exportResult = await service.exportProfiles();
    expect(exportResult.ok).toBe(true);
    if (!exportResult.ok) return;
    expect(exportResult.value).toMatchObject({
      kind: ENVIRONMENT_PROFILES_EXPORT_KIND,
      version: ENVIRONMENT_PROFILES_EXPORT_VERSION,
      profiles: [{
        id: 'team-local',
        variables: {
          APP_ENV: { secret: false, value: 'local' },
          JSM_MANAGER_PASS: { secret: true, hasSecretValue: true },
        },
      }],
    });
    expect(JSON.stringify(exportResult.value)).not.toContain('super-secret');
  });

  it('imports local secret values and resolves a profile into operation env without mutating inventory', async () => {
    const { service } = makeService();
    const importResult = await service.importProfiles({
      kind: ENVIRONMENT_PROFILES_EXPORT_KIND,
      version: ENVIRONMENT_PROFILES_EXPORT_VERSION,
      profiles: [{
        id: 'team-local',
        name: 'Team Local',
        variables: {
          APP_ENV: { secret: false, value: 'local' },
          JSM_MANAGER_USER: { secret: false, value: 'manager' },
          JSM_MANAGER_PASS: { secret: true, value: 'super-secret' },
        },
      }],
    });
    expect(importResult.ok).toBe(true);

    const server = makeServer({
      run: {
        env: { APP_ENV: 'override' },
        envProfileId: 'team-local',
        vmArgs: [],
      },
    });
    const resolved = await service.resolveForServer(server);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.run.env).toEqual({
      APP_ENV: 'override',
      JSM_MANAGER_USER: 'manager',
      JSM_MANAGER_PASS: 'super-secret',
    });
    expect(server.run.env).toEqual({ APP_ENV: 'override' });
  });

  it('fails closed when a referenced profile secret is required but missing', async () => {
    const { service } = makeService();
    await service.importProfiles({
      kind: ENVIRONMENT_PROFILES_EXPORT_KIND,
      version: ENVIRONMENT_PROFILES_EXPORT_VERSION,
      profiles: [{
        id: 'team-local',
        name: 'Team Local',
        variables: {
          JSM_MANAGER_PASS: { secret: true, hasSecretValue: true },
        },
      }],
    });

    const result = await service.resolveForServer(makeServer({
      run: { env: {}, envProfileId: 'team-local', vmArgs: [] },
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.InvalidConfig);
      expect(result.error.message).toContain('JSM_MANAGER_PASS');
    }
  });

  it('rejects blocked environment variable keys before they can become profile metadata', async () => {
    const { service } = makeService();

    const result = await service.upsertProfile({
      id: 'unsafe',
      name: 'Unsafe',
      variables: {
        LD_PRELOAD: { secret: false, value: '/tmp/libevil.so' },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.SecurityPolicyViolation);
    }
  });
});
