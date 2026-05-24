# Documentation Map

## Purpose

This file defines the canonical documentation set for Java Server Manager.

## Canonical documents

- [README.md](../README.md) — public overview, requirements, development entry points, and repository layout
- [docs/specs.md](./specs.md) — product and domain specification (may describe intent not yet implemented)
- [docs/documentation-map.md](./documentation-map.md) — this index and source-of-truth rules
- [docs/release-process.md](./release-process.md) — local release preflight and GitHub Actions publication flow
- [CHANGELOG.md](../CHANGELOG.md) — authoritative version history for published releases

## Repository rules

- **README** and **package.json** should describe the **implemented** product surface (commands, settings, Tomcat-first scope).
- The **implemented server surface is Tomcat-only**. Plugin-ready structure is real; other server types are not shipped.
- **CI** validates the codebase; publication runs through GitHub Actions as summarized in `docs/release-process.md`.
- **Release notes** for a version should appear in **CHANGELOG.md**; GitHub release bodies follow whatever checklist your workflow uses.

## Non-canonical material

Planning notes, release decision logs, and internal runbooks may exist outside this repository. They do not override README, CHANGELOG, `docs/specs.md`, or `docs/release-process.md` for public readers.
