# Changelog

All notable changes to the Java Server Manager extension will be documented in this file.

## [Unreleased]

### Repository cleanup
- moved the canonical product specification to [docs/specs.md](./docs/specs.md)
- moved the extended specification to [docs/specs-extended.md](./docs/specs-extended.md)
- added a [docs/README.md](./docs/README.md) index for project documentation
- removed stale scaffold and placeholder files from the active project surface

### AI customization
- normalized custom agent tool usage to avoid obsolete `usages` references
- added dedicated security and performance review agents
- added supporting security-review and performance-review skills

### Documentation
- rewrote [README.md](./README.md) to reflect the current MVP status instead of production-ready claims
- aligned reconciliation prompts and skills with the new docs layout

---

## [0.0.1] - Initial Release

### Added
- Basic extension structure and VS Code integration
- Command system for server and deployment management
- Tree view for server visualization
- Basic server lifecycle management
- Event bus and error handling system
- Configuration service and validation
- Basic Tomcat runtime (stub implementation)

### Features
- Server CRUD operations
- Deployment management
- Auto-sync service
- Debug manager integration
- Global template system
- Extension activation and lifecycle management