# Feature Discovery And Test Matrix

Date: 2026-05-26
Branch: `codex/full-feature-test-discovery`
Version audited: `0.1.7`

## Discovery Inputs

- Product contract: `docs/specs.md`.
- VS Code manifest: `package.json` commands, views, menus, configuration, activation.
- Extension host: `src/extension.ts`, `src/ui/commands/*`, tree provider, dashboard panel.
- Dashboard client: `src/ui/webviews/client/**/*.svelte`, protocol types, stores.
- Domain services: config, provisioning, lifecycle, deployment, autosync, hooks, templates, diagnostics, telemetry.
- Plugin surface: plugin interface, registry, Tomcat plugin, Tomcat server XML service, startup monitor.
- CI/release gates: `.github/workflows/ci.yml`, `.github/workflows/release-marketplace.yml`, `tools/release/*`.
- Baseline tests: 71 test files, 892 passing tests, 1 skipped environment sanity marker before new coverage.

## Automated Coverage Map

| Area | Must-hold behavior | Primary coverage | Gaps closed in this pass |
| --- | --- | --- | --- |
| Manifest and command surface | Every contributed command is registered; every menu command is declared. | `extension-activation`, command module tests. | Added `webview-contracts.test.ts` manifest/register/menu parity. |
| Tree operational control | Tree commands remain canonical for start, debug, stop, restart, cancel, edit, duplicate, remove, redeploy, logs, config. | `server-commands.test.ts`, `tree-view-provider.test.ts`, lifecycle tests. | Added registration parity plus direct tests for restart, attach/detach debug, cancel, remove, redeploy-all. |
| Dashboard admin surface | Dashboard can author servers, deployments, templates, settings, and dispatch only allowlisted commands. | `dashboard-panel.test.ts`, `protocol-validation.test.ts`, source regression tests. | Added dashboard client executeCommand allowlist and handler/registration contract. |
| Managed inventory authority | Existing server behavior comes from workspace-scoped managed inventory in VS Code storage only. | `ConfigService`, `ConfigRepo`, `WorkspaceServiceRegistry`, integration lifecycle tests. | Added storage-backed persistence, one-time legacy migration, storage-over-legacy authority, and corrupt-storage fail-closed coverage. |
| Templates | Templates are one-way provisioning presets, not live authority. | `TemplateService.test.ts`, dashboard template CRUD tests. | No code change needed. |
| Runtime state | Runtime/server/deployment state is derived and non-authoritative. | `ServerRuntime`, `ServerLifecycle`, deployment state tests. | No code change needed. |
| Hooks | Hooks are parent-operation checkpoints and testable command/task configs, not standalone automation. | `HookRunner`, extension hook executor, hook editor regression, server hook command tests. | Kept hook editor regression in matrix; no architecture drift found. |
| Deployments | Add/edit/remove/redeploy/rollback/undeploy/reveal/logs/autosync are scoped to owning server. | `deployment-commands`, `DeploymentService`, `AutoSyncService`, e2e autosync. | Added direct reveal-source positive and empty-source tests. |
| Tomcat plugin | Tomcat detection, CATALINA_HOME/BASE, start/stop, config XML, logs, deploy plans stay plugin-owned. | `tomcat-plugin`, `tomcat-server-xml-service`, real path sanity tests. | No code change needed. |
| Trust and security | Process, deploy, hooks, settings, templates, and inventory writes fail closed when untrusted; webview cannot execute arbitrary commands. | trust policy, security policy, dashboard panel, lifecycle/deploy/hook tests. | Added dashboard handler contract; fixed silent server-remove workspace lookup failure. |
| Webview UX contracts | All referenced command IDs and icons are available; no dead UI affordances. | dashboard panel tests plus Svelte source regressions. | Added icon usage contract and fixed missing rollback `history` icon. |
| Packaging/release | CI quality, release beta/stable preflight, package and marketplace verification are defined. | release helper tests and GitHub workflows. | Included in matrix; final validation reruns local equivalents. |

