---
name: Documentation Truthfulness
description: Use when editing markdown files, product docs, changelogs, or specs so repository documentation stays aligned with the implemented state.
applyTo: "**/*.md"
---

# Documentation Truthfulness

## Repository truth

- Documentation must describe implemented behavior, not desired future state, unless the section is explicitly marked as roadmap or target architecture.
- Do not use production-ready language unless the supporting code, tests, and release process justify it.
- When specs diverge from implementation, state the divergence explicitly.

## Required cross-checks

- For user-facing features, inspect [README.md](../../README.md), [package.json](../../package.json), and the implementing source files together.
- For architecture or production-readiness statements, cross-check against [PROJECT_TECHNICAL_AUDIT.md](../../PROJECT_TECHNICAL_AUDIT.md) and current source files.
- For release notes, verify that referenced modules and features actually exist in the repository.

## Style

- Prefer precise status labels such as `implemented`, `partial`, `planned`, `missing`, or `legacy`.
- Remove scaffold boilerplate and placeholder text when touching a document.