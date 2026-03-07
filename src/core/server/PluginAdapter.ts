/*
 * src/core/server/PluginAdapter.ts
 * Plugin integration + intelligent caching - Single responsibility
 */

import { PluginRegistry } from './plugins/registry/PluginRegistry';
import { IServerPlugin } from './plugins/interfaces/IServerPlugin';
import { ServerType, ServerConfig } from '../types/domain';
import { Result, ok, err } from '../utils/result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { Logger } from '../utils/logger';

/**
 * PluginAdapter - Single responsibility: Plugin integration + caching
 */
export class PluginAdapter {
  private static instance: PluginAdapter;
  private readonly log = Logger.getInstance().createChild('PluginAdapter');
  private readonly registry = PluginRegistry.getInstance();
  private readonly pluginCache = new Map<ServerType, IServerPlugin>();
  private readonly detectionCache = new Map<string, ServerType>();
  private readonly configCache = new Map<string, Partial<ServerConfig>>();

  private constructor() {}

  static getInstance(): PluginAdapter {
    if (!PluginAdapter.instance) {
      PluginAdapter.instance = new PluginAdapter();
    }
    return PluginAdapter.instance;
  }

  /**
   * Get plugin with intelligent caching
   */
  async getPlugin(type: ServerType): Promise<Result<IServerPlugin, JsmError>> {
    // Check cache first
    const cached = this.pluginCache.get(type);
    if (cached) {
      return ok(cached);
    }

    // Get from registry and cache
    const pluginResult = this.registry.get(type);
    if (!pluginResult.ok) {
      return err(new JsmError(ErrorCode.PLUGIN_NOT_FOUND, `Plugin not found for type: ${type}`));
    }

    // Cache the plugin
    this.pluginCache.set(type, pluginResult.value);
    this.log.debug(`Cached plugin for type: ${type}`);

    return ok(pluginResult.value);
  }

  /**
   * Detect server type with caching
   */
  async detectServerType(serverHome: string): Promise<Result<ServerType, JsmError>> {
    // Check cache first
    const cached = this.detectionCache.get(serverHome);
    if (cached) {
      return ok(cached);
    }

    // Detect and cache result
    const detectionResult = await this.registry.detectServerType(serverHome);
    if (detectionResult.ok) {
      this.detectionCache.set(serverHome, detectionResult.value as ServerType);
      this.log.debug(`Cached detection result for ${serverHome}: ${detectionResult.value}`);
    }

    return detectionResult as any;
  }

  /**
   * Check if server type is supported
   */
  isTypeSupported(type: ServerType): boolean {
    return this.registry.has(type);
  }

  /**
   * Get default configuration for server type
   */
  async getDefaultConfig(serverType: ServerType): Promise<Result<Partial<ServerConfig>, JsmError>> {
    const cacheKey = `defaultConfig:${serverType}`;
    
    // Check cache first
    const cached = this.configCache.get(cacheKey);
    if (cached) {
      return ok(cached);
    }

    try {
      const pluginResult = this.registry.get(serverType);
      if (!pluginResult.ok) {
        return pluginResult as any;
      }

      const defaultConfig = pluginResult.value.getDefaultConfig();
      
      // Cache the result
      this.configCache.set(cacheKey, defaultConfig);
      this.log.debug(`Retrieved and cached default config for type: ${serverType}`);
      
      return ok(defaultConfig);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.PLUGIN_ERROR, 
        `Failed to get default config for ${serverType}: ${error}`,
        error
      ));
    }
  }

  /**
   * Get all supported types
   */
  getSupportedTypes(): ServerType[] {
    return this.registry.getSupportedTypes() as ServerType[];
  }

  /**
   * Clear cache for specific type
   */
  clearCache(type?: ServerType): void {
    if (type) {
      this.pluginCache.delete(type);
      this.configCache.delete(`defaultConfig:${type}`);
      this.log.debug(`Cleared cache for type: ${type}`);
    } else {
      this.pluginCache.clear();
      this.detectionCache.clear();
      this.configCache.clear();
      this.log.debug('Cleared all caches');
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { plugins: number; detections: number; configs: number } {
    return {
      plugins: this.pluginCache.size,
      detections: this.detectionCache.size,
      configs: this.configCache.size
    };
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.pluginCache.clear();
    this.detectionCache.clear();
    this.configCache.clear();
    this.log.info('Plugin adapter disposed');
  }
}