## Detailed Regression Test Cases

| ID | Feature | Test case | Expected result | Automated coverage |
| --- | --- | --- | --- | --- |
| JSM-TC-001 | Manifest | Compare `contributes.commands` with host registrations. | No contributed command is missing a handler. | `webview-contracts.test.ts` |
| JSM-TC-002 | Manifest | Compare menu commands with `contributes.commands`. | No hidden/undeclared menu command exists. | `webview-contracts.test.ts` |
| JSM-TC-003 | Dashboard security | Compare dashboard client `executeCommand` ids with dashboard allowlist. | Client cannot emit an unallowlisted command. | `webview-contracts.test.ts` |
| JSM-TC-004 | Dashboard security | Verify each allowlisted dashboard command has either an internal handler or VS Code command registration. | Allowlist cannot drift into a broken command path. | `webview-contracts.test.ts` |
| JSM-TC-005 | Webview UI | Parse all static icon usages and compare with `Icon.svelte`. | Every visible icon name resolves to SVG content. | `webview-contracts.test.ts` |
| JSM-TC-006 | Server command registry | Register server commands and assert every server command module entry exists. | No tree/admin server command disappears silently. | `server-commands.test.ts` |
| JSM-TC-007 | Lifecycle start | Start run with SPA-shaped args and no serverKey. | Uses workspace-scoped key and waits for queue drain. | Existing `server-commands.test.ts` |
| JSM-TC-008 | Lifecycle start with deployments | Start run/debug when deployments exist. | Prepares undeployed deployments before start; stops if prep fails. | Existing `server-commands.test.ts` |
| JSM-TC-009 | Lifecycle restart | Restart run/debug from SPA-shaped args. | Calls lifecycle restart with `run` or `debug` mode and correct progress title. | `server-commands.test.ts` |
| JSM-TC-010 | Debug attach | Attach debugger for selected server. | Calls lifecycle attach and shows success; failures are surfaced. | `server-commands.test.ts` |
| JSM-TC-011 | Debug detach | Detach debugger for selected server. | Calls lifecycle detach and surfaces failure messages. | `server-commands.test.ts` |
| JSM-TC-012 | Operation cancel | Cancel active operation. | Cancels the workspace-scoped queue key. | `server-commands.test.ts` |
| JSM-TC-013 | Server removal | Confirmed server removal. | Uses provisioning cleanup, refreshes tree only after success. | `server-commands.test.ts` |
| JSM-TC-014 | Server removal cancel | User cancels remove confirmation. | No provisioning cleanup, no refresh. | `server-commands.test.ts` |
| JSM-TC-015 | Server removal missing workspace | Workspace entry cannot be resolved after confirmation. | Shows `Workspace not found`; no silent no-op. | `server-commands.test.ts` |
| JSM-TC-016 | Redeploy all | Server has deployments. | Enqueues `RedeployAll`, waits, and shows success. | `server-commands.test.ts` |
| JSM-TC-017 | Redeploy all empty | Server has no deployments. | Does not enqueue a no-op redeploy. | `server-commands.test.ts` |
| JSM-TC-018 | Deployment command registry | Register deployment commands and assert all expected handlers. | No deployment command disappears silently. | Existing `deployment-commands.test.ts` |
| JSM-TC-019 | Deployment add/edit | SPA draft payloads add/edit a deployment. | Inventory update returns command result and refreshes tree. | Existing `deployment-commands.test.ts` |
| JSM-TC-020 | Deployment rollback | Rollback requires confirmation. | Enqueues rollback only after confirmation. | Existing `deployment-commands.test.ts` |
| JSM-TC-021 | Deployment remove | Confirmed remove. | Removes from inventory and refreshes. | Existing `deployment-commands.test.ts` |
| JSM-TC-022 | Deployment reveal source | Reveal source with spaces in path. | Calls `revealInExplorer` with `vscode.Uri.file(sourcePath)`. | `deployment-commands.test.ts` |
| JSM-TC-023 | Deployment reveal empty source | Source path is blank. | Warns user and does not call explorer reveal. | `deployment-commands.test.ts` |
| JSM-TC-024 | Hook editor state | Add command/task hooks and leave editor. | Hook list stays reactive and parent wizard draft is preserved. | `hook-editor-state-source-regression.test.ts` |
| JSM-TC-025 | Hook test | Test command/task hook from server or deployment editor. | Validates payload, requires confirmation, runs through HookRunner, surfaces trust/errors. | `server-commands.test.ts`, `extension-hook-executor.test.ts` |
| JSM-TC-026 | Config authority | Duplicate IDs, paths, ports, deployment targets. | Rejected before cache/persist mutation. | Config and infra tests |
| JSM-TC-027 | Trust | Side-effecting config, deploy, lifecycle, hook, template, settings operations in untrusted workspace. | Fail closed with `WorkspaceUntrusted`. | Trust/security tests |
| JSM-TC-028 | Process safety | Process spawning and stop/cancel behavior. | No `shell: true`; process args are structured; cancellation/timeout is handled. | process spawner, lifecycle, CI shell audit |
| JSM-TC-029 | Tomcat plugin | Detect, validate, start, stop, deploy, rollback, logs, SSL XML. | Behavior stays behind plugin methods. | Tomcat plugin/XML tests |
| JSM-TC-030 | Release gates | Run CI-equivalent local checks and package checks. | Test, typecheck, lint, build, package, e2e, release helper checks pass. | Final validation commands |
| JSM-TC-031 | Inventory storage | Save a managed server with VS Code storage available. | Writes `jsm.servers.json` under extension workspace storage, not workspace `.vscode`. | `config-repo.test.ts`, `extension-activation.test.ts` |
| JSM-TC-032 | Legacy inventory migration | Storage inventory is absent and `.vscode/jsm.servers.json` exists. | Validates and copies legacy content into storage once while leaving legacy non-authoritative. | `config-repo.test.ts` |
| JSM-TC-033 | Storage authority | Both storage and legacy inventories exist. | Reads storage only and ignores legacy edits. | `config-repo.test.ts` |
| JSM-TC-034 | Corrupt storage fail-closed | Storage inventory is invalid while legacy inventory is valid. | Fails with config read error and does not fall back to legacy authority. | `config-repo-negative-extended.test.ts` |

