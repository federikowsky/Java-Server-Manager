---
name: security-review
description: Use when reviewing this VS Code extension for security flaws, red-team abuse paths, unsafe command execution, or sensitive data exposure.
argument-hint: Optional scope such as hooks, deployment, persistence, runtime launch, or debug exposure.
---

# Security Review

Use this skill to perform a concrete security review of Java Server Manager.

## Primary references

- [src/core/server/plugins/implementations/TomcatPlugin.ts](../../../src/core/server/plugins/implementations/TomcatPlugin.ts)
- [src/services/DeploymentService.ts](../../../src/services/DeploymentService.ts)
- [src/services/AutoSyncService.ts](../../../src/services/AutoSyncService.ts)
- [src/core/persistence/ConfigRepo.ts](../../../src/core/persistence/ConfigRepo.ts)
- [src/core/debug/DebugManager.ts](../../../src/core/debug/DebugManager.ts)
- [.github/hooks](../../../.github/hooks)
- [PROJECT_TECHNICAL_AUDIT.md](../../../PROJECT_TECHNICAL_AUDIT.md)

## Review workflow

1. Identify the trust boundary and attacker-controlled inputs.
2. Trace file paths, process launches, hook execution, and persisted config.
3. Look for injection, path traversal, unsafe defaults, unintended network exposure, and data leakage.
4. Separate proven findings from hardening suggestions.
5. Call out missing tests or validations that leave the risk unguarded.

## Expected output

- findings ordered by severity
- exploit path and impact
- code evidence
- missing safeguards or tests
- smallest safe next action