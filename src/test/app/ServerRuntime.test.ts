import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerRuntime } from '@app/server/ServerRuntime';
import { EventBus } from '@core/events/EventBus';
import type { Logger } from '@core/types/logger';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe('ServerRuntime', () => {
  let bus: EventBus;
  let runtime: ServerRuntime;

  beforeEach(() => {
    bus = new EventBus(mockLogger());
    runtime = new ServerRuntime('s1', bus, mockLogger());
  });

  it('starts in stopped state', () => {
    expect(runtime.state).toBe('stopped');
    expect(runtime.serverId).toBe('s1');
    expect(runtime.pid).toBeUndefined();
  });

  it('allows stopped → starting transition', () => {
    runtime.transition('starting', { startMode: 'run' });
    expect(runtime.state).toBe('starting');
    expect(runtime.lastStartMode).toBe('run');
  });

  it('allows starting → running transition with PID', () => {
    runtime.transition('starting');
    runtime.transition('running', { pid: 1234 });
    expect(runtime.state).toBe('running');
    expect(runtime.pid).toBe(1234);
  });

  it('allows running → stopping → stopped', () => {
    runtime.transition('starting');
    runtime.transition('running', { pid: 1234 });
    runtime.transition('stopping');
    expect(runtime.state).toBe('stopping');
    runtime.transition('stopped');
    expect(runtime.state).toBe('stopped');
    expect(runtime.pid).toBeUndefined();
  });

  it('allows running → error', () => {
    runtime.transition('starting');
    runtime.transition('running');
    runtime.transition('error');
    expect(runtime.state).toBe('error');
  });

  it('allows error → starting (retry)', () => {
    runtime.transition('starting');
    runtime.transition('error');
    runtime.transition('starting');
    expect(runtime.state).toBe('starting');
  });

  it('allows error → stopped (reset)', () => {
    runtime.transition('starting');
    runtime.transition('error');
    runtime.reset();
    expect(runtime.state).toBe('stopped');
  });

  it('rejects invalid transition stopped → running', () => {
    expect(() => runtime.transition('running')).toThrow();
  });

  it('rejects invalid transition running → starting', () => {
    runtime.transition('starting');
    runtime.transition('running');
    expect(() => runtime.transition('starting')).toThrow();
  });

  it('rejects reset from non-error state', () => {
    expect(() => runtime.reset()).toThrow();
  });

  it('emits ServerStateChanged on transition', () => {
    const events: unknown[] = [];
    bus.on('ServerStateChanged', e => events.push(e));
    runtime.transition('starting');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ serverId: 's1', state: 'starting', prevState: 'stopped' });
  });

  it('forceState bypasses transition rules', () => {
    runtime.forceState('running', { pid: 5678 });
    expect(runtime.state).toBe('running');
    expect(runtime.pid).toBe(5678);
  });

  it('getState returns a snapshot', () => {
    runtime.transition('starting');
    const snapshot = runtime.getState();
    expect(snapshot.state).toBe('starting');
    expect(snapshot.serverId).toBe('s1');
  });
});
