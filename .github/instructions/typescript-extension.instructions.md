---
name: TypeScript Extension Standards
description: Use when editing the VS Code extension TypeScript sources under src/ or test-related TypeScript files.
applyTo: "src/**/*.ts,src/**/*.tsx,test/**/*.ts"
---

# TypeScript Extension Standards

## Scope

These instructions apply to the TypeScript implementation of the VS Code extension.

## Architecture

- Preserve the existing separation between UI, services, core runtime, persistence, and plugin modules.
- Avoid pulling UI concerns into core modules unless there is already a project-specific reason.
- When a change affects server lifecycle, inspect service, runtime, and plugin layers together.

## Change discipline

- Prefer small, local edits over broad refactors.
- Reuse existing domain types before introducing new shapes.
- Keep command handlers honest: do not show success messages for work that is not actually performed.
- When adding new behavior, check whether it must also be reflected in tree context values, webviews, and manifest commands.

## Error handling

- Prefer the existing `Result` pattern where it is already used.
- Return actionable errors with enough context to debug extension behavior.
- Do not swallow plugin or runtime failures behind generic success notifications.

## Verification

- After TypeScript edits, prefer `npm run check-types` first.
- If the change affects extension activation, commands, or packaging, also verify `npm run lint`.