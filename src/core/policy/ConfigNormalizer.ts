import type { ServerConfig } from '../types';

// ── Workspace Config Shape ──────────────────────────────────────────────────

export interface WorkspaceConfig {
  schemaVersion: number;
  servers: ServerConfig[];
}

// ── Default Values ──────────────────────────────────────────────────────────

export const DEFAULT_AUTOSYNC_IGNORE_GLOBS: readonly string[] = [
  '**/.git/**',
  '**/node_modules/**',
  '**/target/**',
  '**/build/**',
  '**/.gradle/**',
  '**/.idea/**',
  '**/.classpath',
  '**/.project',
  '*.tmp',
  '*.log',
  '*.swp',
];

// ── Shell-Split Utility ─────────────────────────────────────────────────────

/** Split a string by whitespace, respecting single/double quotes. */
export function shellSplit(str: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of str) {
    if (quote) {
      if (ch === quote) { quote = null; }
      else { current += ch; }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) { tokens.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}
