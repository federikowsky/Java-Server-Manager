/**
 * Pure helpers for form schema merging (host init + hookOptions). No store imports.
 */

import type { FormSchema } from '../protocol';

export function collectSchemaDefaults(formSchema: FormSchema): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const section of formSchema.sections) {
    for (const field of section.fields) {
      if (field.defaultValue !== undefined) {
        defaults[field.name] = field.defaultValue;
      }
    }
  }
  return defaults;
}

export function applyHookTaskOptions(
  formSchema: FormSchema,
  fieldNames: string[],
  taskOptions: { value: string; label: string }[],
): FormSchema {
  const fieldNameSet = new Set(fieldNames);

  return {
    ...formSchema,
    sections: formSchema.sections.map(section => ({
      ...section,
      fields: section.fields.map(field => {
        if (field.type !== 'hooks' || !fieldNameSet.has(field.name)) {
          return field;
        }

        return {
          ...field,
          hookOptions: {
            ...(field.hookOptions ?? {}),
            taskOptions,
          },
        };
      }),
    })),
  };
}
