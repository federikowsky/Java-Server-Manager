# Java Server Manager (JSM) — Implementation Specification v2

> **Status:** CANDIDATE — Pre-freeze review applied. Pending final approval for freeze.  
> **Supersedes:** `docs/spec.md`, `docs/specs.md`, `docs/specs-extended.md`  
> **Scope:** Tomcat-only, plugin-ready architecture  
> **Language:** English  
> **Implementation:** Big-bang rewrite from current codebase. No backward compatibility.  
> **Rule:** Every `[REQUIREMENT]` section MUST be fully implemented. No stubs, no placeholders, no partial features.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Terminology](#2-terminology)
3. [Domain Model and Canonical Types](#3-domain-model-and-canonical-types)
4. [Persistence and Storage](#4-persistence-and-storage)
5. [Architecture and Layers](#5-architecture-and-layers)
6. [Plugin System](#6-plugin-system)
7. [UX and UI](#7-ux-and-ui)
8. [Command Catalog](#8-command-catalog)
9. [Lifecycle and Operations](#9-lifecycle-and-operations)
10. [Deploy and AutoSync](#10-deploy-and-autosync)
11. [Logging, Diagnostics, Output Channels](#11-logging-diagnostics-output-channels)
12. [Security and Safety](#12-security-and-safety)
13. [Performance Budgets](#13-performance-budgets)
14. [Testing Strategy and Definition of Done](#14-testing-strategy-and-definition-of-done)
- [Appendix A: Decision Log](#appendix-a-decision-log)
- [Appendix B: Roadmap](#appendix-b-roadmap)

---

## 1. Product Overview

### 1.1 Purpose

`[REQUIREMENT]` **Java Server Manager (JSM)** is a VS Code extension that manages local Java application servers. It provides a tree-based UI to create, configure, start, stop, deploy to, and monitor server instances — with a focus on developer ergonomics, safety, and predictability.

### 1.2 v1 Goals

`[REQUIREMENT]` v1 delivers:

- **Tomcat-first implementation**: full lifecycle (run/debug), deploy (WAR + exploded), autosync, logs.
- **Multi-instance support**: shared runtime installation (`homePath`) + per-server instance directory (`instancePath`). Tomcat uses `CATALINA_HOME`/`CATALINA_BASE` respectively.
- **Plugin-ready architecture**: core decoupled from server-specific logic so that Jetty, WildFly, etc. can be added without core rewrites.
- **Minimal-UI principle**: tree shows only servers and deployments; all actions via inline buttons and context menus.
- **Professional quality**: SOLID, SRP, DRY; typed boundaries; deterministic decision engine; actionable errors; diagnostics bundle.

### 1.3 Non-Goals (v1)

`[REQUIREMENT]` The following are explicitly out of scope:

- Remote server orchestration, Docker, Kubernetes.
- Production deployment management.
- Full Maven/Gradle integration (beyond optional hooks).
- Telemetry (must be opt-in if ever added).
- Custom `server.xml` templates (v1 uses auto-patching only).
- Plugins beyond Tomcat (architecture ready, but no implementation).

### 1.4 Philosophy

`[REFERENCE]` Design principles:

- **Explicit actions, automatic strategy**: the user triggers an explicit action (Start, Sync); the system decides internally how to execute (incremental vs full, graceful vs force).
- **No surprise operations**: clicking a tree item is a no-op; actions require intentional inline button or context menu clicks.
- **Core independent from VS Code APIs**: `core/` imports zero VS Code modules; UI adapters bridge the gap.

---

## 2. Terminology

`[REFERENCE]`

| Term | Definition |
|---|---|
| **Runtime** | A server installation directory (`homePath`). Stored in global registry; may be shared by multiple servers. For Tomcat: `CATALINA_HOME`. |
| **Server** | A configured instance referencing a runtime + its own instance directory (`instancePath`). Workspace-scoped. For Tomcat: `CATALINA_BASE`. |
| **Deployment** | An artifact (WAR file or exploded directory) mapped to a server's `webapps/`. |
| **Sync** | User action that updates a deployment target. The system automatically chooses incremental vs full strategy. |
| **Inline actions** | Per-item toolbar icons in the tree view (fast lane). |
| **Context menu** | Right-click menu on server, deployment, or view background. |
| **Operation** | A tracked, cancellable unit of work enqueued per server (start, stop, sync, etc.). |
| **DecisionEngine** | A pure, deterministic component that computes strategy choices (sync mode, stop escalation, readiness policy). |
| **OperationQueue** | A per-server priority-FIFO queue that serializes operations and supports coalescing and cancellation. |

---

## 3. Domain Model and Canonical Types

### 3.1 ID Types

`[REQUIREMENT]` All entity identifiers are UUID v4 strings.

```ts
type ServerId = string;       // UUID v4
type DeploymentId = string;   // UUID v4
type TemplateId = string;     // UUID v4
type OperationId = string;    // UUID v4
```

### 3.2 Core Enumerations

`[REQUIREMENT]`

```ts
type ServerType = 'tomcat';          // Literal union — grows when plugins are added
type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
type DeploymentState = 'undeployed' | 'deploying' | 'synced' | 'error';
type StartMode = 'run' | 'debug';
type DeploymentType = 'war' | 'exploded';
type SyncMode = 'off' | 'manual' | 'auto';
```

### 3.3 Result and Error Model

`[REQUIREMENT]`

```ts
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

type ErrorSeverity = 'info' | 'warning' | 'error';

interface JsmError {
  code: ErrorCode;
  severity: ErrorSeverity;
  message: string;           // User-facing summary
  details?: string;          // Technical detail (never shown raw in notifications)
  suggestedFix?: string[];   // Ordered list of user-facing remediation steps
  cause?: unknown;           // Original error (redacted in diagnostics)
}
```

### 3.4 ErrorCode Enumeration

`[REQUIREMENT]` Canonical error codes. Each code has a defined retryability and default severity.

| ErrorCode | Retryable | Default Severity | Default Suggested Fixes |
|---|---|---|---|
| `InvalidConfig` | yes | error | Open Config; Re-run wizard |
| `ValidationFailed` | yes | error | Pick valid Tomcat folder; Ensure scripts executable |
| `ConfigReadFailed` | yes | error | Check workspace permissions; Restore config file |
| `ConfigWriteFailed` | yes | error | Check disk/permissions; Close conflicting editors |
| `MigrationFailed` | yes | error | Backup config; Reset to defaults |
| `OperationInProgress` | yes | info | Wait for current operation; Cancel current operation |
| `AlreadyRunning` | yes | info | Use Stop/Restart; Refresh status |
| `NotRunning` | yes | info | Start the server; Refresh status |
| `ProcessSpawnFailed` | yes | error | Check permissions; Verify JAVA_HOME; Verify catalina script |
| `ProcessNotFound` | yes | warning | Refresh status; Remove stale runtime state |
| `ProcessKillFailed` | yes | error | Try force stop; Check OS permissions |
| `ScriptNotExecutable` | yes | error | `chmod +x bin/catalina.sh`; Fix file permissions |
| `JavaNotFound` | yes | error | Select correct JAVA_HOME; Install JDK |
| `PortInUse` | yes | error | Pick free port; Stop conflicting process |
| `Timeout` | yes | warning | Check logs; Increase timeout; Check port conflicts |
| `DeployFailed` | yes | error | Try Full Redeploy; Check target permissions |
| `UndeployFailed` | yes | warning | Retry; Delete target manually |
| `SourceNotFound` | yes | error | Fix sourcePath; Build artifact; Re-run sync |
| `TargetNotWritable` | yes | error | Fix permissions; Use different base path |
| `LogNotFound` | yes | info | Start server; Check logs directory |
| `HookFailed` | yes | warning | Disable hook; Fix hook command; Re-run operation |
| `Cancelled` | yes | info | Retry when ready |
| `Unsupported` | no | error | Use supported operation; Upgrade extension |
| `Unknown` | yes | error | Copy diagnostics; Retry; Report bug |

### 3.5 ServerConfig (Canonical — Defined Once)

`[REQUIREMENT]` This is the single canonical definition of `ServerConfig`. All other sections reference this shape; it is never redefined elsewhere.

```ts
interface ServerConfig {
  id: ServerId;
  name: string;
  type: ServerType;                   // Plugin type discriminator — literal union, not bare string

  runtime: {
    id: string;                      // Stable runtime ID (stored in global registry)
    homePath: string;                // Absolute path to server installation (plugin maps to its own env var, e.g. CATALINA_HOME)
    version?: string;                // Cached detection result
  };
  instancePath: string;              // Absolute path to per-server instance directory (plugin maps to its own env var, e.g. CATALINA_BASE), unique per server

  javaHome: string;                  // Absolute path, mandatory
  host: string;                      // Default: '127.0.0.1'

  ports: {
    http: number;                    // Default: 8080
    debug: number;                   // Default: 5005
  };

  run: {
    env: Record<string, string>;     // Non-secret environment variables
    vmArgs: string[];                // JVM arguments (split array, not string)
    cwd?: string;                    // Optional working directory override
  };

  debug: {
    enabled: boolean;                // Default: true
    bind: string;                    // Default: '127.0.0.1' (MUST be localhost — validation rejects any value other than '127.0.0.1', 'localhost', or '::1')
    attachDelayMs: number;           // Default: 1000
  };

  deployments: DeploymentConfig[];

  autosync: {
    enabled: boolean;                // Default: true — master switch; if false, ALL deployments ignore their syncMode
    debounceMs: number;              // Default: 400
    maxBatchFiles: number;           // Default: 200
    maxBatchBytes: number;           // Default: 20_000_000
    stormBackoffMs: number;          // Default: 2000
    ignoreGlobs: string[];           // Default: see §10.4
  };

  hooks: HookConfig[];               // Lifecycle hooks (see §10.6)

  timeouts?: {                        // Optional user overrides for operation timeouts (§9.6)
    startRunMs?: number;              // Default: 30_000
    startDebugMs?: number;            // Default: 45_000
    stopMs?: number;                  // Default: 20_000
    deployFullMs?: number;            // Default: 60_000
  };

  pluginConfig?: PluginConfig;       // Plugin-specific extensions — discriminated union (see §3.5.1)
}
```

### 3.5.1 PluginConfig (Discriminated Union)

`[REQUIREMENT]` `PluginConfig` is the single extension point for plugin-specific options that have no generic equivalent across servlet containers. `ServerConfig` references only `PluginConfig` — never a concrete plugin type. Each member of the union is identified by its `type` discriminant, which matches `ServerConfig.type`.

To add a new plugin: define `MyPluginConfig` with `type: '<pluginId>'` and add it to the union. No changes to `ServerConfig` are required.

```ts
/**
 * Discriminated union of all plugin-specific config blocks.
 * ServerConfig only ever references this union — never a concrete member type.
 */
type PluginConfig = TomcatPluginConfig; // | JettyPluginConfig | WildflyPluginConfig | ...

/** Tomcat-specific options. Used when ServerConfig.type === 'tomcat'. */
interface TomcatPluginConfig {
  type: 'tomcat';
  shutdownPort: number;              // Default: 8005 — Tomcat SHUTDOWN command port (no generic equivalent)
  disableAjp: boolean;               // Default: true — remove AJP connector from server.xml on instancePath init
}
```

`[NOTE]` Each plugin translates `homePath` and `instancePath` to its own environment variables (e.g. `CATALINA_HOME`/`CATALINA_BASE` for Tomcat, `JETTY_HOME`/`JETTY_BASE` for Jetty).

### 3.6 DeploymentConfig

`[REQUIREMENT]`

```ts
interface DeploymentConfig {
  id: DeploymentId;
  type: DeploymentType;              // 'war' | 'exploded'
  sourcePath: string;                // Absolute or workspace-relative
  deployName: string;                // Target name in webapps/ AND display name (e.g. 'myapp')
  syncMode: SyncMode;               // Default: 'auto' for exploded, 'manual' for war
  ignoreGlobs: string[];             // Per-deployment ignore patterns (merged with server-level autosync.ignoreGlobs)
  hooks: HookConfig[];               // Deployment-level hooks
}
```

`[REQUIREMENT]` **AutoSync hierarchy:** `ServerConfig.autosync.enabled` is the master switch. If `false`, all deployments behave as `syncMode: 'off'` regardless of their individual `syncMode`. If `true`, each deployment's `syncMode` determines its behavior. Ignore globs are merged: `server.autosync.ignoreGlobs ∪ deployment.ignoreGlobs`.

`[REQUIREMENT]` **Hook execution order:** For the same `phase` + `event`, server-level hooks (`ServerConfig.hooks`) run first, then deployment-level hooks (`DeploymentConfig.hooks`). Within each level, hooks execute in array order.

### 3.7 Runtime State Types (In-Memory, Not Primary Config)

`[REQUIREMENT]` Runtime state is derived and recoverable. It is never the source of truth for configuration.

```ts
interface ServerRuntimeState {
  serverId: ServerId;
  state: ServerState;
  pid?: number;
  lastTransitionAt: number;          // Epoch ms
  lastError?: JsmError;
  lastStartMode?: StartMode;
}

interface DeploymentRuntimeState {
  serverId: ServerId;
  deploymentId: DeploymentId;
  state: DeploymentState;
  lastSyncAt?: number;               // Epoch ms
  lastError?: JsmError;
}
```

### 3.8 HookConfig

`[REQUIREMENT]`

```ts
type HookPhase = 'pre' | 'post' | 'onError';
type HookEvent =
  | 'lifecycle.start'
  | 'lifecycle.stop'
  | 'lifecycle.restart'
  | 'deploy.full'
  | 'deploy.incremental'
  | 'deploy.undeploy';
type HookKind = 'command' | 'vscodeTask';

interface HookConfig {
  id: string;
  enabled: boolean;
  phase: HookPhase;
  event: HookEvent;
  kind: HookKind;
  timeoutMs: number;                 // Default: 60_000
  continueOnError: boolean;          // Default: false

  command?: {
    exe: string;                     // Absolute or PATH-resolved
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
  };

  vscodeTask?: {
    taskName: string;
  };
}
```

### 3.9 Template

`[REQUIREMENT]`

```ts
interface ServerTemplate {
  id: TemplateId;
  name: string;
  pluginType: ServerType;            // Literal type, not bare string
  serverDefaults: Partial<Omit<ServerConfig, 'id' | 'deployments' | 'hooks'>>;  // No id, no deployments, no hooks in template defaults
  deploymentDefaults: Partial<Omit<DeploymentConfig, 'id'>>[];
  hookDefaults: HookConfig[];        // Sole source of template hook defaults (not duplicated in serverDefaults)
  description?: string;
}
```

### 3.10 Persistence Wrapper Types

`[REQUIREMENT]` These types wrap persisted stores. They are NOT duplications of domain types — they represent the on-disk format.

```ts
interface WorkspaceConfig {
  schemaVersion: number;             // Currently: 1
  servers: ServerConfig[];
}

interface RuntimeEntry {
  id: string;                        // Stable runtime ID (referenced by ServerConfig.runtime.id)
  type: ServerType;
  homePath: string;                  // Absolute path
  version?: string;                  // Cached detection result
  detectedAt: number;                // Epoch ms
}

interface GlobalRuntimeRegistry {
  schemaVersion: number;
  runtimes: RuntimeEntry[];
}

interface GlobalTemplateStore {
  schemaVersion: number;
  templates: ServerTemplate[];
}
```

### 3.11 Infrastructure Interfaces (Core-Defined, Infra-Implemented)

`[REQUIREMENT]` These interfaces live in `core/types/` and are implemented in `infra/` or `ui/adapters/`. They exist so that `core/` and `app/` never depend on vscode or Node directly.

```ts
/** Token checked by operations at cancellation checkpoints. */
interface CancellationToken {
  readonly isCancelled: boolean;
  onCancelled(callback: () => void): Disposable;
}

/** Sink for structured log output. Implemented by OutputSinkAdapter (ui/adapters). */
interface OutputSink {
  append(text: string): void;
  appendLine(text: string): void;
  clear(): void;
}

/** Sink for operation progress messages. */
interface ProgressSink {
  report(message: string): void;
}

/** Debug session management. Implemented by ui/adapters/DebugAdapter. Injected into ServerLifecycle. */
interface DebugAttacher {
  attach(config: { port: number; name: string; bind: string }): Promise<Result<void, JsmError>>;
  detach(serverId: ServerId): Promise<void>;
}

/** Key-value store abstraction. Implemented by ui/adapters wrapping vscode.Memento. */
interface KeyValueStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}
```

### 3.12 Typed Event Map

`[REQUIREMENT]` The `EventMap` defines every event the system can emit, with typed payloads. The `EventBus` is generic over this map — `emit()` and `on()` are type-checked.

`[REQUIREMENT]` **EventBus delivery semantics:** `emit()` is synchronous. Each subscriber is invoked in registration order, wrapped in a try/catch. Subscriber errors are logged via Logger but never propagated to the emitter or other subscribers. This guarantees: (1) the emitter is never broken by a failing subscriber, (2) all subscribers always run.

```ts
interface EventMap {
  // Config lifecycle
  ServerAdded:            { serverId: ServerId };
  ServerUpdated:          { serverId: ServerId };
  ServerDeleted:          { serverId: ServerId };
  // Server runtime
  ServerStateChanged:     { serverId: ServerId; state: ServerState; prevState: ServerState };
  // Deployment config
  DeploymentAdded:        { serverId: ServerId; deploymentId: DeploymentId };
  DeploymentUpdated:      { serverId: ServerId; deploymentId: DeploymentId };
  DeploymentRemoved:      { serverId: ServerId; deploymentId: DeploymentId };
  // Deployment runtime
  DeploymentStateChanged: { serverId: ServerId; deploymentId: DeploymentId; state: DeploymentState };
  // Operations
  OperationStarted:       { serverId: ServerId; operationId: OperationId; kind: OperationKind };
  OperationCompleted:     { serverId: ServerId; operationId: OperationId; kind: OperationKind };
  OperationFailed:        { serverId: ServerId; operationId: OperationId; kind: OperationKind; error: JsmError };
  // Workspace
  WorkspaceLoaded:        { serverCount: number };
  ConfigChanged:          { source: 'user' | 'migration' | 'wizard' | 'external' };
  // File watching (bridge from ui/adapters/FileWatcherAdapter to app/sync/AutoSyncService)
  FileChanged:            { serverId: ServerId; deploymentId: DeploymentId; batch: FileChangeBatch };
}

type EventKey = keyof EventMap;
```

### 3.13 Webview Message Protocol

`[REQUIREMENT]` Typed discriminated unions for all webview ↔ extension messages. No `any`. Both host and client import these types.

```ts
/** Protocol version — increment when message shapes change in a breaking way. */
const WEBVIEW_PROTOCOL_VERSION = 1;

/** Messages FROM webview TO extension host */
type WebviewToHost =
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'ready' }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'submit'; data: Record<string, unknown> }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'validate'; data: Record<string, unknown> }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'validateField'; field: string; value: unknown }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'browse'; field: string; kind: 'file' | 'directory'; filters?: Record<string, string[]> }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'cancel' }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'loadData'; id?: string }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'requestDefaults'; pluginType: ServerType };

/** Messages FROM extension host TO webview */
type HostToWebview =
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'init'; formId: string; mode: 'create' | 'edit'; data?: Record<string, unknown>; schema: FormSchema }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'loaded'; data: Record<string, unknown> }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'validationErrors'; errors: FieldError[] }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'fieldValidationResult'; field: string; error?: string }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'browsed'; field: string; path: string }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'defaults'; data: Record<string, unknown> }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'error'; message: string; details?: string };

`[REQUIREMENT]` Both host and client MUST check the `v` field on incoming messages. Messages with an unknown or missing `v` are logged as warnings and silently discarded (no crash, no error notification).

interface FieldError {
  field: string;
  message: string;
  suggestedFix?: string;
}
```

### 3.14 Form Schema (Declarative Form Definitions)

`[REQUIREMENT]` Forms are described declaratively. The host sends a `FormSchema` to the webview, which renders it generically. Adding a field = adding a `FormFieldDef`, not editing HTML.

```ts
interface FormSchema {
  title: string;
  sections: FormSection[];
}

interface FormSection {
  id: string;
  title?: string;
  collapsible?: boolean;             // Default: false
  fields: FormFieldDef[];
}

interface FormFieldDef {
  name: string;                      // Maps to data key
  label: string;
  type: 'text' | 'number' | 'path' | 'select' | 'checkbox' | 'textarea' | 'tags' | 'port';
  required?: boolean;
  defaultValue?: unknown;
  placeholder?: string;
  helpText?: string;
  readOnly?: boolean;
  options?: { value: string; label: string }[];   // For 'select' type
  browse?: { kind: 'file' | 'directory'; filters?: Record<string, string[]> };  // For 'path' type
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    patternMessage?: string;         // Human-readable regex explanation
  };
  visibleWhen?: { field: string; equals: unknown };  // Conditional visibility
}
```

---

## 4. Persistence and Storage

### 4.1 Canonical File Paths

`[REQUIREMENT]`

| Store | Path | Scope |
|---|---|---|
| Workspace server config | `.vscode/jsm.servers.json` | Workspace |
| Global runtime registry | `${globalStoragePath}/jsm.runtimes.json` | User global |
| Global templates | `${globalStoragePath}/jsm.templates.json` | User global |
| Workspace templates (optional) | `.vscode/jsm.templates.json` | Workspace |
| Deployment runtime state | Extension storage (not file-based) | Extension |

### 4.2 Workspace Config Schema

`[REQUIREMENT]`

```json
{
  "schemaVersion": 1,
  "servers": [
    {
      "id": "abc123-...",
      "name": "Dev Tomcat",
      "type": "tomcat",
      "runtime": {
        "id": "rt-xyz",
        "homePath": "/opt/apache-tomcat-10.1",
        "version": "10.1.18"
      },
      "instancePath": "${workspaceFolder}/.jsm/tomcat-bases/abc123",
      "javaHome": "/opt/jdk-17",
      "host": "127.0.0.1",
      "ports": { "http": 8080, "debug": 5005 },
      "run": { "env": {}, "vmArgs": [] },
      "debug": { "enabled": true, "bind": "127.0.0.1", "attachDelayMs": 1000 },
      "deployments": [],
      "autosync": {
        "enabled": true,
        "debounceMs": 400,
        "maxBatchFiles": 200,
        "maxBatchBytes": 20000000,
        "stormBackoffMs": 2000,
        "ignoreGlobs": []
      },
      "hooks": [],
      "pluginConfig": { "type": "tomcat", "shutdownPort": 8005, "disableAjp": true }
    }
  ]
}
```

### 4.3 Global Runtime Registry Schema

`[REQUIREMENT]`

```json
{
  "schemaVersion": 1,
  "runtimes": [
    {
      "id": "rt-xyz",
      "type": "tomcat",
      "homePath": "/opt/apache-tomcat-10.1",
      "version": "10.1.18",
      "detectedAt": 1703347200000
    }
  ]
}
```

### 4.4 Schema Versioning

`[REQUIREMENT]`

| Store | Current schemaVersion |
|---|---|
| Workspace config | 1 |
| Global runtimes | 1 |
| Global templates | 1 |

- The `schemaVersion` field is an integer at the root of each store.
- Future schema changes require a migration function `migrate_N_to_N+1()` that is pure and deterministic.
- Unknown fields are preserved under `x-extra` at the top level (optional, for forward compat).

`[REQUIREMENT]` The JSON validation schema (`jsm.server.schema.json`) MUST mirror §3.5 `ServerConfig` and §3.6 `DeploymentConfig` exactly. Required fields, types, nested object structures, defaults, `minimum`/`maximum` constraints, and `pattern` rules must all match the TypeScript definitions. The current schema file is outdated and MUST be rewritten from scratch during implementation.

### 4.5 Atomic Writes

`[REQUIREMENT]` All config writes use the atomic write pattern:

1. Write to `<path>.tmp.<timestamp>`.
2. On POSIX: `rename()` (atomic overwrite).
3. On Windows (backup-first strategy):
   a. If `<path>` exists, rename it to `<path>.bak.<timestamp>`.
   b. Rename `<path>.tmp.<timestamp>` → `<path>` with retry/backoff (max 3 attempts; backoffs 100ms, 500ms, 1000ms).
   c. On success: delete `.bak` file.
   d. On failure: restore `.bak` → `<path>`, then clean up temp file.
4. On failure (any platform): clean up temp file. On Windows, the `.bak` file guarantees the original is never lost.
5. On total failure (all retries exhausted on any platform): return `err(ConfigWriteFailed)` with platform-specific details. The caller MUST surface the error to the user via a notification with "Retry" and "Copy Diagnostics" actions.

### 4.6 Deployment Runtime State

`[REQUIREMENT]` Deployment runtime state (`DeploymentRuntimeState`) is persisted via VS Code extension storage (`ExtensionContext.workspaceState`) and is recoverable from disk state. It is not stored in the workspace config file.

### 4.7 Schema Migration (Legacy → v1)

`[REQUIREMENT]` On workspace load, if `ConfigRepo` encounters a config file without `schemaVersion` (or with `schemaVersion: 0`), it MUST run the v0→v1 migration before any other operation.

**Migration function:** `migrateV0toV1(legacyData: unknown): Result<WorkspaceConfig, JsmError>`

This function is **pure** (no side effects, no FS access) and lives in `core/policy/ConfigNormalizer.ts`.

#### V0 → V1 Field Mapping

| Legacy (v0 — current code) | Target (v1 — this spec) | Transformation |
|---|---|---|
| `serverHome` / `homePath` | `runtime.homePath` | Move into `runtime` block. Generate `runtime.id` as UUID if missing. |
| `port` (single number) | `ports.http` | Wrap in `ports {}` block. Set `ports.debug` to default `5005`. |
| `vmArgs` (string) | `run.vmArgs` (string[]) | Split by whitespace respecting quoting: `shellSplit(str)`. |
| `autoSync` (boolean) | no direct field | `true` → `autosync.enabled: true`; `false` → `autosync.enabled: false`. Fill remaining autosync sub-fields with defaults. |
| `preStartCmd` / `postStopCmd` | `hooks[]` | Convert to `HookConfig[]`: `preStartCmd` → `{ phase: 'pre', event: 'lifecycle.start', kind: 'command', enabled: false, command: { exe: ... } }`. Same pattern for `postStopCmd` → `phase: 'post', event: 'lifecycle.stop'`. Migrated hooks are `enabled: false` by default — the user must review and enable them explicitly. A notification lists migrated hooks after migration. |
| (absent) `instancePath` | `instancePath` | Generate: `${workspaceFolder}/.jsm/tomcat-bases/${serverId}/`. Do NOT create the directory during migration — defer to first start. |
| (absent) `type` | `type` | Default: `'tomcat'` |
| (absent) `schemaVersion` | `schemaVersion: 1` | Set at root |
| (absent) `debug` | `debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 }` | Apply defaults |
| (absent) `run.env` | `run: { env: {}, vmArgs: [...], cwd: undefined }` | Apply defaults, merge migrated vmArgs |
| (absent) `pluginConfig` | `pluginConfig: { type: 'tomcat', shutdownPort: 8005, disableAjp: true }` | Apply Tomcat defaults |

#### Migration Contract

`[REQUIREMENT]` Rules:

1. Migration is **non-destructive**: the original file is backed up to `.vscode/jsm.servers.json.v0-backup.<timestamp>` before overwrite. The `<timestamp>` is `Date.now()` (milliseconds since epoch), ensuring uniqueness and sortability.
2. Migration is **idempotent**: running it twice on the same input produces the same output.
3. Unknown fields are preserved under `x-extra` at the top level.
4. If migration fails (malformed input), return `err(MigrationFailed)` with details. The extension MUST surface a notification with the error and a "Copy Diagnostics" button.
5. After successful migration, the file is written atomically (§4.5) with `schemaVersion: 1`.

---

## 5. Architecture and Layers

### 5.1 Layering Rules

`[REQUIREMENT]` Strict dependency direction; no reverse imports.

```
┌─────────────────────────────┐
│          UI Layer            │  imports: vscode, app
│  commands, tree, webviews    │
├─────────────────────────────┤
│          App Layer           │  imports: core, infra, plugins
│  use-cases, services         │
├─────────────────────────────┤
│         Core Layer           │  imports: NOTHING external
│  domain, errors, events,     │  (no vscode, no Node FS)
│  fsm, ops, policy            │
├─────────────────────────────┤
│        Infra Layer           │  imports: core
│  fs, process, ports,         │  (no vscode)
│  storage adapters            │
├─────────────────────────────┤
│       Plugins Layer          │  imports: core, infra
│  IServerPlugin impls         │  (no vscode)
└─────────────────────────────┘
```

`[REQUIREMENT]` Key rule: `core/*` MUST NOT import `vscode` or any Node built-in that ties it to a specific runtime. Infrastructure concerns (file I/O, process spawning, network probing) are injected via interfaces defined in `core/` and implemented in `infra/`.

### 5.2 Folder Structure

`[REQUIREMENT]` This is the definitive folder layout. Every file listed here MUST exist in the final implementation.

```
src/
├── core/                              # Pure domain — ZERO external imports (no vscode, no Node FS)
│   ├── types/
│   │   ├── domain.ts                  # ServerConfig, DeploymentConfig, HookConfig, Template, PluginConfig
│   │   ├── runtime.ts                 # ServerRuntimeState, DeploymentRuntimeState, OperationContext
│   │   ├── events.ts                  # EventMap, EventKey, typed event payload interfaces
│   │   └── disposable.ts             # Disposable interface (replaces vscode.Disposable)
│   ├── errors/
│   │   ├── codes.ts                   # ErrorCode enum with retryability matrix
│   │   └── JsmError.ts               # Error class with code, severity, suggestedFix
│   ├── events/
│   │   └── EventBus.ts               # Pure typed pub-sub — no vscode imports
│   ├── result/
│   │   └── index.ts                   # Result<T,E>, ok(), err(), map(), mapErr(), andThen(), fromPromise()
│   ├── ops/
│   │   └── OperationQueue.ts         # Per-server FIFO, coalescing, cancellation, priority
│   ├── policy/
│   │   ├── DecisionEngine.ts         # Pure sync strategy, stop escalation, readiness policy
│   │   └── ConfigNormalizer.ts       # Defaults, validation, normalization — pure functions
│   └── validation/
│       └── SchemaValidator.ts         # JSON Schema validation via AJV (pure, no vscode)
│
├── app/                               # Use-case orchestration — imports core + infra interfaces + plugins
│   ├── server/
│   │   ├── ServerLifecycle.ts         # start/stop/restart with hooks, queue, debug attach coordination
│   │   └── ServerRuntime.ts           # Per-server state machine (FSM transitions, pid tracking)
│   ├── config/
│   │   └── ConfigService.ts           # Server CRUD + validation + event emission
│   ├── deployment/
│   │   └── DeploymentService.ts       # add/remove/sync/undeploy with DecisionEngine
│   ├── hooks/
│   │   └── HookRunner.ts             # Config-driven hook execution (shell commands + vscode tasks)
│   ├── sync/
│   │   └── AutoSyncService.ts        # File watcher coordination + debounced sync enqueue
│   ├── templates/
│   │   └── TemplateService.ts         # Template CRUD with persistence
│   └── diagnostics/
│       └── DiagnosticsService.ts      # Bundle generation, redaction, clipboard
│
├── plugins/                           # Server implementations — imports core + infra, NO vscode
│   ├── interfaces/
│   │   └── IServerPlugin.ts           # Plugin contract (§6.2)
│   ├── registry/
│   │   └── PluginRegistry.ts          # type → plugin factory mapping
│   └── tomcat/
│       └── TomcatPlugin.ts            # Full Tomcat lifecycle, deploy, instancePath init, log sources
│
├── infra/                             # Platform adapters — may import Node built-ins, NO vscode
│   ├── fs/
│   │   ├── FileUtils.ts              # Cross-platform file ops, atomic writes
│   │   ├── ConfigRepo.ts             # .vscode/jsm.servers.json read/write with Map cache
│   │   └── DeploymentStateRepo.ts    # Extension storage persistence for deployment state
│   ├── process/
│   │   └── ProcessSpawner.ts          # spawn() wrapper, cross-platform, shell:false enforcement
│   ├── ports/
│   │   └── PortScanner.ts            # TCP probe, free-port suggestion, conflict detection
│   ├── logging/
│   │   └── Logger.ts                  # Structured logger with ring buffer (no vscode — receives OutputSink)
│   └── pid/
│       └── PidManager.ts             # PID file read/write/cleanup for crash recovery
│
├── ui/                                # VS Code presentation — the ONLY layer that imports vscode
│   ├── commands/
│   │   ├── index.ts                   # Re-exports register functions
│   │   ├── server-commands.ts         # Server lifecycle + CRUD commands
│   │   ├── deployment-commands.ts     # Deployment CRUD + sync commands
│   │   ├── template-commands.ts       # Template management commands
│   │   └── shared.ts                  # showErr, showSuccess, validateNode, registerMany
│   ├── tree/
│   │   ├── ServerTreeViewProvider.ts  # TreeDataProvider + ServerNode + DeploymentNode
│   │   └── constants.ts              # Context values, state mappings, tree view IDs
│   ├── webviews/
│   │   ├── panels/                    # HOST SIDE — runs in extension process
│   │   │   ├── BaseFormPanel.ts       # Abstract panel: lifecycle, CSP+nonce, message routing, dispose
│   │   │   ├── ServerFormPanel.ts     # Server-specific host logic (validation, browse, load/save)
│   │   │   └── DeploymentFormPanel.ts # Deployment-specific host logic
│   │   └── client/                    # CLIENT SIDE — compiled separately, runs in webview iframe
│   │       ├── index.ts               # Entry point: router, init, bridge setup
│   │       ├── bridge.ts              # Typed postMessage wrapper (WebviewToHost / HostToWebview)
│   │       ├── renderer.ts            # Schema-driven form renderer (FormSchema → DOM)
│   │       ├── components/            # Reusable UI primitives (vanilla TS, swappable with React/Svelte)
│   │       │   ├── form-field.ts      # Input + label + error + help text
│   │       │   ├── path-picker.ts     # Browse button + path display
│   │       │   ├── port-input.ts      # Number input + free port suggestion
│   │       │   ├── tag-list.ts        # Tag editor (vmArgs, ignoreGlobs)
│   │       │   └── section.ts         # Collapsible section wrapper
│   │       ├── views/                 # Page-level compositions
│   │       │   ├── server-form.ts     # Overrides/extensions for server form
│   │       │   └── deployment-form.ts # Overrides/extensions for deployment form
│   │       └── styles/
│   │           └── base.css           # Shared styles using VS Code CSS variables
│   ├── channels/
│   │   └── ServerLogChannel.ts        # Per-server OutputChannel with live log tailing
│   └── adapters/
│       ├── DebugAdapter.ts            # vscode.debug attach/detach + launch config (implements DebugAttacher)
│       ├── OutputSinkAdapter.ts       # Bridges Logger to vscode OutputChannel
│       ├── MementoAdapter.ts          # Bridges vscode.Memento to KeyValueStore interface
│       └── FileWatcherAdapter.ts      # Bridges vscode.workspace.createFileSystemWatcher → FileChanged events
│
├── constants.ts                       # Global constants (filenames, channel names, debounce values)
└── extension.ts                       # Composition root ONLY — all DI wiring, zero business logic
```

### 5.3 Layer Dependency Matrix

`[REQUIREMENT]` Allowed and forbidden imports per layer:

| Layer | Can Import | MUST NOT Import |
|---|---|---|
| `core/` | Nothing external | `vscode`, `fs`, `path`, `child_process`, `net`, any npm package except `ajv` (for SchemaValidator) |
| `app/` | `core/`, `infra/` (via interfaces), `plugins/` (via interfaces) | `vscode` |
| `plugins/` | `core/`, `infra/` (via interfaces) | `vscode` |
| `infra/` | `core/`, Node built-ins (`fs`, `path`, `net`, `child_process`), npm packages (`chokidar`, `ajv`) | `vscode` |
| `ui/` | `core/`, `app/`, `infra/`, `plugins/`, `vscode` | — |
| `extension.ts` | Everything | — (composition root) |

`[REQUIREMENT]` Enforcement: a lint rule or CI check MUST flag any `import ... from 'vscode'` in `core/`, `app/`, `plugins/`, or `infra/`.

### 5.4 Dependency Injection

`[REQUIREMENT]` All dependencies are injected via constructors. No singletons (`getInstance()`) anywhere except Logger (cross-cutting; acceptable as a lightweight singleton initialized once at activation).

`extension.ts` is the **composition root**: it creates all instances in dependency order and wires them together. No class instantiates its own dependencies.

```ts
// extension.ts — composition root (pseudo-code)
export async function activate(ctx: ExtensionContext) {
  // 1. Infra layer
  const outputSink = new OutputSinkAdapter(window.createOutputChannel('JSM', { log: true }));
  const logger = Logger.initialize(outputSink);
  const configRepo = new ConfigRepo(workspacePath, logger);
  const mementoAdapter = new MementoAdapter(ctx.workspaceState);
  const stateRepo = new DeploymentStateRepo(mementoAdapter, logger);
  const processSpawner = new ProcessSpawner(logger);
  const portScanner = new PortScanner();
  const pidManager = new PidManager(workspacePath, logger);
  const fileUtils = new FileUtils(ctx.globalStorageUri.fsPath);
  const trustGate = { isTrusted: () => vscode.workspace.isTrusted };

  // 2. Core layer
  const eventBus = new EventBus();
  const opQueueFactory = (serverId: string) => new OperationQueue(serverId, eventBus);
  const decisionEngine = new DecisionEngine();
  const validator = new SchemaValidator();

  // 3. Plugins layer
  const pluginRegistry = new PluginRegistry();
  pluginRegistry.register('tomcat', () => new TomcatPlugin(processSpawner, portScanner, logger));

  // 4. UI adapters (needed by app layer — must be created before app services)
  const debugAdapter = new DebugAdapter();      // Implements DebugAttacher
  const fileWatcher = new FileWatcherAdapter(eventBus, logger);

  // 5. App layer
  const hookRunner = new HookRunner(processSpawner, eventBus, logger);
  const configService = new ConfigService(configRepo, validator, eventBus, logger);
  const serverLifecycle = new ServerLifecycle(configService, pluginRegistry, opQueueFactory, hookRunner, eventBus, pidManager, debugAdapter, trustGate, logger);
  const deployService = new DeploymentService(configService, pluginRegistry, stateRepo, decisionEngine, hookRunner, eventBus, trustGate, logger);
  const autoSyncService = new AutoSyncService(deployService, eventBus, trustGate, logger);
  const templateService = new TemplateService(fileUtils, logger);
  const diagnosticsService = new DiagnosticsService(configService, serverLifecycle, stateRepo, logger);

  // 6. UI presentation
  const logChannel = new ServerLogChannel(logger);
  const treeProv = new ServerTreeViewProvider(configService, serverLifecycle, deployService, autoSyncService, eventBus);

  // 7. Commands
  registerServerCommands(ctx, serverLifecycle, configService, deployService, logChannel, debugAdapter);
  registerDeploymentCommands(ctx, deployService, autoSyncService);
  registerTemplateCommands(ctx, templateService, configService);

  // 8. Event wiring
  eventBus.on('ServerStateChanged', ({ serverId, state }) => { /* log channel attach/detach */ });

  // 9. Load workspace
  await configService.loadWorkspace();
  // Deferred reconciliation — does not block activation (§9.9)
  serverLifecycle.reconcileRunningServers().catch(err => logger.error('Reconciliation failed', err));
}
```

### 5.5 Module Inventory

`[REQUIREMENT]` Every module's public API and responsibility.

#### Core Layer (`core/`)

| Module | Responsibility | Public API (key exports) |
|---|---|---|
| `types/domain.ts` | Canonical config types | `ServerConfig`, `DeploymentConfig`, `HookConfig`, `ServerTemplate`, `PluginConfig`, `TomcatPluginConfig`, ID types, enums |
| `types/runtime.ts` | Runtime state + operation context | `ServerRuntimeState`, `DeploymentRuntimeState`, `OperationContext`, `OperationKind`, `StartMode`, `ProgressSink`, `DebugAttacher`, `KeyValueStore` |
| `types/events.ts` | Typed event map | `EventMap`, `EventKey`, all payload interfaces |
| `types/disposable.ts` | Disposable interface (no vscode) | `Disposable` |
| `errors/codes.ts` | Error code enum + retryability matrix | `ErrorCode`, `isRetryable(code)`, `defaultSeverity(code)` |
| `errors/JsmError.ts` | Domain error class | `JsmError`, `createError(code, msg, opts?)` |
| `events/EventBus.ts` | Typed pub-sub (pure) | `EventBus`, `on()`, `off()`, `emit()`, `dispose()` |
| `result/index.ts` | Result monad | `Result<T,E>`, `ok()`, `err()`, `map()`, `mapErr()`, `andThen()`, `fromPromise()` |
| `ops/OperationQueue.ts` | Per-server priority-FIFO with coalescing/cancellation | `OperationQueue`, `enqueue(kind, opts?)`, `cancel(operationId)`, `cancelAll()` |
| `policy/DecisionEngine.ts` | Pure sync/stop strategy functions | `decideSyncStrategy()`, `decideStopEscalation()`, `decideReadiness()` |

`[REQUIREMENT]` **DecisionEngine decision tables:**

**`decideStopEscalation(elapsedMs: number, gracefulTimeoutMs: number): 'wait' | 'force-kill'`**
- If `elapsedMs >= gracefulTimeoutMs` → `'force-kill'`
- Otherwise → `'wait'`

**`decideReadiness(probeResult: { portOpen: boolean; elapsed: number; timeoutMs: number }): 'ready' | 'retry' | 'timeout'`**
- If `probeResult.portOpen` → `'ready'`
- If `probeResult.elapsed >= probeResult.timeoutMs` → `'timeout'`
- Otherwise → `'retry'`

Readiness probe: TCP connect to `ports.http` on `host`. Probe interval: 250ms (§9.6).
| `policy/ConfigNormalizer.ts` | Defaults, normalization, migration | `normalizeConfig()`, `migrateV0toV1()`, `applyDefaults()` |
| `validation/SchemaValidator.ts` | JSON schema validation (AJV) | `SchemaValidator`, `validate(data, schemaId)` |

`[REQUIREMENT]` **AJV compile-once:** `SchemaValidator` MUST compile each JSON schema once during initialization and cache the compiled validator functions. Subsequent calls to `validate()` reuse the cached validators.

#### App Layer (`app/`)

| Module | Responsibility | Public API (key exports) |
|---|---|---|
| `server/ServerLifecycle.ts` | Start/stop/restart orchestration with hooks, queue, debug | `ServerLifecycle`, `start()`, `stop()`, `restart()`, `cancel()`, `reconcileRunningServers()` |
| `server/ServerRuntime.ts` | Per-server FSM state machine | `ServerRuntime`, `transition()`, `getState()`, `reset()` |
| `config/ConfigService.ts` | Server CRUD + validation + events | `ConfigService`, `loadWorkspace()`, `addServer()`, `updateServer()`, `removeServer()`, `getServer()`, `getAllServers()` |
| `deployment/DeploymentService.ts` | Deploy orchestration with DecisionEngine | `DeploymentService`, `sync()`, `fullRedeploy()`, `undeploy()`, `addDeployment()`, `removeDeployment()` |
| `hooks/HookRunner.ts` | Config-driven hook execution | `HookRunner`, `runHooks(phase, event, ctx)` |
| `sync/AutoSyncService.ts` | File watcher coordination + enqueue | `AutoSyncService`, `enable()`, `disable()`, `disposeAll()` |
| `templates/TemplateService.ts` | Template CRUD | `TemplateService`, `list()`, `get()`, `create()`, `update()`, `delete()`, `applyToConfig()` |
| `diagnostics/DiagnosticsService.ts` | Bundle generation + redaction | `DiagnosticsService`, `generateBundle(serverId?)`, `copyToClipboard(bundle)` |

#### Plugins Layer (`plugins/`)

| Module | Responsibility | Public API (key exports) |
|---|---|---|
| `interfaces/IServerPlugin.ts` | Plugin contract | `IServerPlugin`, `PluginCapabilities`, report types |
| `registry/PluginRegistry.ts` | Type → factory mapping | `PluginRegistry`, `register()`, `get()`, `has()`, `getSupportedTypes()`, `detectServerType()` |
| `tomcat/TomcatPlugin.ts` | Tomcat lifecycle, deploy, instance init | `TomcatPlugin` (implements `IServerPlugin`) |

#### Infra Layer (`infra/`)

| Module | Responsibility | Public API (key exports) |
|---|---|---|
| `fs/FileUtils.ts` | Cross-platform file ops, atomic writes | `FileUtils`, `atomicWrite()`, `copyDir()`, `ensureDir()`, `exists()` |
| `fs/ConfigRepo.ts` | `.vscode/jsm.servers.json` read/write | `ConfigRepo`, `load()`, `save()`, `watch()` |

`[REQUIREMENT]` **ConfigRepo write serialization:** All writes to the shared config file are serialized through a single internal write queue in `ConfigRepo`. This prevents concurrent per-server operations from racing on the same file. `ConfigRepo.watch()` detects external file changes (e.g. user edits in VS Code editor) and emits `ConfigChanged { source: 'external' }` via EventBus.

| `fs/DeploymentStateRepo.ts` | Extension storage persistence | `DeploymentStateRepo`, `getState()`, `setState()`, `clearState()` |

`[REQUIREMENT]` `DeploymentStateRepo` depends on the `KeyValueStore` interface (§3.11), NOT directly on `vscode.Memento`. The `KeyValueStore` implementation wrapping `ExtensionContext.workspaceState` lives in `ui/adapters/MementoAdapter.ts` and is injected at composition root.

| `process/ProcessSpawner.ts` | spawn() wrapper, shell:false | `ProcessSpawner`, `spawn()`, `kill()`, `isRunning()` |
| `ports/PortScanner.ts` | TCP probe + free port | `PortScanner`, `isPortFree()`, `findFreePort()` |
| `logging/Logger.ts` | Structured logger with ring buffer | `Logger`, `debug()`, `info()`, `warn()`, `error()`, `getRingBuffer()` |
| `pid/PidManager.ts` | PID file operations | `PidManager`, `writePid()`, `readPid()`, `clearPid()`, `isProcessAlive()` |

#### UI Layer (`ui/`)

| Module | Responsibility | Public API (key exports) |
|---|---|---|
| `commands/index.ts` | Re-exports register functions | `registerServerCommands()`, `registerDeploymentCommands()`, `registerTemplateCommands()` |
| `commands/server-commands.ts` | Server lifecycle + CRUD commands | (internal handlers) |
| `commands/deployment-commands.ts` | Deployment CRUD + sync commands | (internal handlers) |
| `commands/template-commands.ts` | Template management commands | (internal handlers) |
| `commands/shared.ts` | Common command utilities | `showErr()`, `showSuccess()`, `validateNode()`, `registerMany()` |
| `tree/ServerTreeViewProvider.ts` | Tree data + nodes | `ServerTreeViewProvider`, `ServerNode`, `DeploymentNode` |
| `tree/constants.ts` | Context values, tree IDs | `CONTEXT_VALUES`, `VIEW_ID` |
| `webviews/panels/BaseFormPanel.ts` | Abstract panel: lifecycle, CSP+nonce, message routing, dispose | `BaseFormPanel` |
| `webviews/panels/ServerFormPanel.ts` | Server create/edit host logic | `ServerFormPanel` |
| `webviews/panels/DeploymentFormPanel.ts` | Deployment host logic | `DeploymentFormPanel` |
| `webviews/client/index.ts` | Webview entry point: init, bridge setup | (self-contained) |
| `webviews/client/bridge.ts` | Typed postMessage wrapper | `postToHost()`, `onHostMessage()` |
| `webviews/client/renderer.ts` | Schema-driven form renderer | `renderForm(schema)` |
| `channels/ServerLogChannel.ts` | Per-server output channel | `ServerLogChannel`, `attach()`, `detach()`, `showLogs()` |
| `adapters/DebugAdapter.ts` | Debug session management (implements `DebugAttacher`) | `DebugAdapter`, `attach()`, `detach()` |
| `adapters/OutputSinkAdapter.ts` | Logger → OutputChannel bridge | `OutputSinkAdapter` |
| `adapters/MementoAdapter.ts` | vscode.Memento → KeyValueStore bridge | `MementoAdapter` |
| `adapters/FileWatcherAdapter.ts` | FS watcher → FileChanged events bridge | `FileWatcherAdapter`, `watch()`, `dispose()` |

---

## 6. Plugin System

### 6.1 PluginCapabilities

`[REQUIREMENT]`

```ts
interface PluginCapabilities {
  supportsDebugAttach: boolean;
  supportsExplodedDeploy: boolean;
  supportsWarDeploy: boolean;
  supportsIncrementalDeploy: boolean;
  supportsLogFollow: boolean;
  supportsAutoDetect: boolean;
  supportsMultipleInstances: boolean;
}
```

### 6.2 IServerPlugin Contract (Final)

`[REQUIREMENT]` This is the definitive plugin interface. All methods receive an `OperationContext` for cancellation and progress reporting.

```ts
interface IServerPlugin {
  readonly type: ServerType;      // Stable ID — literal union, not bare string (see §3.2)
  readonly displayName: string;   // e.g. 'Apache Tomcat'

  getCapabilities(): PluginCapabilities;

  // Detection and validation
  detectInstallation(homePath: string): Promise<Result<DetectReport, JsmError>>;
  validateConfig(config: ServerConfig): Promise<Result<void, JsmError>>;

  // Lifecycle
  start(ctx: OperationContext, config: ServerConfig, mode: StartMode): Promise<Result<StartResult, JsmError>>;
  stop(ctx: OperationContext, config: ServerConfig): Promise<Result<void, JsmError>>;

  // Deploy
  planDeploy(ctx: OperationContext, config: ServerConfig, dep: DeploymentConfig): Promise<Result<DeployPlan, JsmError>>;
  deployFull(ctx: OperationContext, config: ServerConfig, dep: DeploymentConfig, plan: DeployPlan): Promise<Result<DeployResult, JsmError>>;
  deployIncremental?(ctx: OperationContext, config: ServerConfig, dep: DeploymentConfig, changes: FileChangeBatch, plan: DeployPlan): Promise<Result<void, JsmError>>;
  undeploy(ctx: OperationContext, config: ServerConfig, dep: DeploymentConfig): Promise<Result<void, JsmError>>;

  // Status
  getStatus(ctx: OperationContext, config: ServerConfig): Promise<Result<StatusReport, JsmError>>;
  healthCheck?(ctx: OperationContext, config: ServerConfig): Promise<Result<HealthReport, JsmError>>;

  // Logs
  getLogSources(config: ServerConfig): Promise<Result<LogSources, JsmError>>;

  // Defaults and cleanup
  getDefaultConfig(): Partial<ServerConfig>;
  dispose?(): Promise<void>;
}
```

### 6.3 Report Types

`[REQUIREMENT]`

```ts
interface DetectReport {
  ok: boolean;
  version?: string;
  checks: Array<{ id: string; ok: boolean; message: string }>;
  warnings: string[];
}

interface StartResult {
  pid: number;
  httpUrl?: string;
  debugPort?: number;
  hints: string[];
}

interface StatusReport {
  state: ServerState;
  pid?: number;
  httpPort?: number;
  lastError?: JsmError;
}

interface HealthReport {
  ok: boolean;
  latencyMs?: number;
}

interface DeployPlan {
  targetRoot: string;              // Absolute path to webapps/
  targetPath: string;              // Absolute path to deployment target
  strategy: 'copy-war' | 'copy-dir' | 'incremental-dir';
  notes: string[];
}

interface DeployResult {
  strategy: DeployPlan['strategy'];
  deployedPath: string;
  warnings: string[];
}

interface LogSource {
  id: string;
  title: string;
  kind: 'file' | 'process-stdout';
  path?: string;                   // Absolute if kind='file'
}

interface LogSources {
  primary?: LogSource;
  others: LogSource[];
}

interface FileChange {
  type: 'add' | 'change' | 'delete';
  path: string;                    // Absolute path
  relativePath: string;            // Relative to sourcePath
  sizeBytes?: number;
}

interface FileChangeBatch {
  changes: FileChange[];
  totalFiles: number;
  totalBytes: number;
}
```

### 6.4 PluginRegistry

`[REQUIREMENT]` The registry maps `type` string → plugin factory function. It is initialized at activation with the Tomcat plugin.

`[REQUIREMENT]` Future plugins register via the same mechanism. The registry supports `get(type)`, `has(type)`, `getSupportedTypes()`, and `detectServerType(path)` (probes all registered plugins).

### 6.5 Tomcat v1 Capabilities

`[REFERENCE]`

```ts
const TOMCAT_V1_CAPABILITIES: PluginCapabilities = {
  supportsDebugAttach: true,
  supportsExplodedDeploy: true,
  supportsWarDeploy: true,
  supportsIncrementalDeploy: true,
  supportsLogFollow: true,
  supportsAutoDetect: true,
  supportsMultipleInstances: true,
};
```

---

## 7. UX and UI

### 7.1 Tree View Layout

`[REQUIREMENT]` The tree view is titled **Java Server Manager** and registered in the Activity Bar.

```
Java Server Manager
├── Tomcat • <name> • <state>
│   ├── <deploymentName> • <state>
│   └── <deploymentName> • <state>
└── Tomcat • <name> • <state>
    └── ...
```

`[REQUIREMENT]` Rules:

- No log nodes, action nodes, or grouping nodes in the tree.
- Server tooltip: `httpUrl`, `pid`, `runtime version`, `lastTransitionAt`, `lastError.message` (if any).
- Deployment tooltip: `type`, `sourcePath`, `lastSyncAt`, `lastError.message` (if any).
- Click on server item: no-op (avoid accidental actions).
- Click on deployment item: no-op.
- Tree refresh MUST be coalesced: events set a dirty flag, and a single `refresh()` fires via a debounce timer (50–100 ms). This prevents refresh storms during bulk operations (e.g. "Full Redeploy All" emitting 10+ events).

### 7.2 Context Values

`[REQUIREMENT]` Tree items use `contextValue` for `when`-clause matching.

| Item | Context Values |
|---|---|
| Server | `jsm.server.stopped`, `jsm.server.starting`, `jsm.server.running`, `jsm.server.stopping`, `jsm.server.error` |
| Deployment | `jsm.deployment.undeployed`, `jsm.deployment.deploying`, `jsm.deployment.synced`, `jsm.deployment.error` |

### 7.3 Inline Actions (Fast Lane)

`[REQUIREMENT]` Inline actions are hidden (not just disabled) when not meaningful, enforced via `when` clauses.

`[NOTE]` Inline actions appear both as icons on the tree row (on hover) and at the top of the context menu. A separate `lifecycle` group in the context menu is therefore not needed.

#### Server Inline Actions (State-Dependent)

| Server State | Inline Actions (ordered) |
|---|---|
| `stopped` / `error` | Run, Debug |
| `running` | Stop, Restart Run, Restart Debug |
| `starting` / `stopping` | Cancel *(target)* |

#### Deployment Inline Actions

| Order | Action |
|---|---|
| 1 | Sync |

### 7.4 Context Menus

`[REQUIREMENT]`

#### Server Context Menu

`[NOTE]` Lifecycle actions (Run, Debug, Stop, Restart, Cancel) surface at the top of the context menu automatically via the inline mechanism — no separate `lifecycle` group is contributed.

| Group | Commands | Notes |
|---|---|---|
| `deploy` | Sync All Deployments, Full Redeploy All, Add Deployment | |
| `manage` | Edit, Remove | Duplicate, Open Config, Open Home: *target* |
| `troubleshooting` | Open Logs, Refresh Status, Copy Diagnostics | |

#### Deployment Context Menu

`[NOTE]` Sync appears at the top of the context menu via the inline mechanism. The `actions` group contains non-inline actions only.

| Group | Commands | Notes |
|---|---|---|
| `actions` | Full Redeploy, Undeploy | Sync is inline (auto-appears at top) |
| `autosync` | Toggle Autosync | Configure Ignore Globs: *target* |
| `manage` | Edit, Remove | |
| `troubleshooting` | Open Logs | *target* |

#### View Background Context Menu

| Commands |
|---|
| Add Tomcat Server, Refresh |

### 7.5 View Title Actions (Top-Right Toolbar)

`[REQUIREMENT]`

| Order | Command |
|---|---|
| 1 | Add Server |
| 2 | Refresh |
| 3 | Manage Templates |

### 7.6 Empty State

`[REQUIREMENT]` When no servers exist, the tree shows a welcome message with a button to add the first server.

### 7.7 Wizard (Add Server)

`[REQUIREMENT]` The wizard is implemented as a webview form. Steps:

1. **Select Runtime** (`homePath`; for Tomcat: `CATALINA_HOME`): directory picker, validates structure for the selected plugin type, detects version, reuses existing runtime if same path.
2. **Server Name & Ports**: name input, HTTP/Debug ports with auto-suggest for free ports per conflict resolution (8080→8081→…). `instancePath` shown as read-only (auto-created). Advanced toggle: "Use existing instance directory".
3. **Select JAVA_HOME**: auto-detect from `JAVA_HOME` env → common paths → fallback to manual. Validates `bin/java` exists and `java -version` succeeds.
4. **Deployments (optional)**: add deployment entries with type, sourcePath, deployName. `syncMode` defaults: exploded → `auto`, WAR → `manual`.
5. **Summary & Save**: show normalized config preview. Offer post-save actions: Start Run, Start Debug, Open Config.

`[REQUIREMENT]` Wizard validations:

- Every validation error includes a suggested fix.
- Port conflicts block saving with fix suggestion.
- `instancePath` is auto-created at `${workspaceFolder}/.jsm/tomcat-bases/<serverId>/` and seeded from `homePath/conf/` (Tomcat-specific initialization).
- `server.xml` ports are patched via XML parser (not regex). AJP connectors are removed by default (see `TomcatPluginConfig.disableAjp`). The XML parser MUST disable external entity processing and DTD resolution to prevent XXE attacks.

### 7.8 Notifications and Microcopy

`[REQUIREMENT]` No stack traces in notifications. Details go to OutputChannel.

| Event | Message |
|---|---|
| Start | `Starting Tomcat: <name>…` |
| Start success | `Tomcat is running at http://127.0.0.1:<port>` |
| Stop | `Stopping Tomcat: <name>…` |
| Stop escalated | `Stopping Tomcat: <name>… (force)` |
| Sync | `Syncing <deployName>…` |
| Strategy switch | `Large change detected — using Full Redeploy (files=<n>, bytes=<m>)` |
| Error | Short summary + "See Output" button |

### 7.9 Webview Architecture

`[REQUIREMENT]` Webview forms use a **host/client bridge** pattern that separates VS Code extension logic from DOM rendering.

#### 7.9.1 Host/Client Split

| Side | Runs In | Responsibilities | Folder |
|---|---|---|---|
| **Host** | Extension process | Panel lifecycle, CSP header, nonce generation, vscode API calls (browse, validate, persist), message routing | `ui/webviews/panels/` |
| **Client** | Webview iframe | DOM rendering, user interaction, local validation (required fields), `postMessage` to host | `ui/webviews/client/` |

The two sides communicate ONLY via typed messages (`WebviewToHost` / `HostToWebview` — see §3.13). No `any`.

#### 7.9.2 Build Pipeline

`[REQUIREMENT]` The webview client is a separate esbuild entry point:

```
esbuild client/index.ts → dist/webview/webview.js
esbuild client/styles/base.css → dist/webview/webview.css
```

The host panel loads these via `webview.asWebviewUri()` with proper `localResourceRoots`.

#### 7.9.3 Content Security Policy

`[REQUIREMENT]` Every panel generates a cryptographic nonce and sets CSP:

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}'; font-src ${cspSource};">
```

No inline scripts without nonce. No `eval()`. No external resource loads.

#### 7.9.4 Schema-Driven Rendering

`[REQUIREMENT]` The host sends a `FormSchema` (§3.14) to the webview on `init`. The client's `renderer.ts` iterates sections and fields, instantiating the appropriate component for each `FormFieldDef.type`. Adding a new form field means adding a `FormFieldDef` to the schema in the host — the client renders it automatically.

#### 7.9.5 Shared Styles

`[REQUIREMENT]` One `base.css` file using VS Code CSS variables (`--vscode-font-family`, `--vscode-input-background`, etc.). Zero inline styles. All panels share the same CSS.

#### 7.9.6 Framework Swap Boundary

`[REQUIREMENT]` The `client/` folder is the framework boundary. v1 uses vanilla TypeScript/HTML. To migrate to React/Svelte/Vue:

1. Replace `client/` with framework-specific code.
2. Update the esbuild entry to compile the framework.
3. Keep `panels/` (host side) unchanged — the message protocol is the contract.
4. The `FormSchema` type and `WebviewToHost`/`HostToWebview` message types remain stable.

#### 7.9.7 BaseFormPanel Contract

`[REQUIREMENT]` `BaseFormPanel` is an abstract class providing:

- `createPanel(viewType, title, column)` — creates `WebviewPanel` with CSP, nonce, resource URIs
- `dispose()` — cleans up panel + listeners
- `postMessage(msg: HostToWebview)` — typed send to webview
- `abstract handleMessage(msg: WebviewToHost)` — subclass implements
- `abstract getFormSchema(): FormSchema` — subclass returns the form definition
- `showForm(mode, data?)` → `Promise<Result<T, 'CANCELED'>>` — lifecycle wrapper

---

## 8. Command Catalog

`[REQUIREMENT]` Each command appears exactly once in this table. The `id` is the canonical contribution identifier.

**Status key:**
- `mandatory`: MUST be fully implemented in v1. No stubs.
- `deferred-v1.1`: Designed and ID-reserved in manifest, but handler shows "Coming in v1.1" notification. Not counted for v1 Definition of Done.

### 8.1 Server Commands

| id | label | icon | menu(s) | when clause | handler | status |
|---|---|---|---|---|---|---|
| `jsm.server.add` | Add Server | `$(add)` | view/title@1, view/background | `view == javaServerManagerView` | Opens wizard webview | mandatory |
| `jsm.server.startRun` | Run | `$(play)` | inline@1 (stopped/error) | `viewItem =~ /jsm\.server\.(stopped\|error)/` | Enqueue `LifecycleStart` (run) | mandatory |
| `jsm.server.startDebug` | Debug | `$(debug-alt)` | inline@2 (stopped/error) | `viewItem =~ /jsm\.server\.(stopped\|error)/` | Enqueue `LifecycleStart` (debug) | mandatory |
| `jsm.server.stop` | Stop | `$(primitive-square)` | inline@1 (running) | `viewItem == jsm.server.running` | Enqueue `LifecycleStop` | mandatory |
| `jsm.server.restartRun` | Restart Run | `$(refresh)` | inline@2 (running) | `viewItem == jsm.server.running` | Enqueue `LifecycleRestart` (run) | mandatory |
| `jsm.server.restartDebug` | Restart Debug | `$(debug-rerun)` | inline@3 (running) | `viewItem == jsm.server.running` | Enqueue `LifecycleRestart` (debug) | mandatory |
| `jsm.server.cancelOperation` | Cancel | `$(close)` | inline@1 (starting/stopping) | `viewItem =~ /jsm\.server\.(starting\|stopping)/` | Cancel active operation | mandatory |
| `jsm.server.refreshStatus` | Refresh Status | `$(sync)` | troubleshooting@2 (on server) | `viewItem =~ /jsm\.server\./` | Enqueue `StatusRefresh` | mandatory |
| `jsm.server.edit` | Edit Server | `$(edit)` | manage@1 | `viewItem =~ /jsm\.server\./` | Opens edit webview | mandatory |
| `jsm.server.duplicate` | Duplicate | `$(copy)` | manage@2 | `viewItem =~ /jsm\.server\./` | Clone config with new ID/name | deferred-v1.1 |
| `jsm.server.remove` | Remove | `$(trash)` | manage@3 | `viewItem =~ /jsm\.server\./` | Confirm + delete config + cleanup base | mandatory |
| `jsm.server.openConfig` | Open Config | `$(settings-gear)` | manage@4 | `viewItem =~ /jsm\.server\./` | Opens `.vscode/jsm.servers.json` in editor | mandatory |
| `jsm.server.openHome` | Open Home | `$(folder-opened)` | manage@5 | `viewItem =~ /jsm\.server\./` | Opens `instancePath` in OS file manager | deferred-v1.1 |
| `jsm.server.openLogs` | Open Logs | `$(file)` | troubleshooting@1 | `viewItem =~ /jsm\.server\./` | Show the `JSM: <serverName>` per-server output channel | mandatory |
| `jsm.server.syncAllDeployments` | Sync All | `$(sync)` | deploy@1 | `viewItem =~ /jsm\.server\./` | Enqueue sync for each deployment | mandatory |
| `jsm.server.fullRedeployAll` | Full Redeploy All | `$(cloud-upload)` | deploy@2 | `viewItem =~ /jsm\.server\./` | Enqueue full redeploy for each deployment | mandatory |

### 8.2 Deployment Commands

| id | label | icon | menu(s) | when clause | handler | status |
|---|---|---|---|---|---|---|
| `jsm.deployment.add` | Add Deployment | `$(file-add)` | deploy@3 (on server) | `viewItem =~ /jsm\.server\./` | Opens deployment form | mandatory |
| `jsm.deployment.sync` | Sync | `$(sync)` | inline@1 | `viewItem =~ /jsm\.deployment\./` | Enqueue `DeployIncremental` or `DeployFull` (DecisionEngine) | mandatory |
| `jsm.deployment.fullRedeploy` | Full Redeploy | `$(cloud-upload)` | actions@1 | `viewItem =~ /jsm\.deployment\./` | Enqueue `DeployFull` always | mandatory |
| `jsm.deployment.undeploy` | Undeploy | `$(cloud-download)` | actions@2 | `viewItem =~ /jsm\.deployment\./` | Enqueue `Undeploy` | mandatory |
| `jsm.deployment.toggleAutosync` | Toggle Autosync | `$(sync)` | autosync@1 | `viewItem =~ /jsm\.deployment\./` | Toggle `syncMode` and persist | mandatory |
| `jsm.deployment.configureIgnoreGlobs` | Configure Ignore | `$(filter)` | autosync@2 | `viewItem =~ /jsm\.deployment\./` | Open ignore globs editor in deployment form | deferred-v1.1 |
| `jsm.deployment.edit` | Edit | `$(edit)` | manage@1 | `viewItem =~ /jsm\.deployment\./` | Opens deployment edit form | mandatory |
| `jsm.deployment.remove` | Remove | `$(trash)` | manage@2 | `viewItem =~ /jsm\.deployment\./` | Confirm + remove from config | mandatory |
| `jsm.deployment.openLogs` | Open Logs | `$(file)` | troubleshooting@1 | `viewItem =~ /jsm\.deployment\./` | Open deployment-specific log source | deferred-v1.1 |

### 8.3 Global Commands

| id | label | icon | menu(s) | when clause | handler | status |
|---|---|---|---|---|---|---|
| `jsm.view.refresh` | Refresh | `$(refresh)` | view/title@2 | `view == javaServerManagerView` | Reload config + refresh tree | mandatory |
| `jsm.diagnostics.copy` | Copy Diagnostics | `$(copy)` | troubleshooting@3 (on server) | `viewItem =~ /jsm\.server\./` | Generate + copy diagnostics bundle | mandatory |

---

## 9. Lifecycle and Operations

### 9.1 Server State Machine (FSM)

`[REQUIREMENT]` Valid state transitions:

```
stopped  ──startRun/startDebug──▸  starting
starting ──readiness met──────▸  running
starting ──timeout/error──────▸  error
starting ──cancel──────────────▸  stopped (with cleanup)
running  ──stop────────────────▸  stopping
running  ──crash/exit──────────▸  error
stopping ──exit────────────────▸  stopped
stopping ──timeout─────────────▸  stopped (force-killed)
stopping ──cancel──────────────▸  stopped (force-killed)
error    ──startRun/startDebug──▸  starting
error    ──reset───────────────▸  stopped
```

`[REQUIREMENT]` The `error → reset → stopped` transition is triggered by:
- The `jsm.server.refreshStatus` command when the process is confirmed dead (PID absent or not alive).
- Automatic reconciliation at extension reload (§9.9).

If the process is still alive while in `error` state, `reset` MUST NOT fire — the user must `Stop` first.

### 9.1.1 Deployment State Machine (FSM)

`[REQUIREMENT]` Valid deployment state transitions:

```
undeployed ──deploy──────────────▸  deploying
deploying  ──success─────────────▸  synced
deploying  ──error───────────────▸  error
deploying  ──cancel──────────────▸  undeployed
synced     ──sync/redeploy───────▸  deploying
synced     ──undeploy────────────▸  undeployed
error      ──retry/redeploy──────▸  deploying
error      ──undeploy────────────▸  undeployed
```

`[REQUIREMENT]` Rules:
- `deploy` trigger: any of `DeployFull`, `DeployIncremental`, `SyncAll`, `RedeployAll` enqueued for this deployment.
- `cancel` during `deploying`: if full deploy was in progress, rollback MUST be attempted (§10.3). State returns to `undeployed` only if rollback succeeds; otherwise → `error`.
- `undeploy` from `error`: always allowed — removes the target from webapps/ and resets state.
- `error → retry`: the user clicks Sync or Full Redeploy on the errored deployment.
- Transition events: every transition emits `DeploymentStateChanged` (§9.8).

### 9.2 OperationQueue

`[REQUIREMENT]` One queue per server. Priority-FIFO execution: operations at higher priority are inserted before waiting operations at lower priority; within the same priority level, order is FIFO. One active operation at a time per server.

```ts
type OperationKind =
  | 'LifecycleStart'
  | 'LifecycleStop'
  | 'LifecycleRestart'
  | 'DeployFull'
  | 'DeployIncremental'
  | 'SyncAll'
  | 'RedeployAll'
  | 'Undeploy'
  | 'StatusRefresh';

interface OperationContext {
  operationId: OperationId;
  serverId: ServerId;
  kind: OperationKind;
  targetDeploymentId?: DeploymentId;  // Set for per-deployment ops (DeployFull, DeployIncremental, Undeploy)
  startedAt: number;
  timeoutMs: number;
  cancel: CancellationToken;
  progress: ProgressSink;
  output: OutputSink;
}
```

### 9.3 Coalescing Matrix

`[REQUIREMENT]` Coalescing rules use exact `OperationKind` values and `targetDeploymentId` for identity. `dep1`/`dep2` denote distinct `DeploymentId` values.

| Active/Pending | New Operation | Result |
|---|---|---|
| `StatusRefresh` | `StatusRefresh` | Keep last only |
| `DeployIncremental(dep1)` | `DeployIncremental(dep1)` | Keep last (same deployment) |
| `DeployIncremental(dep1)` | `DeployIncremental(dep2)` | Queue both |
| `DeployFull(dep1)` | `DeployIncremental(dep1)` | Drop new (full covers it) |
| `DeployIncremental(dep1)` | `DeployFull(dep1)` | Replace with full |
| `SyncAll` | `DeployIncremental(any)` | Drop new (SyncAll covers it) |
| `SyncAll` | `DeployFull(any)` | Queue DeployFull (explicit full takes precedence) |
| `DeployIncremental(any)` | `SyncAll` | Replace pending incrementals with SyncAll |
| `RedeployAll` | `DeployFull(any)` | Drop new (RedeployAll covers it) |
| `RedeployAll` | `SyncAll` | Drop new (RedeployAll covers it) |
| `DeployFull(any)` / `SyncAll` | `RedeployAll` | Replace with RedeployAll |
| `LifecycleStart(run)` | `LifecycleStart(run)` | Ignore new (already starting) |
| `LifecycleStart(run)` | `LifecycleStart(debug)` | Replace pending with debug |
| `LifecycleStart(debug)` | `LifecycleStart(run)` | Replace pending with run |
| `LifecycleStart(any)` | `LifecycleStop` | Queue stop (waits for start) |
| `LifecycleStop` | `LifecycleStart(any)` | Queue start (waits for stop) |
| Any | `Cancel` | **Immediate**: abort active + clear queue |

`[NOTE]` `SyncAll` expands internally to one `DeployIncremental` or `DeployFull` per deployment (DecisionEngine decides per-deployment). `RedeployAll` expands to one `DeployFull` per deployment. The coalescing rules apply to the unexpanded compound operation.

### 9.4 Operation Priority

`[REQUIREMENT]`

| Priority | Operations | Behavior |
|---|---|---|
| 1 (highest) | `Stop`, `Cancel` | Preempts lower-priority waiting ops |
| 2 | `Start`, `Restart` | Queued; respects coalescing |
| 3 | `Sync`, `StatusRefresh` | Queued; can be cancelled mid-execution |

### 9.5 Cancellation Contract

`[REQUIREMENT]` Operations MUST check the cancellation token at these checkpoints:

- Before spawning a process.
- Before/after each heavy FS copy batch.
- Between hook phases.

On cancellation:

- If a process was spawned during a start operation: attempt graceful stop → force kill.
- If a **full deploy** is in progress (§10.3 staging→swap): cancellation MUST follow the rollback path — restore backup, delete staging. The atomicity guarantee of §10.3 takes precedence. Deployment state → `undeployed` on successful rollback, `error` on rollback failure.
- If an **incremental deploy** file copy is in progress: stop at next checkpoint, leave partial state. The next sync will bring the target up to date.
- Emit `OperationFailed` with `error.code = 'Cancelled'` (severity `info`).
- State must remain consistent (no half-transitions).

### 9.6 Timeouts (Canonical)

`[REQUIREMENT]` All timeout values in one place. Units are milliseconds.

| Operation | Default Timeout (ms) | Config Override Field |
|---|---|---|
| Start (run) | 30 000 | `timeouts.startRunMs` |
| Start (debug) | 45 000 | `timeouts.startDebugMs` |
| Stop (graceful) | 20 000 | `timeouts.stopMs` |
| Stop → force kill escalation | 5 000 | — |
| Deploy full | 60 000 | `timeouts.deployFullMs` |
| Deploy incremental batch | 10 000 | — |
| Health check (single probe) | 3 000 | — |
| Readiness poll interval | 250 | — |
| Hook execution | 60 000 | `hook.timeoutMs` |
| Java version detection | 3 000 | — |
| Port probe | 200 | — |

### 9.7 Idempotency Rules

`[REQUIREMENT]`

| Operation | When Already In Target State | Behavior |
|---|---|---|
| Stop | Already stopped | Return `ok` (no-op) |
| Start | Already running | Return `AlreadyRunning` (info, non-fatal) |
| Undeploy | Target absent | Return `ok` (idempotent) |
| Deploy | Target exists | Overwrite via atomic write strategy |

### 9.8 Eventing Contract

`[REQUIREMENT]` Core emits typed events for UI refresh and diagnostics.

| Event Name | Payload | Trigger |
|---|---|---|
| `ServerAdded` | `{ serverId }` | Config created |
| `ServerUpdated` | `{ serverId }` | Config changed |
| `ServerDeleted` | `{ serverId }` | Config removed |
| `ServerStateChanged` | `{ serverId, state, prevState }` | FSM transition |
| `DeploymentAdded` | `{ serverId, deploymentId }` | Deployment added |
| `DeploymentUpdated` | `{ serverId, deploymentId }` | Deployment config changed |
| `DeploymentRemoved` | `{ serverId, deploymentId }` | Deployment removed |
| `DeploymentStateChanged` | `{ serverId, deploymentId, state }` | Deploy state change |
| `OperationStarted` | `{ serverId, operationId, kind }` | Operation dequeued |
| `OperationCompleted` | `{ serverId, operationId, kind }` | Operation success |
| `OperationFailed` | `{ serverId, operationId, kind, error }` | Operation failure |
| `WorkspaceLoaded` | `{ serverCount }` | Initial load complete |
| `ConfigChanged` | `{ source: 'user' \| 'migration' \| 'wizard' \| 'external' }` | Config file written or reloaded from external change |
| `FileChanged` | `{ serverId, deploymentId, batch }` | File watcher detects source changes (bridge for AutoSync) |

### 9.9 State Reconciliation

`[REQUIREMENT]` `reconcileRunningServers()` runs **after** `activate()` resolves — it is deferred (fire-and-forget), not blocking the activation promise. The tree shows a placeholder "Reconciling…" badge until reconciliation completes.

`[REQUIREMENT]` Reconciliation contract per server:

1. Read PID file via `PidManager.readPid(serverId)`.
2. If no PID file → set state to `stopped`.
3. If PID file exists → probe `PidManager.isProcessAlive(pid)`:
   - **Alive**: set state to `running`, keep PID file. If `lastStartMode` is known, restore it.
   - **Dead**: clear PID file, set state to `stopped`. Log warning: "Stale PID file removed for \<name\>."
4. For servers stuck in `starting` or `stopping` (persisted `lastTransitionAt` older than 2× the respective timeout):
   - If process alive → attempt graceful stop first (e.g. Tomcat SHUTDOWN port for `stopping`; for `starting`, send SIGTERM/`taskkill`). Wait up to 5 000 ms. If process is still alive after grace period → force kill (SIGKILL / `taskkill /F`). Set `stopped`.
   - If process dead → clear PID, set `stopped`.
5. For servers in `error` state with dead process → transition to `stopped` (equivalent to `reset`).

`[REQUIREMENT]` Reconciliation budget: 2 000 ms. PID probes run in parallel (`Promise.all`). If the budget is exceeded, remaining servers default to `stopped` with a log warning.

`[REQUIREMENT]` After reconciliation completes, emit `WorkspaceLoaded` and refresh the tree.

---

## 10. Deploy and AutoSync

### 10.1 Target Mapping (Tomcat)

`[REQUIREMENT]` Uses `instancePath` as the per-server instance directory (Tomcat: `CATALINA_BASE`). The plugin resolves `instancePath` to the appropriate server-specific environment variable.

| Type | Source | Target |
|---|---|---|
| WAR | `<sourcePath>.war` | `<instancePath>/webapps/<deployName>.war` |
| Exploded | `<sourcePath>/` | `<instancePath>/webapps/<deployName>/` |

### 10.2 DecisionEngine — Sync Strategy

`[REQUIREMENT]` The DecisionEngine is a pure function with no side effects. It outputs a **strategy hint** (`'incremental'` or `'full'`) that is passed to `IServerPlugin.planDeploy()` as input. The plugin returns a `DeployPlan` whose `strategy` must be consistent with the hint: if the hint is `'incremental'`, the plan MUST NOT use `'copy-war'` or `'copy-dir'` (full strategies). The plugin may escalate `'incremental'` to `'full'` only if the plugin lacks incremental capability.

| Condition | Strategy | Log Reason |
|---|---|---|
| Type = WAR | `full` | "WAR deployment requires full copy" |
| Changed files > `autosync.maxBatchFiles` | `full` | "Large change (N files) — full redeploy" |
| Changed bytes > `autosync.maxBatchBytes` | `full` | "Large change (N MB) — full redeploy" |
| In failure cooldown | `full` | "Recent failures — using safe full redeploy" |
| Plugin lacks `deployIncremental` | `full` | "Plugin does not support incremental deploy" |
| Otherwise | `incremental` | "Incremental sync (N files)" |

### 10.3 Deploy Atomicity

`[REQUIREMENT]` Full deploy uses staging → swap → rollback:

1. Copy source to `<target>.staging.<timestamp>`.
2. If existing target exists, rename to `<target>.backup.<timestamp>`.
3. Rename staging to target (atomic on POSIX; deterministic replace on Windows).
4. On success: delete backup.
5. On failure: restore backup, delete staging.

`[REQUIREMENT]` Backup retention: keep at most **3** backup directories/files per deployment target. After a successful deploy, delete any backup older than the most recent 3. This prevents disk exhaustion from accumulated backup artifacts across many deploy cycles.

### 10.4 AutoSync

`[REQUIREMENT]` AutoSync watches exploded deployment source directories for changes and enqueues sync operations.

Default ignore globs:

```
**/.git/**
**/node_modules/**
**/target/**
**/build/**
**/.gradle/**
**/.idea/**
**/.classpath
**/.project
*.tmp
*.log
*.swp
```

`[REQUIREMENT]` AutoSync behavior:

- Uses `vscode.workspace.createFileSystemWatcher` via adapter (reliable cross-platform).
- Source path MUST be under the workspace for autosync to work. If outside workspace: autosync disabled, show warning.
- Events are coalesced within `autosync.debounceMs` window.
- Ignore globs applied before batching.
- Storm protection: if batch exceeds `maxBatchFiles` or `maxBatchBytes`, skip incremental and either auto-switch to full (if `auto` mode) or suggest full (if `manual` mode), then apply `stormBackoffMs` cooldown.
- **Watcher lifecycle:** Watchers MUST be suspended when the server is in `stopped` or `error` state and resumed when the server transitions to `running`. This prevents file-change events from accumulating against stopped servers and poisoning the failure cooldown counter on restart.
- **Watcher cap:** Global limit of 30 active file watchers across all servers. If the cap is reached, new watchers are deferred until existing ones are disposed.

### 10.5 Failure Cooldown

`[REQUIREMENT]` Per server/deployment short-term memory:

- If an operation fails twice within 10 minutes: set 2-minute cooldown, switch to safer strategy on next attempt.
- Example: incremental fails twice → prefer full.

### 10.6 Hook Lifecycle

`[REQUIREMENT]` Hooks run within the OperationQueue. Cancellation propagates. All hook logs include `operationId`.

Hook phases: `pre` (before operation), `post` (after success), `onError` (after failure).

Hook events: `lifecycle.start`, `lifecycle.stop`, `lifecycle.restart`, `deploy.full`, `deploy.incremental`, `deploy.undeploy`.

`[REQUIREMENT]` **Hook timeout budget:** Hook execution time counts against the parent operation’s total timeout budget. If hooks consume the budget, the parent operation times out normally. An aggregate hook phase limit of 120 000 ms (2 minutes) applies: if all hooks for a single phase exceed this limit, remaining hooks are skipped with a warning log. Individual hook timeouts (§3.8 `timeoutMs`) still apply per-hook.

---

## 11. Logging, Diagnostics, Output Channels

### 11.1 Output Channels

`[REQUIREMENT]`

| Channel | Content |
|---|---|
| `JSM` | Core decisions, high-level events, warnings. |
| `JSM: <serverName>` | Server stdout/stderr, plugin logs, operation details. One channel per server. |

`[BEHAVIOR]` When a server transitions to `running`, its output channel is automatically cleared before presenting logs, preventing carryover from prior sessions.

### 11.2 Structured Log Format

`[REQUIREMENT]` Internal log events follow this shape:

| Field | Type | Description |
|---|---|---|
| `ts` | ISO string | Timestamp |
| `level` | `debug\|info\|warn\|error` | Severity |
| `scope` | string | Module path (e.g. `core.ops`, `tomcat.lifecycle`) |
| `serverId` | string? | Server context |
| `operationId` | string? | Operation context |
| `msg` | string | Human-readable message |
| `data` | object? | Structured payload |

### 11.3 Ring Buffer

`[REQUIREMENT]` Each per-server output channel maintains a ring buffer of the last 2000 lines (≈1 MB cap per server) for diagnostics extraction.

### 11.4 DiagnosticsBundle

`[REQUIREMENT]` The `jsm.diagnostics.copy` command produces a deterministic bundle:

```ts
interface DiagnosticsBundle {
  timestamp: string;                // ISO
  extension: { name: string; version: string };
  vscode: { version: string };
  os: { platform: string; release: string; arch: string };
  node: { version: string };
  workspace: { schemaVersion: number; serverCount: number };
  server?: {                        // If invoked on a specific server
    config: RedactedServerConfig;   // Secrets removed
    runtimeState: ServerRuntimeState;
    deploymentStates: DeploymentRuntimeState[];
  };
  recentLogs: string[];             // Last 200 lines from ring buffer (sanitized)
  lastError?: JsmError;             // Most recent error (redacted)
}
```

`[REQUIREMENT]` Redaction rules: keys matching `password|secret|token|key|auth` are replaced with `[REDACTED]`. The command MUST never throw; on internal failure it returns a minimal bundle with the error summary.

### 11.5 Error UX Standard

`[REQUIREMENT]` Every surfaced error includes:

- **Title**: short summary.
- **Details**: error code + root cause.
- **Suggested fixes**: ordered list (most likely first).
- **Buttons**: `Copy Diagnostics`, `Open Output`, `Retry` (when retryable).

---

## 12. Security and Safety

### 12.1 Debug Binding

`[REQUIREMENT]` Debug MUST bind to a localhost address (`127.0.0.1`, `localhost`, or `::1`). The JDWP address MUST be set as `JPDA_ADDRESS=<bind>:<port>` where `<bind>` is the value from `ServerConfig.debug.bind` (default `127.0.0.1`). Never `*`, never `0.0.0.0`.

### 12.2 No Shell Execution

`[REQUIREMENT]` All process spawning uses `spawn()` with `shell: false` and an `argv` array. No string concatenation for command lines. On Windows, use `cmd.exe /d /s /c` with deterministic quoting (see infra/process).

### 12.3 AJP Disabled

`[REQUIREMENT]` On `instancePath` initialization (Tomcat: CATALINA_BASE), AJP connectors in `server.xml` are removed by default. Controlled by `TomcatPluginConfig.disableAjp` (default: `true`).

### 12.4 Path Validation

`[REQUIREMENT]` All user-supplied paths are normalized and validated before use:

- `deployName` must match the allowlist pattern `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`. This rejects path traversal (`..`), separators (`/`, `\`), and empty strings by construction.
- Source paths are resolved against workspace root.
- Paths used for file operations MUST be resolved via `realpath()` and validated to remain under the expected root directory (no symlink escape).
- CATALINA_HOME and CATALINA_BASE must be absolute paths to existing, writable directories.

### 12.5 Secrets Storage

`[REQUIREMENT]` Any secret-like values (passwords, tokens) MUST be stored via VS Code `SecretStorage`. Workspace config files store only references, never raw secrets.

### 12.6 Log Redaction

`[REQUIREMENT]` Log output and diagnostics bundles redact values for keys matching (word-boundary, case-insensitive): `\bpassword\b|\bsecret\b|\btoken\b|\bapi[_-]?key\b|\bauth\b|\bcredential\b`. The pattern `key` alone is intentionally excluded (too broad — matches `primaryKey`, `hookKey`, etc.).

### 12.7 Webview CSP

`[REQUIREMENT]` If webviews are used, enforce a strict Content Security Policy: no inline scripts, no external resource loads.

### 12.8 Workspace Trust

`[REQUIREMENT]` The extension MUST integrate with the VS Code Workspace Trust API.

**Manifest declaration:**
```jsonc
"capabilities": {
  "untrustedWorkspaces": {
    "supported": "limited",
    "description": "In untrusted workspaces, JSM operates in read-only/view-only mode. No processes are spawned, no hooks executed, no deployments performed."
  }
}
```

**Behavior in untrusted workspaces:**
- Config is loaded and displayed in the tree (read-only view).
- All lifecycle commands (Start, Stop, Restart) are disabled with a notification: "Grant workspace trust to manage servers."
- All deploy commands (Sync, Full Redeploy, Undeploy) are disabled.
- AutoSync watchers are NOT created.
- Hooks are NOT executed.
- Process spawning is blocked at `ServerLifecycle` level.
- Wizard and edit forms remain accessible for inspection but the "Save" button is disabled.

**Behavior on trust grant:**
- Full functionality enabled. AutoSync watchers created for eligible deployments. Tree refreshed.

`[REQUIREMENT]` Implementation: `ServerLifecycle`, `HookRunner`, `DeploymentService`, and `AutoSyncService` MUST check `vscode.workspace.isTrusted` before performing any side-effecting operation. The check is centralized in a `TrustGate` utility injected at composition root.

### 12.9 Env Var and vmArgs Safety

`[REQUIREMENT]` The following environment variables MUST be rejected in `ServerConfig.run.env` during validation (§3.5, `ConfigNormalizer`):

| Blocked Key | Reason |
|---|---|
| `LD_PRELOAD` | Loads arbitrary shared library into every spawned process |
| `DYLD_INSERT_LIBRARIES` | macOS equivalent of LD_PRELOAD |
| `JAVA_TOOL_OPTIONS` | Injects JVM flags including `-javaagent:` |
| `_JAVA_OPTIONS` | Legacy JVM flag injection |
| `JDK_JAVA_OPTIONS` | JDK 9+ flag injection |

`[REQUIREMENT]` The following `run.vmArgs` prefixes MUST be rejected during validation:

| Blocked Prefix | Reason |
|---|---|
| `-javaagent:` | Loads arbitrary agent JAR with full bytecode access |
| `-agentlib:` | Loads native agent library |
| `-agentpath:` | Loads native agent from absolute path |
| `-XX:OnOutOfMemoryError` | Executes arbitrary command on OOM |
| `-XX:OnError` | Executes arbitrary command on JVM crash |

`[REQUIREMENT]` Validation MUST return `ValidationFailed` with `suggestedFix: ["Remove the blocked environment variable/argument. These are restricted for security."]`. The restriction is enforced in both wizard validation and `ConfigNormalizer.normalizeConfig()`.

---

## 13. Performance Budgets

`[REQUIREMENT]` All budgets are measured on a mid-range developer machine.

| Metric | Budget | Notes |
|---|---|---|
| Extension activation | < 200 ms | No disk scanning on activation; defer detection to wizard. |
| Tree view refresh (10 servers) | < 50 ms | Use cached state; schedule async status refresh with rate-limit. |
| Watcher storm CPU | Bounded | Rate-limited batching; debounce + storm protection. |
| Config save | < 100 ms | Debounced writes; atomic (write temp then rename). |
| Ring buffer memory | ≤ 1 MB per server | 2000-line cap per server channel. |
| Port probe | < 200 ms | Single TCP connect attempt. |

---

## 14. Testing Strategy and Definition of Done

### 14.1 Test Pyramid

`[REQUIREMENT]`

| Level | Coverage Target | Scope |
|---|---|---|
| **Unit** | All pure core modules | ConfigNormalizer, DecisionEngine, OperationQueue coalescing/cancellation, XML patcher, error mapping, deploy planner, migration functions |
| **Integration** | FS and process adapters | ProcessManager spawn/kill (cross-platform), deploy strategies with temp dirs, atomic write correctness |
| **E2E / Smoke** | Critical paths | VS Code test-electron: create server via config injection → start/stop (fake plugin) → deploy → verify tree state |

### 14.2 CI Gates (Mandatory)

`[REQUIREMENT]`

| Gate | Command |
|---|---|
| Lint | `npm run lint` |
| Type check | `npm run check-types` |
| Unit tests | `npm test` |
| Build package | `npm run compile` |

`[REQUIREMENT]` OS matrix: run unit/integration on Linux + macOS + Windows.

### 14.3 Definition of Done — Feature Level

`[REQUIREMENT]` A feature is DONE only if:

- Spec behavior implemented exactly as described.
- Tests cover success path + key failure paths.
- Logs and error UX are actionable (not generic).
- No architecture boundary violations (core does not import vscode).
- Performance budgets not regressed.

### 14.4 Definition of Done — v1 Release

`[REQUIREMENT]` v1 release requires ALL of the following:

| # | Gate | Verification |
|---|---|---|
| 1 | Wizard creates server on macOS, Linux, Windows | E2E smoke test |
| 2 | Start/Stop/Restart (Run + Debug) stable for Tomcat | Integration test + manual verification |
| 3 | Deploy WAR + exploded + Sync + AutoSync functional | Integration test |
| 4 | Diagnostics bundle works and copies to clipboard | Unit test + manual verification |
| 5 | No stub commands in manifest (every contributed command has a real handler) | Audit script |
| 6 | CI green on all gates | CI pipeline |
| 7 | `schemaVersion` present in all persisted stores | Unit test |
| 8 | Debug binds `127.0.0.1` only | Unit test |
| 9 | No `shell: true` in codebase | Grep audit |
| 10 | README, CHANGELOG factually aligned with implemented state | Review |

---

## Appendix A: Decision Log

| ID | Domain | Options Evaluated | Chosen | Rationale |
|---|---|---|---|---|
| D-01 | **Normative document** | `specs.md` (frozen, ~2400 lines), `specs-extended.md` (~1600 lines) | `specs-extended.md` as primary base, with operational detail from `specs.md` | `specs-extended` is more current, has richer plugin contracts, typed events, hooks, and the `SyncMode` model. `specs.md` supplies superior OperationQueue coalescing matrix, atomicity detail, and ProcessManager cross-platform specs. Both are superseded by this unified document. |
| D-02 | **ServerConfig shape** | (A) Flat model (current code: `serverHome`, `port`, `autoSync: boolean`), (B) Nested model from `specs.md` (`runtimeId`, `httpPort`, `debugPort`), (C) Nested model from `specs-extended` (`runtime{}`, `ports{}`, `run{}`, `debug{}`, `autosync{}`) | (C) `specs-extended` nested model | The nested model groups related concerns (ports, debug, autosync), reduces flat-field sprawl, and separates runtime identity from instance config. The flat model conflates `serverHome` with both CATALINA_HOME and CATALINA_BASE. |
| D-03 | **SyncMode vs boolean** | `autoSync: boolean` (specs.md, current code), `SyncMode: 'off' \| 'manual' \| 'auto'` (specs-extended) | `SyncMode` enum | Three states are semantically richer: `off` = never sync, `manual` = user-triggered only, `auto` = watcher-driven. A boolean cannot distinguish `off` from `manual`. |
| D-04 | **Storage path** | `.vscode/servers.json` (current code), `.vscode/jsm.servers.json` (both specs) | `.vscode/jsm.servers.json` | Namespaced filename avoids collision with other extensions and is clearly JSM-owned. Both specs agree. |
| D-05 | **Canonical timeouts** | specs.md: startup 60s, stop 10s; specs-extended: start-run 30s, start-debug 45s, stop 20s, deploy-full 60s | specs-extended granular values | Per-operation timeouts are more precise. Debug start legitimately needs more time than run start. 60s startup is excessive for typical Tomcat. |
| D-06 | **Inline action "Remove"** | (A) Include Remove in server inline actions (specs.md stopped/error state), (B) Context menu only (specs-extended: "optional; can be context-only if safer") | (B) Context menu only | Remove is destructive and irreversible. Keeping it in the context menu prevents accidental deletion. Inline actions are the "fast lane" — they should be safe to click rapidly. |
| D-07 | **schemaVersion start** | specs.md: workspace starts at v2 (post-migration from legacy), specs-extended: starts at v1 | Start at v1 | Starting the schema version at 1 avoids the overhead of a v1→v2 numbering scheme. v0→v1 migration from the current codebase's legacy config shape is still required (§4.7). |
| D-08 | **Deploy command naming** | `jsm.deployment.fullRedeploy` (specs.md), `jsm.deployment.deployFull` (specs-extended) | `jsm.deployment.fullRedeploy` | "Full Redeploy" is clearer user-facing language. "Deploy Full" reads awkwardly. |
| D-09 | **vmArgs type** | `string` (current code, specs.md), `string[]` (specs-extended) | `string[]` | Array form is safer (no shell splitting), aligns with `spawn()` argv semantics, and avoids whitespace/quoting bugs. |
| D-10 | **Hook system** | (A) Simple `preStartCmd/postStopCmd` on ServerConfig (current code), (B) Full `HookConfig[]` with phases, events, kinds (specs-extended) | (B) Full hook system | The full system is more powerful. The simple `preStartCmd/postStopCmd` fields are inadequate for real use (no error handling, no cancellation, no deploy hooks). Additionally, old hook fields are migrated to `HookConfig[]` in v0→v1 migration (§4.7). |
| D-11 | **`openOutput` removal** | (A) Keep `jsm.server.openOutput` as a separate command alongside `openLogs`, (B) Remove `openOutput`, have `openLogs` show the `JSM: <serverName>` per-server output channel | (B) Merged into `openLogs` | The distinction between "Open Logs" (catalina.out file) and "Open Output" (VS Code channel) is an implementation detail, not a user concern. Since output channels already receive live server stdout/stderr, a single action is clearer and removes a redundant command. |
| D-12 | **Inline action scope** | (A) Include Edit and Undeploy in deployment inline; include Edit in server stopped/error inline, (B) Restrict inline to lifecycle-only on server (Run/Stop/Restart) and Sync-only on deployment | (B) Restricted inline | Inline is the fast lane — highest-frequency, low-risk actions only. Edit opens a form (secondary). Undeploy is destructive. Context menu satisfies discoverability without unsafe one-click access. |
| D-13 | **ServerConfig generic fields** | (A) Keep `catalinaHome`/`catalinaBase` as named fields in `ServerConfig`, (B) Rename to generic `homePath`/`instancePath` + optional `pluginConfig` discriminated union per plugin type | (B) Generic base + `pluginConfig` extension | `ServerConfig` is the common contract for all plugins. Tomcat-named fields leak implementation into the domain model. `homePath`/`instancePath` cover the same semantics for any servlet container. Truly Tomcat-only options (`shutdownPort`, `disableAjp`) move to `TomcatPluginConfig`. `ports.shutdown` was removed from the generic `ports` block and folded into `TomcatPluginConfig.shutdownPort`. |
| D-14 | **specs as single source of truth** | (A) Keep three spec files and reconcile manually, (B) Create one unified specs.md that supersedes all previous specs | (B) Unified specs | Avoids spec drift. One normative document means no ambiguity during implementation. Old specs preserved read-only for archaeology. |
| D-15 | **Big bang rewrite** | (A) Incremental migration preserving current tests, (B) Full rewrite from specs | (B) Big bang | Current codebase has too many structural issues (singletons, layer violations, flat config, no DI, monolithic commands). Incremental migration would require maintaining two parallel architectures. New code starts clean from the spec. |
| D-16 | **Schema migration mandatory** | (A) No migration — require fresh config, (B) Automatic v0→v1 migration with backup | (B) Automatic migration | Users with existing Tomcat configs must not lose their setups. Migration is a pure function with backup — low risk, high value. |
| D-17 | **All [DESIGN] → [REQUIREMENT]** | (A) Keep some items as design aspirations, (B) Upgrade all to REQUIREMENT — everything shipped must be implemented | (B) All REQUIREMENT | The user mandate is "nothing incomplete or placeholder". If it's in the spec, it ships working. Items not ready for v1 are explicitly marked `deferred-v1.1` in §8. |
| D-18 | **Constructor injection everywhere** | (A) Keep singletons for convenience, (B) Pure constructor injection at composition root | (B) Constructor injection | Singletons hide dependencies, complicate testing, and create initialization order bugs. The only exception is Logger (cross-cutting, initialized once). |
| D-19 | **5-layer strict architecture** | (A) 3-layer (core/services/ui), (B) 5-layer (core/app/plugins/infra/ui) with enforced import rules | (B) 5-layer | Separating infra from core enables pure-domain unit tests. Separating plugins from app enables adding server types without touching orchestration. A lint rule enforces the boundary. |
| D-20 | **Deferred commands** | (A) Implement all 30+ commands in v1, (B) Ship mandatory commands, reserve IDs for deferred-v1.1 with placeholder notification | (B) Deferred with placeholder | `duplicate`, `openHome`, `configureIgnoreGlobs`, `deployment.openLogs` are nice-to-have but not critical for v1 professional quality. Reserving the IDs prevents manifest churn. |
| D-21 | **Webview host/client split** | (A) Keep inline HTML template literals, (B) Separate host (panel lifecycle) from client (DOM), typed bridge | (B) Host/Client bridge | Inline HTML mixes concerns, blocks CSP, prevents framework migration, duplicates CSS. A typed message bridge (§3.13) isolates the rendering layer so it can be swapped to React/Svelte later without touching host logic. |
| D-22 | **Schema-driven declarative forms** | (A) Hand-code each form, (B) FormSchema → renderer pipeline | (B) Schema-driven | Adding a field should be a data change (one `FormFieldDef`), not a template surgery. The renderer iterates the schema; components are reusable. Cuts form boilerplate by ~70%. |
| D-23 | **DeploymentConfig.name removal** | (A) Keep both `name` and `deployName`, (B) Drop `name`, use `deployName` as the sole display + deploy identifier | (B) `deployName` only | Two name-like fields invite drift. `deployName` already carries the WAR/context semantics; `name` added nothing. |
| D-24 | **ServerConfig.type literal constraint** | (A) `type: string`, (B) `type: ServerType` (literal union) | (B) Literal union | A free `string` offers no compile-time safety for plugin dispatch, config validation, or exhaustive switch. A literal union (`'tomcat'`) catches invalid types at development time and simplifies PluginRegistry lookups. |

---

## Appendix B: Roadmap

`[REFERENCE]` High-level milestones for context. Not normative.

### v1.0 — Tomcat Professional Core (this spec)

Everything marked `mandatory` in §8.

- 5-layer architecture with enforced import boundaries
- Constructor injection at composition root
- OperationQueue with coalescing, cancellation, and priority
- DecisionEngine (sync strategy, stop escalation, readiness)
- Full HookRunner (config-driven + EventBus pub-sub)
- Wizard + templates (webview forms)
- Cross-platform Tomcat lifecycle: run, debug, stop, restart, cancel
- Multi-instance Tomcat: CATALINA_HOME/CATALINA_BASE separation
- Deploy WAR + exploded + smart sync + autosync with storm protection
- Per-server log channels + structured logging + ring buffer
- Diagnostics bundle with redaction
- Schema v1 + atomic persistence + v0→v1 migration
- JSON Schema validation (AJV)
- CI gates: lint, types, unit tests, build
- Unit tests for all core pure modules
- Integration tests for FS/process adapters

### v1.1 — Deferred Commands + Polish

- `jsm.server.duplicate` — Clone server config
- `jsm.server.openHome` — Open instancePath in OS file manager
- `jsm.deployment.configureIgnoreGlobs` — Per-deployment ignore globs editor
- `jsm.deployment.openLogs` — Deployment-specific log source
- E2E test coverage expansion
- Performance profiling and optimization
- Accessibility (keyboard navigation, screen reader)

### v2.0 — Plugin Expansion

- Plugin capability negotiation proven with second plugin (Jetty detect-only)
- Plugin authoring documentation
- Remote server support investigation

---

*End of Normative Specification*
