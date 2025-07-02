/*
 * src/core/plugins/index.ts
 * Simplified plugin system exports - direct imports recommended
 */

// Core interfaces - direct exports only
export { IServerPlugin } from './interfaces/IServerPlugin';

// Plugin registry and management - core components only
export { PluginRegistry } from './registry/PluginRegistry';
export { SimpleCache } from './cache/SimpleCache';

// Runtime management
export { ServerRuntimeManager } from './runtime/ServerRuntimeManager';

// Implementations
export { TomcatPlugin } from './implementations/TomcatPlugin';
