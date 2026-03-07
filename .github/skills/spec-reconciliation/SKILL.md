---
name: spec-reconciliation
description: Use when comparing the current implementation with specs, docs, or manifest definitions to identify drift, conflicts, and the next corrective action.
argument-hint: Optional scope such as commands, config schema, runtime model, or documentation.
---

# Spec Reconciliation

Use this skill to reconcile repository truth with the project specifications.

## Primary references

- [docs/specs.md](../../../docs/specs.md)
- [docs/specs-extended.md](../../../docs/specs-extended.md)
- [package.json](../../../package.json)
- [README.md](../../../README.md)
- [PROJECT_TECHNICAL_AUDIT.md](../../../PROJECT_TECHNICAL_AUDIT.md)

## Workflow

1. Identify the implemented code path first.
2. Compare user-facing command ids, config schema, and lifecycle behavior against specs.
3. Separate factual conflicts from recommendations.
4. Prefer narrow, high-impact corrections over speculative redesign.

## Expected output

- observed repository facts
- spec or doc conflicts
- missing capabilities that materially affect delivery
- recommended next action

Use [output-template.md](./output-template.md) as the response structure when the user asks for a formal reconciliation report.