import { describe, expect, it, vi } from 'vitest';
import { TeamSetupRecipeService } from '@app/recipes';
import { TemplateService } from '@app/templates';
import type { KeyValueStore, Logger, ServerTemplate } from '@core/types';
import { ErrorCode } from '@core/errors/codes';

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

function makeTemplate(id = 'team.tomcat'): ServerTemplate {
  return {
    id,
    name: 'Team Tomcat',
    description: 'Shared team defaults',
    pluginType: 'tomcat',
    serverDefaults: {
      host: '127.0.0.1',
      ports: { http: 8080, debug: 5005 },
      hooks: [],
      pluginConfig: { type: 'tomcat', shutdownPort: 8005, disableAjp: true },
    },
  };
}

describe('TeamSetupRecipeService', () => {
  function makeServices() {
    const templateService = new TemplateService({
      globalStore: mockStore(),
      workspaceStore: mockStore(),
      logger: mockLogger(),
      trustGate: { isTrusted: () => true },
    });
    return {
      templateService,
      recipeService: new TeamSetupRecipeService({
        templateService,
        logger: mockLogger(),
      }),
    };
  }

  it('exports saved templates as a one-way setup recipe and excludes built-in gallery templates', async () => {
    const { templateService, recipeService } = makeServices();
    await templateService.save(makeTemplate('team.tomcat'), 'workspace');

    const result = recipeService.exportRecipe({
      name: 'Team setup',
      instructions: ['Install Tomcat locally before creating a server.'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      kind: 'jsm.teamSetupRecipe',
      version: 1,
      name: 'Team setup',
      instructions: ['Install Tomcat locally before creating a server.'],
    });
    expect(result.value.templates).toHaveLength(1);
    expect(result.value.templates[0].template.id).toBe('team.tomcat');
    expect(result.value.templates.some(entry => entry.template.id.startsWith('gallery.'))).toBe(false);
  });

  it('imports recipe templates into workspace scope without creating managed servers', async () => {
    const { templateService, recipeService } = makeServices();
    const recipe = {
      kind: 'jsm.teamSetupRecipe',
      version: 1,
      name: 'Team setup',
      instructions: [],
      templates: [{
        scope: 'workspace',
        template: makeTemplate('team.imported'),
      }],
    };

    const result = await recipeService.importRecipe(recipe);

    expect(result.ok).toBe(true);
    expect(templateService.get('team.imported')).toMatchObject({
      id: 'team.imported',
      name: 'Team Tomcat',
    });
  });

  it('rejects recipes that try to smuggle server inventory authority through template defaults', async () => {
    const { recipeService } = makeServices();
    const recipe = {
      kind: 'jsm.teamSetupRecipe',
      version: 1,
      name: 'Bad recipe',
      instructions: [],
      templates: [{
        scope: 'workspace',
        template: {
          ...makeTemplate('team.bad'),
          serverDefaults: {
            deployments: [],
          },
        },
      }],
    };

    const result = await recipeService.importRecipe(recipe);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.InvalidConfig);
      expect(result.error.message).toContain('deployments');
    }
  });
});
