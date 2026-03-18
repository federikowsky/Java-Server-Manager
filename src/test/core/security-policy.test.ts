import { describe, it, expect } from 'vitest';
import { validateSecurityPolicy } from '@core/policy/SecurityPolicy';
import { ErrorCode } from '@core/errors/codes';
import type { ServerConfig } from '@core/types/domain';

function makeConfig(overrides: Partial<ServerConfig['run']> = {}): ServerConfig {
  return {
    id: 'srv-1',
    name: 'Test',
    type: 'tomcat',
    runtime: { id: 'rt-1', homePath: '/opt/tomcat' },
    instancePath: '/tmp/inst',
    javaHome: '/opt/java',
    host: '127.0.0.1',
    ports: { http: 8080, debug: 5005 },
    run: { env: {}, vmArgs: [], ...overrides },
    debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
    deployments: [],
    autosync: {
      enabled: true,
      debounceMs: 400,
      maxBatchFiles: 200,
      maxBatchBytes: 20_000_000,
      stormBackoffMs: 2000,
      ignoreGlobs: [],
    },
    hooks: [],
  };
}

describe('SecurityPolicy', () => {
  it('accepts config with no blocked env/vmArgs', () => {
    const result = validateSecurityPolicy(makeConfig());
    expect(result.ok).toBe(true);
  });

  it('accepts safe env variables', () => {
    const result = validateSecurityPolicy(makeConfig({ env: { JAVA_HOME: '/opt/java', PATH: '/usr/bin' }, vmArgs: [] }));
    expect(result.ok).toBe(true);
  });

  it('rejects LD_PRELOAD env variable', () => {
    const result = validateSecurityPolicy(makeConfig({ env: { LD_PRELOAD: '/evil.so' }, vmArgs: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.SecurityPolicyViolation);
  });

  it('rejects DYLD_INSERT_LIBRARIES env variable', () => {
    const result = validateSecurityPolicy(makeConfig({ env: { DYLD_INSERT_LIBRARIES: '/evil.dylib' }, vmArgs: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.SecurityPolicyViolation);
  });

  it('rejects JAVA_TOOL_OPTIONS env variable', () => {
    const result = validateSecurityPolicy(makeConfig({ env: { JAVA_TOOL_OPTIONS: '-javaagent:evil.jar' }, vmArgs: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.SecurityPolicyViolation);
  });

  it('rejects -javaagent: vmArg', () => {
    const result = validateSecurityPolicy(makeConfig({ env: {}, vmArgs: ['-javaagent:/evil.jar'] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.SecurityPolicyViolation);
  });

  it('rejects -agentlib: vmArg', () => {
    const result = validateSecurityPolicy(makeConfig({ env: {}, vmArgs: ['-agentlib:jdwp'] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.SecurityPolicyViolation);
  });

  it('rejects -XX:OnOutOfMemoryError vmArg', () => {
    const result = validateSecurityPolicy(makeConfig({ env: {}, vmArgs: ['-XX:OnOutOfMemoryError=rm -rf /'] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.SecurityPolicyViolation);
  });

  it('accepts safe vmArgs', () => {
    const result = validateSecurityPolicy(makeConfig({
      env: {},
      vmArgs: ['-Xmx512m', '-Xms256m', '-Djava.awt.headless=true'],
    }));
    expect(result.ok).toBe(true);
  });

  it('rejects case-insensitively for vmArg prefixes', () => {
    const result = validateSecurityPolicy(makeConfig({ env: {}, vmArgs: ['-JAVAAGENT:/evil.jar'] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.SecurityPolicyViolation);
  });
});
