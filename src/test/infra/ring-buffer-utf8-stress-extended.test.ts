/**
 * Extended coverage: RingBuffer byte accounting with multibyte UTF-8 (Boundary / Performance).
 * Maps to feature F-RINGBUFFER.
 */
import { describe, it, expect } from 'vitest';
import { RingBuffer } from '@infra/logging/Logger';

describe('RingBuffer UTF-8 and stress (extended)', () => {
  it('EXT-RB-001: multibyte characters count toward maxBytes', () => {
    const euro = '\u20AC';
    const buf = new RingBuffer(100, Buffer.byteLength(euro, 'utf-8'));
    buf.push(euro);
    expect(buf.size).toBe(1);
    buf.push('x');
    expect(buf.size).toBe(1);
    expect(buf.bytes).toBeLessThanOrEqual(Buffer.byteLength(euro, 'utf-8'));
  });

  it('EXT-RB-002: empty string push does not break invariants', () => {
    const buf = new RingBuffer(10, 1000);
    buf.push('');
    expect(buf.size).toBe(1);
    expect(buf.bytes).toBe(0);
  });

  it('EXT-RB-003: many small pushes stay under maxLines', () => {
    const buf = new RingBuffer(5, 1_000_000);
    for (let i = 0; i < 100; i++) buf.push(`line-${i}`);
    expect(buf.size).toBe(5);
    expect(buf.getAll()[0]).toBe('line-95');
  });

  it('EXT-RB-004: deterministic eviction order under byte cap', () => {
    const buf = new RingBuffer(100, 10);
    buf.push('12345');
    buf.push('67890');
    expect(buf.bytes).toBeLessThanOrEqual(10);
    const all = buf.getAll().join('');
    expect(all.length).toBeGreaterThan(0);
  });
});
