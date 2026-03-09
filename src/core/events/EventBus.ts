import type { EventMap, EventKey, Disposable } from '../types';
import type { Logger } from '../types/logger';

type Listener<K extends EventKey> = (payload: EventMap[K]) => void;

/**
 * Typed pub-sub event bus.
 *
 * Delivery semantics (§3.12):
 * - emit() is synchronous.
 * - Each subscriber is invoked in registration order, wrapped in try/catch.
 * - Subscriber errors are logged but never propagated to emitter or other subscribers.
 */
export class EventBus {
  private readonly listeners = new Map<EventKey, Set<Listener<EventKey>>>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** Register a listener. Returns a Disposable to unsubscribe. */
  on<K extends EventKey>(event: K, listener: Listener<K>): Disposable {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const fn = listener as Listener<EventKey>;
    set.add(fn);
    return {
      dispose: () => { set!.delete(fn); },
    };
  }

  /** Emit an event synchronously to all registered listeners. */
  emit<K extends EventKey>(event: K, payload: EventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(payload);
      } catch (err) {
        this.logger.error(`EventBus: subscriber error on '${event}'`, err);
      }
    }
  }

  /** Remove all listeners for all events. */
  dispose(): void {
    this.listeners.clear();
  }
}
