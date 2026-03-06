---
name: vscode-extension-release
description: Use when preparing, validating, or packaging this repository as a VS Code extension release, including command contributions, build scripts, smoke checks, and release notes.
argument-hint: Optional scope such as package, activation, commands, or release notes.
---

# VS Code Extension Release

Use this skill for extension-specific release work.

## Focus areas

- extension activation and entrypoint correctness
- command contribution consistency in `package.json`
- build, package, and test script health
- release notes and README accuracy
- launch and debug configuration sanity

## Workflow

1. Inspect [package.json](../../../package.json), [src/extension.ts](../../../src/extension.ts), [src/commands/index.ts](../../../src/commands/index.ts), [esbuild.js](../../../esbuild.js), and [tsconfig.json](../../../tsconfig.json).
2. Confirm what is actually shipped and user-visible.
3. Validate the smallest relevant build or test command.
4. Update release-facing docs if behavior changed.

## Output

- release blocker summary
- affected files
- verification command set
- remaining risks

See [release-checklist.md](./release-checklist.md) for the extension-specific gate list.