"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEBVIEW_PROTOCOL_VERSION = exports.BLOCKED_VMARGS_PREFIXES = exports.BLOCKED_ENV_KEYS = exports.DEPLOY_NAME_PATTERN = exports.HOOK_PHASE_BUDGET_MS = exports.RING_BUFFER_MAX_BYTES = exports.RING_BUFFER_MAX_LINES = exports.DEFAULT_SSL_CIPHERS = exports.DEFAULT_SSL_PROTOCOLS = exports.DEFAULT_TRUSTSTORE_TYPE = exports.DEFAULT_KEYSTORE_TYPE = exports.DEFAULT_SSL_PORT = exports.DEPLOY_BACKUP_MAX_KEPT = exports.ATOMIC_WRITE_BACKOFFS_MS = exports.ATOMIC_WRITE_MAX_RETRIES = exports.RECONCILIATION_STALE_FACTOR = exports.RECONCILIATION_GRACE_PERIOD_MS = exports.RECONCILIATION_BUDGET_MS = exports.STARTUP_CALLBACK_DEBOUNCE_MS = exports.READINESS_PROBE_INTERVAL_MS = exports.WATCHER_GLOBAL_CAP = exports.AUTOSYNC_FAILURE_THRESHOLD = exports.AUTOSYNC_FAILURE_WINDOW_MS = exports.AUTOSYNC_COOLDOWN_MS = exports.AUTOSYNC_MAX_BATCH_BYTES = exports.AUTOSYNC_MAX_BATCH_FILES = exports.AUTOSYNC_DEBOUNCE_MS = exports.TREE_REFRESH_DEBOUNCE_MS = exports.VIEW_CONTAINER_ID = exports.VIEW_ID = exports.SERVER_CHANNEL_PREFIX = exports.MAIN_OUTPUT_CHANNEL = exports.WORKSPACE_TEMPLATES_FILENAME = exports.GLOBAL_TEMPLATES_FILENAME = exports.GLOBAL_RUNTIMES_FILENAME = exports.WORKSPACE_CONFIG_DIR = exports.WORKSPACE_CONFIG_FILENAME = void 0;
// ── File Paths ──────────────────────────────────────────────────────────────
exports.WORKSPACE_CONFIG_FILENAME = 'jsm.servers.json';
exports.WORKSPACE_CONFIG_DIR = '.vscode';
exports.GLOBAL_RUNTIMES_FILENAME = 'jsm.runtimes.json';
exports.GLOBAL_TEMPLATES_FILENAME = 'jsm.templates.json';
exports.WORKSPACE_TEMPLATES_FILENAME = 'jsm.templates.json';
// ── Channel Names ───────────────────────────────────────────────────────────
exports.MAIN_OUTPUT_CHANNEL = 'JSM';
exports.SERVER_CHANNEL_PREFIX = 'JSM: ';
// ── Tree View ───────────────────────────────────────────────────────────────
exports.VIEW_ID = 'javaServerManagerView';
exports.VIEW_CONTAINER_ID = 'javaServerManager';
// ── Debounce / Timing ───────────────────────────────────────────────────────
exports.TREE_REFRESH_DEBOUNCE_MS = 75;
exports.AUTOSYNC_DEBOUNCE_MS = 400;
exports.AUTOSYNC_MAX_BATCH_FILES = 200;
exports.AUTOSYNC_MAX_BATCH_BYTES = 10 * 1024 * 1024; // 10 MB
exports.AUTOSYNC_COOLDOWN_MS = 2 * 60 * 1000; // 2 min
exports.AUTOSYNC_FAILURE_WINDOW_MS = 10 * 60 * 1000; // 10 min
exports.AUTOSYNC_FAILURE_THRESHOLD = 2;
exports.WATCHER_GLOBAL_CAP = 30;
exports.READINESS_PROBE_INTERVAL_MS = 250;
exports.STARTUP_CALLBACK_DEBOUNCE_MS = 150;
// ── Reconciliation ──────────────────────────────────────────────────────────
exports.RECONCILIATION_BUDGET_MS = 2000;
exports.RECONCILIATION_GRACE_PERIOD_MS = 5000;
exports.RECONCILIATION_STALE_FACTOR = 2;
// ── Atomic Write ────────────────────────────────────────────────────────────
exports.ATOMIC_WRITE_MAX_RETRIES = 3;
exports.ATOMIC_WRITE_BACKOFFS_MS = [100, 500, 1000];
// ── Deploy ──────────────────────────────────────────────────────────────────
exports.DEPLOY_BACKUP_MAX_KEPT = 3;
// ── SSL/TLS ─────────────────────────────────────────────────────────────────
exports.DEFAULT_SSL_PORT = 8443;
exports.DEFAULT_KEYSTORE_TYPE = 'PKCS12';
exports.DEFAULT_TRUSTSTORE_TYPE = 'PKCS12';
exports.DEFAULT_SSL_PROTOCOLS = ['TLSv1.2', 'TLSv1.3'];
exports.DEFAULT_SSL_CIPHERS = 'HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5';
// ── Ring Buffer ─────────────────────────────────────────────────────────────
exports.RING_BUFFER_MAX_LINES = 2000;
exports.RING_BUFFER_MAX_BYTES = 1 * 1024 * 1024; // 1 MB
// ── Hooks ───────────────────────────────────────────────────────────────────
exports.HOOK_PHASE_BUDGET_MS = 120_000; // 120 s
// ── Security ────────────────────────────────────────────────────────────────
exports.DEPLOY_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
exports.BLOCKED_ENV_KEYS = new Set([
    'LD_PRELOAD',
    'DYLD_INSERT_LIBRARIES',
    'JAVA_TOOL_OPTIONS',
    '_JAVA_OPTIONS',
    'JDK_JAVA_OPTIONS',
]);
exports.BLOCKED_VMARGS_PREFIXES = [
    '-javaagent:',
    '-agentlib:',
    '-agentpath:',
    '-XX:OnOutOfMemoryError',
    '-XX:OnError',
];
// ── Webview Protocol ────────────────────────────────────────────────────────
exports.WEBVIEW_PROTOCOL_VERSION = 1;
