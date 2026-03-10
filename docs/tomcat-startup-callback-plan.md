# Tomcat Startup Callback Plan

Status: implemented in this repository

## Goal

Replace startup outcome polling as the primary signal for Tomcat with an event-driven callback emitted from inside Tomcat, while keeping the generic lifecycle contract clean and all Tomcat-specific behavior isolated in the Tomcat plugin.

## Design Decisions

1. Generic lifecycle code will depend on a plugin-provided `startupMonitor` contract, not on Tomcat-specific concepts.
2. Tomcat-specific startup outcome detection will use a custom `LifecycleListener` packaged with the extension.
3. The listener will notify the extension through an authenticated localhost HTTP callback.
4. `process exit` remains the fail-fast safety signal.
5. Timeout remains a fallback safety net.
6. Port probing remains a fallback for plugins that do not provide a startup monitor.

## Target Flow

1. `ServerLifecycle` calls `plugin.start(...)`.
2. `TomcatPlugin.start(...)` opens a localhost callback endpoint, generates a token and startup id, and injects callback settings into the Tomcat process.
3. `TomcatPlugin.start(...)` ensures the startup listener jar is available to the Tomcat instance and that `server.xml` contains the listener registration.
4. Tomcat starts and emits lifecycle events internally.
5. The custom listener forwards `started` or `failed` to the extension callback.
6. The plugin-provided `startupMonitor` resolves with the startup outcome.
7. `ServerLifecycle` transitions to `running` or `error` based on that outcome.

## Contract Changes

`IServerPlugin.start()` will continue to return process information immediately, but `StartResult` will optionally include a `startupMonitor`.

The monitor will expose:

1. `waitForOutcome(timeoutMs)` to await `started` or `failed`
2. `dispose()` for cleanup

This keeps the generic lifecycle layer free from Tomcat-specific transport details.

## Tomcat Plugin Scope

Tomcat-only responsibilities:

1. Create and manage the localhost callback server.
2. Generate callback token and startup id.
3. Add JVM system properties consumed by the listener.
4. Ensure the listener jar is present in the Tomcat instance runtime.
5. Patch `server.xml` idempotently to register the listener.

## Packaging Strategy

1. Store the listener source in the repository.
2. Store the built listener jar as an extension asset.
3. Ensure the asset is available both in dev runs and packaged extension runs.

The implementation will avoid compiling Java at extension runtime.

## Fallback Rules

1. If the Tomcat process exits before startup completes, startup fails immediately.
2. If the startup monitor reports failure, startup fails immediately.
3. If no outcome arrives within timeout, startup fails with timeout.
4. Plugins without a startup monitor keep the current readiness fallback path.

## Verification Scope

Implementation must cover:

1. contract tests for startup monitor support in lifecycle
2. Tomcat plugin tests for callback monitor behavior and listener patching
3. packaging/path resolution checks for the listener asset
4. typecheck and focused tests after implementation