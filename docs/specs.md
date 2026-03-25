# JSM Repository Blueprint

## 1. Purpose

Java Server Manager (JSM) is a VS Code extension for explicit management of local Java application server instances used in development environments. It provides a managed model for registering, configuring, starting, stopping, debugging, deploying to, and observing local server instances inside a workspace-centered workflow.

JSM is a local development tool. It is not a remote orchestration system, a production deployment platform, or a general infrastructure controller.

## 2. Scope

JSM manages explicitly registered local server instances.

The shipped product surface is Tomcat-first. The architecture is plugin-ready, but additional server types are outside the current product scope unless they are intentionally added as supported functionality.

JSM supports:

- explicit registration of managed local server instances
- per-server lifecycle control
- per-server deployment management
- run and debug workflows where supported
- reusable provisioning templates
- discovery as explicit provisioning assistance
- trust-aware local automation through hooks

JSM does not manage remote servers, clusters, production rollout workflows, or continuous background runtime ownership.

## 3. Product Model

JSM is built around five canonical product concepts.

### 3.1 Managed Server

A managed server is an explicitly registered workspace entity representing one local server instance under JSM control. It references a server runtime installation and an instance-specific working directory owned by that managed server.

### 3.2 Deployment

A deployment is a user-defined application artifact associated with a managed server. Deployments may be WAR-based or exploded-directory based.

### 3.3 Template

A template is a reusable provisioning preset used to accelerate creation of new managed servers. Templates are creation-time presets only.

### 3.4 User Preferences

User preferences define creation defaults and UI behavior. They are not the authority for existing managed server behavior.

### 3.5 Runtime State

Runtime state is operational data derived from execution and observation. It is not authoritative configuration.

## 4. Design Principles

JSM follows these design principles:

- **Explicit registration over implicit adoption**: JSM manages only servers that the user explicitly creates or imports into workspace inventory.
- **Single ownership per workflow**: each major workflow has one canonical product surface owner.
- **Stable configuration separate from derived state**: durable definitions and operational state are different domains and must not compete.
- **Workspace authority**: managed server inventory belongs to the workspace context.
- **Trust-aware side effects**: process execution, deployment operations, and hooks require a trusted workspace context.
- **Plugin isolation**: server-specific behavior belongs behind the plugin boundary; orchestration, policy, and workflow ownership remain in the core product.
- **No hidden background management**: discovery assistance does not imply background adoption or autonomous runtime management.
- **Deterministic per-server operations**: conflicting lifecycle actions are serialized so server state transitions remain predictable.

## 5. Canonical Domains

### 5.1 Managed Server Inventory

Managed server inventory is the sole authoritative domain for registered servers and their deployments. It contains the stable, user-authored definitions required to manage existing entities.

This domain includes:

- server identity and display metadata
- server type
- runtime home reference data required for management
- managed instance path
- server network and runtime options that govern behavior
- deployment definitions
- server-scope and deployment-scope hook definitions
- plugin-specific user-authored options that materially affect managed behavior

This domain excludes:

- transient process status
- derived health observations
- discovered-but-unregistered candidates
- user preference defaults
- template assets

### 5.2 User Preferences

User preferences define:

- defaults applied when creating new managed servers
- UI presentation preferences

User preferences do not govern existing managed server runtime behavior.

### 5.3 Template Library

Templates are stored separately from managed server inventory and exist as reusable provisioning presets. Templates may be scoped to the user or to the workspace, but they remain preset assets rather than live parents of managed configuration.

### 5.4 Derived Runtime State

Runtime state contains:

- server lifecycle state
- deployment runtime state
- process identity and liveness observations
- last-known operational errors
- readiness and health observations
- debug-attachment state

Runtime state is operational and derived. It may be reconstructed or refreshed from live evidence and managed metadata, but it is never the authoritative source of configuration.

### 5.5 Plugin Capability Domain

Plugins define server-type-specific behavior, capabilities, validation rules, instance initialization behavior, lifecycle execution, deployment strategies, and server-type-specific observability sources.

## 6. Architectural Model and Subsystem Boundaries

### 6.1 Core Orchestration

Core orchestration owns:

- lifecycle operation ordering
- deployment orchestration
- trust gating
- stable domain contracts
- event distribution
- runtime state transitions
- policy decisions that are not server-type-specific

Core orchestration does not own server-type process details or server-type configuration patching.

### 6.2 Provisioning and Discovery

