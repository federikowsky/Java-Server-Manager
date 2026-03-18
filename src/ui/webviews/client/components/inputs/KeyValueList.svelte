<script lang="ts">
  interface KeyValueRow {
    id: number;
    key: string;
    value: string;
  }

  const { value, onChange, id }: {
    value: Record<string, string> | undefined;
    onChange: (v: Record<string, string>) => void;
    id: string;
  } = $props();

  let nextRowId = $state(1);
  let rows = $state<KeyValueRow[]>([]);
  let lastSerialized = $state('');

  function serialize(entries: Record<string, string> | undefined): string {
    return JSON.stringify(entries ?? {});
  }

  $effect(() => {
    const serialized = serialize(value);
    if (serialized === lastSerialized) return;

    rows = Object.entries(value ?? {}).map(([key, entry]) => ({
      id: nextRowId++,
      key,
      value: entry,
    }));
    lastSerialized = serialized;
  });

  function emit(nextRows: KeyValueRow[]): void {
    rows = nextRows;
    const env: Record<string, string> = {};
    for (const row of nextRows) {
      const trimmedKey = row.key.trim();
      if (trimmedKey.length === 0) continue;
      env[trimmedKey] = row.value;
    }
    lastSerialized = serialize(env);
    onChange(env);
  }

  function addRow(): void {
    emit([...rows, { id: nextRowId++, key: '', value: '' }]);
  }

  function updateRow(rowId: number, patch: Partial<KeyValueRow>): void {
    emit(rows.map(row => row.id === rowId ? { ...row, ...patch } : row));
  }

  function removeRow(rowId: number): void {
    emit(rows.filter(row => row.id !== rowId));
  }
</script>

<div class="kv-list" id={id}>
  {#if rows.length > 0}
    <div class="kv-list-rows">
      {#each rows as row (row.id)}
        <div class="kv-row">
          <input
            class="field-input kv-input"
            type="text"
            placeholder="KEY"
            value={row.key}
            oninput={(e: Event) => updateRow(row.id, { key: (e.target as HTMLInputElement).value })}
          />
          <input
            class="field-input kv-input"
            type="text"
            placeholder="value"
            value={row.value}
            oninput={(e: Event) => updateRow(row.id, { value: (e.target as HTMLInputElement).value })}
          />
          <button type="button" class="btn btn-secondary kv-remove" onclick={() => removeRow(row.id)}>
            Remove
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <button type="button" class="btn btn-secondary kv-add" onclick={addRow}>
    Add Environment Variable
  </button>
</div>