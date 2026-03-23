import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@app/config/ConfigService';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { Logger } from '@core/types/logger';
import type { ServerConfig, DeploymentConfig } from '@core/types/domain';

/* ── helpers ─────────────────────────────────────────────────────────────── */

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeServer(id = 'srv-1', name = 'My Tomcat'): ServerConfig {
  return {
    id,
    name,
    type: 'tomcat',
    runtime: { id: 'rt-1', homePath: '/opt/tomcat', version: '10.1' },
    instancePath: '/tmp/inst',
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
      maxBatchBytes: 20_000_000,
      stormBackoffMs: 2000,
      ignoreGlobs: [],
    },
    hooks: [],
  };
}

function makeDeployment(id = 'dep-1'): DeploymentConfig {
  return {
    id,
    type: 'exploded',
    sourcePath: '/src/app',
    deployName: 'app',
    syncMode: 'auto',
    hotReload: false,
    ignoreGlobs: [],
    hooks: [],
  };
}

/* ── mock factories ──────────────────────────────────────────────────────── */

function mockRepo() {
  const cache = new Map<string, ServerConfig>();
  return {
    load: vi.fn(async () => ok([...cache.values()])),
    get: vi.fn((id: string) => cache.get(id)),
    getAll: vi.fn(() => [...cache.values()]),
    save: vi.fn(async (cfg: ServerConfig) => { cache.set(cfg.id, cfg); return ok(undefined); }),
    delete: vi.fn(async (id: string) => { cache.delete(id); return ok(undefined); }),
    isDirty: vi.fn(async () => false),
    filePath: '/ws/.vscode/jsm.servers.json',
    /* expose cache for test setup */
    _seed(cfg: ServerConfig) { cache.set(cfg.id, cfg); },
  };
}

function mockValidator() {
  return {
    validate: vi.fn(() => ok(undefined)),
    addSchema: vi.fn(),
  };
}

function mockBus() {
  return {
    emit: vi.fn(),
    on: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  };
}

/* ── tests ───────────────────────────────────────────────────────────────── */

