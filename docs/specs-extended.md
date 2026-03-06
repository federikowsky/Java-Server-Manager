# Java Server Manager (JSM)

## **Executable Specification** — v1.0 (Tomcat-first, plugin-ready)

**Intent:** Freeze a spec that can be implemented *once* with minimal ambiguity.\
**Target:** VSCode extension for managing **local** Java application servers (Tomcat v1), designed for clean expansion to Jetty/WildFly/JBoss/WebLogic.

**Guarantee:** This document defines:

- exact features, commands, UX flows
- strict architecture boundaries
- plugin contracts and capability negotiation
- config schemas (keys, defaults) + migrations
- operation semantics (idempotency, cancellation, timeouts)
- performance/reliability/security requirements
- test plan + CI gates

---

## Table of Contents

1. [Goals and Non-goals](#1-goals-and-non-goals)
2. [User Experience](#2-user-experience)
3. [Functional Requirements](#3-functional-requirements)
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [Architecture and Boundaries](#5-architecture-and-boundaries)
6. [Domain Model and Types](#6-domain-model-and-types)
7. [Operations Model](#7-operations-model)
8. [Plugin System](#8-plugin-system)
9. [Wizard, Templates, and Hooks](#9-wizard-templates-and-hooks)
10. [Deploy and Sync](#10-deploy-and-sync)
11. [Smart Decisions and Auto-Fallback](#11-smart-decisions-and-auto-fallback)
12. [Logging, Diagnostics, and Error UX](#12-logging-diagnostics-and-error-ux)
13. [Config, Storage, Schema, Migrations](#13-config-storage-schema-migrations)
14. [Security and Safety](#14-security-and-safety)
15. [Performance and Scalability](#15-performance-and-scalability)
16. [Tomcat Plugin Algorithmic Spec](#16-tomcat-plugin-algorithmic-spec)
17. [Testing Strategy](#17-testing-strategy)
18. [CI/CD](#18-cicd)
19. [Definition of Done](#19-definition-of-done)
20. [Refactor Plan from Current Repo](#20-refactor-plan-from-current-repo)
21. [E2E Scenarios](#21-e2e-scenarios)
22. [Roadmap](#22-roadmap)
23. [Appendix: Command Catalog](#23-appendix-command-catalog)
24. [Appendix: Config Schemas](#24-appendix-config-schemas)

---

## 1. Goals and Non-goals

### 1.1 Goals

- **Tomcat-first**: implement Tomcat plugin with run/debug lifecycle, deploy, logs, autosync.
- **Plugin-ready**: the core must support additional server plugins without core rewrites.
- **Professional DX**: setup in minutes, clear actions, actionable errors, robust recovery.
- **Clean architecture**: SOLID, SRP, DRY, typed boundaries, testable core.

### 1.2 Non-goals (v1)

- Remote server orchestration, clusters, Kubernetes.
- Production deployment management.
- Full Maven/Gradle integration beyond optional hooks.
- Telemetry by default (must be opt-in).

---

## 2. User Experience

### 2.1 Primary surfaces

- **Tree View**: `Java Server Manager` in Activity Bar
  - Servers (workspace scope)
  - Deployments under each server
  - State indicator (icon/badge)
- **Commands**: Command Palette + right-click context menus
- **Output Channels**:
  - `JSM` (core)
  - `JSM: <serverName>` (server-scoped)
- **Editor integration**:
  - Logs open as editor tabs when file-backed
  - Config opens as JSON (workspace)

### 2.2 Primary flows (exact)

#### Flow A — Quick Start (Add Server)
1. User clicks **Add** in view toolbar OR runs `jsm.server.add`
2. Wizard runs:
   - Pick / detect Tomcat **runtime** (`CATALINA_HOME`)
   - Pick / detect `JAVA_HOME`
   - Choose ports (HTTP + Debug)
   - Optional: add deployments
   - Autosync defaults
   - Save
3. Server appears in tree (state: stopped)
4. User can **Start Run** or **Start Debug** from inline actions

#### Flow B — Daily loop
- Start server (run/debug)
- Click deployment **Sync** (one action)
- Autosync keeps exploded deployments updated
- Troubleshoot via **Open Logs** + output channels
- Stop server

#### Flow C — Troubleshooting
- `Copy Diagnostics` from context menu
- “Open Config” and “Open Logs” are always reachable from right-click

### 2.3 Minimal UI with complete inline actions

> Principle: **Tree is minimal and readable. Inline actions are the fast lane. Everything else is in right-click.**

#### 2.3.1 Tree layout
- `Java Server Manager` (view title actions only)
  - `Tomcat • <name> • <state>`
    - `<deploymentName> • <state>`

No extra nodes (no Logs, no Actions, no groups).

Tooltips:
- Server tooltip includes: `httpUrl`, `pid`, `runtimeName/version`, `lastTransitionAt`, `lastError.message` (if any).
- Deployment tooltip includes: `type`, `sourcePath`, `lastSyncAt`, `lastError.message` (if any).

#### 2.3.2 Inline actions (fast lane)
Use VS Code `view/item/context` with `group: "inline"`.

**Server inline actions MUST be complete for daily use** (state-dependent):

When server is `stopped` or `error`:
- **Run** (Start Run)
- **Debug** (Start Debug)
- **Edit** (Edit Server)
- **Remove** (optional; can be context-only if you want it safer)

When server is `running`:
- **Stop**
- **Restart** (Run)
- **Restart Debug**
- **Open Output**

When server is `starting` or `stopping`:
- **Cancel** (cancels the active operation)
- **Open Output**

Notes:
- Inline actions are enabled/disabled via `enablement` and must never throw when disabled.
- Keep iconography standard (codicons).

**Deployment inline actions (always):**
- **Sync** (single command; auto strategy)
- **Undeploy**
- **Edit**

(Full Redeploy stays in right-click; Sync chooses strategy automatically.)

#### 2.3.2.1 Inline action contribution mapping (exact)

Inline actions must be contributed with deterministic ordering.

**Server item** (contextValue = `jsm.server.<state>`):

- `jsm.server.stopped` or `jsm.server.error` (order):
  1. `jsm.server.startRun`  (label: Run)
  2. `jsm.server.startDebug` (label: Debug)
  3. `jsm.server.edit`
  4. `jsm.server.openOutput`

- `jsm.server.running` (order):
  1. `jsm.server.stop`
  2. `jsm.server.restartRun`
  3. `jsm.server.restartDebug`
  4. `jsm.server.openOutput`

- `jsm.server.starting` or `jsm.server.stopping` (order):
  1. `jsm.server.cancelOperation`
  2. `jsm.server.openOutput`

**Deployment item** (contextValue = `jsm.deployment.<state>`):
- Always (order):
  1. `jsm.deployment.sync` (label: Sync)
  2. `jsm.deployment.undeploy`
  3. `jsm.deployment.edit`

Rules:
- Inline actions must be hidden when the command is not meaningful (use `when` clauses), not just disabled.
- Labels must be short (1 word) and consistent.

#### 2.3.3 View title actions (top-right toolbar)
Minimal, global-only:
- Add Tomcat Server
- Refresh
- Open Docs

#### 2.3.4 Context menus (right-click)
All non-inline actions live here.

Server context menu (grouped):
- Lifecycle: Run, Debug, Stop, Restart Run, Restart Debug, Refresh Status
- Deploy: Sync All, Full Redeploy All
- Manage: Edit, Duplicate, Remove
- Troubleshooting: Open Logs, Open Output, Copy Diagnostics

Deployment context menu:
- Actions: Sync, Full Redeploy, Undeploy
- Autosync: Toggle Autosync, Configure Ignore Globs
- Manage: Edit, Remove
- Troubleshooting: Open Logs

View background context menu:
- Add Tomcat Server, Refresh, Open Docs

#### 2.3.5 Primary interactions
- Click server item: **no-op** (do not surprise-run). The fast lane is inline actions.
- Click deployment item: **no-op** (same reason).

Rationale: avoid accidental Start/Stop; inline actions are explicit and still one-click.



Yes, we will support **many Tomcat servers from one Tomcat installation** using the standard split:

- `CATALINA_HOME` = Tomcat install (shared binaries/jars)
- `CATALINA_BASE` = per-server instance (conf, logs, webapps, temp, work)

This enables:

- multiple independent Tomcat servers (different ports/JVM args/deployments)
- easy upgrades (update one runtime, many servers benefit)
- minimal disk duplication

#### 2.4 Tomcat runtimes and servers (automatic multi-instance)

We support **many Tomcat servers from one Tomcat installation** using the standard split:
- `CATALINA_HOME` = Tomcat runtime install (shared binaries/jars)
- `CATALINA_BASE` = per-server instance (conf/logs/webapps/temp/work)

#### 2.4.1 Runtime model

**TomcatRuntime** (global, reusable; stored in Global Storage)
- `id: string`
- `name: string`
- `catalinaHome: AbsolutePath`
- `version?: string`
- `platform: 'unix'|'windows'`
- `validatedAt: epochMs`

**TomcatServer** (workspace; references runtime)
- `id: string`
- `name: string`
- `runtimeId: string`
- `catalinaBase: AbsolutePath` (unique per server; created automatically)
- ports + java + deployments (see §6.4)

#### 2.4.2 Automatic linking behavior
When the user creates a server:
- If a runtime with the same `catalinaHome` already exists → **reuse** it (same `runtimeId`).
- Else → create new runtime entry.

No duplication of runtime files.

#### 2.4.3 Automatic base creation (default)
Default base location:
- `${workspace}/.jsm/tomcat-bases/<serverId>/`

On creation, JSM must:
1) Create base folders:
   - `conf/`, `logs/`, `webapps/`, `temp/`, `work/`
2) Seed `conf/` from runtime:
   - Copy `${CATALINA_HOME}/conf/*` → `${CATALINA_BASE}/conf/*`
3) Patch ports in `${CATALINA_BASE}/conf/server.xml` deterministically:
   - `Server@port` (shutdown port) ← `ports.shutdown` (or auto-suggested)
   - `Connector@port` for HTTP ← `ports.http`
   - If AJP present: default behavior is **disable AJP** unless explicitly enabled in Advanced.

Patch must be implemented via an XML parser (not brittle regex) and must be unit-tested.

#### 2.4.4 Advanced options (optional)
- “Use existing CATALINA_BASE” can be exposed in wizard under **Advanced**.
- In that mode JSM validates the base and patches ports only if user confirms.

#### 2.4.5 Start contract
On start, environment must include:
- `CATALINA_HOME = runtime.catalinaHome`
- `CATALINA_BASE = server.catalinaBase`

Additionally set JVM system props:
- `-Dcatalina.home=$CATALINA_HOME`
- `-Dcatalina.base=$CATALINA_BASE`

#### 2.4.6 Constraints
- Each server instance must have unique ports.
- Base directory must be writable.
- Debug binds `127.0.0.1` by default.

---

## 3. Functional Requirements

### 3.1 Server lifecycle

Commands (see appendix) must implement:

- `Start Run`
- `Start Debug` (with auto-attach)
- `Stop`
- `Restart Run`
- `Restart Debug`
- `Status Refresh`

Lifecycle semantics:

- **Serialized per server** (no concurrent ops) via OperationQueue.
- **Idempotent stop**: if already stopped → OK.
- **Start when running**: returns `AlreadyRunning` (default behavior: show info, no action). Configurable as strict error.
- **Cancellation**: user-initiated cancel must stop waiting and attempt cleanup.
- **Timeouts**: default timeouts per operation (see §7.5).

### 3.2 Deployments

Support deployment types:

- `war` (file)
- `exploded` (directory)

Support operations:

- Add/Edit/Remove deployment
- Deploy
- Undeploy
- Full redeploy
- Incremental deploy (exploded only in v1; capability-based)

Deployment semantics:

- Deploy ops must be serialized per server.
- If server is stopped and user deploys:
  - default policy: deploy allowed (copy files), but readiness checks skipped.
  - optional policy: prompt to start.

### 3.3 Autosync

Autosync requirements:

- Exploded deployments only by default.
- Watcher coalesces file events and enqueues `IncrementalSync` operation.
- Must support ignore globs and storm protection.

### 3.4 Logs

- Must support opening relevant logs for the server.
- Must support tail/follow for at least one primary log source.
- Must support quick copy of last N lines for diagnostics.

### 3.5 Templates

- Global templates (user scope)
- Workspace templates (optional)
- Wizard can start from template

### 3.6 Hooks (first-class)

- Pre/post/onError hooks for lifecycle and deploy.
- Hooks defined at:
  - template level (defaults)
  - server level
  - deployment level
- Hooks must be cancellable and time-bounded.

---

## 4. Non-Functional Requirements

### 4.1 Performance budgets

- Activation < **200ms** (no scanning disk).
- Tree view refresh for 10 servers < **50ms** (lazy status fetch).
- Watcher storm CPU bounded: rate-limited batching.

### 4.2 Reliability

- No inconsistent state after failures.
- No zombie processes.
- Recovery after restart: reconcile runtime state.

### 4.3 Compatibility

- macOS/Linux/Windows for Tomcat.
- Path handling cross-platform.

### 4.4 DX requirements

- Every failure surfaced as:
  - short summary
  - precise cause (best effort)
  - suggested fix steps
  - copy diagnostics action

### 4.5 Security/Safety

- Debug binds **127.0.0.1** by default.
- Never use `shell: true`.
- Secrets stored only in SecretStorage.

---

## 5. Architecture and Boundaries

### 5.1 Layering

**Strict dependency rule**

- `core/*` depends on nothing else (no VSCode import).
- `app/*` orchestrates use-cases, depends on `core` + `infra`.
- `plugins/*` implement server support, depend on `core` + `infra`.
- `ui/*` contains VSCode UI only, depends on `app`.
- `infra/*` contains adapters for FS/process/vscode/storage.

### 5.2 File layout (target)

```
src/
  core/
    domain/
    errors/
    events/
    fsm/
    ops/
    policy/
  app/
    usecases/
    services/
  plugins/
    tomcat/
    registry/
  infra/
    fs/
    process/
    ports/
    storage/
    logging/
    vscode/
  ui/
    commands/
    treeview/
    webviews/
```

### 5.3 Refactor policy (from existing code)

If current repo already has `services/`, `core/`, `ui/`, `plugins/`:

- Keep what maps cleanly.
- Move VSCode-only dependencies out of core.
- Replace stringly-typed EventBus with typed events.
- Replace singleton managers with explicit dependency injection at app boundary.

---

## 6. Domain Model and Types

### 6.1 IDs

- `ServerId` = UUID v4 string
- `DeploymentId` = UUID v4 string
- `TemplateId` = UUID v4 string
- `OperationId` = UUID v4 string

### 6.2 Core enums

```ts
export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
export type DeploymentState = 'undeployed' | 'deploying' | 'synced' | 'error';
export type StartMode = 'run' | 'debug';
export type DeploymentType = 'war' | 'exploded';
export type SyncMode = 'off' | 'manual' | 'auto';
```

### 6.3 Result and Error model

```ts
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export type ErrorSeverity = 'info' | 'warning' | 'error';

export type ErrorCode =
  // Config / persistence
  | 'InvalidConfig'
  | 'ValidationFailed'
  | 'ConfigReadFailed'
  | 'ConfigWriteFailed'
  | 'MigrationFailed'

  // Concurrency / state
  | 'OperationInProgress'
  | 'AlreadyRunning'
  | 'NotRunning'

  // Process / execution
  | 'ProcessSpawnFailed'
  | 'ProcessNotFound'
  | 'ProcessKillFailed'
  | 'ScriptNotExecutable'
  | 'JavaNotFound'

  // Network / ports
  | 'PortInUse'
  | 'Timeout'

  // Deploy
  | 'DeployFailed'
  | 'UndeployFailed'
  | 'SourceNotFound'
  | 'TargetNotWritable'

  // Logs / hooks
  | 'LogNotFound'
  | 'HookFailed'

  // Generic
  | 'Cancelled'
  | 'Unsupported'
  | 'Unknown';

export interface JsmError {
  code: ErrorCode;
  severity: ErrorSeverity;
  message: string;        // user-facing summary
  details?: string;       // technical detail
  suggestedFix?: string[]; // user-facing steps
  cause?: unknown;
}
```

### 6.4 Config objects (canonical)

> These are the canonical shapes used by schema and code.

```ts
export interface JsmWorkspaceConfig {
  schemaVersion: number; // integer
  servers: ServerConfig[];
}

export interface ServerConfig {
  id: ServerId;
  name: string;
  type: 'tomcat';

  // Tomcat runtime + instance
  runtime: {
    id: string;                 // stable runtime id (stored in global registry)
    catalinaHome: string;       // absolute path (CATALINA_HOME)
    version?: string;           // optional cached detection
  };
  catalinaBase: string;         // absolute path (CATALINA_BASE)

  host: string;                 // default '127.0.0.1'
  ports: {
    http: number;               // default 8080
    shutdown?: number;          // optional
    ajp?: number;               // optional (disabled by default)
    debug: number;              // default 5005
  };

  run: {
    env: Record<string, string>;     // non-secret
    vmArgs: string[];                // split array
    programArgs: string[];           // plugin-defined args
    cwd?: string;                    // optional
  };

  debug: {
    enabled: boolean;                // default true
    bind: '127.0.0.1' | 'localhost'; // default 127.0.0.1
    port: number;                    // mirrors ports.debug
    attachDelayMs: number;           // default 1000
    vscodeLaunchConfigName?: string; // optional advanced
  };

  deployments: DeploymentConfig[];

  autosync: {
    enabled: boolean;
    debounceMs: number;              // default 400
    maxBatchFiles: number;           // default 200
    maxBatchBytes: number;           // default 20_000_000
    stormBackoffMs: number;          // default 2000
    ignoreGlobs: string[];           // default common ignores
  };

  hooks: HookConfig[];               // lifecycle hooks
}

export interface DeploymentConfig {
  id: DeploymentId;
  name: string;
  type: DeploymentType;
  sourcePath: string;        // absolute or workspace-relative
  deployName: string;        // e.g. 'app'
  syncMode: SyncMode;        // default 'auto' for exploded, 'manual' for war
  ignoreGlobs: string[];     // per-deployment ignores
  hooks: HookConfig[];       // deploy hooks
}
```

### 6.5 Runtime state (not primary config)

Runtime must not be the source of truth. It is derived and recoverable.

```ts
export interface ServerRuntimeState {
  serverId: ServerId;
  state: ServerState;
  pid?: number;
  lastTransitionAt: number; // epoch ms
  lastError?: JsmError;
  lastStartMode?: StartMode;
}

export interface DeploymentRuntimeState {
  serverId: ServerId;
  deploymentId: DeploymentId;
  state: DeploymentState;
  lastSyncAt?: number;
  lastError?: JsmError;
}
```

---

## 7. Operations Model

### 7.1 OperationQueue (per server)

- One queue per server.
- FIFO execution.
- Coalescing allowed for sync ops.
- Persisted runtime state is updated only at safe points.

```ts
export type OperationKind =
  | 'LifecycleStart'
  | 'LifecycleStop'
  | 'LifecycleRestart'
  | 'DeployFull'
  | 'DeployIncremental'
  | 'Undeploy'
  | 'StatusRefresh'
  | 'HealthCheck'

  // Non-mutating UX ops (still tracked for diagnostics)
  | 'OpenLogs'
  | 'OpenOutput'
  | 'CopyDiagnostics'

  // Config mutations
  | 'UpdateConfig';

export interface OperationContext {
  operationId: OperationId;
  serverId: ServerId;
  kind: OperationKind;
  startedAt: number;
  timeoutMs: number;
  cancel: CancelToken;
}
```

### 7.2 Cancellation

- Any operation must check cancellation at least:
  - before spawning processes
  - before/after heavy FS copy batch
  - between hook phases
- On cancellation:
  - stop waiting for readiness
  - if started process and operation kind is start: attempt stop/kill cleanup

### 7.3 Idempotency rules

- `Stop` on stopped → OK
- `Start` on running → `AlreadyRunning` (default non-fatal)
- `Deploy` if target exists → overwrite permitted (atomic write strategy)

### 7.4 Timeouts (defaults)

- Start run: 30s
- Start debug: 45s
- Stop: 20s
- Deploy full: 60s
- Deploy incremental batch: 10s
- Health check: 3s

### 7.5 Readiness checks

- For Tomcat, readiness is a policy:
  - default: TCP connect to `host:http` with retries
  - optional: HTTP GET `/` expecting any response

### 7.6 Eventing contracts

Core must emit typed events for UI refresh and diagnostics.

Event names (exact):

- `WorkspaceLoaded`
- `ServerAdded`
- `ServerUpdated`
- `ServerDeleted`
- `ServerStateChanged`
- `DeploymentAdded`
- `DeploymentUpdated`
- `DeploymentRemoved`
- `DeploymentStateChanged`
- `OperationStarted`
- `OperationCompleted`
- `OperationFailed`

Event payload requirements:

- Must include `serverId` for server-scoped events.
- Must include `operationId` for operation events.
- Must include `error` (JsmError) on failures.

### 7.7 Command-to-operation contracts (canonical)

> UI commands are thin. They must call a single use-case which enqueues exactly one operation per intent.

Also:

- Primary click command must be **contextual** (Start/Stop for server; Sync for deployment).
- Inline actions expose the top 2–3 commands only (see §2.3.3).

For each command below, the contract is required.

#### `jsm.server.startRun`

- Preconditions: server exists; no operation in progress
- DecisionEngine: validates ports; readiness policy
- OperationKind: `LifecycleStart`
- Runtime transitions:
  - server: `stopped` → `starting` → `running` OR `error`
- Notifications:
  - start: “Starting Tomcat: …”
  - success: “Tomcat is running at http\://:”
- Events:
  - `OperationStarted`, `ServerStateChanged` (starting)
  - on success: `ServerStateChanged` (running), `OperationCompleted`
  - on failure: `ServerStateChanged` (error), `OperationFailed`

#### `jsm.server.startDebug`

- Same as startRun, plus:
  - enforce debug bind localhost
  - auto-attach after delay

#### `jsm.server.stop`

- Preconditions: server exists
- OperationKind: `LifecycleStop`
- Runtime transitions:
  - `running|starting` → `stopping` → `stopped` OR `error`
- Stop strategy: graceful then force (DecisionEngine)

#### `jsm.server.cancelOperation`

- Preconditions: server exists; an operation is in progress for that server
- OperationKind: cancels the **active** operation (no new operation enqueued)
- Behavior:
  - Signal cancellation token
  - If active op is `LifecycleStart` and a process was spawned: attempt `stop` escalation (graceful → kill tree)
  - If active op is a file copy: stop at next cancellation checkpoint
- Events:
  - `OperationFailed` with `error.code = 'Cancelled'` (severity `info`)
  - State must remain consistent (no half-transition)

#### `jsm.server.restartRun`

- OperationKind: `LifecycleRestart`
- Must be implemented as: stop (graceful→force) then start
- Dedup rule: if a restart is queued while stop/start in progress, coalesce into single restart.

#### `jsm.server.restartDebug`

- Same as restartRun but start in debug.

#### `jsm.deployment.sync`

- Preconditions: deployment exists
- OperationKind: `DeployIncremental` OR `DeployFull` (DecisionEngine)
- Runtime transitions:
  - `synced|error|undeployed` → `deploying` → `synced` OR `error`
- Must log decision reasons (incremental vs full)

#### `jsm.deployment.fullRedeploy`

- OperationKind: `DeployFull`
- Must always perform full, no smart decision.

#### `jsm.deployment.undeploy`

- OperationKind: `Undeploy`
- Must be idempotent.

#### `jsm.deployment.toggleAutosync`

- OperationKind: `UpdateConfig`
- Must persist config + emit `DeploymentUpdated`.

#### `jsm.server.openOutput`

- Must focus the output channel for the server.

#### `jsm.server.openLogs` / `jsm.deployment.openLogs`

- OperationKind: `OpenLogs`
- Must select best log source deterministically.

#### `jsm.diagnostics.copy`

- Must never throw.
- On failure: returns minimal bundle + error summary.

---

## 8.

---

## 8. Plugin System

### 8.1 Plugin registry

- Registry maps `pluginType` → plugin factory.
- Plugins are stateless where possible.
- Plugin instance may cache computed info (e.g., detected version) but must not store VSCode references.

### 8.2 Capability negotiation

```ts
export interface PluginCapabilities {
  supportsAutoDetect: boolean;
  supportsDebugAttach: boolean;
  supportsLogFollow: boolean;
  supportsExplodedDeploy: boolean;
  supportsWarDeploy: boolean;
  supportsIncrementalDeploy: boolean;
}
```

### 8.3 Plugin contracts (final)

#### `IServerPlugin`

```ts
export interface IServerPlugin {
  readonly type: string;         // stable id, e.g. 'tomcat'
  readonly displayName: string;  // e.g. 'Apache Tomcat'

  getCapabilities(): PluginCapabilities;

  // Detection and validation
  detectInstallations?(): Promise<Result<DetectedInstallation[], JsmError>>;
  detectInstallation(catalinaHome: string): Promise<Result<DetectReport, JsmError>>;
  validateConfig(config: ServerConfig): Promise<Result<void, JsmError>>;

  // Lifecycle
  start(ctx: OperationContext, config: ServerConfig, mode: StartMode): Promise<Result<StartResult, JsmError>>;
  stop(ctx: OperationContext, config: ServerConfig): Promise<Result<void, JsmError>>;
  restart(ctx: OperationContext, config: ServerConfig, mode: StartMode): Promise<Result<StartResult, JsmError>>;

  // Status
  getStatus(ctx: OperationContext, config: ServerConfig): Promise<Result<StatusReport, JsmError>>;
  healthCheck?(ctx: OperationContext, config: ServerConfig): Promise<Result<HealthReport, JsmError>>;

  // Deploy
  planDeploy(ctx: OperationContext, config: ServerConfig, dep: DeploymentConfig): Promise<Result<DeployPlan, JsmError>>;
  deployFull(ctx: OperationContext, config: ServerConfig, dep: DeploymentConfig, plan: DeployPlan): Promise<Result<DeployResult, JsmError>>;
  undeploy(ctx: OperationContext, config: ServerConfig, dep: DeploymentConfig): Promise<Result<void, JsmError>>;
  deployIncremental?(ctx: OperationContext, config: ServerConfig, dep: DeploymentConfig, changes: FileChangeBatch, plan: DeployPlan): Promise<Result<void, JsmError>>;

  // Logs
  getLogSources(ctx: OperationContext, config: ServerConfig): Promise<Result<LogSources, JsmError>>;

  // Cleanup
  dispose?(): Promise<void>;
}
```

#### Report types (final)

```ts
export interface DetectedInstallation {
  catalinaHome: string;
  version?: string;
  confidence: 'high' | 'medium' | 'low';
  notes?: string[];
}

export interface DetectCheck {
  id: string;
  ok: boolean;
  message: string;
}

export interface DetectReport {
  ok: boolean;
  version?: string;
  checks: DetectCheck[];
  warnings: string[];
}

export interface StartResult {
  pid: number;
  httpUrl?: string;        // derived
  debugPort?: number;
  hints: string[];
}

export interface StatusReport {
  state: ServerState;
  pid?: number;
  httpPort?: number;
  lastError?: JsmError;
}

export interface HealthReport {
  ok: boolean;
  latencyMs?: number;
}

export interface LogSource {
  id: string;              // stable per plugin
  title: string;           // display
  kind: 'file' | 'process-stdout';
  path?: string;           // absolute if kind=file
}

export interface LogSources {
  primary?: LogSource;
  others: LogSource[];
}

export interface DeployPlan {
  targetRoot: string;          // absolute
  targetPath: string;          // absolute
  strategy: 'copy-war' | 'copy-dir' | 'incremental-dir';
  notes: string[];
}

export interface DeployResult {
  strategy: DeployPlan['strategy'];
  deployedPath: string;
  warnings: string[];
}

export type FileChangeType = 'add' | 'change' | 'delete' | 'rename';

export interface FileChange {
  type: FileChangeType;
  from?: string; // absolute
  to?: string;   // absolute
  path: string;  // absolute
  sizeBytes?: number;
}

export interface FileChangeBatch {
  changes: FileChange[];
  totalFiles: number;
  totalBytes: number;
}
```

---

## 9. Wizard, Templates, and Hooks

### 9.1 Wizard principles

- No blocking operations on UI thread.
- Every validation error must include suggested fix.
- Wizard must be restartable: user can go back without losing inputs.
- Wizard supports template import at step 0.

### 9.2 Wizard — exact pages

#### 9.2.1 Page 0 — Choose setup method

- Options:
  - **Use Template**
  - **Auto-detect Tomcat**
  - **Manual Setup**

If template chosen: pre-fill all fields and still validate.

#### 9.2.2 Page 1 — Tomcat runtime (CATALINA_HOME)

- Input: directory picker + editable text
- Behavior:
  - If the selected `catalinaHome` matches an existing runtime in global registry → reuse it automatically
  - Else create a new runtime entry (validated + version-detected)

Validation checks (must be implemented exactly):
- directory exists
- contains `bin/`
- contains `conf/`
- contains `lib/`
- contains executable script:
  - on Unix: `bin/catalina.sh`
  - on Windows: `bin/catalina.bat`

Version detection (best effort):
- prefer `bin/version.sh` (Unix) / `bin/version.bat` (Windows)
- fallback: parse `RELEASE-NOTES` / `RUNNING.txt` if present

##### 9.2.2.1 CATALINA_BASE (automatic)

By default JSM creates a fresh instance folder:
- `${workspace}/.jsm/tomcat-bases/<serverId>/`

The wizard shows it as read-only text with an **Advanced** toggle:
- Advanced: “Use existing CATALINA_BASE” (directory picker)

Base validation:
- base dir exists or can be created
- base dir writable

If base is created (default):
- seed `${CATALINA_HOME}/conf/*` → `${CATALINA_BASE}/conf/*`
- patch `${CATALINA_BASE}/conf/server.xml` ports to match wizard selections

#### 9.2.3 Page 2 — Java home

- Input: directory picker + editable text
- Validation:
  - directory exists
  - contains `bin/java` (or `bin/java.exe`)
  - running `java -version` succeeds (via ProcessManager, timeout 3s)

#### 9.2.4 Page 3 — Ports

- Fields: HTTP port, Debug port
- Behavior:
  - auto-suggest free ports (probe)
  - if chosen port is in use: block with fix suggestion
- Debug bind fixed to `127.0.0.1` by default.

#### 9.2.5 Page 4 — Deployments (optional)

- Add deployment entries:
  - type: war/exploded
  - sourcePath picker
  - deployName
  - syncMode default:
    - exploded → auto
    - war → manual

#### 9.2.6 Page 5 — Autosync

- Toggle
- Debounce ms (default 400)
- Ignore patterns: default list + custom

Default ignore globs:

- `**/.git/**`
- `**/node_modules/**`
- `**/target/**`
- `**/build/**`
- `**/.gradle/**`
- `**/.idea/**`
- `**/.classpath`
- `**/.project`

#### 9.2.7 Page 6 — Summary & Save

- Show normalized config preview
- Save to workspace config
- Offer actions:
  - Start Run
  - Start Debug
  - Open Config File

### 9.3 Templates

#### 9.3.1 Template storage

- Global templates file: `${globalStorage}/jsm.templates.json`
- Workspace templates file (optional): `.vscode/jsm.templates.json`

#### 9.3.2 Template schema

```ts
export interface Template {
  id: TemplateId;
  templateVersion: number;
  name: string;
  pluginType: string; // 'tomcat'
  serverDefaults: Partial<ServerConfig>;
  deploymentDefaults: Partial<DeploymentConfig>[];
  hookDefaults: HookConfig[];
}
```

### 9.4 Hooks

#### 9.4.1 Hook lifecycle

Hooks may run:

- `pre`
- `post`
- `onError`

Hook events:

- `lifecycle.start`
- `lifecycle.stop`
- `lifecycle.restart`
- `deploy.full`
- `deploy.incremental`
- `deploy.undeploy`
- `wizard.finish`

#### 9.4.2 Hook contract (final)

```ts
export type HookPhase = 'pre' | 'post' | 'onError';
export type HookEvent =
  | 'lifecycle.start'
  | 'lifecycle.stop'
  | 'lifecycle.restart'
  | 'deploy.full'
  | 'deploy.incremental'
  | 'deploy.undeploy'
  | 'wizard.finish';

export type HookKind = 'command' | 'vscodeTask';

export interface HookConfig {
  id: string;
  enabled: boolean;
  phase: HookPhase;
  event: HookEvent;
  kind: HookKind;
  timeoutMs: number; // default 60_000
  continueOnError: boolean; // default false

  // kind=command
  command?: {
    exe: string;           // absolute or PATH-resolved
    args: string[];
    cwd?: string;
    env?: Record<string,string>;
  };

  // kind=vscodeTask
  vscodeTask?: {
    taskName: string;
  };
}
```

Hook execution rules:

- Runs within the server OperationQueue.
- Cancellation propagates.
- All hook logs include operationId.

---

## 10. Deploy and Sync

### 10.1 Target mapping (Tomcat)

Target mapping uses **CATALINA_BASE** (per-server instance):
- WAR target: `<CATALINA_BASE>/webapps/<deployName>.war`
- Exploded target: `<CATALINA_BASE>/webapps/<deployName>/`

### 10.2 Deploy plan algorithm

1. Validate deployment config (source exists, type matches)
2. Compute target paths (absolute)
3. Select strategy:
   - war → `copy-war`
   - exploded → `copy-dir` OR `incremental-dir`

### 10.3 Full deploy strategies

#### WAR: atomic copy

- Copy to temp file in same dir then rename:
  - `<deployName>.war.tmp` → `<deployName>.war`

#### Exploded: safe dir update

- Prefer incremental sync; for full copy:
  - copy to staging dir then swap if feasible
  - else overwrite file-by-file with safe order

### 10.4 Incremental sync (exploded)

#### Watcher batching

- Collect events within debounce window.
- Normalize to absolute paths.
- Apply ignore filters.
- Compute batch totals (files/bytes).

#### Storm protection

If:

- totalFiles > `maxBatchFiles` OR totalBytes > `maxBatchBytes` Then:
- do not run incremental
- emit UI suggestion: **"Too many changes; switching to Full Redeploy"** (if auto mode) or **"Consider Full Redeploy"** (if manual)
- apply backoff `stormBackoffMs`

#### Copy rules

- Add/change: copy file
- Delete: delete target
- Rename: best-effort (delete old + copy new)

---

## 11. Smart Decisions and Auto-Fallback

> DX rule: **Users trigger one obvious action. JSM chooses the safest and fastest strategy and handles edge cases automatically.**

### 11.1 Global decision engine

All “smart” decisions must be implemented by a pure component:

- `DecisionEngine` (pure, deterministic)
- Inputs: normalized config + runtime state + plugin capabilities + latest signals
- Output: `Decision` + `Reasons[]`

### 11.2 Smart decisions: Deploy/Sync (exploded)

Single user action per deployment:

- Exploded: **Sync**
- WAR: **Deploy**

Command:

- Canonical: `jsm.deployment.sync` (auto)
- Overrides:
  - `jsm.deployment.deployFull`

Decision policy (exploded):

- Choose **Incremental** if ALL:
  - `syncMode != off`
  - plugin supports incremental
  - batch within thresholds
  - not in cooldown
  - no repeated recent failures
- Else choose **Full**.

### 11.3 Smart decisions: Start/Debug

Primary server action is **Start** (Run).

- Debug start occurs only if user explicitly chooses “Start in Debug” or enabled sticky preference.

### 11.4 Smart decisions: Ports

- Wizard prevents saving occupied ports.
- At runtime, if a port becomes occupied, offer retry with suggested free port.

### 11.5 Smart decisions: Stop strategy

- Always attempt graceful stop.
- Escalate automatically to kill tree if needed.

### 11.6 Auto-fallback and cooldown (all operations)

Maintain per server/deployment short-term memory:

- `failureCounter[kind]`
- `lastFailureAt`
- `cooldownUntil`

Rules:

- If an operation fails twice within 10 minutes:
  - set cooldown 2 minutes
  - switch to safer strategy on next attempt

Examples:

- Incremental fails twice → prefer full
- Start readiness timeout twice → suggest raising timeout + check port conflicts

### 11.7 Smart decisions: Readiness

- Default: TCP connect.
- Optional: HTTP GET `/`.
- On failure: show top 3 likely causes.

### 11.8 Smart decisions: Logs

- Open Logs selects best available source deterministically.
- If none: `LogNotFound` with fixes.

---

## 12. Logging, Diagnostics, and Error UX

### 12.1 Structured logging format

Logger event (JSON line):

- `ts` ISO
- `level` one of `debug|info|warn|error`
- `scope` e.g. `core.ops`, `tomcat.lifecycle`
- `serverId`, `operationId`
- `msg`
- `data` (object)

### 12.2 Output routing

- OutputChannel `JSM` receives high-level events and warnings.
- OutputChannel `JSM: <server>` receives server stdout/stderr + plugin logs.

### 12.3 Diagnostics bundle (deterministic)

Command `jsm.diagnostics.copy` produces:

- extension version
- OS, arch, Node
- schemaVersion
- server config summary (no secrets)
- runtime state report
- last 200 lines from primary log source (sanitized)

### 12.4 Error UX standard

Every surfaced error must include:

- Title
- Details (code + root cause)
- Suggested fixes
- Buttons: `Copy Diagnostics`, `Open Config`, `Retry` (when safe)

### 12.5 Error matrix (retryability + UX)

Each `ErrorCode` defines:

- `retryable`: boolean
- `defaultSeverity`: `info|warning|error`
- `defaultSuggestedFix[]`: ordered list (top = most likely)

Canonical mapping (v1):

| ErrorCode           | Retryable | Severity | Default suggested fixes (ordered)                                                 |
| ------------------- | --------- | -------- | --------------------------------------------------------------------------------- |
| InvalidConfig       | yes       | error    | Open Config; Re-run wizard; Reset server entry                                    |
| ValidationFailed    | yes       | error    | Pick valid Tomcat folder; Pick valid JAVA\_HOME; Ensure scripts executable        |
| ConfigReadFailed    | yes       | error    | Check workspace permissions; Reopen workspace; Restore `.vscode/jsm.servers.json` |
| ConfigWriteFailed   | yes       | error    | Check disk/permissions; Close conflicting editors; Retry save                     |
| MigrationFailed     | yes       | error    | Backup config; Reset to defaults; Report diagnostics                              |
| OperationInProgress | yes       | info     | Wait for current operation; Cancel current operation; Retry                       |
| AlreadyRunning      | yes       | info     | Use Stop/Restart; Refresh status                                                  |
| NotRunning          | yes       | info     | Start the server; Refresh status                                                  |
| ProcessSpawnFailed  | yes       | error    | Check permissions; Verify JAVA\_HOME; Verify catalina script exists               |
| ProcessNotFound     | yes       | warning  | Refresh status; Re-run operation; Remove stale runtime state                      |
| ProcessKillFailed   | yes       | error    | Try force stop again; Check OS permissions; Kill manually and retry               |
| ScriptNotExecutable | yes       | error    | `chmod +x bin/catalina.sh`; Reinstall Tomcat; Fix file permissions                |
| JavaNotFound        | yes       | error    | Select correct JAVA\_HOME; Install JDK; Ensure `bin/java` exists                  |
| PortInUse           | yes       | error    | Pick free port; Stop other service; Change http/debug port                        |
| Timeout             | yes       | warning  | Check logs; Increase timeout; Check port conflicts                                |
| DeployFailed        | yes       | error    | Try Full Redeploy; Check target permissions; Check server logs                    |
| UndeployFailed      | yes       | warning  | Retry; Delete target manually; Check permissions                                  |
| SourceNotFound      | yes       | error    | Fix sourcePath; Build artifact; Re-run sync/deploy                                |
| TargetNotWritable   | yes       | error    | Fix permissions; Use different serverHome; Run with correct privileges            |
| LogNotFound         | yes       | info     | Start server; Check `logs/`; Verify log paths                                     |
| HookFailed          | yes       | warning  | Disable hook; Fix hook command/task; Re-run operation                             |
| Cancelled           | yes       | info     | Retry when ready                                                                  |
| Unsupported         | no        | error    | Use supported operation; Install plugin with capability; Upgrade extension        |
| Unknown             | yes       | error    | Copy diagnostics; Retry; Report bug                                               |

---

## 13. Config, Storage, Schema, Migrations

### 13.1 Canonical file paths

- Workspace config: `.vscode/jsm.servers.json`
- Workspace templates (optional): `.vscode/jsm.templates.json`
- Global templates: `${globalStorage}/jsm.templates.json`

### 13.2 Schema versioning

- `schemaVersion` integer in workspace config.
- Current v1: `schemaVersion = 1`.

### 13.3 Migration rules

- Migrations are pure functions:
  - `migrate_1_to_2(obj): obj2`
- Unknown fields preserved under `x-extra` at top-level (optional).
- Breaking changes require:
  - migration + tests
  - release note entry

### 13.4 Secrets storage

- Any secret-like values must be stored via VSCode `SecretStorage`.
- Workspace config stores only references.

---

## 14. Security and Safety

- Debug bind default: `127.0.0.1`
- No `shell: true`
- Validate executable paths and avoid user-controlled executable substitution where possible.
- Redact secrets in logs.
- Webview CSP strict (if used).

---

## 14. Performance and Scalability

### 14.1 Activation

- Must not scan disk or detect installations automatically.
- Defer detection to wizard.

### 14.2 Tree refresh

- Status fetch is lazy:
  - refresh UI immediately with cached state
  - schedule async status refresh per server with rate-limit

### 14.3 File I/O

- Workspace config saves are debounced.
- Writes are atomic (write temp then rename).

---

## 15. Testing Strategy

### 15.1 Unit tests (must-have)

- Migrator correctness
- OperationQueue serialization + cancellation
- Deploy planner mapping + ignore
- Error mapping (plugin → core)

### 15.2 Integration tests

- Fake plugin to simulate lifecycle + failures
- FS adapter tests with temp dirs

### 15.3 E2E tests

- VSCode test-electron smoke:
  - create server via config injection
  - run command start/stop (fake plugin)

---

## 16. CI/CD

### 16.1 CI gates (mandatory)

- lint
- typecheck
- unit tests
- integration tests
- build package

### 16.2 OS matrix

- run unit/integration on Linux + Windows + macOS

---

## 17. Definition of Done

A feature is DONE only if:

- spec behavior implemented exactly
- tests cover success + key failures
- logs and error UX are actionable
- no architecture boundary violations
- performance budgets not regressed

Release v1 is DONE only if:

- Wizard setup works on macOS/Linux/Windows
- Start/Stop/Deploy/Autosync stable in Tomcat
- Diagnostics bundle works
- CI green

---

## 22. Roadmap

### Milestone 1 — Tomcat Professional Core (v1)

- OperationQueue + cancellation + timeouts
- Wizard + templates
- Cross-platform Tomcat lifecycle
- Deploy war/exploded + smart sync
- Logs + diagnostics
- Schema v1 + migration framework
- CI gates + unit tests

### Milestone 2 — Plugin expansion readiness

- Capability negotiation proven
- Add Jetty detect-only stub
- Plugin authoring docs

---

## 23. Appendix: Command Catalog

**Servers**

- `jsm.server.add`
- `jsm.server.startRun`
- `jsm.server.startDebug`
- `jsm.server.stop`
- `jsm.server.restartRun`
- `jsm.server.restartDebug`
- `jsm.server.cancelOperation`
- `jsm.server.edit`
- `jsm.server.duplicate`
- `jsm.server.remove`
- `jsm.server.openHome`
- `jsm.server.openConfig`
- `jsm.server.openOutput`
- `jsm.server.openLogs`
- `jsm.server.refreshStatus`
- `jsm.server.syncAllDeployments`      # one-click convenience
- `jsm.server.fullRedeployAll`         # explicit override

**Deployments**

- `jsm.deployment.add`
- `jsm.deployment.edit`
- `jsm.deployment.remove`
- `jsm.deployment.sync`            # smart decision (incremental vs full)
- `jsm.deployment.deployFull`      # explicit override
- `jsm.deployment.undeploy`
- `jsm.deployment.toggleAutosync`

**Logs & Diagnostics**

- `jsm.logs.open`
- `jsm.diagnostics.copy`
- `jsm.diagnostics.open`

---

## 24. Appendix: Config Schemas

### 24.1 Workspace config file — `.vscode/jsm.servers.json`

**schemaVersion = 1**

Top-level:

- `schemaVersion`: integer (required)
- `servers`: array of ServerConfig

ServerConfig required fields:

- `id, name, type, runtime, catalinaBase, host, ports, run, debug, deployments, autosync, hooks`

DeploymentConfig required fields:

- `id, name, type, sourcePath, deployName, syncMode, ignoreGlobs, hooks`

Defaults (applied by wizard + config normalizer):

- `host = '127.0.0.1'`
- `ports.http = 8080`
- `ports.debug = 5005`
- `debug.enabled = true`
- `debug.bind = '127.0.0.1'`
- `debug.attachDelayMs = 1000`
- `autosync.enabled = true`
- `autosync.debounceMs = 400`
- `autosync.maxBatchFiles = 200`
- `autosync.maxBatchBytes = 20000000`
- `autosync.stormBackoffMs = 2000`
- `autosync.ignoreGlobs = (default list in §9.2.6)`
- `deployment.syncMode = 'auto'` if exploded, else `manual`

---

## 16. Tomcat Plugin Algorithmic Spec

> This section is deliberately **algorithmic** to remove ambiguity.

### 16.0 Required infra specs (cross-platform)

#### 16.0.1 ProcessManager

Must support:

- spawn process with piped stdout/stderr
- check alive(pid)
- terminate process tree reliably

Rules:

- Never use shell execution.
- Always pass args as array.

Unix termination:

- Spawn in new process group.
- Terminate group: SIGTERM then SIGKILL with timeouts.

Windows termination:

- Terminate tree with `taskkill /PID <pid> /T /F`.

Stdout/stderr handling:

- Stream to OutputChannel `JSM: <server>`.
- Keep ring buffer of last N lines (default 2000) for diagnostics.

#### 16.0.2 Ports adapter

- `isPortFree(host, port)` probe timeout 200ms.
- `suggestFreePort(host, preferred)` tries preferred then random (limit 20 attempts).

#### 16.0.3 ConfigNormalizer

Before any operation:

- Expand workspace-relative paths to absolute
- Normalize separators
- Ensure args are arrays
- Apply defaults
- Validate deployName safety (no
