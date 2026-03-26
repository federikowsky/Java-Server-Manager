import { describe, expect, it } from 'vitest';
import { findServerTemplateById, hasServerTemplateId } from '../../ui/webviews/client/templateLookup';

describe('templateLookup', () => {
  const rows = [
    { template: { id: 'a', name: 'A' }, scope: 'global' as const },
    { template: 'bad', scope: 'workspace' as const },
  ];

  it('findServerTemplateById returns template when id matches', () => {
    expect(findServerTemplateById(rows, 'a')).toEqual({ id: 'a', name: 'A' });
  });

  it('findServerTemplateById returns undefined when missing', () => {
    expect(findServerTemplateById(rows, 'z')).toBeUndefined();
  });

  it('hasServerTemplateId mirrors find', () => {
    expect(hasServerTemplateId(rows, 'a')).toBe(true);
    expect(hasServerTemplateId(rows, 'z')).toBe(false);
  });
});
