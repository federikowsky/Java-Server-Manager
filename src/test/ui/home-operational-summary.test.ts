import { describe, it, expect } from 'vitest';
import { computeHomeOperationalSummary } from '@ui/webviews/client/lib/homeOperationalSummary';

describe('computeHomeOperationalSummary', () => {
  const servers = [
    { serverKey: 'a', config: { id: 's1', name: 'One' } },
    { serverKey: 'b', config: { id: 's2', name: 'Two' } },
  ];

  it('counts running, stopped, error, transitioning', () => {
    const rs = {
      a: { state: 'running' },
      b: { state: 'stopped' },
    };
    const s = computeHomeOperationalSummary(servers, rs, {});
    expect(s.totalServers).toBe(2);
    expect(s.running).toBe(1);
    expect(s.stopped).toBe(1);
    expect(s.error).toBe(0);
    expect(s.transitioning).toBe(0);
    expect(s.serversInError).toEqual([]);
  });

  it('lists servers in error state', () => {
    const rs = {
      a: { state: 'error' },
      b: { state: 'running' },
    };
    const s = computeHomeOperationalSummary(servers, rs, {});
    expect(s.error).toBe(1);
    expect(s.serversInError).toEqual([{ id: 's1', name: 'One' }]);
  });

  it('treats missing runtime as stopped', () => {
    const s = computeHomeOperationalSummary(servers, {}, {});
    expect(s.stopped).toBe(2);
  });

  it('counts deployment-level errors', () => {
    const ds = {
      a: { d1: 'synced', d2: 'error' },
      b: { d3: 'error' },
    };
    const s = computeHomeOperationalSummary(servers, { a: { state: 'running' }, b: { state: 'running' } }, ds);
    expect(s.deploymentErrors).toBe(2);
  });
});
