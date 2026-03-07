---
name: tomcat-hardening
description: Use when improving the Tomcat runtime, deployment flow, autosync behavior, log access, or safety checks in the only implemented server plugin.
argument-hint: Optional scope such as catalina base, deploy flow, autosync, logs, or restart safety.
---

# Tomcat Hardening

Use this skill for the Tomcat-specific runtime and deployment path.

## Key files

- [src/core/server/plugins/implementations/TomcatPlugin.ts](../../../src/core/server/plugins/implementations/TomcatPlugin.ts)
- [src/services/DeploymentService.ts](../../../src/services/DeploymentService.ts)
- [src/services/AutoSyncService.ts](../../../src/services/AutoSyncService.ts)
- [src/services/LogService.ts](../../../src/services/LogService.ts)
- [src/services/ServerService.ts](../../../src/services/ServerService.ts)

## Review goals

- confirm actual deploy strategy
- confirm whether incremental deploy is real or implicit fallback
- check startup, shutdown, and restart safety
- inspect log-path assumptions and debug exposure
- identify where the current implementation diverges from the target Tomcat model in the specs

## Expected output

- current behavior
- concrete risk list
- minimal hardening steps
- verification plan

Use [checklist.md](./checklist.md) as the baseline review order.