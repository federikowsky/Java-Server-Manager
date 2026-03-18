import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import type { Logger } from '@core/types/logger';

function mockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('EventBus', () => {
  it('delivers events to registered listeners', () => {
    const bus = new EventBus(mockLogger());
    const received: unknown[] = [];
    bus.on('ServerAdded', p => received.push(p));
    bus.emit('ServerAdded', { serverId: 's1' });
    expect(received).toEqual([{ serverId: 's1' }]);
  });

  it('delivers to multiple listeners in registration order', () => {
    const bus = new EventBus(mockLogger());
    const order: number[] = [];
    bus.on('ServerDeleted', () => order.push(1));
    bus.on('ServerDeleted', () => order.push(2));
    bus.emit('ServerDeleted', { serverId: 's1' });
    expect(order).toEqual([1, 2]);
  });

  it('does not propagate subscriber errors to other subscribers', () => {
    const logger = mockLogger();
    const bus = new EventBus(logger);
    const received: string[] = [];
    bus.on('ServerUpdated', () => { throw new Error('boom'); });
    bus.on('ServerUpdated', () => received.push('ok'));
    bus.emit('ServerUpdated', { serverId: 's1' });
    expect(received).toEqual(['ok']);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('dispose() removes all listeners', () => {
    const bus = new EventBus(mockLogger());
    const received: unknown[] = [];
    bus.on('WorkspaceLoaded', p => received.push(p));
    bus.dispose();
    bus.emit('WorkspaceLoaded', { serverCount: 1 });
    expect(received).toEqual([]);
  });

  it('on() returns a disposable that removes only that listener', () => {
    const bus = new EventBus(mockLogger());
    const received: string[] = [];
    const d = bus.on('ConfigChanged', () => received.push('a'));
    bus.on('ConfigChanged', () => received.push('b'));
    d.dispose();
    bus.emit('ConfigChanged', { source: 'user' });
    expect(received).toEqual(['b']);
  });

  it('emitting an event with no listeners does nothing', () => {
    const bus = new EventBus(mockLogger());
    expect(() => bus.emit('ServerAdded', { serverId: 'x' })).not.toThrow();
  });
});
