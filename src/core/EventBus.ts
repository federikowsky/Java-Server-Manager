/*
 * src/core/EventBus.ts
 * Typed global message bus built on Node.js EventEmitter.
 */

import { Disposable } from 'vscode';
import { EventEmitter } from 'events';
import { ServerConfig, DeploymentConfig, ServerState, DeploymentState } from './types/domain';

/** Map of all application‑level events */
export interface EventMap {
  WorkspaceLoaded        : { servers: ServerConfig[] };
  ServerStateChanged     : { id:string; state:ServerState };
  DeploymentStateChanged : { srvId:string; depId:string; state:DeploymentState };
  ServerAdded            : ServerConfig;
  ServerUpdated          : ServerConfig;
  ServerDeleted          : { id:string };
  DeploymentAdded        : DeploymentConfig;
  DeploymentRemoved      : DeploymentConfig;
  DeploymentUndeployed   : DeploymentConfig;
  ServerPublished        : { id:string; mode:'incremental'|'full' };
  ConfigChanged          : { source: 'file' | 'api'; servers: ServerConfig[] };
}

export type EventKey = keyof EventMap;
export type Handler<K extends EventKey> = (payload: EventMap[K]) => unknown;

export class EventBus {
  private static instance: EventBus;
  private readonly emitter = new EventEmitter();

  private constructor() {
    this.emitter.setMaxListeners(100);
  }

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  on<K extends EventKey>(event: K, cb: Handler<K>): Disposable {
    this.emitter.addListener(event, cb);
    return { dispose: () => this.emitter.removeListener(event, cb) };
  }

  once<K extends EventKey>(event: K, cb: Handler<K>): Disposable {
    this.emitter.once(event, cb);
    return { dispose: () => this.emitter.removeListener(event, cb) };
  }

  off<K extends EventKey>(event: K, cb: Handler<K>): void {
    this.emitter.removeListener(event, cb);
  }

  emit<K extends EventKey>(event: K, payload: EventMap[K]): void {
    this.emitter.emit(event, payload);
  }

  disposeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
