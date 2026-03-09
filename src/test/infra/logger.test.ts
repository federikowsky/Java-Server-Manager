import { describe, it, expect } from 'vitest';
import { RingBuffer, Logger } from '@infra/logging/Logger';

describe('RingBuffer', () => {
  it('stores and retrieves lines', () => {
    const buf = new RingBuffer(10, 10_000);
    buf.push('line 1');
    buf.push('line 2');
    expect(buf.getAll()).toEqual(['line 1', 'line 2']);
    expect(buf.size).toBe(2);
  });

  it('evicts oldest lines when maxLines exceeded', () => {
    const buf = new RingBuffer(3, 10_000);
    buf.push('a');
    buf.push('b');
    buf.push('c');
    buf.push('d');
    expect(buf.getAll()).toEqual(['b', 'c', 'd']);
    expect(buf.size).toBe(3);
  });

  it('evicts when maxBytes exceeded', () => {
    // Each 'x' is 1 byte in UTF-8
    const buf = new RingBuffer(1000, 5);
    buf.push('abc');  // 3 bytes
    buf.push('de');   // 2 bytes, total 5 — at limit
    expect(buf.size).toBe(2);
    buf.push('fgh');  // 3 bytes → needs to evict to get under 5
    // After eviction: should have dropped enough to be ≤ 5 bytes
    expect(buf.bytes).toBeLessThanOrEqual(5);
  });

  it('clear() empties the buffer', () => {
    const buf = new RingBuffer(10, 10_000);
    buf.push('a');
    buf.push('b');
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.bytes).toBe(0);
    expect(buf.getAll()).toEqual([]);
  });
});

describe('Logger', () => {
  it('writes to ring buffer', () => {
    const logger = new Logger({ scope: 'test' });
    logger.info('hello');
    const lines = logger.getRingBuffer().getAll();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('INFO');
    expect(lines[0]).toContain('[test]');
    expect(lines[0]).toContain('hello');
  });

  it('writes to OutputSink when provided', () => {
    const output: string[] = [];
    const sink = {
      append: () => {},
      appendLine: (line: string) => output.push(line),
      clear: () => {},
    };
    const logger = new Logger({ scope: 'test', sink });
    logger.warn('caution');
    expect(output).toHaveLength(1);
    expect(output[0]).toContain('WARN');
  });

  it('respects minLevel', () => {
    const logger = new Logger({ scope: 'test', minLevel: 'warn' });
    logger.debug('hidden');
    logger.info('hidden');
    logger.warn('shown');
    logger.error('shown');
    expect(logger.getRingBuffer().size).toBe(2);
  });

  it('child() shares ring buffer', () => {
    const parent = new Logger({ scope: 'parent' });
    const child = parent.child('child');
    parent.info('from parent');
    child.info('from child');
    const lines = parent.getRingBuffer().getAll();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('[parent.child]');
  });

  it('includes serverId in output when provided', () => {
    const logger = new Logger({ scope: 'test', serverId: 's1' });
    logger.info('msg');
    const line = logger.getRingBuffer().getAll()[0];
    expect(line).toContain('s1');
  });

  it('appends structured data', () => {
    const logger = new Logger({ scope: 'test' });
    logger.info('with data', { key: 'val' });
    const line = logger.getRingBuffer().getAll()[0];
    expect(line).toContain('"key":"val"');
  });
});
