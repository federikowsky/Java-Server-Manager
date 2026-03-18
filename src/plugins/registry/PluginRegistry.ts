import type { ServerType } from '@core/types';
import type { Logger } from '@core/types/logger';
import type { IServerPlugin, DetectReport } from '../interfaces/IServerPlugin';
import { ok, err, type Result } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';

/** Factory function that creates a plugin instance. */
export type PluginFactory = (logger: Logger) => IServerPlugin;

/**
 * Registry mapping ServerType → plugin factory (§6.4).
 * Initialized at activation with the Tomcat plugin factory.
 */
export class PluginRegistry {
  private readonly factories = new Map<ServerType, PluginFactory>();
  private readonly instances = new Map<ServerType, IServerPlugin>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** Register a plugin factory for the given server type. */
  register(type: ServerType, factory: PluginFactory): void {
    if (this.factories.has(type)) {
      this.logger.warn(`PluginRegistry: overwriting factory for type '${type}'`);
      this.instances.delete(type);
    }
    this.factories.set(type, factory);
    this.logger.info(`PluginRegistry: registered plugin for type '${type}'`);
  }

  /** Get or lazily create the plugin instance for the given type. */
  get(type: ServerType): IServerPlugin | undefined {
    let instance = this.instances.get(type);
    if (instance) return instance;

    const factory = this.factories.get(type);
    if (!factory) return undefined;

    instance = factory(this.logger);
    this.instances.set(type, instance);
    return instance;
  }

  /** Check whether a plugin type is registered. */
  has(type: ServerType): boolean {
    return this.factories.has(type);
  }

  /** Return all registered server types. */
  getSupportedTypes(): ServerType[] {
    return [...this.factories.keys()];
  }

  /**
   * Probe all registered plugins to detect the server type at a given path (§6.4).
   * Returns the first plugin whose `detectInstallation` yields `ok: true`.
   */
  async detectServerType(homePath: string): Promise<Result<{ type: ServerType; report: DetectReport }, JsmError>> {
    for (const type of this.factories.keys()) {
      const plugin = this.get(type);
      if (!plugin) continue;

      const result = await plugin.detectInstallation(homePath);
      if (result.ok && result.value.ok) {
        return ok({ type, report: result.value });
      }
    }

    return err(new JsmError({
      code: ErrorCode.ValidationFailed,
      message: `No registered plugin recognizes the installation at: ${homePath}`,
      suggestedFix: ['Verify the server home path is correct', 'Check that the required plugin is registered'],
    }));
  }

  /** Dispose all instantiated plugin instances. */
  async dispose(): Promise<void> {
    for (const [type, instance] of this.instances) {
      try {
        await instance.dispose?.();
      } catch (e) {
        this.logger.error(`PluginRegistry: error disposing plugin '${type}'`, e);
      }
    }
    this.instances.clear();
    this.factories.clear();
  }
}
