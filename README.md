# Java Server Manager

Java Server Manager is a VS Code extension for managing local Java application servers, currently Tomcat-first and plugin-oriented.

## Status

The repository is an advanced MVP, not a production-ready release.

- Implemented: Tomcat server CRUD, run/debug lifecycle, deployment management, template management, tree view, and webview forms.
- Partial: autosync, logging UX, deployment orchestration, manifest/spec alignment.
- Missing for production readiness: stable test pipeline, CI, diagnostics, stronger runtime hardening, and full spec reconciliation.

For the current assessment, see [PROJECT_TECHNICAL_AUDIT.md](./PROJECT_TECHNICAL_AUDIT.md).

## Requirements

- VS Code 1.100.0 or newer
- Node.js 18+
- A local Java JDK
- A local Tomcat installation for runtime testing

## Development

```bash
npm install
npm run check-types
npm run lint
npm run compile
```

To launch the extension in development, open the workspace in VS Code and press `F5`.

## Repository layout

- [src](./src): extension source code
- [docs](./docs): canonical specifications and supporting project documents
- [.github](./.github): shared Copilot customizations, agents, prompts, skills, and hooks

## Key documents

- [docs/specs.md](./docs/specs.md): canonical frozen specification
- [docs/specs-extended.md](./docs/specs-extended.md): extended supporting specification
- [PROJECT_TECHNICAL_AUDIT.md](./PROJECT_TECHNICAL_AUDIT.md): implementation audit and production blocker baseline
- [PROJECT_DOSSIER.md](./PROJECT_DOSSIER.md): architecture and status dossier

## Current focus areas

- close the spec-to-code gap
- restore a working automated test path
- harden Tomcat runtime and deployment behavior
- improve diagnostics, logging, and release confidence

## Verification commands

```bash
npm run check-types
npm run lint
npm test
```

`npm test` is expected to remain the main readiness gate to fix before claiming production quality.
