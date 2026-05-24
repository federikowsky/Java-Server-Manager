import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@core/errors/codes';
import { PortAssistantService, type PortProbe } from '@app/network';

describe('PortAssistantService', () => {
  let probe: PortProbe;
  let service: PortAssistantService;

  beforeEach(() => {
    probe = {
      isPortFree: vi.fn(async () => true),
      findFreePort: vi.fn(async () => 8081),
    };
    service = new PortAssistantService(probe);
  });

  it('reports the requested port when it is available', async () => {
    const result = await service.suggest({ port: 8080, host: '127.0.0.1', field: 'httpPort' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        field: 'httpPort',
        requestedPort: 8080,
        probeHost: '127.0.0.1',
        free: true,
      });
    }
    expect(probe.isPortFree).toHaveBeenCalledWith(8080, '127.0.0.1');
    expect(probe.findFreePort).not.toHaveBeenCalled();
  });

  it('suggests the next free port when the requested port is occupied', async () => {
    probe.isPortFree = vi.fn(async () => false);
    probe.findFreePort = vi.fn(async () => 8181);
    service = new PortAssistantService(probe);

    const result = await service.suggest({ port: 8080, host: 'localhost' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.free).toBe(false);
      expect(result.value.suggestedPort).toBe(8181);
      expect(result.value.probeHost).toBe('localhost');
    }
    expect(probe.findFreePort).toHaveBeenCalledWith(8081, 'localhost', 100);
  });

  it('maps wildcard bind hosts to loopback probes without scanning arbitrary networks', async () => {
    const result = await service.suggest({ port: 8080, host: '0.0.0.0' });

    expect(result.ok).toBe(true);
    expect(probe.isPortFree).toHaveBeenCalledWith(8080, '127.0.0.1');
  });

  it('rejects remote hosts fail-closed', async () => {
    const result = await service.suggest({ port: 8080, host: 'example.com' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.InvalidConfig);
      expect(result.error.message).toContain('local bind addresses');
    }
    expect(probe.isPortFree).not.toHaveBeenCalled();
  });

  it('rejects invalid ports before probing', async () => {
    const result = await service.suggest({ port: 70000 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.InvalidConfig);
      expect(result.error.message).toContain('between 1 and 65535');
    }
    expect(probe.isPortFree).not.toHaveBeenCalled();
  });
});
