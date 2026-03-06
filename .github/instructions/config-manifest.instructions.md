---
name: Config And Manifest Rules
description: Use when editing package.json, TypeScript or ESLint config, esbuild setup, or workspace config files that affect extension activation, commands, packaging, or runtime settings.
applyTo: "package.json,tsconfig.json,eslint.config.mjs,esbuild.js,.vscode/**/*.json"
---

# Config And Manifest Rules

## Manifest alignment

- Keep contributed commands, menus, key labels, and tree contexts aligned with actual handlers in [src/commands/index.ts](../../src/commands/index.ts).
- Do not add command ids or menu items without confirming the handler exists and behaves correctly.
- When removing or renaming a command, update all contribution points in the same change.

## Build and packaging

- Preserve the existing extension entrypoint and bundling flow unless the task explicitly changes packaging strategy.
- Prefer minimal config edits that support the current CommonJS extension packaging constraints.
- Be careful with ESM versus CommonJS interactions. The repo already has a known test-path mismatch.

## Workspace config

- Treat `.vscode/servers.json` as current operational evidence, not as a normative schema.
- Avoid silently changing configuration shape without migration or documentation.

## Verification

- After manifest or config changes, check the related scripts in [package.json](../../package.json) and run the narrowest relevant verification command.