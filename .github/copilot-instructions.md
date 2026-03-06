# Java Server Manager AI Instructions

This repository is a VS Code extension written in TypeScript for managing Java application servers, currently Tomcat-first and plugin-oriented.

## Project reality first

- Treat the repository as the source of truth. Do not trust README, changelog, or specs unless the code confirms them.
- Use [PROJECT_TECHNICAL_AUDIT.md](../PROJECT_TECHNICAL_AUDIT.md), [PROJECT_DOSSIER.md](../PROJECT_DOSSIER.md), [docs/specs.md](../docs/specs.md), and [docs/specs-extended.md](../docs/specs-extended.md) as context, not as proof that a feature already exists.
- The current implementation is an advanced MVP, not production-ready. Do not describe the project as production-ready unless the requested work actually closes the blocking gaps.

## Technical priorities

- Prefer fixes that reduce the gap between code, manifest, docs, tests, and specs.
- Preserve current architecture unless the task explicitly requires architectural change.
- Fix root causes instead of adding cosmetic patches.
- Avoid introducing support for additional server types unless the task requires it. Tomcat is the only implemented plugin.
- Keep command ids, tree actions, webviews, persistence schema, and docs aligned when changing user-facing behavior.

## Verification requirements

- Before claiming completion for code changes, run the narrowest relevant verification among `npm run check-types`, `npm run lint`, and `npm test`.
- If `npm test` is still failing because of known baseline issues, state that clearly and separate pre-existing failures from new regressions.
- For changes that affect command contributions or packaging, inspect [package.json](../package.json), [src/commands/index.ts](../src/commands/index.ts), and [src/extension.ts](../src/extension.ts) together.

## Implementation conventions

- Keep diffs focused and minimal.
- Match existing TypeScript style and strict typing.
- Prefer updating existing services and core modules over adding duplicate abstractions.
- When touching persistence or runtime behavior, check both workspace config and extension storage flows.
- When touching deployment behavior, verify how [src/services/DeploymentService.ts](../src/services/DeploymentService.ts), [src/services/AutoSyncService.ts](../src/services/AutoSyncService.ts), and [src/core/server/plugins/implementations/TomcatPlugin.ts](../src/core/server/plugins/implementations/TomcatPlugin.ts) interact.

## Documentation conventions

- Keep README, changelog, and specs factually aligned with the implemented state.
- Do not leave placeholder boilerplate or aspirational claims after making changes.
- Prefer explicit limitations over vague roadmap language.