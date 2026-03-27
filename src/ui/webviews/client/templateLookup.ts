import type { ServerTemplate } from '@core/types';
import type { SpaTemplateRow } from './stores';

export function findServerTemplateById(rows: SpaTemplateRow[], id: string): ServerTemplate | undefined {
  for (const row of rows) {
    const t = row.template;
    if (typeof t === 'object' && t !== null && 'id' in t && (t as { id: string }).id === id) {
      return t as ServerTemplate;
    }
  }
  return undefined;
}

export function hasServerTemplateId(rows: SpaTemplateRow[], id: string): boolean {
  return findServerTemplateById(rows, id) !== undefined;
}
