import type { SpaSettings } from '../protocol';

export type EditableSettings = SpaSettings;

export type DirtySettingsPayload = Partial<SpaSettings>;

export function buildDirtySettingsPayload(
  current: EditableSettings,
  baseline: EditableSettings,
): DirtySettingsPayload {
  const payload: DirtySettingsPayload = {};

  if (current.defaultHttpPort !== baseline.defaultHttpPort) {
    payload.defaultHttpPort = current.defaultHttpPort;
  }
  if (current.defaultDebugPort !== baseline.defaultDebugPort) {
    payload.defaultDebugPort = current.defaultDebugPort;
  }
  if (current.defaultJavaHome !== baseline.defaultJavaHome) {
    payload.defaultJavaHome = current.defaultJavaHome;
  }
  if (current.showStatusInSidebar !== baseline.showStatusInSidebar) {
    payload.showStatusInSidebar = current.showStatusInSidebar;
  }
  if (current.localTelemetryEnabled !== baseline.localTelemetryEnabled) {
    payload.localTelemetryEnabled = current.localTelemetryEnabled;
  }

  return payload;
}

export function hasDirtySettings(payload: DirtySettingsPayload): boolean {
  return Object.keys(payload).length > 0;
}
