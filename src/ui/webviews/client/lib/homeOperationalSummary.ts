/**
 * Derives Home tab operational signals from syncState (plan §7.2).
 * Pure logic — testable without Svelte.
 */

export type HomeOperationalSummary = {
  totalServers: number;
  running: number;
  stopped: number;
  error: number;
  transitioning: number;
  /** Deployments in `error` state across all servers. */
  deploymentErrors: number;
  serversInError: Array<{ id: string; name: string }>;
};

type ServerLike = {
  serverKey: string;
  config: { id?: string; name?: string };
};

function serverName(config: { id?: string; name?: string }): string {
  return typeof config.name === 'string' && config.name.trim().length > 0
    ? config.name
    : (config.id ?? 'Server');
}

function runtimeStateForKey(
  runtimeStates: Record<string, { state?: string } | undefined>,
  serverKey: string,
): string {
  const rs = runtimeStates[serverKey];
  return typeof rs?.state === 'string' ? rs.state : 'stopped';
}

export function computeHomeOperationalSummary(
  servers: ServerLike[],
  runtimeStates: Record<string, { state?: string } | undefined>,
  deploymentStates: Record<string, Record<string, string> | undefined>,
): HomeOperationalSummary {
  let running = 0;
  let stopped = 0;
  let error = 0;
  let transitioning = 0;
  const serversInError: Array<{ id: string; name: string }> = [];

  for (const s of servers) {
    const st = runtimeStateForKey(runtimeStates, s.serverKey);
    switch (st) {
      case 'running':
        running += 1;
        break;
      case 'error':
        error += 1;
        serversInError.push({ id: s.config.id ?? s.serverKey, name: serverName(s.config) });
        break;
      case 'starting':
      case 'stopping':
        transitioning += 1;
        break;
      default:
        stopped += 1;
    }
  }

  let deploymentErrors = 0;
  for (const byServer of Object.values(deploymentStates ?? {})) {
    if (!byServer) continue;
    for (const depState of Object.values(byServer)) {
      if (depState === 'error') deploymentErrors += 1;
    }
  }

  return {
    totalServers: servers.length,
    running,
    stopped,
    error,
    transitioning,
    deploymentErrors,
    serversInError,
  };
}
