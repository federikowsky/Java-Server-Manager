# Java Server Manager

**Java Server Manager** is a [VS Code](https://code.visualstudio.com/) extension for managing **local Tomcat** instances from the editor: lifecycle (run/debug/stop), deployments, templates, and a dashboard webview. The codebase is structured for additional server plugins later; only Tomcat is implemented today.


## Features

- Add and configure Tomcat servers (workspace-scoped configuration)
- Start/stop/restart with run or debug
- Manage deployments (including autosync-oriented workflows where supported)
- Template-based server provisioning and template editing
- Tree view and **Server Dashboard** (Svelte webview)

## Requirements

- **VS Code** 1.100.0 or newer (see `engines.vscode` in `package.json`)
- **Node.js** 20+ (for building and developing the extension; CI/release use Node 20)
- **JDK** and a **local Tomcat** installation for runtime testing

## Install (users)

Install the extension from the VS Code Marketplace when available, or from a `.vsix` built from this repository (see Development).

## Development

Clone the repository, install dependencies, then type-check, lint, test, and build:

```bash
npm ci
npm run check-types
npm run lint
npm test
npm run build
```

Open the folder in VS Code and press **F5** to launch the **Extension Development Host** with this extension loaded.

### Verification gates

- **`npm test`** — main automated test gate before merging substantive changes
- **`npm run test:smoke`** — lighter smoke suite when appropriate

## Repository layout

| Path | Purpose |
|------|---------|
| [`src/`](./src) | Extension source (TypeScript), UI adapters, webview client (Svelte) |
| [`docs/`](./docs) | Product spec, documentation index, and other tracked technical docs |
| [`.github/`](./.github) | CI workflows, Copilot instructions, agents, prompts, hooks |
| [`assets/`](./assets) | Bundled assets (e.g. Tomcat listener JAR) |
| [`tools/`](./tools) | Scripts (build, release helpers, etc.) |

## Configuration note

Prefer the extension UI and registered commands for server and deployment changes. JSM stores the managed server inventory in VS Code workspace storage; legacy `.vscode/jsm.servers.json` files are migrated once when storage is empty. Manual edits to inventory files are not a supported way to keep lifecycle, watchers, and UI state consistent.

## Documentation

| Document | Description |
|----------|-------------|
| [docs/documentation-map.md](./docs/documentation-map.md) | What counts as canonical vs supporting documentation |
| [docs/specs.md](./docs/specs.md) | Product and domain specification (intent vs shipped code may differ) |
| [CHANGELOG.md](./CHANGELOG.md) | Version history for releases |

Release policy and local publication commands are tracked in [docs/release-process.md](./docs/release-process.md).

## Status

The project is a **beta** extension for real local Tomcat workflows. CI runs lint, type checks, tests, and production builds; release publication is automated through GitHub Actions. Stable-readiness work remains focused on broader runtime matrices, deeper e2e coverage, and additional plugin hardening.
