---
name: reconcile-specs
description: Compare implementation against specs and docs, then identify what must change first.
agent: SpecReconciler
argument-hint: Optional scope such as commands, config schema, diagnostics, or Tomcat runtime.
---
Reconcile the implementation, manifest, and documentation for this repository.

Compare the relevant code with [docs/specs.md](../../docs/specs.md), [docs/specs-extended.md](../../docs/specs-extended.md), [README.md](../../README.md), and [package.json](../../package.json).

Return:

1. Repository facts
2. Conflicts or outdated claims
3. Missing but high-impact capabilities
4. The next priority changes to align the project with a production roadmap