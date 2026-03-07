# Shared Agent Guidance

These instructions are intended to be compatible across AI coding agents working in this repository.

## Core rules

- Read the code before changing it.
- Treat the current implementation as the primary truth.
- Treat [PROJECT_TECHNICAL_AUDIT.md](PROJECT_TECHNICAL_AUDIT.md) as the baseline assessment of production blockers.
- Keep changes minimal, verifiable, and scoped to the user request.

## Repository context

- This is a VS Code extension for Java server management.
- The shipped implementation is Tomcat-first.
- Specs are richer than the current codebase. Reconcile with code before implementing spec-driven work.
- The current persistence model still reflects a legacy or transitional configuration shape.

## Quality bar

- Do not claim production readiness without evidence.
- When editing commands, also check manifest contributions and user-facing labels.
- When editing runtime or deployment flows, verify state management, persistence, and plugin behavior together.
- When editing tests or build configuration, prefer restoring a working baseline over adding more tooling.

## Required checks before finishing code work

- Run the smallest relevant verification command.
- Call out unresolved baseline failures explicitly.
- Update docs when user-visible behavior or project status changes.