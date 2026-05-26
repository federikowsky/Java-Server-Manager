import type { KeyValueStore, Logger, SecretStore, ServerConfig, TrustGate } from '@core/types';
import type { Result } from '@core/result';
import { err, ok } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import { requireWorkspaceTrust } from '@core/policy';
import { BLOCKED_ENV_KEYS } from '../../constants';

export const ENVIRONMENT_PROFILES_STORE_KEY = 'jsm.environmentProfiles.v1';
export const ENVIRONMENT_PROFILES_EXPORT_KIND = 'jsm.environmentProfiles';
export const ENVIRONMENT_PROFILES_EXPORT_VERSION = 1;

export interface EnvironmentProfileVariable {
  secret: boolean;
  value?: string;
  required?: boolean;
  hasSecretValue?: boolean;
}

export interface EnvironmentProfile {
  id: string;
  name: string;
  description?: string;
  variables: Record<string, EnvironmentProfileVariable>;
}

export interface EnvironmentProfileVariableSummary {
  secret: boolean;
  required: boolean;
  hasValue: boolean;
  value?: string;
}

export interface EnvironmentProfileSummary {
  id: string;
  name: string;
  description?: string;
  variables: Record<string, EnvironmentProfileVariableSummary>;
}

export interface EnvironmentProfileExportVariable {
  secret: boolean;
  value?: string;
  required?: boolean;
  hasSecretValue?: boolean;
}

export interface EnvironmentProfilesExportProfile {
  id: string;
  name: string;
  description?: string;
  variables: Record<string, EnvironmentProfileExportVariable>;
}

export interface EnvironmentProfilesExport {
  kind: typeof ENVIRONMENT_PROFILES_EXPORT_KIND;
  version: typeof ENVIRONMENT_PROFILES_EXPORT_VERSION;
  profiles: EnvironmentProfilesExportProfile[];
}

