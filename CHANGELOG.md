# Changelog

All notable changes to the Java Server Manager extension will be documented in this file.

The format follows Keep a Changelog and this project adheres to Semantic Versioning.

## [Unreleased]

### Planned

- ongoing improvements toward stable readiness

## [0.1.6] - 2026-05-24

### Summary

- Sixth beta patch focused on deployment authoring and settings-save regressions found after 0.1.5 publication.
- Keeps the dashboard authoring model intact while preventing inferred deployment values and unchanged settings from overriding explicit user intent.
- Expands regression coverage around deployment context path inference, dirty settings payloads, and host-side partial settings writes.

### Beta Disclaimer

- this is a beta prerelease intended for validation and feedback.
- behavior and feature surface may change before stable.

### Known Limitations

- only Tomcat is supported in this release.
- some advanced workflows and hardening tasks are still in progress.

### Fixed

- Deployment Context Path can now be cleared completely after being suggested from the source path; the wizard no longer restores the suggestion on the final deleted character.
- Existing deployment context paths are treated as explicit values in edit mode, so changing source paths does not silently rename an existing deployment target.
- Settings save now sends only fields that changed, so changing Default Java Home no longer attempts to rewrite unrelated UI preferences such as `jsm.ui.showStatusInSidebar`.

### Tests

- Added executable model coverage for deployment context path inference across exploded directories, WAR files, trailing separators, Windows paths, custom names, source changes, and intentionally cleared values.
- Added dirty settings payload coverage for Java home, port defaults, boolean preferences, cleared values, mixed updates, and unchanged-state no-op payloads.
- Added dashboard host tests proving partial settings writes update only provided keys and that unregistered optional settings cannot break Java-only settings saves.

## [0.1.5] - 2026-05-24

### Summary

- Fifth beta patch focused on the hooks editor regression found after 0.1.4 publication.
- Restores reliable command/task hook authoring from the full-screen hooks editor and preserves Add Server draft input when returning from that editor.
- Fixes the lightweight VS Code E2E launcher so workspace-backed extension tests run instead of treating the workspace path as the test module.

### Beta Disclaimer

- this is a beta prerelease intended for validation and feedback.
- behavior and feature surface may change before stable.

### Known Limitations

- only Tomcat is supported in this release.
- some advanced workflows and hardening tasks are still in progress.

### Fixed

- Existing Hooks now updates immediately after adding command or VS Code task hooks.
- Hook test actions are wired through the hooks editor props so saved server/deployment hooks can be tested from the editor.
- Add Server draft state, including runtime paths, Java home, ports, VM args, selected workspace, template mode, and hooks, is preserved while opening and returning from the hooks editor.
- Deployment draft state is preserved through the same hooks editor round-trip.
- `npm run test:e2e` now launches VS Code with test flags before the workspace path and passes locally.

## [0.1.4] - 2026-05-24

### Summary

- Fourth beta (pre-release): product-readiness expansion focused on guided setup, safer import/provisioning, operator observability, template authoring, and deployment recovery.
- Keeps the shipped runtime scope Tomcat-first while adding plugin-bound rollback and stronger plugin API conformance evidence.
- Adds CI-level real-runtime validation for pinned Tomcat and Java combinations.

### Beta Disclaimer

- this is a beta prerelease intended for validation and feedback
- behavior and feature surface may change before the first stable release

### Known Limitations

- only Tomcat is supported in this release
- local telemetry is opt-in, local-only, and never sent automatically
- second server plugins remain a dedicated future milestone

### Added

- Dashboard first-run onboarding, operation history, health/readiness, deployment log access, autosync inspector, and built-in read-only template gallery.
- Hook test action, local-only port assistant, and Tomcat deployment rollback from retained local artifact backups.
- Opt-in local aggregate telemetry counters included only in explicitly copied diagnostics bundles.
- Nightly GitHub Actions real-runtime matrix for Tomcat 9.0.105 and 10.1.28 on Java 17 and 21.

### Changed

- Workspace inventory documents now support explicit schema versioning and legacy migration.
- Server import now performs a dry-run preview with validation before provisioning.
- Real Tomcat integration tests can use `JSM_TEST_TOMCAT_HOME` and `JSM_TEST_JAVA_HOME`.

### Fixed

- Dashboard server deletion now uses provisioning cleanup parity instead of inventory-only removal.
- Template saves are sanitized at persistence and reserved gallery template ids cannot be edited, deleted, or saved.

## [0.1.3] - 2026-05-23

### Summary

- Third beta (pre-release): production-readiness hardening focused on multi-root identity, Tomcat runtime tracking, diagnostics safety, extension deactivation cleanup, deterministic autosync E2E coverage, and release package hygiene.
- Keeps the shipped scope Tomcat-first while tightening behavior that can otherwise fail in real multi-workspace sessions or leak sensitive support data.
- Includes a release-readiness audit/remediation pass across architecture conformance, managed inventory authority, workspace trust, process cleanup, webview command safety, packaging, and CI release gates.

### Beta Disclaimer

- this is a beta prerelease intended for validation and feedback
- behavior and feature surface may change before the first stable release

### Known Limitations

- only Tomcat is supported in this release
- some advanced workflows and hardening tasks are still in progress

### Changed

- **Multi-root identity**: dashboard navigation, server detail, deployment forms, recent selections, and deployment commands now preserve workspace-scoped `serverKey` data instead of relying on bare server IDs.
- **Tomcat runtime tracking**: child process tracking, status lookups, stop cleanup, and startup listener callback metadata use the operation server key so duplicate server IDs in different workspaces remain isolated.
- **Managed inventory invariants**: server edits, imports, and external reloads now reject duplicate instance paths, runtime ports, and deployment target names before they become ambiguous runtime behavior.
- **E2E runner**: E2E tests no longer depend on Mocha/glob and run through a local runner compatible with the VS Code extension test host.
- **E2E reliability**: autosync workbench coverage waits for watcher registration before mutating deployment files, avoiding race-prone false failures.
- **Release packaging**: VSIX packaging excludes local agent/tooling files, test-only scripts, transient data, dependency trees, source maps, and source-root generated JavaScript artifacts.
- **CI coverage**: CI branch filters include `master` as the repository default branch while retaining existing branch coverage.