Provisioning owns explicit creation of managed servers. Discovery is a provisioning aid that helps the user find candidate installations. Discovery does not create managed servers and does not imply ongoing ownership.

### 6.3 Plugin Layer

The plugin layer owns:

- installation detection
- config validation
- managed instance initialization
- lifecycle execution details
- deployment planning and execution details
- server-type status and optional health checks
- server-type log and config source discovery

The plugin layer does not own:

- inventory semantics
- workflow ownership
- template semantics
- global preferences
- workspace trust policy

### 6.4 Infrastructure Adapters

Infrastructure adapters provide the concrete mechanisms used by orchestration and plugins, including filesystem access, process spawning, PID handling, port probing, logging, and other host integrations.

Infrastructure adapters execute operations but do not define product semantics.

### 6.5 Presentation Layer

The presentation layer is deliberately split into two non-symmetric surfaces:

- the tree surface, which is the operational control plane
- the dashboard surface, which is the administrative and authoring plane

Auxiliary or legacy presentation paths are not canonical unless they are intentionally promoted into one of these surfaces.

## 7. UI Ownership Model

### 7.1 Tree Surface

The tree is the canonical operational control plane for existing managed entities. It owns:

- quick lifecycle actions
- quick deployment actions
- status visibility
- lightweight operational troubleshooting shortcuts
- context-sensitive operational commands against registered entities

The tree may link into richer workflows, but it is not the canonical owner of structured authoring flows.

### 7.2 Dashboard Surface

The dashboard is the canonical administrative and authoring plane. It owns:

- creating and editing managed servers
- creating and editing deployments
- template management
- settings management
- discovery assistance
- structured detail views and administrative workflows

The dashboard may display runtime status, but it is not required to mirror the full fast-operation model of the tree.

### 7.3 Ownership Rules

Every primary workflow has one canonical surface owner. The product does not require feature parity between tree and dashboard, and a workflow must not be treated as canonically owned by both surfaces at once.

## 8. Discovery and Provisioning Model

Discovery is explicit assistance used during provisioning. It helps the user locate candidate runtime installations but does not register or manage them automatically.

Provisioning supports:

- creating a server from scratch
- creating a server from a template
- importing or duplicating an existing managed definition where supported

A discovered installation becomes a managed server only after explicit user action creates or imports a managed server record.

## 9. Lifecycle and Deployment Model

### 9.1 Lifecycle

Lifecycle operations are explicit user-initiated actions against managed servers. Operations are serialized per managed server to preserve deterministic state transitions and to prevent conflicting side effects.

Canonical lifecycle actions include:

- start in run mode
- start in debug mode
- stop
- restart
- status refresh
- debug attach and detach where supported

Lifecycle execution consists of:

- precondition validation
- trust validation
- ordered operation execution
- runtime state transition management
- readiness confirmation
- post-start or post-stop follow-up as required by the server type

### 9.2 Deployment

Deployments are managed per server and operate within the server's runtime context. The product supports:

- full redeploy
- undeploy
- incremental sync where supported and safe
- hot reload where supported and safe

Deployment orchestration decides when a deployment path may use a narrower strategy and when it must escalate to a fuller strategy. Server-specific execution remains plugin-owned.

### 9.3 Autosync and Hot Reload

Autosync is a deployment convenience for supported exploded deployments. It observes local file changes and turns eligible batches into deployment sync requests when the target server is in a suitable runtime state.

Autosync and hot reload are conveniences, not separate configuration authorities. Their behavior remains subordinate to deployment definitions, runtime state, and plugin capabilities.

### 9.4 Readiness and Health

Readiness is a lifecycle concern and confirms that the server has reached an operational state. Deployment health is an optional deployment concern and may validate application-specific availability after a deployment becomes active.

## 10. Hooks Model

Hooks are synchronous, trusted, user-authored checkpoints attached to lifecycle or deployment operations.

Hooks are defined by:

- scope: server-level or deployment-level
- phase: pre, post, or on-error
- event: the specific lifecycle or deployment operation event
- execution kind: shell command line or VS Code task
- timeout and continue-on-error policy

Hooks are subordinate to a parent JSM operation. They are not autonomous jobs and do not define their own scheduling model.

Server lifecycle operations use matching server-scope hooks. Deployment operations use the effective union of matching server-scope and deployment-scope hooks.

Hook execution inherits parent-operation semantics for:

- trust gating
- timeout budgeting
- cooperative cancellation
- output and progress reporting
- failure boundaries

On-error hooks are best-effort follow-up actions. They do not replace the primary operation outcome and must not redefine the authoritative failure result.

