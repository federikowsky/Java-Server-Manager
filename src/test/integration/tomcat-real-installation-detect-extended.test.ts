/**
 * Integration: TomcatPlugin.detectInstallation against user-provided CATALINA_HOME layout.
 * Maps to feature F-TOMCAT-DETECT.
 */
import { describe, it, expect } from 'vitest';
import { TomcatPlugin } from '@plugins/tomcat/TomcatPlugin';
import type { KeyValueStore } from '@core/types';
import type { Logger } from '@core/types/logger';
import * as fsSync from 'fs';
import * as path from 'path';

/** Must match `user-tomcat-jdk-paths-sanity.test.ts` (user Inputs). */
const USER_TOMCAT_HOME = '/Users/federicofilippi/Desktop/apache-tomcat-9.0.105';

function mockKeyValueStore(): KeyValueStore {
  const data = new Map<string, unknown>();
  return {
    get: <T>(key: string) => data.get(key) as T | undefined,
    set: async <T>(key: string, value: T) => {
      data.set(key, value);
    },
    delete: async (key: string) => {
      data.delete(key);
    },
  };
}

function noopLogger(): Logger {
  const noop = () => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => noopLogger(),
  };
}

const tomcatReady = fsSync.existsSync(USER_TOMCAT_HOME);

describe.skipIf(!tomcatReady)('TomcatPlugin detectInstallation (real home)', () => {
  it('EXT-TOM-REAL-001: user Tomcat home passes structural checks', async () => {
    const plugin = new TomcatPlugin(noopLogger(), { keyValueStore: mockKeyValueStore() });
    try {
      const r = await plugin.detectInstallation(USER_TOMCAT_HOME);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.ok).toBe(true);
      expect(r.value.checks.every(c => c.ok)).toBe(true);
      if (r.value.version) {
        expect(r.value.version.split('.').length).toBeGreaterThanOrEqual(2);
      }
    } finally {
      await plugin.dispose();
    }
  });

  it('EXT-TOM-REAL-002: negative path fails checks', async () => {
    const plugin = new TomcatPlugin(noopLogger(), { keyValueStore: mockKeyValueStore() });
    try {
      const bogus = path.join(USER_TOMCAT_HOME, 'nonexistent-nested-xyz');
      const r = await plugin.detectInstallation(bogus);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.ok).toBe(false);
    } finally {
      await plugin.dispose();
    }
  });
});
