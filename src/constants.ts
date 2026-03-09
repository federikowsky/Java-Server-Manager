// ── File Paths ──────────────────────────────────────────────────────────────
export const WORKSPACE_CONFIG_FILENAME = 'jsm.servers.json';
export const WORKSPACE_CONFIG_DIR = '.vscode';
export const GLOBAL_RUNTIMES_FILENAME = 'jsm.runtimes.json';
export const GLOBAL_TEMPLATES_FILENAME = 'jsm.templates.json';
export const WORKSPACE_TEMPLATES_FILENAME = 'jsm.templates.json';

// ── Channel Names ───────────────────────────────────────────────────────────
export const MAIN_OUTPUT_CHANNEL = 'JSM';
export const SERVER_CHANNEL_PREFIX = 'JSM: ';

// ── Tree View ───────────────────────────────────────────────────────────────
export const VIEW_ID = 'javaServerManagerView';
export const VIEW_CONTAINER_ID = 'javaServerManager';

// ── Debounce / Timing ───────────────────────────────────────────────────────
export const TREE_REFRESH_DEBOUNCE_MS = 75;
export const AUTOSYNC_DEBOUNCE_MS = 400;
export const AUTOSYNC_MAX_BATCH_FILES = 200;
export const AUTOSYNC_MAX_BATCH_BYTES = 10 * 1024 * 1024; // 10 MB
export const AUTOSYNC_COOLDOWN_MS = 2 * 60 * 1000; // 2 min
export const AUTOSYNC_FAILURE_WINDOW_MS = 10 * 60 * 1000; // 10 min
export const AUTOSYNC_FAILURE_THRESHOLD = 2;
export const WATCHER_GLOBAL_CAP = 30;
export const READINESS_PROBE_INTERVAL_MS = 250;

// ── Reconciliation ──────────────────────────────────────────────────────────
export const RECONCILIATION_BUDGET_MS = 2000;
export const RECONCILIATION_GRACE_PERIOD_MS = 5000;
export const RECONCILIATION_STALE_FACTOR = 2;

// ── Atomic Write ────────────────────────────────────────────────────────────
export const ATOMIC_WRITE_MAX_RETRIES = 3;
export const ATOMIC_WRITE_BACKOFFS_MS = [100, 500, 1000] as const;

// ── Deploy ──────────────────────────────────────────────────────────────────
export const DEPLOY_BACKUP_MAX_KEPT = 3;

// ── Ring Buffer ─────────────────────────────────────────────────────────────
export const RING_BUFFER_MAX_LINES = 2000;
export const RING_BUFFER_MAX_BYTES = 1 * 1024 * 1024; // 1 MB

// ── Hooks ───────────────────────────────────────────────────────────────────
export const HOOK_PHASE_BUDGET_MS = 120_000; // 120 s

// ── Schema ──────────────────────────────────────────────────────────────────
export const SCHEMA_VERSION = 1;

// ── Security ────────────────────────────────────────────────────────────────
export const DEPLOY_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
export const BLOCKED_ENV_KEYS = new Set([
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
  'JAVA_TOOL_OPTIONS',
  '_JAVA_OPTIONS',
  'JDK_JAVA_OPTIONS',
]);
export const BLOCKED_VMARGS_PREFIXES = [
  '-javaagent:',
  '-agentlib:',
  '-agentpath:',
  '-XX:OnOutOfMemoryError',
  '-XX:OnError',
] as const;

// ── Webview Protocol ────────────────────────────────────────────────────────
export const WEBVIEW_PROTOCOL_VERSION = 1;
