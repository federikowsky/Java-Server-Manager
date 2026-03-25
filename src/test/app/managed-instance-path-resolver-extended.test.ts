/**
 * Extended coverage: deterministic managed storage paths (Happy / Edge / Boundary).
 * Maps to feature F-MANAGED-PATHS.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { ManagedInstancePathResolver } from '@app/server/ManagedInstancePathResolver';

describe('ManagedInstancePathResolver (extended)', () => {
  const root = path.join('/tmp', 'jsm-managed', 'instances');

  it('EXT-MIP-001: join serverId under storage root', () => {
    const r = new ManagedInstancePathResolver(root);
    expect(r.resolve('srv-1')).toBe(path.join(root, 'srv-1'));
  });

  it('EXT-MIP-002: getStorageRoot returns constructor path', () => {
    const r = new ManagedInstancePathResolver(root);
    expect(r.getStorageRoot()).toBe(root);
  });

  it('EXT-MIP-003: empty serverId collapses to storage root path (edge)', () => {
    const r = new ManagedInstancePathResolver(root);
    expect(r.resolve('')).toBe(path.join(root));
  });

  it('EXT-MIP-004: path-like serverId is normalized and can escape storage root (caller must validate IDs)', () => {
    const r = new ManagedInstancePathResolver(root);
    const joined = r.resolve('..' + path.sep + 'etc');
    const normalizedRoot = path.normalize(root + path.sep);
    expect(joined).toBe(path.normalize(path.join(root, '..' + path.sep + 'etc')));
    expect(joined.startsWith(normalizedRoot)).toBe(false);
  });

  it('EXT-MIP-005: unicode server id preserved', () => {
    const r = new ManagedInstancePathResolver(root);
    const id = 'srv-\u{1F600}';
    expect(r.resolve(id)).toBe(path.join(root, id));
  });

  it('EXT-MIP-006: very long server id still produces path under root prefix', () => {
    const r = new ManagedInstancePathResolver(root);
    const longId = 's'.repeat(500);
    const out = r.resolve(longId);
    expect(out.startsWith(root + path.sep)).toBe(true);
  });
});
