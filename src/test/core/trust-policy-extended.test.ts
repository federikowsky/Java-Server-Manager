/**
 * Extended coverage: workspace trust gate (Security / Negative / Alternate flows).
 * Maps to feature F-TRUST.
 */
import { describe, it, expect, vi } from 'vitest';
import { requireWorkspaceTrust } from '@core/policy/TrustPolicy';
import type { TrustGate } from '@core/types';

describe('requireWorkspaceTrust (extended)', () => {
  it('EXT-TRUST-001: allows action when trustGate is undefined', () => {
    const r = requireWorkspaceTrust(undefined, 'start a server');
    expect(r.ok).toBe(true);
  });

  it('EXT-TRUST-002: allows action when workspace is trusted', () => {
    const gate: TrustGate = { isTrusted: () => true };
    const r = requireWorkspaceTrust(gate, 'deploy');
    expect(r.ok).toBe(true);
  });

  it('EXT-TRUST-003: rejects when workspace is untrusted', () => {
    const gate: TrustGate = { isTrusted: () => false };
    const r = requireWorkspaceTrust(gate, 'run hooks');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('WorkspaceUntrusted');
      expect(r.error.message).toContain('run hooks');
    }
  });

  it('EXT-TRUST-004: action string is embedded for observability', () => {
    const gate: TrustGate = { isTrusted: () => false };
    const r = requireWorkspaceTrust(gate, 'spawn Tomcat');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain('spawn Tomcat');
    }
  });

  it('EXT-TRUST-005: repeated checks reflect live trust state', () => {
    let trusted = false;
    const gate: TrustGate = { isTrusted: () => trusted };
    expect(requireWorkspaceTrust(gate, 'x').ok).toBe(false);
    trusted = true;
    expect(requireWorkspaceTrust(gate, 'x').ok).toBe(true);
  });

  it('EXT-TRUST-006: isTrusted invoked each call (no caching in policy)', () => {
    const spy = vi.fn().mockReturnValue(true);
    const gate: TrustGate = { isTrusted: spy };
    requireWorkspaceTrust(gate, 'a');
    requireWorkspaceTrust(gate, 'b');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
