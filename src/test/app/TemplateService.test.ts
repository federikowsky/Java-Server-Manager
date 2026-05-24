import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateService } from '@app/templates/TemplateService';
import { ErrorCode } from '@core/errors/codes';
import type { Logger } from '@core/types/logger';
import type { KeyValueStore } from '@core/types/runtime';
import type { ServerTemplate } from '@core/types/domain';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function mockStore(): KeyValueStore {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn(<T>(key: string): T | undefined => data.get(key) as T | undefined),
    set: vi.fn(async <T>(key: string, value: T) => { data.set(key, value); }),
    delete: vi.fn(async (key: string) => { data.delete(key); }),
  };
}

function makeTemplate(id = 'tpl-1', name = 'Default Tomcat'): ServerTemplate {
  return {
    id,
    name,
    pluginType: 'tomcat',
    serverDefaults: {},
  };
}

describe('TemplateService', () => {
  let globalStore: KeyValueStore;
  let workspaceStore: KeyValueStore;
  let service: TemplateService;
  let trustGate: { isTrusted: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    globalStore = mockStore();
    workspaceStore = mockStore();
    trustGate = { isTrusted: vi.fn(() => true) };
    service = new TemplateService({
      globalStore,
      workspaceStore,
      logger: mockLogger(),
      trustGate,
    });
  });

  it('returns built-in gallery templates when no saved templates exist', () => {
    const all = service.getAll();

    expect(all.length).toBeGreaterThan(0);
    expect(all.some(template => template.id === 'gallery.tomcat.local-dev')).toBe(true);
    expect(service.listScoped().every(entry =>
      entry.scope === 'gallery'
        || entry.scope === 'workspace'
        || entry.scope === 'global',
    )).toBe(true);
  });

  it('saves and retrieves a global template', async () => {
    const tpl = makeTemplate();
    const result = await service.save(tpl, 'global');
    expect(result.ok).toBe(true);

    const all = service.getAll();
    expect(all.some(template => template.id === 'tpl-1')).toBe(true);
  });

  it('saves and retrieves a workspace template', async () => {
    const tpl = makeTemplate('ws-1', 'Workspace Tomcat');
    const result = await service.save(tpl, 'workspace');
    expect(result.ok).toBe(true);

    expect(service.get('ws-1')).toMatchObject({ name: 'Workspace Tomcat' });
  });

  it('sanitizes persisted templates to creation defaults only', async () => {
    const result = await service.save({
      id: 'tpl-safe',
      name: '  Safe Template  ',
      description: '  Useful defaults  ',
      pluginType: 'tomcat',
      serverDefaults: {
        runtime: { homePath: '  /opt/tomcat  ' },
        javaHome: '  /jdk  ',
        host: '  127.0.0.1  ',
        ports: { http: 8080, debug: 5005 },
        run: { vmArgs: [' -Xmx1g ', ''] },
        debug: { bind: 'localhost' },
        hooks: [],
        pluginConfig: { type: 'tomcat', shutdownPort: 8005, disableAjp: true },
      },
    }, 'workspace');

    expect(result.ok).toBe(true);
    expect(service.get('tpl-safe')).toEqual({
      id: 'tpl-safe',
      name: 'Safe Template',
      description: 'Useful defaults',
      pluginType: 'tomcat',
      serverDefaults: {
        runtime: { homePath: '/opt/tomcat' },
        javaHome: '/jdk',
        host: '127.0.0.1',
        ports: { http: 8080, debug: 5005 },
        run: { vmArgs: ['-Xmx1g'] },
        debug: { bind: 'localhost' },
        pluginConfig: { type: 'tomcat', shutdownPort: 8005, disableAjp: true },
      },
    });
  });

  it('rejects identity and instance fields in template defaults', async () => {
    const result = await service.save({
      id: 'tpl-bad',
      name: 'Bad Template',
      pluginType: 'tomcat',
      serverDefaults: {
        id: 'server-id',
        instancePath: '/tmp/instance',
      } as ServerTemplate['serverDefaults'],
    }, 'workspace');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.InvalidConfig);
      expect(result.error.message).toContain('unsupported field');
      expect(result.error.message).toContain('id');
      expect(result.error.message).toContain('instancePath');
    }
    expect(service.get('tpl-bad')).toBeUndefined();
  });

  it('rejects deployments in template defaults', async () => {
    const result = await service.save({
      id: 'tpl-deployments',
      name: 'Bad Deployments',
      pluginType: 'tomcat',
      serverDefaults: {
        deployments: [{
          id: 'dep-1',
          type: 'war',
          sourcePath: '/app.war',
          deployName: 'app',
          syncMode: 'manual',
          hotReload: false,
          ignoreGlobs: [],
          hooks: [],
        }],
      } as ServerTemplate['serverDefaults'],
    }, 'workspace');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.InvalidConfig);
      expect(result.error.message).toContain('deployments');
    }
    expect(service.get('tpl-deployments')).toBeUndefined();
  });

  it('rejects non-creation runtime defaults', async () => {
    const result = await service.save({
      id: 'tpl-runtime',
      name: 'Bad Runtime',
      pluginType: 'tomcat',
      serverDefaults: {
        runtime: {
          id: 'runtime-id',
          homePath: '/opt/tomcat',
        },
      } as ServerTemplate['serverDefaults'],
    }, 'workspace');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.InvalidConfig);
      expect(result.error.message).toContain('runtime');
      expect(result.error.message).toContain('id');
    }
    expect(service.get('tpl-runtime')).toBeUndefined();
  });

  it('workspace templates override global templates with same id', async () => {
    await service.save(makeTemplate('t1', 'Global'), 'global');
    await service.save(makeTemplate('t1', 'Workspace'), 'workspace');

    const all = service.getAll();
    expect(all.find(template => template.id === 't1')?.name).toBe('Workspace');
  });

  it('get checks workspace first', async () => {
    await service.save(makeTemplate('t1', 'Global'), 'global');
    await service.save(makeTemplate('t1', 'Workspace'), 'workspace');

    expect(service.get('t1')?.name).toBe('Workspace');
  });

  it('deletes a template from global scope', async () => {
    await service.save(makeTemplate('t1'), 'global');
    const result = await service.delete('t1', 'global');
    expect(result.ok).toBe(true);
    expect(service.get('t1')).toBeUndefined();
  });

  it('returns error when deleting non-existent template', async () => {
    const result = await service.delete('non-existent', 'global');
    expect(result.ok).toBe(false);
  });

  it('updates existing template in place', async () => {
    await service.save(makeTemplate('t1', 'Original'), 'global');
    await service.save(makeTemplate('t1', 'Updated'), 'global');
    expect(service.get('t1')?.name).toBe('Updated');
    expect(service.getAll().filter(template => template.id === 't1')).toHaveLength(1);
  });

  it('moves a template from global to workspace scope without leaving a duplicate copy', async () => {
    await service.save(makeTemplate('t1', 'Global'), 'global');

    const result = await service.save(makeTemplate('t1', 'Workspace'), 'workspace');

    expect(result.ok).toBe(true);
    expect(service.listScoped()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'workspace:t1',
        scope: 'workspace',
        template: expect.objectContaining({ id: 't1', name: 'Workspace' }),
      }),
    ]));
    expect(service.listScoped().some(entry => entry.key === 'global:t1')).toBe(false);
  });

  it('moves a template from workspace to global scope without leaving a duplicate copy', async () => {
    await service.save(makeTemplate('t1', 'Workspace'), 'workspace');

    const result = await service.save(makeTemplate('t1', 'Global'), 'global');

    expect(result.ok).toBe(true);
    expect(service.listScoped()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'global:t1',
        scope: 'global',
        template: expect.objectContaining({ id: 't1', name: 'Global' }),
      }),
    ]));
    expect(service.listScoped().some(entry => entry.key === 'workspace:t1')).toBe(false);
  });

  it('lists templates with their scope', async () => {
    await service.save(makeTemplate('g1', 'Global'), 'global');
    await service.save(makeTemplate('w1', 'Workspace'), 'workspace');

    expect(service.listScoped()).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'workspace:w1', scope: 'workspace', template: expect.objectContaining({ id: 'w1' }) }),
      expect.objectContaining({ key: 'global:g1', scope: 'global', template: expect.objectContaining({ id: 'g1' }) }),
      expect.objectContaining({ key: 'gallery:gallery.tomcat.local-dev', scope: 'gallery' }),
    ]));
  });

  it('rejects saved templates that try to use reserved gallery ids', async () => {
    const result = await service.save(makeTemplate('gallery.custom', 'Reserved'), 'workspace');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.InvalidConfig);
      expect(result.error.message).toContain('reserved');
    }
    expect(service.get('gallery.custom')).toBeUndefined();
  });

  it('clones a template with a new id and name', () => {
    const clone = service.cloneTemplate({
      template: makeTemplate('t1', 'Original'),
      id: 't2',
      name: 'Copy',
    });

    expect(clone.id).toBe('t2');
    expect(clone.name).toBe('Copy');
  });

  it('blocks template writes when workspace is untrusted', async () => {
    trustGate.isTrusted.mockReturnValue(false);

    const saveResult = await service.save(makeTemplate(), 'global');
    const deleteResult = await service.delete('tpl-1', 'global');

    expect(saveResult.ok).toBe(false);
    expect(deleteResult.ok).toBe(false);
    expect((globalStore.set as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);

    for (const result of [saveResult, deleteResult]) {
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
      }
    }
  });
});
