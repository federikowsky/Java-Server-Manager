# Java Server Manager

Java Server Manager is a VS Code extension for managing local Java application servers. The implemented surface is Tomcat-only today, with a plugin-oriented architecture for future expansion.

## Status

The repository is an advanced MVP. It is not production-ready and has not yet completed its first official Marketplace release cycle.

- Implemented: Tomcat server CRUD, run/debug lifecycle, deployment management, template management, tree view, and webview forms.
- Partial: autosync, logging UX, deployment orchestration, manifest/spec alignment.
- Release posture: CI exists and runs lint, type checks, tests, production build, and repository audits; Marketplace publication is now governed separately.
- Missing for production readiness: stronger runtime hardening, full spec-to-code reconciliation, broader release validation confidence, and first monitored release execution.

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
npm run build
```

To launch the extension in development, open the workspace in VS Code and press `F5`.

## Repository layout

- [src](./src): extension source code
- [docs](./docs): canonical specifications and supporting project documents
- [.github](./.github): shared Copilot customizations, agents, prompts, skills, and hooks

## Key documents

- [docs/documentation-map.md](./docs/documentation-map.md): canonical documentation map and source-of-truth rules
- [docs/release-process.md](./docs/release-process.md): Beta and Stable release policy plus CI/CD contract
- [docs/release-decision-log.md](./docs/release-decision-log.md): frozen release decisions
- [docs/specs.md](./docs/specs.md): canonical product and domain specification

## Current focus areas

- close the remaining spec-to-code gap
- harden Tomcat runtime and deployment behavior
- complete the first monitored Beta release cycle
- graduate the release flow to Stable readiness

## Verification commands

```bash
npm run check-types
npm run lint
npm test
npm run build
```

`npm test` remains the main Stable-quality gate, while `npm run test:smoke` is the lighter Beta gate.
