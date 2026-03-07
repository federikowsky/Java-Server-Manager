/*
 * src/core/server/plugins/index.ts
 * Clean plugin system exports
 */

// Core interfaces
export { IServerPlugin } from './interfaces/IServerPlugin';

// Plugin registry
export { PluginRegistry } from './registry/PluginRegistry';

// Plugin implementations
export { TomcatPlugin } from './implementations/TomcatPlugin';
