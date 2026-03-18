import * as net from 'net';

const PROBE_TIMEOUT_MS = 200;

/**
 * TCP port scanner (§13).
 * Single TCP connect attempt with < 200ms budget.
 */
export class PortScanner {
  /** Check if a port is free (not listening). */
  async isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
    const inUse = await this.probe(port, host);
    return !inUse;
  }

  /** Probe whether a port is listening. Returns true if connection succeeds. */
  async probe(port: number, host = '127.0.0.1'): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      let settled = false;

      const done = (result: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(PROBE_TIMEOUT_MS);
      socket.on('connect', () => done(true));
      socket.on('timeout', () => done(false));
      socket.on('error', () => done(false));
      socket.connect(port, host);
    });
  }

  /**
   * Find a free port starting from `startPort`, incrementing up to `startPort + maxTries`.
   * Returns the first free port or null if none found.
   */
  async findFreePort(startPort: number, host = '127.0.0.1', maxTries = 100): Promise<number | null> {
    for (let port = startPort; port < startPort + maxTries; port++) {
      if (await this.isPortFree(port, host)) {
        return port;
      }
    }
    return null;
  }
}
