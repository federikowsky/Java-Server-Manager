import { describe, expect, it } from 'vitest';
import { applyHookTaskOptions, collectSchemaDefaults } from '../../ui/webviews/client/formSchemaUtils';
import type { FormSchema } from '../../ui/webviews/protocol';

describe('formSchemaUtils', () => {
  it('collectSchemaDefaults collects field defaultValue entries', () => {
    const schema: FormSchema = {
      title: 'T',
      sections: [
        {
          id: 's1',
          fields: [
            { name: 'a', label: 'A', type: 'text', defaultValue: 'x' },
            { name: 'b', label: 'B', type: 'number' },
          ],
        },
      ],
    };
    expect(collectSchemaDefaults(schema)).toEqual({ a: 'x' });
  });

  it('applyHookTaskOptions merges taskOptions for named hooks fields', () => {
    const schema: FormSchema = {
      title: 'T',
      sections: [
        {
          id: 's1',
          fields: [
            { name: 'h', label: 'H', type: 'hooks', hookOptions: { events: [] } },
            { name: 't', label: 'T', type: 'text' },
          ],
        },
      ],
    };
    const taskOptions = [{ value: 't1', label: 'Task 1' }];
    const next = applyHookTaskOptions(schema, ['h'], taskOptions);
    const h = next.sections[0].fields[0];
    expect(h.type).toBe('hooks');
    expect(h.hookOptions?.taskOptions).toEqual(taskOptions);
    expect(next.sections[0].fields[1]).toEqual(schema.sections[0].fields[1]);
  });
});
