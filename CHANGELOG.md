# Changelog

All notable changes to the Java Server Manager extension will be documented in this file.

The format follows Keep a Changelog and this project adheres to Semantic Versioning.

## [Unreleased]

### Planned

- ongoing improvements toward stable readiness

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
