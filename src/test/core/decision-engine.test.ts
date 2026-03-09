import { describe, it, expect } from 'vitest';
import {
  decideStopEscalation,
  decideReadiness,
  canStart,
  canStop,
  canRestart,
  canDeploy,
} from '@core/policy/DecisionEngine';

describe('DecisionEngine', () => {
  describe('decideStopEscalation', () => {
    it('returns wait when elapsed < timeout', () => {
      expect(decideStopEscalation(5000, 20000)).toBe('wait');
    });
    it('returns force-kill when elapsed >= timeout', () => {
      expect(decideStopEscalation(20000, 20000)).toBe('force-kill');
      expect(decideStopEscalation(25000, 20000)).toBe('force-kill');
    });
  });

  describe('decideReadiness', () => {
    it('returns ready when port is open', () => {
      expect(decideReadiness({ portOpen: true, elapsed: 100, timeoutMs: 30000 })).toBe('ready');
    });
    it('returns timeout when elapsed >= timeoutMs and port not open', () => {
      expect(decideReadiness({ portOpen: false, elapsed: 30000, timeoutMs: 30000 })).toBe('timeout');
    });
    it('returns retry when port not open and not timed out', () => {
      expect(decideReadiness({ portOpen: false, elapsed: 5000, timeoutMs: 30000 })).toBe('retry');
    });
  });

  describe('state guards', () => {
    it('canStart from stopped or error', () => {
      expect(canStart('stopped')).toBe(true);
      expect(canStart('error')).toBe(true);
      expect(canStart('running')).toBe(false);
      expect(canStart('starting')).toBe(false);
      expect(canStart('stopping')).toBe(false);
    });

    it('canStop from running or starting', () => {
      expect(canStop('running')).toBe(true);
      expect(canStop('starting')).toBe(true);
      expect(canStop('stopped')).toBe(false);
    });

    it('canRestart only from running', () => {
      expect(canRestart('running')).toBe(true);
      expect(canRestart('stopped')).toBe(false);
    });

    it('canDeploy only from running', () => {
      expect(canDeploy('running')).toBe(true);
      expect(canDeploy('stopped')).toBe(false);
    });
  });
});
