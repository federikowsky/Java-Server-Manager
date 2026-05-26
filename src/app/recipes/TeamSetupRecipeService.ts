import type { ServerTemplate, Logger } from '@core/types';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { TemplateService } from '@app/templates';

export const TEAM_SETUP_RECIPE_KIND = 'jsm.teamSetupRecipe';
export const TEAM_SETUP_RECIPE_VERSION = 1;

export interface TeamSetupRecipeTemplate {
  scope: 'workspace' | 'global';
  template: ServerTemplate;
}

export interface TeamSetupRecipe {
  kind: typeof TEAM_SETUP_RECIPE_KIND;
  version: typeof TEAM_SETUP_RECIPE_VERSION;
  name: string;
  description?: string;
  instructions: string[];
  templates: TeamSetupRecipeTemplate[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cleanStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map(entry => entry.trim())
    : [];
}

function invalidRecipe(message: string): Result<never, JsmError> {
  return err(new JsmError({
    code: ErrorCode.InvalidConfig,
    message,
  }));
}

export class TeamSetupRecipeService {
  private readonly templateService: TemplateService;
  private readonly logger: Logger;

  constructor(deps: {
    templateService: TemplateService;
    logger: Logger;
  }) {
    this.templateService = deps.templateService;
    this.logger = deps.logger;
  }

  exportRecipe(args: {
    name: string;
    description?: string;
    instructions?: string[];
  }): Result<TeamSetupRecipe, JsmError> {
    const name = args.name.trim();
    if (!name) {
      return invalidRecipe('Recipe name is required.');
    }

    const templates: TeamSetupRecipeTemplate[] = [];
    for (const entry of this.templateService.listScoped()) {
      if (entry.scope === 'gallery') {
        continue;
      }
      templates.push({
        scope: entry.scope,
        template: structuredClone(entry.template),
      });
    }

    if (templates.length === 0) {
      return invalidRecipe('No saved templates are available to export as a team setup recipe.');
    }

    return ok({
      kind: TEAM_SETUP_RECIPE_KIND,
      version: TEAM_SETUP_RECIPE_VERSION,
      name,
      ...(args.description?.trim() ? { description: args.description.trim() } : {}),
      instructions: cleanStringArray(args.instructions),
      templates,
    });
  }

  async importRecipe(value: unknown): Promise<Result<{ importedTemplates: number }, JsmError>> {
    const parseResult = this.parseRecipe(value);
    if (!parseResult.ok) {
      return parseResult;
    }

    let importedTemplates = 0;
    for (const entry of parseResult.value.templates) {
      const result = await this.templateService.save(entry.template, 'workspace');
      if (!result.ok) {
        return result;
      }
      importedTemplates += 1;
    }

    this.logger.info(`TeamSetupRecipeService: imported ${importedTemplates} template(s) from '${parseResult.value.name}'`);
    return ok({ importedTemplates });
  }

  private parseRecipe(value: unknown): Result<TeamSetupRecipe, JsmError> {
    if (!isRecord(value)) {
      return invalidRecipe('Team setup recipe must be a JSON object.');
    }
    if (value['kind'] !== TEAM_SETUP_RECIPE_KIND || value['version'] !== TEAM_SETUP_RECIPE_VERSION) {
      return invalidRecipe('Unsupported team setup recipe format.');
    }
    if (typeof value['name'] !== 'string' || value['name'].trim().length === 0) {
      return invalidRecipe('Recipe name is required.');
    }
    if (!Array.isArray(value['templates'])) {
      return invalidRecipe('Recipe templates must be an array.');
    }

    const templates: TeamSetupRecipeTemplate[] = [];
    for (const rawEntry of value['templates']) {
      if (!isRecord(rawEntry) || !isRecord(rawEntry['template'])) {
        return invalidRecipe('Recipe template entries must contain a template object.');
      }
      const scope = rawEntry['scope'] === 'global' ? 'global' : 'workspace';
      templates.push({
        scope,
        template: rawEntry['template'] as unknown as ServerTemplate,
      });
    }

    return ok({
      kind: TEAM_SETUP_RECIPE_KIND,
      version: TEAM_SETUP_RECIPE_VERSION,
      name: value['name'].trim(),
      ...(typeof value['description'] === 'string' && value['description'].trim()
        ? { description: value['description'].trim() }
        : {}),
      instructions: cleanStringArray(value['instructions']),
      templates,
    });
  }
}