describe('ConfigService', () => {
  let repo: ReturnType<typeof mockRepo>;
  let validator: ReturnType<typeof mockValidator>;
  let bus: ReturnType<typeof mockBus>;
  let service: ConfigService;
  let trustGate: { isTrusted: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    repo = mockRepo();
    validator = mockValidator();
    bus = mockBus();
    trustGate = { isTrusted: vi.fn(() => true) };
    service = new ConfigService({
      repo: repo as never,
      validator: validator as never,
      bus: bus as never,
      logger: mockLogger(),
      workspaceFolderUri: 'file:///ws',
      trustGate,
    });
  });

  /* ── loadWorkspace ───────────────────────────────────────────────────── */

  describe('loadWorkspace', () => {
    it('returns loaded server configs', async () => {
      const srv = makeServer();
      repo.load.mockResolvedValue(ok([srv]));

      const result = await service.loadWorkspace();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual([srv]);
    });

    it('propagates repo failure', async () => {
      const error = new JsmError({ code: ErrorCode.ConfigReadFailed, message: 'disk error' });
      repo.load.mockResolvedValue(err(error));

      const result = await service.loadWorkspace();
      expect(result.ok).toBe(false);
    });
  });

  /* ── getServer / getAllServers ────────────────────────────────────────── */

  describe('getServer', () => {
    it('delegates to repo.get', () => {
      const srv = makeServer();
      repo._seed(srv);
      expect(service.getServer('srv-1')).toEqual(srv);
    });

    it('returns undefined for unknown id', () => {
      expect(service.getServer('nope')).toBeUndefined();
    });
  });

  describe('getAllServers', () => {
    it('returns all servers from repo', () => {
      repo._seed(makeServer('a'));
      repo._seed(makeServer('b'));
      expect(service.getAllServers()).toHaveLength(2);
    });
  });

  /* ── addServer ───────────────────────────────────────────────────────── */

  describe('addServer', () => {
    it('validates, saves, and emits ServerAdded', async () => {
      const srv = makeServer();
      const result = await service.addServer(srv);

      expect(result.ok).toBe(true);
      expect(validator.validate).toHaveBeenCalledWith(srv, 'server-config');
      expect(repo.save).toHaveBeenCalledWith(srv);
      expect(bus.emit).toHaveBeenCalledWith('ServerAdded', {
        serverId: 'srv-1',
        workspaceFolderUri: 'file:///ws',
      });
    });

    it('rejects duplicate id', async () => {
      repo._seed(makeServer());
      const result = await service.addServer(makeServer());

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.InvalidConfig);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rejects when validation fails', async () => {
      const valErr = new JsmError({ code: ErrorCode.ValidationFailed, message: 'bad' });
      validator.validate.mockReturnValue(err(valErr));

      const result = await service.addServer(makeServer());
      expect(result.ok).toBe(false);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('propagates save failure', async () => {
      const saveErr = new JsmError({ code: ErrorCode.ConfigWriteFailed, message: 'write error' });
      repo.save.mockResolvedValue(err(saveErr));

      const result = await service.addServer(makeServer());
      expect(result.ok).toBe(false);
      expect(bus.emit).not.toHaveBeenCalled();
    });

    it('rejects config with blocked env key (§12.9)', async () => {
      const srv = makeServer();
      srv.run.env = { LD_PRELOAD: '/evil.so' };
      const result = await service.addServer(srv);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.SecurityPolicyViolation);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rejects config with blocked vmArg (§12.9)', async () => {
      const srv = makeServer();
      srv.run.vmArgs = ['-javaagent:/evil.jar'];
      const result = await service.addServer(srv);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.SecurityPolicyViolation);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('trust enforcement', () => {
    beforeEach(() => {
      trustGate.isTrusted.mockReturnValue(false);
    });

    it('blocks server inventory writes when workspace is untrusted', async () => {
      repo._seed(makeServer());

      const addResult = await service.addServer(makeServer('srv-2'));
      const updateResult = await service.updateServer(makeServer());
      const removeResult = await service.removeServer('srv-1');

      expect(addResult.ok).toBe(false);
      expect(updateResult.ok).toBe(false);
      expect(removeResult.ok).toBe(false);
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.delete).not.toHaveBeenCalled();
      expect(bus.emit).not.toHaveBeenCalled();

      for (const result of [addResult, updateResult, removeResult]) {
        if (!result.ok) {
          expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
        }
      }
    });

    it('blocks deployment config writes when workspace is untrusted', async () => {
      const server = makeServer();
      server.deployments = [makeDeployment()];
      repo._seed(server);

      const addResult = await service.addDeployment('srv-1', makeDeployment('dep-2'));
      const removeResult = await service.removeDeployment('srv-1', 'dep-1');

      expect(addResult.ok).toBe(false);
      expect(removeResult.ok).toBe(false);
      expect(repo.save).not.toHaveBeenCalled();
      expect(bus.emit).not.toHaveBeenCalled();

      for (const result of [addResult, removeResult]) {
        if (!result.ok) {
          expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
        }
      }
    });
  });

  /* ── updateServer ────────────────────────────────────────────────────── */

  describe('updateServer', () => {
    it('validates, saves, and emits ServerUpdated', async () => {
      repo._seed(makeServer());
      const updated = makeServer('srv-1', 'Renamed');
      const result = await service.updateServer(updated);

      expect(result.ok).toBe(true);
      expect(bus.emit).toHaveBeenCalledWith('ServerUpdated', {
        serverId: 'srv-1',
        workspaceFolderUri: 'file:///ws',
      });
    });

    it('rejects unknown server', async () => {
      const result = await service.updateServer(makeServer());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.InvalidConfig);
    });

    it('rejects when validation fails', async () => {
      repo._seed(makeServer());
      validator.validate.mockReturnValue(err(new JsmError({ code: ErrorCode.ValidationFailed, message: 'bad' })));

      const result = await service.updateServer(makeServer());
      expect(result.ok).toBe(false);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  /* ── removeServer ────────────────────────────────────────────────────── */

  describe('removeServer', () => {
    it('deletes and emits ServerDeleted', async () => {
      repo._seed(makeServer());
      const result = await service.removeServer('srv-1');

      expect(result.ok).toBe(true);
      expect(repo.delete).toHaveBeenCalledWith('srv-1');
      expect(bus.emit).toHaveBeenCalledWith('ServerDeleted', {
        serverId: 'srv-1',
        workspaceFolderUri: 'file:///ws',
      });
    });

    it('rejects unknown server', async () => {
      const result = await service.removeServer('nope');
      expect(result.ok).toBe(false);
    });

    it('propagates delete failure', async () => {
      repo._seed(makeServer());
      repo.delete.mockResolvedValue(err(new JsmError({ code: ErrorCode.ConfigWriteFailed, message: 'fail' })));

      const result = await service.removeServer('srv-1');
      expect(result.ok).toBe(false);
      expect(bus.emit).not.toHaveBeenCalled();
    });
  });

  /* ── addDeployment ───────────────────────────────────────────────────── */

  describe('addDeployment', () => {
    it('appends deployment and emits DeploymentAdded', async () => {
      repo._seed(makeServer());
      const dep = makeDeployment();
      const result = await service.addDeployment('srv-1', dep);

      expect(result.ok).toBe(true);
      expect(bus.emit).toHaveBeenCalledWith('DeploymentAdded', {
        serverId: 'srv-1',
        deploymentId: 'dep-1',
        workspaceFolderUri: 'file:///ws',
      });
      // repo.save should have received the updated config with the deployment
      const savedCfg = repo.save.mock.calls[0][0] as ServerConfig;
      expect(savedCfg.deployments).toHaveLength(1);
    });

    it('rejects unknown server', async () => {
      const result = await service.addDeployment('nope', makeDeployment());
      expect(result.ok).toBe(false);
    });

    it('rejects duplicate deployment id', async () => {
      const srv = makeServer();
      srv.deployments = [makeDeployment()];
      repo._seed(srv);

      const result = await service.addDeployment('srv-1', makeDeployment());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('already exists');
    });
  });

  /* ── removeDeployment ────────────────────────────────────────────────── */

  describe('removeDeployment', () => {
    it('removes deployment and emits DeploymentRemoved', async () => {
      const srv = makeServer();
      srv.deployments = [makeDeployment()];
      repo._seed(srv);

      const result = await service.removeDeployment('srv-1', 'dep-1');

      expect(result.ok).toBe(true);
      expect(bus.emit).toHaveBeenCalledWith('DeploymentRemoved', {
        serverId: 'srv-1',
        deploymentId: 'dep-1',
        workspaceFolderUri: 'file:///ws',
      });
      const savedCfg = repo.save.mock.calls[0][0] as ServerConfig;
      expect(savedCfg.deployments).toHaveLength(0);
    });

    it('rejects unknown server', async () => {
      const result = await service.removeDeployment('nope', 'dep-1');
      expect(result.ok).toBe(false);
    });
  });

  /* ── checkForExternalChanges ─────────────────────────────────────────── */

  describe('checkForExternalChanges', () => {
    it('returns false when not dirty', async () => {
      expect(await service.checkForExternalChanges()).toBe(false);
    });

    it('returns true when repo reports dirty', async () => {
      repo.isDirty.mockResolvedValue(true);
      expect(await service.checkForExternalChanges()).toBe(true);
    });
  });

  /* ── reload ──────────────────────────────────────────────────────────── */

  describe('reload', () => {
    it('reloads and emits ConfigChanged', async () => {
      repo.load.mockResolvedValue(ok([]));
      const result = await service.reload();

      expect(result.ok).toBe(true);
      expect(bus.emit).toHaveBeenCalledWith('ConfigChanged', {
        source: 'external',
        workspaceFolderUri: 'file:///ws',
      });
    });

    it('does not emit when reload fails', async () => {
      repo.load.mockResolvedValue(err(new JsmError({ code: ErrorCode.ConfigReadFailed, message: 'fail' })));
      const result = await service.reload();

      expect(result.ok).toBe(false);
      expect(bus.emit).not.toHaveBeenCalled();
    });
  });
});