### Fixed

- **Diagnostics safety**: diagnostics bundles recursively redact sensitive values in nested config, hooks, deployments, JVM args, shell command lines, environment variables, and bearer tokens while preserving non-secret support context.
- **Dashboard webview boundary**: dashboard command execution is allowlisted and argument-validated instead of forwarding arbitrary VS Code commands.
- **Dashboard secret exposure**: dashboard sync and config form initialization redact secret values while preserving existing persisted secrets on redacted form round-trips.
- **Managed instance deletion**: server removal now proves the instance is under managed storage and marked as JSM-managed before recursive deletion.
- **PID ownership**: stale or foreign PID files no longer mark a server as running unless the process identity matches the JSM-owned runtime record.
- **Stop escalation**: stop timeouts now force-kill still-running server processes and report timeout if escalation fails.
- **Hook cancellation**: timed-out or cancelled hook commands and VS Code tasks now terminate the child work instead of leaving it running.
- **Deployment path containment**: autosync and incremental deployment changes reject relative paths that escape the deployment target.
- **Tomcat Manager safety**: Manager reload credentials are only sent to loopback HTTP hosts.
- **Tomcat environment ownership**: user environment overrides can no longer replace plugin-owned `CATALINA_HOME`, `CATALINA_BASE`, or `JAVA_HOME`.
- **Multi-root hook cwd**: command hooks without an explicit cwd now default to the owning workspace folder instead of the first workspace folder.
- **Extension deactivation**: plugin registry disposal is wired into extension shutdown so plugin-owned resources are cleaned up on reload/deactivation.
- **Test source of truth**: removed tracked generated `src/*.js` artifacts that could shadow TypeScript source in local tests and mask source-of-truth behavior.

## [0.1.2] - 2026-03-27

### Summary

- Second beta (pre-release): dashboard and templates UX hardening, deployment actions from the SPA, autosync wired through the server operation queue, dynamic multi-root workspace registration, and registry release verification for OpenVSX.
- Add Server opens the dashboard via direct panel wiring (no nested command); template create/edit navigates to the template detail view after save; template delete from the detail page; second edit session reliably re-requests the host form schema.

### Beta Disclaimer

- this is a beta prerelease intended for validation and feedback
- behavior and feature surface may change before the first stable release

### Known Limitations

- only Tomcat is supported in this release
- some advanced workflows and hardening tasks are still in progress

### Added

- **Autosync**: file watching and deploy synchronization through `AutoSyncService`, with failure recording, `rebindWatchers`, and queue-backed `enqueueDeploySync` on `ServerLifecycle`.
- **Deployments (SPA)**: overflow menu for per-deployment actions; **Reveal source** command; safer webview messaging (avoid structured-clone failures from reactive proxies).
- **Templates**: delete from template detail view; description truncated in the list with full text in tooltip; navigate to read-only detail after successful save.
- **Workspace**: `WorkspaceServiceRegistry` `registerEntry` / `removeEntry` and `onDidChangeWorkspaceFolders` so folders added or removed after activation stay in sync with services and lifecycle.
- **Release tooling**: OpenVSX version verification script and related release documentation updates.

### Changed

- **Operation queue**: tree and commands schedule lifecycle, deploy, redeploy, and related work on the same per-server `OperationQueue`; progress cancel aligns with lifecycle cancel; tree reflects queue busy state.
- **Dashboard / webview**: SPA layout for forms (`FormBody`, schema utilities); streamlined host message handling; hooks editor and dashboard navigation refinements; removal of the standalone `DeploymentForm` in favor of integrated flows.
- **Server commands**: `openDashboard` callback to `DashboardPanel.show` for Add Server; webview panel `reveal` on first open after `createPanel`.
- **Java**: Java home detection flow updates in the webview.
- **Logs**: server output channel is cleared only when entering **starting** (not again on **running**) so startup lines are not wiped at ready.

### Fixed

- **Templates**: host and webview form context stay aligned (`clearSpaFormMirror` on navigate and key template routes) so a second edit/save after the first no longer hits “Submit is not supported in the current view.”
- **Deployments**: workspace folder URI handling and deployment command/webview wiring for overflow actions.

## [0.1.1] - 2026-03-18

### Summary

- added explicit manifest licensing metadata required by OpenVSX validation
- aligned release metadata for dual publication (VS Code Marketplace and OpenVSX)

### Beta Disclaimer

- this is a beta prerelease intended for validation and feedback
- behavior and feature surface may change before the first stable release

### Known Limitations

- only Tomcat is supported in this release
- some advanced workflows and hardening tasks are still in progress

### Added

- added MIT license declaration and repository license file for registry compliance
- added publisher field to the extension manifest for deterministic release identity checks

## [0.1.0] - 2026-03-18

### Summary

- first public beta release of Java Server Manager
- Tomcat-first extension architecture with plugin-oriented foundations

### Beta Disclaimer

- this is a beta prerelease intended for validation and feedback
- behavior and feature surface may change before the first stable release

### Known Limitations

- only Tomcat is supported in this release
- some advanced workflows and hardening tasks are still in progress

### Added

- server discovery and local server lifecycle operations for Tomcat
- deployment and auto-sync foundations with runtime safety gates
- release governance, deterministic preflight checks, and Marketplace release workflow