const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function invalidProfile(message: string, code = ErrorCode.InvalidConfig): Result<never, JsmError> {
  return err(new JsmError({ code, message }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeRequired(variable: { secret: boolean; required?: boolean }): boolean {
  return variable.required ?? variable.secret;
}

function cloneProfile(profile: EnvironmentProfile): EnvironmentProfile {
  return {
    id: profile.id,
    name: profile.name,
    ...(profile.description ? { description: profile.description } : {}),
    variables: Object.fromEntries(Object.entries(profile.variables).map(([key, variable]) => [
      key,
      {
        secret: variable.secret,
        ...(variable.value !== undefined ? { value: variable.value } : {}),
        ...(variable.required !== undefined ? { required: variable.required } : {}),
        ...(variable.hasSecretValue !== undefined ? { hasSecretValue: variable.hasSecretValue } : {}),
      },
    ])),
  };
}

function secretKey(profileId: string, variableName: string): string {
  return `jsm.envProfile.v1.${encodeURIComponent(profileId)}.${encodeURIComponent(variableName)}`;
}

export class EnvironmentProfileService {
  private readonly metadataStore: KeyValueStore;
  private readonly secretStore: SecretStore;
  private readonly logger: Logger;
  private readonly trustGate?: TrustGate;

  constructor(deps: {
    metadataStore: KeyValueStore;
    secretStore: SecretStore;
    logger: Logger;
    trustGate?: TrustGate;
  }) {
    this.metadataStore = deps.metadataStore;
    this.secretStore = deps.secretStore;
    this.logger = deps.logger;
    this.trustGate = deps.trustGate;
  }

  listProfiles(): EnvironmentProfileSummary[] {
    const profiles = this.loadProfiles();
    const summaries: EnvironmentProfileSummary[] = [];

    for (const profile of profiles) {
      const variables: Record<string, EnvironmentProfileVariableSummary> = {};
      for (const [key, variable] of Object.entries(profile.variables)) {
        if (variable.secret) {
          variables[key] = {
            secret: true,
            required: normalizeRequired(variable),
            hasValue: variable.hasSecretValue === true,
          };
        } else {
          variables[key] = {
            secret: false,
            required: normalizeRequired(variable),
            hasValue: variable.value !== undefined,
            ...(variable.value !== undefined ? { value: variable.value } : {}),
          };
        }
      }

      summaries.push({
        id: profile.id,
        name: profile.name,
        ...(profile.description ? { description: profile.description } : {}),
        variables,
      });
    }

    return summaries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async upsertProfile(profile: EnvironmentProfile): Promise<Result<void, JsmError>> {
    const trustResult = requireWorkspaceTrust(this.trustGate, 'modify environment profiles');
    if (!trustResult.ok) return trustResult;

    const normalizedResult = this.normalizeProfile(profile);
    if (!normalizedResult.ok) return normalizedResult;
    const normalized = normalizedResult.value;

    const existingProfile = this.loadProfiles().find(existing => existing.id === normalized.id);
    const profiles = this.loadProfiles().filter(existing => existing.id !== normalized.id);
    const metadataProfile: EnvironmentProfile = {
      ...normalized,
      variables: {},
    };

    for (const [key, variable] of Object.entries(normalized.variables)) {
      if (variable.secret) {
        if (variable.value !== undefined) {
          await this.secretStore.set(secretKey(normalized.id, key), variable.value);
        }
        const existingSecretMetadata = existingProfile?.variables[key];
        metadataProfile.variables[key] = {
          secret: true,
          required: normalizeRequired(variable),
          hasSecretValue: variable.value !== undefined || existingSecretMetadata?.hasSecretValue === true,
        };
      } else {
        await this.secretStore.delete(secretKey(normalized.id, key));
        metadataProfile.variables[key] = {
          secret: false,
          value: variable.value ?? '',
          required: normalizeRequired(variable),
        };
      }
    }

    profiles.push(metadataProfile);
    await this.saveProfiles(profiles);
    this.logger.info(`EnvironmentProfileService: saved profile '${normalized.name}'`);
    return ok(undefined);
  }

  async exportProfiles(): Promise<Result<EnvironmentProfilesExport, JsmError>> {
    const profiles = this.loadProfiles();
    const exportedProfiles: EnvironmentProfilesExportProfile[] = [];

    for (const profile of profiles) {
      const variables: Record<string, EnvironmentProfileExportVariable> = {};
      for (const [key, variable] of Object.entries(profile.variables)) {
        if (variable.secret) {
          variables[key] = {
            secret: true,
            required: normalizeRequired(variable),
            hasSecretValue: variable.hasSecretValue === true,
          };
        } else {
          variables[key] = {
            secret: false,
            required: normalizeRequired(variable),
            value: variable.value ?? '',
          };
        }
      }
      exportedProfiles.push({
        id: profile.id,
        name: profile.name,
        ...(profile.description ? { description: profile.description } : {}),
        variables,
      });
    }

    return ok({
      kind: ENVIRONMENT_PROFILES_EXPORT_KIND,
      version: ENVIRONMENT_PROFILES_EXPORT_VERSION,
      profiles: exportedProfiles.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    });
  }

  async importProfiles(value: unknown): Promise<Result<{ importedProfiles: number }, JsmError>> {
    const trustResult = requireWorkspaceTrust(this.trustGate, 'modify environment profiles');
    if (!trustResult.ok) return trustResult;

    const parsedResult = this.parseExport(value);
    if (!parsedResult.ok) return parsedResult;

    let importedProfiles = 0;
    for (const profile of parsedResult.value.profiles) {
      const result = await this.upsertProfile(profile);
      if (!result.ok) return result;
      importedProfiles += 1;
    }

    return ok({ importedProfiles });
  }

  async resolveForServer(config: ServerConfig): Promise<Result<ServerConfig, JsmError>> {
    const profileId = config.run.envProfileId;
    if (!profileId) {
      return ok(config);
    }

    const profile = this.loadProfiles().find(candidate => candidate.id === profileId);
    if (!profile) {
      return invalidProfile(`Environment profile '${profileId}' is not available in VS Code storage.`);
    }

    const profileEnv: Record<string, string> = {};
    for (const [key, variable] of Object.entries(profile.variables)) {
      if (variable.secret) {
        const value = await this.secretStore.get(secretKey(profile.id, key));
        if (value === undefined) {
          if (normalizeRequired(variable)) {
            return invalidProfile(`Environment profile '${profile.name}' is missing required secret '${key}'.`);
          }
          continue;
        }
        profileEnv[key] = value;
      } else if (variable.value !== undefined) {
        profileEnv[key] = variable.value;
      }
    }

    return ok({
      ...config,
      run: {
        ...config.run,
        env: {
          ...profileEnv,
          ...config.run.env,
        },
      },
    });
  }

  private loadProfiles(): EnvironmentProfile[] {
    const raw = this.metadataStore.get<EnvironmentProfile[]>(ENVIRONMENT_PROFILES_STORE_KEY);
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter((entry): entry is EnvironmentProfile => this.normalizeProfile(entry).ok)
      .map(profile => cloneProfile(profile));
  }

  private async saveProfiles(profiles: EnvironmentProfile[]): Promise<void> {
    await this.metadataStore.set(
      ENVIRONMENT_PROFILES_STORE_KEY,
      profiles
        .map(profile => cloneProfile(profile))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    );
  }

  private normalizeProfile(profile: EnvironmentProfile): Result<EnvironmentProfile, JsmError> {
    const id = cleanString(profile.id);
    if (!id || !PROFILE_ID_PATTERN.test(id)) {
      return invalidProfile('Environment profile id must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens.');
    }
    const name = cleanString(profile.name);
    if (!name) {
      return invalidProfile('Environment profile name is required.');
    }
    if (!isRecord(profile.variables)) {
      return invalidProfile('Environment profile variables must be an object.');
    }

    const variables: Record<string, EnvironmentProfileVariable> = {};
    for (const [rawKey, rawVariable] of Object.entries(profile.variables)) {
      const key = rawKey.trim();
      if (!ENV_KEY_PATTERN.test(key)) {
        return invalidProfile(`Environment variable '${rawKey}' is not a valid variable name.`);
      }
      if (BLOCKED_ENV_KEYS.has(key)) {
        return invalidProfile(
          `Environment variable '${key}' is blocked by security policy.`,
          ErrorCode.SecurityPolicyViolation,
        );
      }
      if (!isRecord(rawVariable)) {
        return invalidProfile(`Environment variable '${key}' must be an object.`);
      }
      const secret = rawVariable['secret'] === true;
      const required = rawVariable['required'] === undefined ? undefined : rawVariable['required'] === true;
      const value = typeof rawVariable['value'] === 'string' ? rawVariable['value'] : undefined;
      const hasSecretValue = rawVariable['hasSecretValue'] === true;
      if (!secret && value === undefined) {
        return invalidProfile(`Environment variable '${key}' must include a value when it is not secret.`);
      }
      variables[key] = {
        secret,
        ...(value !== undefined ? { value } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(secret && hasSecretValue ? { hasSecretValue: true } : {}),
      };
    }

    return ok({
      id,
      name,
      ...(profile.description?.trim() ? { description: profile.description.trim() } : {}),
      variables,
    });
  }

  private parseExport(value: unknown): Result<{ profiles: EnvironmentProfile[] }, JsmError> {
    if (!isRecord(value)) {
      return invalidProfile('Environment profile import must be a JSON object.');
    }
    if (value['kind'] !== ENVIRONMENT_PROFILES_EXPORT_KIND || value['version'] !== ENVIRONMENT_PROFILES_EXPORT_VERSION) {
      return invalidProfile('Unsupported environment profiles import format.');
    }
    if (!Array.isArray(value['profiles'])) {
      return invalidProfile('Environment profiles import must contain a profiles array.');
    }

    const profiles: EnvironmentProfile[] = [];
    for (const rawProfile of value['profiles']) {
      if (!isRecord(rawProfile) || !isRecord(rawProfile['variables'])) {
        return invalidProfile('Each environment profile import entry must contain variables.');
      }
      const variables: Record<string, EnvironmentProfileVariable> = {};
      for (const [key, rawVariable] of Object.entries(rawProfile['variables'])) {
        if (!isRecord(rawVariable)) {
          return invalidProfile(`Environment variable '${key}' must be an object.`);
        }
        variables[key] = {
          secret: rawVariable['secret'] === true,
          ...(typeof rawVariable['value'] === 'string' ? { value: rawVariable['value'] } : {}),
          ...(rawVariable['required'] !== undefined ? { required: rawVariable['required'] === true } : {}),
        };
      }
      const normalizedResult = this.normalizeProfile({
        id: String(rawProfile['id'] ?? ''),
        name: String(rawProfile['name'] ?? ''),
        ...(typeof rawProfile['description'] === 'string' ? { description: rawProfile['description'] } : {}),
        variables,
      });
      if (!normalizedResult.ok) return normalizedResult;
      profiles.push(normalizedResult.value);
    }

    return ok({ profiles });
  }
}
