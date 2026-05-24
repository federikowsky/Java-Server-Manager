import type { Result } from '@core/result';
import { err, ok } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';

export interface PortProbe {
  isPortFree(port: number, host?: string): Promise<boolean>;
  findFreePort(startPort: number, host?: string, maxTries?: number): Promise<number | null>;
}

export interface PortAssistantRequest {
  port: number;
  host?: string;
  field?: string;
  maxTries?: number;
}

export interface PortAssistantSuggestion {
  field?: string;
  requestedPort: number;
  probeHost: string;
  free: boolean;
  suggestedPort?: number;
}

const LOCAL_PROBE_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
]);

function validatePort(port: number): Result<number, JsmError> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return err(new JsmError({
      code: ErrorCode.InvalidConfig,
      message: 'Port must be an integer between 1 and 65535.',
    }));
  }
  return ok(port);
}

function resolveProbeHost(host: string | undefined): Result<string, JsmError> {
  const candidate = host?.trim() || '127.0.0.1';
  if (candidate === '0.0.0.0' || candidate === '::') {
    return ok('127.0.0.1');
  }
  if (!LOCAL_PROBE_HOSTS.has(candidate)) {
    return err(new JsmError({
      code: ErrorCode.InvalidConfig,
      message: 'Port assistant only checks local bind addresses.',
      details: `Use 127.0.0.1, localhost, ::1, or 0.0.0.0. Received: ${candidate}`,
    }));
  }
  return ok(candidate);
}

export class PortAssistantService {
  constructor(private readonly probe: PortProbe) {}

  async suggest(request: PortAssistantRequest): Promise<Result<PortAssistantSuggestion, JsmError>> {
    const portResult = validatePort(request.port);
    if (!portResult.ok) {
      return portResult;
    }

    const hostResult = resolveProbeHost(request.host);
    if (!hostResult.ok) {
      return hostResult;
    }

    const requestedPort = portResult.value;
    const probeHost = hostResult.value;
    const free = await this.probe.isPortFree(requestedPort, probeHost);
    if (free) {
      return ok({
        field: request.field,
        requestedPort,
        probeHost,
        free: true,
      });
    }

    const suggestedPort = await this.probe.findFreePort(
      Math.min(requestedPort + 1, 65535),
      probeHost,
      request.maxTries ?? 100,
    );

    if (suggestedPort === null) {
      return ok({
        field: request.field,
        requestedPort,
        probeHost,
        free: false,
      });
    }

    return ok({
      field: request.field,
      requestedPort,
      probeHost,
      free: false,
      suggestedPort,
    });
  }
}
