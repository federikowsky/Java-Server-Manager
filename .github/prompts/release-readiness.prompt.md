---
name: release-readiness
description: Assess the next release barrier for Java Server Manager and produce a concrete close-out plan.
agent: ProductionPlanner
argument-hint: Optional scope such as tests, diagnostics, config migration, or packaging.
---
Assess release readiness for ${workspaceFolderBasename}.

Use [PROJECT_TECHNICAL_AUDIT.md](../../PROJECT_TECHNICAL_AUDIT.md), [package.json](../../package.json), [README.md](../../README.md), [CHANGELOG.md](../../CHANGELOG.md), and the current source tree as your baseline.

Produce:

1. The most important unresolved production blockers
2. The smallest safe milestone to close next
3. An implementation plan with acceptance criteria
4. The exact verification commands to run

If I provide additional context after the slash command, treat it as the release scope to prioritize.