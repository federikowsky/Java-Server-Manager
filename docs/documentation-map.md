# Documentation Map

## Purpose

This file defines the canonical documentation set for Java Server Manager as of March 18, 2026.

## Canonical Documents

- [README.md](../README.md)
  - public overview, current status, supported scope, and developer entry points
- [docs/specs.md](./specs.md)
  - canonical product and domain specification
  - note: it is still a candidate implementation target and may describe work not yet shipped
- [docs/release-process.md](./release-process.md)
  - canonical release governance, release gates, approval model, and CI/CD contract
- [docs/release-decision-log.md](./release-decision-log.md)
  - frozen release-policy decisions and incident follow-ups
- [CHANGELOG.md](../CHANGELOG.md)
  - authoritative release history

## Supporting Documents

- [docs/vscode-marketplace-release-foundation.plan.md](./vscode-marketplace-release-foundation.plan.md)
  - approved planning baseline
  - superseded as an operational source of truth by `docs/release-process.md`
- [docs/configuration-rationalization-analysis-plan.md](./configuration-rationalization-analysis-plan.md)
  - supporting implementation analysis
- [docs/spa_webview_architecture_analysis.md](./spa_webview_architecture_analysis.md)
  - supporting UI architecture analysis
- [docs/codex-gpt54-release-orchestrator.prompt.md](./codex-gpt54-release-orchestrator.prompt.md)
  - execution prompt, not repository policy

## Repository Reality Rules

- README and `package.json` must describe the implemented product surface only.
- The implemented server surface is Tomcat-only. Plugin-ready architecture is real; additional server types are not.
- CI exists today and remains separate from release publication.
- Release claims are not valid unless they are backed by `CHANGELOG.md`, `docs/release-process.md`, and the release workflow.

## Reconciliation Decisions

- Missing legacy references to `docs/specs.md`, `docs/specs-extended.md`, `PROJECT_TECHNICAL_AUDIT.md`, and `PROJECT_DOSSIER.md` are removed from canonical docs.
- Release governance is materialized in dedicated release docs instead of living only in planning notes.
- Supporting analysis documents may contain future-looking material; they do not override README, changelog, or release policy.
