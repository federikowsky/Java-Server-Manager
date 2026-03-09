import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateService } from '@app/templates/TemplateService';
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
    deploymentDefaults: [],
    hookDefaults: [],
  };
}

describe('TemplateService', () => {
  let globalStore: KeyValueStore;
  let workspaceStore: KeyValueStore;
  let service: TemplateService;

  beforeEach(() => {
    globalStore = mockStore();
    workspaceStore = mockStore();
    service = new TemplateService({
      globalStore,
      workspaceStore,
      logger: mockLogger(),
    });
  });

  it('returns empty array when no templates exist', () => {
    expect(service.getAll()).toEqual([]);
  });

  it('saves and retrieves a global template', async () => {
    const tpl = makeTemplate();
    const result = await service.save(tpl, 'global');
    expect(result.ok).toBe(true);

    const all = service.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('tpl-1');
  });

  it('saves and retrieves a workspace template', async () => {
    const tpl = makeTemplate('ws-1', 'Workspace Tomcat');
    const result = await service.save(tpl, 'workspace');
    expect(result.ok).toBe(true);

    expect(service.get('ws-1')).toMatchObject({ name: 'Workspace Tomcat' });
  });

  it('workspace templates override global templates with same id', async () => {
    await service.save(makeTemplate('t1', 'Global'), 'global');
    await service.save(makeTemplate('t1', 'Workspace'), 'workspace');

    const all = service.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Workspace');
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
    expect(service.getAll()).toHaveLength(0);
  });

  it('returns error when deleting non-existent template', async () => {
    const result = await service.delete('non-existent', 'global');
    expect(result.ok).toBe(false);
  });

  it('updates existing template in place', async () => {
    await service.save(makeTemplate('t1', 'Original'), 'global');
    await service.save(makeTemplate('t1', 'Updated'), 'global');
    expect(service.get('t1')?.name).toBe('Updated');
    expect(service.getAll()).toHaveLength(1);
  });
});
