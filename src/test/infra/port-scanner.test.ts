import { describe, it, expect } from 'vitest';
import { PortScanner } from '@infra/ports/PortScanner';
import * as net from 'net';

describe('PortScanner', () => {
  const scanner = new PortScanner();

  it('probe returns true for a listening port', async () => {
    // Create a temporary server
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const result = await scanner.probe(port, '127.0.0.1');
      expect(result).toBe(true);
    } finally {
      server.close();
    }
  });

  it('probe returns false for a non-listening port', async () => {
    // Use a port that's almost certainly not in use
    const result = await scanner.probe(59123, '127.0.0.1');
    expect(result).toBe(false);
  });

  it('isPortFree returns true for a free port', async () => {
    const free = await scanner.isPortFree(59124, '127.0.0.1');
    expect(free).toBe(true);
  });

  it('isPortFree returns false for an occupied port', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const free = await scanner.isPortFree(port, '127.0.0.1');
      expect(free).toBe(false);
    } finally {
      server.close();
    }
  });

  it('findFreePort returns a port number', async () => {
    const port = await scanner.findFreePort(49152, '127.0.0.1', 50);
    expect(port).toBeTypeOf('number');
    expect(port).toBeGreaterThanOrEqual(49152);
  });
});
