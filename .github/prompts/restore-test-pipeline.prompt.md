---
name: restore-test-pipeline
description: Repair or redesign the test pipeline for this extension, starting from the current broken baseline.
agent: ReleaseHardener
argument-hint: Optional scope such as runTest.ts, ESM/CJS, smoke tests, or CI.
---
Restore a working test pipeline for this VS Code extension.

Start from the current repository state and use [PROJECT_TECHNICAL_AUDIT.md](../../PROJECT_TECHNICAL_AUDIT.md) as context.

Requirements:

- Diagnose the current failure before editing
- Prefer the smallest viable path to a working `npm test`
- Keep TypeScript, bundling, and extension-host constraints aligned
- If full restoration is too large, implement the smallest stable baseline and document what remains

Verification target:

- `npm test` or a clearly documented replacement test path that is wired into `package.json`