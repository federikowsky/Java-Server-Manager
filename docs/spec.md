# Java Server Manager (JSM) — Normative Specification v1

> **Status:** NORMATIVE — Single source of truth for v1  
> **Supersedes:** `docs/specs.md`, `docs/specs-extended.md`  
> **Scope:** Tomcat-only, plugin-ready architecture  
> **Language:** English

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
- Migration tooling from legacy config shapes.

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
| **OperationQueue** | A per-server FIFO queue that serializes operations and supports coalescing and cancellation. |

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
  type: string;                      // Plugin type discriminator (e.g. 'tomcat')

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
    bind: string;                    // Default: '127.0.0.1' (MUST be localhost)
    attachDelayMs: number;           // Default: 1000
  };

  deployments: DeploymentConfig[];

  autosync: {
    enabled: boolean;                // Default: true
    debounceMs: number;              // Default: 400
    maxBatchFiles: number;           // Default: 200
    maxBatchBytes: number;           // Default: 20_000_000
    stormBackoffMs: number;          // Default: 2000
    ignoreGlobs: string[];           // Default: see §10.4
  };

  hooks: HookConfig[];               // Lifecycle hooks (see §10.6)

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
  name: string;                      // Context path name (e.g. 'myapp')
  type: DeploymentType;              // 'war' | 'exploded'
  sourcePath: string;                // Absolute or workspace-relative
  deployName: string;                // Target name in webapps/ (e.g. 'myapp')
  syncMode: SyncMode;               // Default: 'auto' for exploded, 'manual' for war
  ignoreGlobs: string[];             // Per-deployment ignore patterns
  hooks: HookConfig[];               // Deployment-level hooks
}
```

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

`[DESIGN]`

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

`[DESIGN]`

```ts
interface ServerTemplate {
  id: TemplateId;
  name: string;
  pluginType: string;                // 'tomcat'
  serverDefaults: Partial<ServerConfig>;
  deploymentDefaults: Partial<DeploymentConfig>[];
  hookDefaults: HookConfig[];
  description?: string;
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

### 4.5 Atomic Writes

`[REQUIREMENT]` All config writes use the atomic write pattern:

1. Write to `<path>.tmp.<timestamp>`.
2. On POSIX: `rename()` (atomic overwrite).
3. On Windows: `rm` existing + `rename` with retry/backoff (max 3 attempts; backoffs 100ms, 500ms, 1000ms).
4. On failure: clean up temp file.

### 4.6 Deployment Runtime State

`[DESIGN]` Deployment runtime state (`DeploymentRuntimeState`) is persisted via VS Code extension storage (`ExtensionContext.workspaceState`) and is recoverable from disk state. It is not stored in the workspace config file.

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

### 5.2 Target Folder Structure

`[DESIGN]`

```
src/
  core/
    domain/          # Types (§3), ID generators
    errors/          # JsmError, ErrorCode, error matrix
    events/          # Typed event bus (no vscode)
    fsm/             # Server state machine
    ops/             # OperationQueue, OperationContext
    policy/          # DecisionEngine, ConfigNormalizer
  app/
    usecases/        # One file per use-case (StartServer, SyncDeployment, etc.)
    services/        # Orchestrators (AutosyncService, DiagnosticsService)
  plugins/
    interfaces/      # IServerPlugin, PluginCapabilities
    registry/        # PluginRegistry
    tomcat/          # TomcatPlugin implementation
  infra/
    fs/              # FileUtils, atomic writes
    process/         # ProcessManager (spawn, kill, cross-platform)
    ports/           # PortsAdapter (probe, suggest)
    storage/         # WorkspaceStore, GlobalStore adapters
    logging/         # Structured logger, ring buffer
  ui/
    commands/        # Command registrations (split by domain)
    tree/            # ServerTreeViewProvider
    webviews/        # ServerFormPanel, DeploymentFormPanel
    adapters/        # OutputChannelAdapter, FileWatcherAdapter
```

### 5.3 Module Disposition

`[DESIGN]` Compared to the current codebase:

| Current Module | Disposition | Notes |
|---|---|---|
| `src/commands/index.ts` | **Split** | Break into `ui/commands/{server,deployment,template,diagnostics}.ts` |
| `src/core/EventBus.ts` | **Move** | To `core/events/` — remove vscode dependency |
| `src/core/config/ConfigManager.ts` | **Replace** | Split into `core/policy/ConfigNormalizer.ts` + `infra/storage/WorkspaceStore.ts` |
| `src/core/server/ServerManager.ts` | **Replace** | Split into use-cases + `core/ops/OperationQueue.ts` |
| `src/core/server/ServerRuntime.ts` | **Keep** | Move to `infra/process/` |
| `src/core/server/plugins/*` | **Move** | To `plugins/` |
| `src/services/*` | **Keep/refactor** | Move to `app/services/` or `app/usecases/` |
| `src/ui/*` | **Keep** | Move tree to `ui/tree/`, webviews to `ui/webviews/` |
| `src/core/persistence/*` | **Move** | To `infra/storage/` |
| `src/core/debug/DebugManager.ts` | **Move** | To `ui/adapters/DebugAdapter.ts` (vscode-dependent) |

### 5.4 Dependency Injection

`[DESIGN]` Use explicit constructor injection at the app boundary. Avoid singletons in core. The extension entry point (`extension.ts`) is the composition root where all dependencies are wired.

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
  readonly type: string;          // Stable ID, e.g. 'tomcat'
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

`[DESIGN]` Future plugins register via the same mechanism. The registry supports `get(type)`, `has(type)`, `getSupportedTypes()`, and `detectServerType(path)` (probes all registered plugins).

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
| `troubleshooting` | Open Logs, Copy Diagnostics | |

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

`[DESIGN]` When no servers exist, the tree shows a welcome message with a button to add the first server.

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
- `server.xml` ports are patched via XML parser (not regex). AJP connectors are removed by default (see `TomcatPluginConfig.disableAjp`).

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

---

## 8. Command Catalog

`[REQUIREMENT]` Each command appears exactly once in this table. The `id` is the canonical contribution identifier. The `status` column indicates implementation priority for v1.

### 8.1 Server Commands

| id | label | icon | menu(s) | when clause | handler | status |
|---|---|---|---|---|---|---|
| `jsm.server.add` | Add Server | `$(add)` | view/title@1, view/background | `view == javaServerManagerView` | Opens wizard webview | mandatory |
| `jsm.server.startRun` | Run | `$(play)` | inline@1 (stopped/error) | `viewItem =~ /jsm\.server\.(stopped\|error)/` | Enqueue `LifecycleStart` (run) | mandatory |
| `jsm.server.startDebug` | Debug | `$(debug-alt)` | inline@2 (stopped/error) | `viewItem =~ /jsm\.server\.(stopped\|error)/` | Enqueue `LifecycleStart` (debug) | mandatory |
| `jsm.server.stop` | Stop | `$(primitive-square)` | inline@1 (running) | `viewItem == jsm.server.running` | Enqueue `LifecycleStop` | mandatory |
| `jsm.server.restartRun` | Restart Run | `$(refresh)` | inline@2 (running) | `viewItem == jsm.server.running` | Enqueue `LifecycleRestart` (run) | mandatory |
| `jsm.server.restartDebug` | Restart Debug | `$(debug-rerun)` | inline@3 (running) | `viewItem == jsm.server.running` | Enqueue `LifecycleRestart` (debug) | mandatory |
| `jsm.server.cancelOperation` | Cancel | `$(close)` | inline@1 (starting/stopping) | `viewItem =~ /jsm\.server\.(starting\|stopping)/` | Cancel active operation | target |
| `jsm.server.refreshStatus` | Refresh Status | `$(sync)` | troubleshooting@2 (on server) | `viewItem =~ /jsm\.server\./` | Enqueue `StatusRefresh` | target |
| `jsm.server.edit` | Edit Server | `$(edit)` | manage@1 | `viewItem =~ /jsm\.server\./` | Opens edit webview | mandatory |
| `jsm.server.duplicate` | Duplicate | `$(copy)` | manage@2 | `viewItem =~ /jsm\.server\./` | Clone config with new ID/name | target |
| `jsm.server.remove` | Remove | `$(trash)` | manage@3 | `viewItem =~ /jsm\.server\./` | Confirm + delete config + cleanup base | mandatory |
| `jsm.server.openConfig` | Open Config | `$(settings-gear)` | manage@4 | `viewItem =~ /jsm\.server\./` | Opens `.vscode/jsm.servers.json` in editor | target |
| `jsm.server.openHome` | Open Home | `$(folder-opened)` | manage@5 | `viewItem =~ /jsm\.server\./` | Opens `instancePath` in OS file manager | target |
| `jsm.server.openLogs` | Open Logs | `$(file)` | troubleshooting@1 | `viewItem =~ /jsm\.server\./` | Show the `JSM: <serverName>` per-server output channel | mandatory |
| `jsm.server.syncAllDeployments` | Sync All | `$(sync)` | deploy@1 | `viewItem =~ /jsm\.server\./` | Enqueue sync for each deployment | mandatory |
| `jsm.server.fullRedeployAll` | Full Redeploy All | `$(cloud-upload)` | deploy@2 | `viewItem =~ /jsm\.server\./` | Enqueue full redeploy for each deployment | target |

### 8.2 Deployment Commands

| id | label | icon | menu(s) | when clause | handler | status |
|---|---|---|---|---|---|---|
| `jsm.deployment.add` | Add Deployment | `$(file-add)` | deploy@3 (on server) | `viewItem =~ /jsm\.server\./` | Opens deployment form | mandatory |
| `jsm.deployment.sync` | Sync | `$(sync)` | inline@1 | `viewItem =~ /jsm\.deployment\./` | Enqueue `DeployIncremental` or `DeployFull` (DecisionEngine) | mandatory |
| `jsm.deployment.fullRedeploy` | Full Redeploy | `$(cloud-upload)` | actions@1 | `viewItem =~ /jsm\.deployment\./` | Enqueue `DeployFull` always | mandatory |
| `jsm.deployment.undeploy` | Undeploy | `$(cloud-download)` | actions@2 | `viewItem =~ /jsm\.deployment\./` | Enqueue `Undeploy` | mandatory |
| `jsm.deployment.toggleAutosync` | Toggle Autosync | `$(sync)` | autosync@1 | `viewItem =~ /jsm\.deployment\./` | Toggle `syncMode` and persist | mandatory |
| `jsm.deployment.configureIgnoreGlobs` | Configure Ignore | `$(filter)` | autosync@2 | `viewItem =~ /jsm\.deployment\./` | Open ignore globs editor in deployment form | target |
| `jsm.deployment.edit` | Edit | `$(edit)` | manage@1 | `viewItem =~ /jsm\.deployment\./` | Opens deployment edit form | mandatory |
| `jsm.deployment.remove` | Remove | `$(trash)` | manage@2 | `viewItem =~ /jsm\.deployment\./` | Confirm + remove from config | mandatory |
| `jsm.deployment.openLogs` | Open Logs | `$(file)` | troubleshooting@1 | `viewItem =~ /jsm\.deployment\./` | Open deployment-specific log source | target |

### 8.3 Global Commands

| id | label | icon | menu(s) | when clause | handler | status |
|---|---|---|---|---|---|---|
| `jsm.view.refresh` | Refresh | `$(refresh)` | view/title@2 | `view == javaServerManagerView` | Reload config + refresh tree | mandatory |
| `jsm.diagnostics.copy` | Copy Diagnostics | `$(copy)` | troubleshooting@3 (on server) | `viewItem =~ /jsm\.server\./` | Generate + copy diagnostics bundle | mandatory |
| `jsm.templates.manage` | Manage Templates | `$(settings-gear)` | view/title@3 | `view == javaServerManagerView` | Open template management UI | target |

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

### 9.2 OperationQueue

`[REQUIREMENT]` One queue per server. FIFO execution. One active operation at a time per server.

```ts
type OperationKind =
  | 'LifecycleStart'
  | 'LifecycleStop'
  | 'LifecycleRestart'
  | 'DeployFull'
  | 'DeployIncremental'
  | 'Undeploy'
  | 'StatusRefresh';

interface OperationContext {
  operationId: OperationId;
  serverId: ServerId;
  kind: OperationKind;
  startedAt: number;
  timeoutMs: number;
  cancel: CancellationToken;
  progress: (message: string) => void;
  output: OutputSink;
}
```

### 9.3 Coalescing Matrix

`[REQUIREMENT]`

| Active/Pending | New Operation | Result |
|---|---|---|
| `StatusRefresh` | `StatusRefresh` | Keep last only |
| `Sync(dep1)` | `Sync(dep1)` | Keep last (same deployment) |
| `Sync(dep1)` | `Sync(dep2)` | Queue both |
| `SyncAll` | `Sync(any)` | Drop new sync (SyncAll covers it) |
| `Sync(any)` | `SyncAll` | Replace with SyncAll |
| `Start(run)` | `Start(run)` | Ignore new (already starting) |
| `Start(run)` | `Start(debug)` | Replace pending with debug |
| `Start(debug)` | `Start(run)` | Replace pending with run |
| `Start(any)` | `Stop` | Queue stop (waits for start) |
| `Stop` | `Start(any)` | Queue start (waits for stop) |
| Any | `Cancel` | **Immediate**: abort active + clear queue |

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
- If a file copy is in progress: stop at next checkpoint, leave partial state.
- Emit `OperationFailed` with `error.code = 'Cancelled'` (severity `info`).
- State must remain consistent (no half-transitions).

### 9.6 Timeouts (Canonical)

`[REQUIREMENT]` All timeout values in one place. Units are milliseconds.

| Operation | Default Timeout (ms) | Config Override Field |
|---|---|---|
| Start (run) | 30 000 | — |
| Start (debug) | 45 000 | — |
| Stop (graceful) | 20 000 | — |
| Stop → force kill escalation | 5 000 | — |
| Deploy full | 60 000 | — |
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

---

## 10. Deploy and AutoSync

### 10.1 Target Mapping (Tomcat)

`[REQUIREMENT]` Uses `instancePath` as the per-server instance directory (Tomcat: `CATALINA_BASE`). The plugin resolves `instancePath` to the appropriate server-specific environment variable.

| Type | Source | Target |
|---|---|---|
| WAR | `<sourcePath>.war` | `<instancePath>/webapps/<deployName>.war` |
| Exploded | `<sourcePath>/` | `<instancePath>/webapps/<deployName>/` |

### 10.2 DecisionEngine — Sync Strategy

`[REQUIREMENT]` The DecisionEngine is a pure function with no side effects.

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

### 10.5 Failure Cooldown

`[DESIGN]` Per server/deployment short-term memory:

- If an operation fails twice within 10 minutes: set 2-minute cooldown, switch to safer strategy on next attempt.
- Example: incremental fails twice → prefer full.

### 10.6 Hook Lifecycle

`[DESIGN]` Hooks run within the OperationQueue. Cancellation propagates. All hook logs include `operationId`.

Hook phases: `pre` (before operation), `post` (after success), `onError` (after failure).

Hook events: `lifecycle.start`, `lifecycle.stop`, `lifecycle.restart`, `deploy.full`, `deploy.incremental`, `deploy.undeploy`.

---

## 11. Logging, Diagnostics, Output Channels

### 11.1 Output Channels

`[REQUIREMENT]`

| Channel | Content |
|---|---|
| `JSM` | Core decisions, high-level events, warnings. |
| `JSM: <serverName>` | Server stdout/stderr, plugin logs, operation details. One channel per server. |

### 11.2 Structured Log Format

`[DESIGN]` Internal log events follow this shape:

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

`[REQUIREMENT]` Debug always binds to `127.0.0.1`. The JDWP address MUST be set as `JPDA_ADDRESS=127.0.0.1:<port>`. Never `*`, never `0.0.0.0`.

### 12.2 No Shell Execution

`[REQUIREMENT]` All process spawning uses `spawn()` with `shell: false` and an `argv` array. No string concatenation for command lines. On Windows, use `cmd.exe /d /s /c` with deterministic quoting (see infra/process).

### 12.3 AJP Disabled

`[REQUIREMENT]` On `instancePath` initialization (Tomcat: CATALINA_BASE), AJP connectors in `server.xml` are removed by default. Controlled by `TomcatPluginConfig.disableAjp` (default: `true`).

### 12.4 Path Validation

`[REQUIREMENT]` All user-supplied paths are normalized and validated before use:

- `deployName` must not contain `/`, `\`, or `..`.
- Source paths are resolved against workspace root.
- CATALINA_HOME and CATALINA_BASE must be absolute paths to existing, writable directories.

### 12.5 Secrets Storage

`[REQUIREMENT]` Any secret-like values (passwords, tokens) MUST be stored via VS Code `SecretStorage`. Workspace config files store only references, never raw secrets.

### 12.6 Log Redaction

`[REQUIREMENT]` Log output and diagnostics bundles redact values for keys matching `password|secret|token|key|auth`.

### 12.7 Webview CSP

`[REQUIREMENT]` If webviews are used, enforce a strict Content Security Policy: no inline scripts, no external resource loads.

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

`[DESIGN]` OS matrix: run unit/integration on Linux + macOS + Windows.

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
| D-07 | **schemaVersion start** | specs.md: workspace starts at v2 (post-migration from legacy), specs-extended: starts at v1 | Start at v1 | No backward compatibility required (per task constraints). Starting fresh at v1 is cleaner. No migration from legacy shapes needed. |
| D-08 | **Deploy command naming** | `jsm.deployment.fullRedeploy` (specs.md), `jsm.deployment.deployFull` (specs-extended) | `jsm.deployment.fullRedeploy` | "Full Redeploy" is clearer user-facing language. "Deploy Full" reads awkwardly. |
| D-09 | **vmArgs type** | `string` (current code, specs.md), `string[]` (specs-extended) | `string[]` | Array form is safer (no shell splitting), aligns with `spawn()` argv semantics, and avoids whitespace/quoting bugs. |
| D-10 | **Hook system** | (A) Simple `preStartCmd/postStopCmd` on ServerConfig (current code), (B) Full `HookConfig[]` with phases, events, kinds (specs-extended) | (B) Full hook system, marked as `[DESIGN]` | The full system is more powerful but the simple fields are inadequate for real use. Marking as DESIGN allows simpler initial implementation while preserving the target contract. |
| D-11 | **`openOutput` removal** | (A) Keep `jsm.server.openOutput` as a separate command alongside `openLogs`, (B) Remove `openOutput`, have `openLogs` show the `JSM: <serverName>` per-server output channel | (B) Merged into `openLogs` | The distinction between "Open Logs" (catalina.out file) and "Open Output" (VS Code channel) is an implementation detail, not a user concern. Since output channels already receive live server stdout/stderr, a single action is clearer and removes a redundant command. |
| D-12 | **Inline action scope** | (A) Include Edit and Undeploy in deployment inline; include Edit in server stopped/error inline, (B) Restrict inline to lifecycle-only on server (Run/Stop/Restart) and Sync-only on deployment | (B) Restricted inline | Inline is the fast lane — highest-frequency, low-risk actions only. Edit opens a form (secondary). Undeploy is destructive. Context menu satisfies discoverability without unsafe one-click access. |
| D-13 | **ServerConfig generic fields** | (A) Keep `catalinaHome`/`catalinaBase` as named fields in `ServerConfig`, (B) Rename to generic `homePath`/`instancePath` + optional `pluginConfig` discriminated union per plugin type | (B) Generic base + `pluginConfig` extension | `ServerConfig` is the common contract for all plugins. Tomcat-named fields leak implementation into the domain model. `homePath`/`instancePath` cover the same semantics for any servlet container. Truly Tomcat-only options (`shutdownPort`, `disableAjp`) move to `TomcatPluginConfig`. `ports.shutdown` was removed from the generic `ports` block and folded into `TomcatPluginConfig.shutdownPort`. |

---

## Appendix B: Roadmap

`[REFERENCE]` High-level milestones for context. Not normative.

### Milestone 1 — Tomcat Professional Core (v1)

- OperationQueue + cancellation + timeouts
- Wizard + templates (webview)
- Cross-platform Tomcat lifecycle (run/debug/stop/restart)
- Deploy WAR + exploded + smart sync + autosync
- Logs + diagnostics bundle
- Schema v1 + atomic persistence
- CI gates + unit tests for core

### Milestone 2 — Plugin Expansion Readiness

- Plugin capability negotiation proven with second plugin stub
- Jetty detect-only stub
- Plugin authoring documentation

---

*End of Normative Specification*