## 11. Template Model

Templates are reusable provisioning presets used when creating new managed servers.

Canonical template semantics are:

- a template contributes initial defaults to a creation flow
- the user may override template defaults during creation
- selecting or switching templates re-applies the selected template to the creation draft
- once a managed server is created, it is independent of the template that seeded it
- template edits do not retroactively mutate existing managed servers
- templates are not inheritance roots and do not create live config parent-child relationships

Template scopes are:

- user-global templates
- workspace-local templates

Each template exists in exactly one storage scope at a time. Moving a template between scopes changes its storage scope without creating parallel authoritative copies.

Templates may contain only creation-relevant defaults. They do not contain live runtime state, existing deployment instances, or system-assigned identity.

## 12. Settings and Preferences Model

JSM distinguishes between configuration and preferences.

Preferences are global product settings that control:

- defaults for creation workflows
- UI presentation preferences

Runtime-affecting behavior belongs to managed server inventory, not to global preferences.

Canonical preferences include:

- default HTTP port for new servers
- default debug port for new servers
- default Java home for new servers
- UI visibility preferences such as sidebar status display

Discovery is modeled as explicit assistance, not as an automatic background subsystem. The product does not define a runtime discovery policy layer that continuously scans or adopts installations.

## 13. Plugin Boundary

The plugin boundary is the sole extension point for server-type-specific behavior.

A plugin must be able to:

- recognize or validate an installation
- validate a managed server definition for its type
- initialize managed instance storage if the server type supports it
- start and stop the server type
- plan and execute deployment behavior
- report status and optional health
- expose relevant log or configuration sources
- declare its capabilities and UI metadata for authoring flows

The core product remains responsible for:

- inventory semantics
- runtime state authority
- workflow ownership
- trust and security policy
- queueing and orchestration semantics
- cross-plugin consistency

## 14. Trust and Security Model

All side-effecting operations are trust-aware. Process spawning, hook execution, deployment side effects, and other mutating runtime operations require a trusted workspace context.

Security-relevant rules include:

- runtime-affecting operations must not bypass trust checks
- managed configuration is subject to security-policy validation for environment variables and VM arguments
- debugger exposure is limited to explicitly allowed local bindings
- plugins may add secure defaults but may not weaken core trust ownership

## 15. Runtime State Model

Runtime state is outside authoritative configuration and exists to support orchestration, UX, and recovery.

Server runtime state tracks lifecycle position and associated operational facts. Deployment runtime state tracks deployment activity and resulting operational condition.

Runtime state may be cached, reconstructed, or refreshed from operational evidence and managed metadata, but it is never user-authored configuration.

Runtime state is consumable by both product surfaces, but it does not change the ownership matrix: the tree owns operational control, and the dashboard owns administrative authoring.

## 16. Invariants

The following invariants are mandatory:

- A discovered installation is not a managed server until it is explicitly registered.
- Managed server inventory is the sole authority for existing server behavior.
- Global preferences never mutate existing managed servers.
- Templates only seed creation-time defaults.
- Created servers are independent of their source templates.
- A template exists in exactly one authoritative storage scope at a time.
- Hooks execute only within the lifetime of a parent JSM operation.
- Side-effecting operations require workspace trust.
- Runtime state is derived and never replaces authoritative configuration.
- Tree and dashboard have distinct workflow ownership and are not required to reach feature parity.
- Plugin-specific behavior remains behind the plugin boundary.

## 17. Non-Goals

The following are outside the JSM product model:

- remote server orchestration
- production deployment management
- infrastructure automation
- automatic adoption of discovered servers
- template inheritance or live rebinding
- a global runtime registry as a product domain
- a general-purpose automation platform built from hooks
- broad UI parity between tree and dashboard
- additional shipped server types beyond the supported product surface
- mandatory schema-versioning or migration machinery unless a future persisted-model change requires it

## 18. Explicit Exclusions to Prevent Drift

The following concepts are explicitly excluded from the canonical architecture:

- discovery policy settings as part of runtime architecture
- a second authoritative configuration source outside managed server inventory for existing servers
- diagnostics export, bundle generation, or similar auxiliary tooling as core architectural guarantees unless intentionally promoted
- legacy or auxiliary presentation paths as canonical product design
- hooks as a standalone scheduler or detached job system
- runtime-state persistence as a competing domain model
- template-driven retroactive mutation of existing servers
- speculative plugin surfaces that are not part of the supported product scope

