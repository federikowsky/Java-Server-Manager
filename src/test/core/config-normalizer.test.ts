import { describe, it, expect } from 'vitest';
import { shellSplit } from '@core/policy/ConfigNormalizer';

describe('shellSplit', () => {
  it('splits simple whitespace-separated args', () => {
    expect(shellSplit('-Xmx512m -Xms256m')).toEqual(['-Xmx512m', '-Xms256m']);
  });

  it('respects double quotes', () => {
    expect(shellSplit('-Dpath="/my dir/lib" -Xmx1g')).toEqual(['-Dpath=/my dir/lib', '-Xmx1g']);
  });

  it('respects single quotes', () => {
    expect(shellSplit("-Dfoo='bar baz'")).toEqual(['-Dfoo=bar baz']);
  });

  it('handles empty string', () => {
    expect(shellSplit('')).toEqual([]);
  });

  it('handles multiple spaces', () => {
    expect(shellSplit('a   b  c')).toEqual(['a', 'b', 'c']);
  });
});
