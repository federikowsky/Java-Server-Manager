/*
 * Centralized plugin registry
 */

import { IServerPlugin } from '../interfaces/IServerPlugin';
import { Result, ok, err } from '../../../utils/result';
import { JsmError } from '../../../errors/JsmError';
import { ErrorCode } from '../../../errors/codes';
import { ServerType } from '../../../types/domain';

export class PluginRegistry {
  private static instance: PluginRegistry;
  private readonly plugins = new Map<string, () => IServerPlugin>();

  private constructor() {
    this.registerDefaultPlugins();
  }

  static getInstance(): PluginRegistry {
    if (!PluginRegistry.instance) {
      PluginRegistry.instance = new PluginRegistry();
    }
    return PluginRegistry.instance;
  }

  registerFactory(type: string, factory: () => IServerPlugin): void {
    this.plugins.set(type, factory);
  }

  get(type: ServerType): Result<IServerPlugin, JsmError> {
    const factory = this.plugins.get(type);
    if (!factory) {
      return err(new JsmError(
        ErrorCode.PLUGIN_NOT_FOUND,
        `Plugin not found: ${type}`
      ));
    }

    try {
      const plugin = factory();
      return ok(plugin);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.PLUGIN_CREATION_ERROR,
        `Failed to create plugin: ${type}`,
        error
      ));
    }
  }

  has(type: ServerType): boolean {
    return this.plugins.has(type);
  }

  getSupportedTypes(): ServerType[] {
    return Array.from(this.plugins.keys()) as ServerType[];
  }

  async detectServerType(serverHome: string): Promise<Result<ServerType, JsmError>> {
    const detectionPromises = Array.from(this.plugins.entries()).map(async ([type, factory]) => {
      try {
        const plugin = factory();
        const result = await plugin.detect(serverHome);
        return result.ok ? type : null;
      } catch {
        return null;
      }
    });

    const results = await Promise.allSettled(detectionPromises);
    const detectedType = results
      .filter((result): result is PromiseFulfilledResult<string> => 
        result.status === 'fulfilled' && result.value !== null)
      .map(result => result.value)[0];

    return detectedType 
      ? ok(detectedType as ServerType)
      : err(new JsmError(
          ErrorCode.SERVER_TYPE_DETECTION_ERROR,
          `Unable to detect server type from: ${serverHome}`
        ));
  }

  async dispose(): Promise<void> {
    this.plugins.clear();
  }

  private registerDefaultPlugins(): void {
    this.registerFactory('tomcat', () => {
      const { TomcatPlugin } = require('../implementations/TomcatPlugin');
      return new TomcatPlugin();
    });
  }
}
