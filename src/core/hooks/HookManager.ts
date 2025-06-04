/*
 * src/core/hooks/HookManager.ts
 * Simple pub‑sub hook system built on top of EventBus.
 */

import { Disposable } from 'vscode';
import { EventBus } from '../EventBus';
import { Logger } from '../utils/logger';
import { JsmError, hasCode } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';

export interface HookSchema {
  beforeStartServer(id:string,mode:'run'|'debug'):unknown|Promise<unknown>;
  afterStartServer(id:string):unknown|Promise<unknown>;
  beforeStopServer(id:string):unknown|Promise<unknown>;
  afterStopServer(id:string):unknown|Promise<unknown>;
  beforeAddServer(tplId:string):unknown|Promise<unknown>;
  afterAddServer(cfg:import('../types/domain').ServerConfig):unknown|Promise<unknown>;
  beforeDeleteServer(id:string):unknown|Promise<unknown>;
  afterDeleteServer(id:string):unknown|Promise<unknown>;
  beforeAddDeployment(srvId:string):unknown|Promise<unknown>;
  afterAddDeployment(cfg:import('../types/domain').DeploymentConfig):unknown|Promise<unknown>;
  beforeRemoveDeployment(cfg:import('../types/domain').DeploymentConfig):unknown|Promise<unknown>;
  afterRemoveDeployment(cfg:import('../types/domain').DeploymentConfig):unknown|Promise<unknown>;
  onError(err:Error):unknown|Promise<unknown>;
}

type PartialHook = Partial<HookSchema>;

export class HookManager {
  private static instance: HookManager;
  private readonly logger = Logger.getInstance().createChild('Hook');
  private readonly eventBus = EventBus.getInstance();
  private readonly registry = new Map<string, PartialHook>();

  private constructor() {}

  static getInstance(): HookManager {
    if (!this.instance) this.instance = new HookManager();
    return this.instance;
  }

  register(name:string, impl: PartialHook): Disposable {
    this.registry.set(name, impl);
    this.logger.debug(`registered hook "${name}"`);
    return { dispose: () => {
      this.registry.delete(name);
      this.logger.debug(`disposed hook "${name}"`);
    }};
  }

  async invoke<K extends keyof HookSchema>(key:K, ...args: Parameters<HookSchema[K]>): Promise<void> {
    for (const [name, impl] of this.registry.entries()) {
      const fn = impl[key];
      if (typeof fn === 'function') {
        try {
          // const fn = impl[key] as (...a:any[]) => unknown;
          // await fn(...args as any);
          (await fn as any)(...args);
        } catch (err) {
          this.logger.error(`hook "${name}" failed on ${String(key)}`);
          // fallback to onError hook if present
          if (!hasCode(err, ErrorCode.UNKNOWN)) {
            this.invoke('onError', err as Error).catch(() => {/* swallow */});
          }
        }
      }
    }
  }
}
