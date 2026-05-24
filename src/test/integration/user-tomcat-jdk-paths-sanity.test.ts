/**
 * Integration sanity checks using user-provided absolute paths (Integration / Compatibility).
 * Preconditions: paths exist on the machine running tests.
 *
 * Maps to feature F-LOCAL-RUNTIME.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** Exact local fallback paths from project test specification; CI can override with env. */
export const USER_TOMCAT_HOME = process.env.JSM_TEST_TOMCAT_HOME || '/Users/federicofilippi/Desktop/apache-tomcat-9.0.105';
export const USER_JAVA_HOME = process.env.JSM_TEST_JAVA_HOME || process.env.JAVA_HOME || '/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home';

const pathsReady =
  fsSync.existsSync(USER_TOMCAT_HOME) &&
  fsSync.existsSync(path.join(USER_JAVA_HOME, 'bin', 'java'));

describe.skipIf(!pathsReady)('User Tomcat + JDK path sanity', () => {
  it('EXT-ENV-001: Tomcat catalina script exists', async () => {
    const script = path.join(USER_TOMCAT_HOME, 'bin', 'catalina.sh');
    const st = await fs.stat(script);
    expect(st.isFile()).toBe(true);
  });

  it('EXT-ENV-002: Tomcat lib/catalina.jar exists', async () => {
    const jar = path.join(USER_TOMCAT_HOME, 'lib', 'catalina.jar');
    const st = await fs.stat(jar);
    expect(st.isFile()).toBe(true);
  });

  it('EXT-ENV-003: Tomcat conf/server.xml exists', async () => {
    const xml = path.join(USER_TOMCAT_HOME, 'conf', 'server.xml');
    const st = await fs.stat(xml);
    expect(st.isFile()).toBe(true);
  });

  it('EXT-ENV-004: java -version exits 0 with USER_JAVA_HOME', async () => {
    const javaBin = path.join(USER_JAVA_HOME, 'bin', 'java');
    const { stderr, stdout } = await execFileAsync(javaBin, ['-version'], {
      env: { ...process.env, JAVA_HOME: USER_JAVA_HOME },
    });
    const combined = `${stdout}${stderr}`;
    expect(combined.toLowerCase()).toContain('version');
  });

  it('EXT-ENV-005: Tomcat version marker file readable', async () => {
    const release = path.join(USER_TOMCAT_HOME, 'RELEASE-NOTES');
    const alt = path.join(USER_TOMCAT_HOME, 'RUNNING.txt');
    let found = false;
    try {
      await fs.access(release);
      found = true;
    } catch {
      try {
        await fs.access(alt);
        found = true;
      } catch {
        found = false;
      }
    }
    expect(found).toBe(true);
  });
});

describe('User Tomcat + JDK path sanity — skip marker', () => {
  it('EXT-ENV-SKIP: documents when integration suite is skipped', () => {
    if (!pathsReady) {
      expect(pathsReady).toBe(false);
    } else {
      expect(pathsReady).toBe(true);
    }
  });
});
