/**
 * CORE-006: EventBus synchronous delivery — nested emit and dispose-during-emit behavior.
 */
import { describe, it, expect } from 'vitest';
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

describe('EventBus re-entrancy and dispose (extended)', () => {
  it('CORE-006a: nested emit delivers inner event before outer listeners continue', () => {
    const bus = new EventBus(mockLogger());
    const order: string[] = [];

    bus.on('ConfigChanged', () => {
      order.push('outer-before');
      bus.emit('ServerAdded', {
        serverId: 'x' as never,
        workspaceFolderUri: 'file:///w',
      });
      order.push('outer-after');
    });

    bus.on('ServerAdded', () => {
      order.push('inner');
    });

    bus.emit('ConfigChanged', { source: 'external', workspaceFolderUri: 'file:///w' });

    expect(order).toEqual(['outer-before', 'inner', 'outer-after']);
  });

  it('CORE-006b: dispose during emit — second listener on same event still invoked', () => {
    const bus = new EventBus(mockLogger());
    const calls: string[] = [];

    const d1 = bus.on('ConfigChanged', () => {
      calls.push('first');
      d1.dispose();
    });
    bus.on('ConfigChanged', () => {
      calls.push('second');
    });

    bus.emit('ConfigChanged', { source: 'external', workspaceFolderUri: 'file:///w' });

    expect(calls).toEqual(['first', 'second']);
  });
});
