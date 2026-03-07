---
name: production-readiness
description: Use when evaluating or closing production blockers for this VS Code extension, especially around tests, packaging, manifest alignment, diagnostics, and release confidence.
argument-hint: Optional scope such as tests, packaging, diagnostics, or release blocker.
---

# Production Readiness

Use this skill to move Java Server Manager closer to a production release.

## Context

- The current baseline is documented in [PROJECT_TECHNICAL_AUDIT.md](../../../PROJECT_TECHNICAL_AUDIT.md).
- This repository is a VS Code extension with an advanced MVP implementation.
- `npm run check-types` and `npm run lint` were previously green, while `npm test` was identified as a blocking gap.

## Workflow

1. Identify the exact release blocker and the files that govern it.
2. Confirm current repository behavior before proposing or making changes.
3. Prefer the smallest viable milestone that improves release confidence.
4. Keep implementation, manifest, docs, and verification aligned.
5. Validate with the narrowest relevant command.

## Areas to prioritize

- test pipeline viability
- command and manifest truthfulness
- persistence and config compatibility
- deployment correctness and rollback safety
- diagnostics and logging
- packaging and release workflow

## Expected output

- current blocker summary
- proposed change set
- verification steps
- residual risks

See [release-checklist.md](./release-checklist.md) for the expected production gate order.