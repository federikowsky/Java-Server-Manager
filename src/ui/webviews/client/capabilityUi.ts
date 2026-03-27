/**
 * Narrowing for plugin capability blobs sent on syncState (display strings only).
 */

export interface SpaCapabilityUiSlice {
  displayName?: string;
  runtimeHomeLabel?: string;
  runtimeHomeHelp?: string;
  defaultName?: string;
}

export function capabilityUiSlice(
  capabilities: Record<string, unknown>,
  pluginType: string,
): SpaCapabilityUiSlice {
  const raw = capabilities[pluginType];
  return typeof raw === 'object' && raw !== null ? (raw as SpaCapabilityUiSlice) : {};
}
