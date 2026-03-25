# Changelog

All notable changes to the Java Server Manager extension will be documented in this file.

The format follows Keep a Changelog and this project adheres to Semantic Versioning.

## [Unreleased]

### Added
- ongoing improvements after the first public beta release

## [0.1.2] - 2026-03-25

### Autosync

- File-change batches are submitted through the per-server operation queue on `ServerLifecycle` (`enqueueDeploySync`) instead of bypassing core orchestration.
- When a sync cannot be enqueued or the queue executor reports a deploy-sync failure, `AutoSyncService.recordFailure` runs so storm protection and failure-window cooldown behave as intended.

### Unified per-server operation queue (tree and commands)

- Tree-driven server lifecycle (start/stop/restart/debug), pre-start deploy of undeployed apps, redeploy-all, deployment redeploy/undeploy, and refresh-driven deployment health checks are scheduled on the same per-server `OperationQueue` under `ServerLifecycle`.
- Progress notification **Cancel** calls `lifecycle.cancel` (aligned with **Cancel Operation** on busy servers), not a separate VS Code–only cancellation path.
- The server tree exposes a busy context when the queue has work so cancel is discoverable; queue drain errors can surface back to the UI after the queue goes idle.

## [0.1.1] - 2026-03-18

### Summary
- added explicit manifest licensing metadata required by OpenVSX validation
- aligned release metadata for dual publication (VS Code Marketplace and OpenVSX)

### Beta Disclaimer
- this is a beta prerelease intended for validation and feedback
- behavior and feature surface may change before the first stable release

### Known Limitations
- only Tomcat is supported in this release
- some advanced workflows and hardening tasks are still in progress

### Added
- added MIT license declaration and repository license file for registry compliance
- added publisher field to the extension manifest for deterministic release identity checks

## [0.1.0] - 2026-03-18

### Summary
- first public beta release of Java Server Manager
- Tomcat-first extension architecture with plugin-oriented foundations

### Beta Disclaimer
- this is a beta prerelease intended for validation and feedback
- behavior and feature surface may change before the first stable release

### Known Limitations
- only Tomcat is supported in this release
- some advanced workflows and hardening tasks are still in progress

### Added
- server discovery and local server lifecycle operations for Tomcat
- deployment and auto-sync foundations with runtime safety gates
- release governance, deterministic preflight checks, and Marketplace release workflow
