/*
 * src/core/server/ServerManager.ts
 * Main facade for server lifecycle orchestration - Event-driven architecture
 */

import { EventBus } from '../EventBus';
import { ServerRuntime } from './ServerRuntime';
import { PluginAdapter } from './PluginAdapter';
import { ServerConfig, ServerState } from '../types/domain';
import { ServerStartMode } from '../types/runtime';
import { Result, ok, err } from '../utils/result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { Logger } from '../utils/logger';

/**
 * ServerManager - Single responsibility: Server lifecycle orchestration
 * Uses event-driven architecture for state coordination
 */
export class ServerManager {
  private static instance: ServerManager;
  private readonly log = Logger.getInstance().createChild('ServerManager');
  private readonly eventBus = EventBus.getInstance();
  private readonly runtimes = new Map<string, ServerRuntime>();
  private readonly pluginAdapter = PluginAdapter.getInstance();

  private constructor() {
    this.setupEventListeners();
  }

  static getInstance(): ServerManager {
    if (!ServerManager.instance) {
      ServerManager.instance = new ServerManager();
    }
    return ServerManager.instance;
  }

  /**
   * Setup event listeners for state coordination
   */
  private setupEventListeners(): void {
    // Listen to state changes and coordinate accordingly
    this.eventBus.on('ServerStateChanged', ({ id, state }) => {
      this.log.debug(`Server ${id} state changed to ${state}`);
    });
  }

  /**
   * Register server runtime
   */
  async register(config: ServerConfig): Promise<Result<void, JsmError>> {
    if (this.runtimes.has(config.id)) {
      return err(new JsmError(ErrorCode.RUNTIME_REGISTRATION_ERROR, `Server ${config.id} already registered`));
    }

    try {
      const runtime = new ServerRuntime(config, this.pluginAdapter);
      this.runtimes.set(config.id, runtime);
      
      this.log.info(`Registered server: ${config.name} (${config.id})`);
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(ErrorCode.RUNTIME_REGISTRATION_ERROR, `Failed to register server: ${error}`, error));
    }
  }

  /**
   * Unregister server runtime
   */
  async unregister(serverId: string): Promise<Result<void, JsmError>> {
    const runtime = this.runtimes.get(serverId);
    if (!runtime) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Server ${serverId} not found`));
    }

    try {
      await runtime.dispose();
      this.runtimes.delete(serverId);
      
      this.log.info(`Unregistered server: ${serverId}`);
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(ErrorCode.RUNTIME_UNREGISTRATION_ERROR, `Failed to unregister server: ${error}`, error));
    }
  }

  /**
   * Start server
   */
  async start(serverId: string, mode: ServerStartMode = 'run', debugPort?: number): Promise<Result<void, JsmError>> {
    const runtime = this.runtimes.get(serverId);
    if (!runtime) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Server ${serverId} not found`));
    }

    this.log.info(`Starting server ${serverId} in ${mode} mode`);
    return runtime.start(mode, debugPort);
  }

  /**
   * Stop server
   */
  async stop(serverId: string): Promise<Result<void, JsmError>> {
    const runtime = this.runtimes.get(serverId);
    if (!runtime) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Server ${serverId} not found`));
    }

    this.log.info(`Stopping server ${serverId}`);
    return runtime.stop();
  }

  /**
   * Restart server
   */
  async restart(serverId: string, mode: ServerStartMode = 'run', debugPort?: number): Promise<Result<void, JsmError>> {
    const runtime = this.runtimes.get(serverId);
    if (!runtime) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Server ${serverId} not found`));
    }

    this.log.info(`Restarting server ${serverId} in ${mode} mode`);
    return runtime.restart(mode, debugPort);
  }

  /**
   * Get current server state
   */
  getState(serverId: string): Result<ServerState, JsmError> {
    const runtime = this.runtimes.get(serverId);
    if (!runtime) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Server ${serverId} not found`));
    }

    return ok(runtime.getCurrentState());
  }

  /**
   * Wait for server to reach specific status - Key requirement
   */
  async waitForStatus(serverId: string, targetState: ServerState, timeoutMs: number = 30000): Promise<Result<void, JsmError>> {
    const runtime = this.runtimes.get(serverId);
    if (!runtime) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Server ${serverId} not found`));
    }

    this.log.debug(`Waiting for server ${serverId} to reach state: ${targetState} (timeout: ${timeoutMs}ms)`);

    return new Promise((resolve) => {
      // Check current state first
      if (runtime.getCurrentState() === targetState) {
        resolve(ok(undefined));
        return;
      }

      let timeoutHandle: NodeJS.Timeout;
      let disposable: any;

      // Setup timeout
      timeoutHandle = setTimeout(() => {
        disposable?.dispose();
        resolve(err(new JsmError(
          ErrorCode.TIMEOUT_ERROR,
          `Timeout waiting for server ${serverId} to reach state ${targetState}`
        )));
      }, timeoutMs);

      // Listen for state changes
      disposable = this.eventBus.on('ServerStateChanged', ({ id, state }) => {
        if (id === serverId && state === targetState) {
          clearTimeout(timeoutHandle);
          disposable.dispose();
          resolve(ok(undefined));
        }
      });
    });
  }

  /**
   * Health check
   */
  async healthCheck(serverId: string): Promise<Result<boolean, JsmError>> {
    const runtime = this.runtimes.get(serverId);
    if (!runtime) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Server ${serverId} not found`));
    }

    return runtime.healthCheck();
  }

  /**
   * Get all server IDs
   */
  getServerIds(): string[] {
    return Array.from(this.runtimes.keys());
  }

  /**
   * Get all runtimes (for debugging)
   */
  getRuntimes(): ServerRuntime[] {
    return Array.from(this.runtimes.values());
  }

  /**
   * Dispose all resources
   */
  async dispose(): Promise<void> {
    this.log.info('Disposing server manager...');
    
    for (const [serverId, runtime] of this.runtimes) {
      try {
        await runtime.dispose();
      } catch (error) {
        this.log.error(`Failed to dispose runtime ${serverId}: ${error}`);
      }
    }
    
    this.runtimes.clear();
    this.log.info('Server manager disposed');
  }
}
