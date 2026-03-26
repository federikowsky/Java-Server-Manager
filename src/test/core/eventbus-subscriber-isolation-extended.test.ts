/**
 * Extended coverage: EventBus synchronous delivery and fault isolation (Concurrency / Observability).
 * Maps to feature F-EVENTBUS.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import type { Logger } from '@core/types/logger';

function mockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => mockLogger(),
  };
}

describe('EventBus subscriber isolation (extended)', () => {
  it('EXT-EB-001: later subscribers still run if earlier throws', () => {
    const logger = mockLogger();
    const bus = new EventBus(logger);
    const second = vi.fn();
    bus.on('ServerAdded', () => {
      throw new Error('first listener');
    });
    bus.on('ServerAdded', second);
    expect(() =>
      bus.emit('ServerAdded', {
        serverId: 's1' as never,
        workspaceFolderUri: 'file:///x',
      }),
    ).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
  });

  it('EXT-EB-002: dispose removes all listeners', () => {
    const bus = new EventBus(mockLogger());
    const fn = vi.fn();
    bus.on('ConfigChanged', fn);
    bus.dispose();
    bus.emit('ConfigChanged', { source: 'external', workspaceFolderUri: 'file:///x' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('EXT-EB-003: disposable unregisters single listener', () => {
    const bus = new EventBus(mockLogger());
    const fn = vi.fn();
    const d = bus.on('ConfigChanged', fn);
    d.dispose();
    bus.emit('ConfigChanged', { source: 'external', workspaceFolderUri: 'file:///x' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('EXT-EB-004: registration order preserved for successful listeners', () => {
    const bus = new EventBus(mockLogger());
    const order: number[] = [];
    bus.on('ServerStateChanged', () => {
      order.push(1);
    });
    bus.on('ServerStateChanged', () => {
      order.push(2);
    });
    bus.emit('ServerStateChanged', {
      serverId: 's1' as never,
      state: 'running',
      prevState: 'starting',
    });
    expect(order).toEqual([1, 2]);
  });
});
