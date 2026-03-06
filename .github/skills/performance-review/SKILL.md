---
name: performance-review
description: Use when reviewing this VS Code extension for startup cost, deployment efficiency, file-watching churn, and scalability risks.
argument-hint: Optional scope such as activation, autosync, tree refresh, deployment, or logging.
---

# Performance Review

Use this skill to evaluate performance and responsiveness risks in Java Server Manager.

## Primary references

- [src/extension.ts](../../../src/extension.ts)
- [src/ui/views/ServerTreeViewProvider.ts](../../../src/ui/views/ServerTreeViewProvider.ts)
- [src/services/AutoSyncService.ts](../../../src/services/AutoSyncService.ts)
- [src/services/DeploymentService.ts](../../../src/services/DeploymentService.ts)
- [src/core/config/ConfigManager.ts](../../../src/core/config/ConfigManager.ts)
- [src/core/server/plugins/implementations/TomcatPlugin.ts](../../../src/core/server/plugins/implementations/TomcatPlugin.ts)
- [PROJECT_TECHNICAL_AUDIT.md](../../../PROJECT_TECHNICAL_AUDIT.md)

## Review workflow

1. Identify the hot path or scale scenario.
2. Check for synchronous I/O, repeated full refreshes, redundant event propagation, and unbounded watchers or buffers.
3. Evaluate how the path behaves with multiple servers, deployments, or large exploded apps.
4. Separate measured or code-proven problems from speculative tuning.
5. Call out missing benchmarks or stress tests.

## Expected output

- findings ordered by severity
- triggering scenario and likely user impact
- code evidence
- missing measurements or tests
- smallest high-value fix