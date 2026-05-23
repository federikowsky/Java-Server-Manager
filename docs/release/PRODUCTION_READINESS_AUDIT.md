# Production Readiness Audit

Date: 2026-05-23
Branch: codex/production-readiness-audit

## Scope

Production-release readiness audit for Java Server Manager 0.1.3 across architecture, VS Code extension correctness, domain behavior, UX/operator safety, security/trust, test quality, and release packaging.

## Gates

- [x] Architecture conforms to `docs/specs.md` for the managed-inventory authority model.
- [x] Managed server inventory remains authoritative for existing servers.
- [x] Templates remain one-way provisioning presets.
- [x] Runtime state remains derived and non-authoritative.
- [x] Preferences remain defaults/UI preferences only.
- [x] Plugin capability behavior remains behind plugin boundaries.
- [x] Tree and dashboard ownership remain aligned with the canonical model.
- [x] Workspace trust, file IO, process spawning, webview, and path handling are production safe.
- [x] Meaningful tests, typecheck, lint, compile/build, release checks, E2E, and packaging pass.
- [x] Release metadata and package contents are acceptable for local installation/publishing.

## Commands

- `git status --short --branch` - pass.
- `npm ci` - pass, 0 vulnerabilities.
- `npm audit --json` - pass, 0 vulnerabilities.
- `npm audit --omit=dev --json` - pass, 0 vulnerabilities.
- `npm test` - pass, 61 files, 800 passing, 1 skipped.
- `npm run check-types` - pass.
- `npm run lint` - pass.
- `npm run compile` - pass.
- `npm run compile:e2e` - pass.
- `npm run test:smoke` - pass, 40 passing.
- `npm run test:release` - pass, 11 passing.
- `npm run package` - pass.
- `npm run build` - pass.
- `npm run vscode:prepublish` - pass.
- `JSM_E2E_VSCODE_EXECUTABLE="/Applications/Visual Studio Code.app/Contents/MacOS/Electron" npm run test:e2e` - pass.
- `npm run release:preflight` - not runnable locally without CI release environment; failed fast on missing `JSM_MARKETPLACE_PUBLISHER`.
- `npx --yes @vscode/vsce package --out java-server-manager-0.1.3.vsix` - pass.
- `unzip -l java-server-manager-0.1.3.vsix` - pass, package contents inspected.

## Findings

- Blocker: none remaining in repository code.
- High: webview dashboard accepted arbitrary VS Code command execution.
- High: managed instance removal could recursively delete a path without proving it was a JSM-managed instance.
- High: stop timeout logic could finalize a server as stopped without killing a still-running process.
- High: stale/foreign PID files were trusted as proof of an owned running server.
- High: hook timeout cancellation did not terminate spawned shell commands or VS Code tasks.
- High: incremental deployment accepted escaping relative paths.
- High: duplicate ports, instance paths, and deployment targets were not rejected at the inventory boundary.
- Medium: dashboard state/form init exposed stored secrets to the webview.
- Medium: Tomcat Manager reload could send Basic credentials to non-loopback HTTP hosts.
- Medium: user run environment could override plugin-owned Tomcat variables.
- Medium: command hooks in multi-root workspaces defaulted to the first workspace folder.
- Medium: E2E runner replacement was not compatible with CommonJS `require()` of `file://` URLs.
- Medium: package hygiene included unnecessary dependency trees and source maps in VSIX.
- Low: debug adapter registered VS Code debug listeners without disposing them.
- Low: `AGENTS.md` was not present; audit used `docs/specs.md`, package metadata, tests, and source.

## Fixes

- Added dashboard command allowlisting and argument-shape validation.
- Added managed-instance marker verification and storage-root containment before recursive deletion.
- Added PID ownership records with process start-token checks; legacy numeric PID files now fail closed.
- Added force-kill escalation and timeout error behavior for stop operations.
- Added child cancellation propagation for hook shell commands and VS Code tasks.
- Added deployment and watcher path containment.
- Added inventory invariants for duplicate instance paths, runtime ports, and deployment targets.
- Redacted dashboard/webview secrets and preserved existing secrets on redacted form round-trips.
- Restricted Tomcat Manager reload to loopback hosts and made plugin-owned Tomcat env vars authoritative.
- Resolved command hook cwd from the owning workspace in multi-root workspaces.
- Replaced the Mocha/glob E2E dependency path with a small local runner and fixed CommonJS import behavior.
- Added deterministic Tomcat startup listener JAR build and release test.
- Removed vulnerable/unused dev dependencies; dependency audit is now clean.
- Added `vscode:prepublish`, tightened `.vscodeignore`, and produced a clean VSIX.

## Final Status

Production-ready for local installation and external publication once marketplace/GitHub release credentials and CI release variables are supplied.

Artifact: `java-server-manager-0.1.3.vsix`

SHA-256: `10ff1e9e2425636a2f0e40fc938acb4ac20124127d4d50864bbcd9a69c09b6ba`