## Manual/E2E Scenarios To Keep

- Install generated VSIX into a clean VS Code profile and open a trusted workspace.
- Add a Tomcat server with a path containing spaces; start, stop, restart, attach/detach debug.
- Add command and VS Code task hooks from Add Server, return to the Add Server form, and verify draft fields remain.
- Add command and VS Code task hooks from Deployment edit, return to the Deployment form, and verify draft fields remain.
- Add exploded and WAR deployments; redeploy, rollback, undeploy, reveal source, open logs.
- Toggle AutoSync and verify watcher diagnostics update without persisting runtime state as authority.
- Open an untrusted workspace and verify side-effecting dashboard/tree actions are blocked with actionable messages.
- Run release workflow on a beta tag and verify Marketplace/OpenVSX after publish.

## Findings From This Pass

- High: `jsm.server.remove` silently did nothing after confirmation when the workspace entry could not be resolved. Fixed by failing closed with a visible `Workspace not found` error.
- Medium: the VS Code E2E runner could report failure after successful extension tests when temporary profile deletion hit delayed filesystem writes. Fixed with retrying cleanup.
- Low: deployment rollback menu used an undeclared `history` icon, producing a missing icon in the webview action menu. Fixed by adding the icon and a source-level icon contract test.

## Current Status

The matrix is now backed by executable regression tests for command manifest parity, dashboard command allowlisting, command handler availability, icon availability, E2E runner cleanup, and newly covered server/deployment command paths. Full local validation passed after the fixes.
