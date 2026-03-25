/**
 * Extended coverage: Tomcat HTTP startup callback edge cases (Negative / Security / Stateful).
 * Maps to feature F-TOMCAT-STARTUP-CB.
 */
import { describe, it, expect } from 'vitest';
import { TomcatStartupMonitor } from '@plugins/tomcat/TomcatStartupMonitor';
import type { Logger } from '@core/types/logger';

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

describe('TomcatStartupMonitor callbacks (extended)', () => {
  it('EXT-MON-001: GET to callback path returns 404', async () => {
    const monitor = await TomcatStartupMonitor.create({
      serverKey: 'k',
      serverName: 'n',
      logger: noopLogger(),
    });
    try {
      const res = await fetch(monitor.callbackUrl, { method: 'GET' });
      expect(res.status).toBe(404);
    } finally {
      await monitor.dispose();
    }
  });

  it('EXT-MON-002: POST wrong path returns 404', async () => {
    const monitor = await TomcatStartupMonitor.create({
      serverKey: 'k',
      serverName: 'n',
      logger: noopLogger(),
    });
    try {
      const u = new URL(monitor.callbackUrl);
      const bad = `${u.origin}/wrong`;
      const res = await fetch(bad, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: monitor.token, startupId: monitor.startupId, status: 'started' }),
      });
      expect(res.status).toBe(404);
    } finally {
      await monitor.dispose();
    }
  });

  it('EXT-MON-003: wrong token returns 403', async () => {
    const monitor = await TomcatStartupMonitor.create({
      serverKey: 'k',
      serverName: 'n',
      logger: noopLogger(),
    });
    try {
      const res = await fetch(monitor.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'wrong',
          startupId: monitor.startupId,
          status: 'started',
        }),
      });
      expect(res.status).toBe(403);
    } finally {
      await monitor.dispose();
    }
  });

  it('EXT-MON-004: wrong startupId returns 403', async () => {
    const monitor = await TomcatStartupMonitor.create({
      serverKey: 'k',
      serverName: 'n',
      logger: noopLogger(),
    });
    try {
      const res = await fetch(monitor.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: monitor.token,
          startupId: 'wrong-id',
          status: 'started',
        }),
      });
      expect(res.status).toBe(403);
    } finally {
      await monitor.dispose();
    }
  });

  it('EXT-MON-005: invalid JSON body returns 403 (body undefined)', async () => {
    const monitor = await TomcatStartupMonitor.create({
      serverKey: 'k',
      serverName: 'n',
      logger: noopLogger(),
    });
    try {
      const res = await fetch(monitor.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ not json',
      });
      expect(res.status).toBe(403);
    } finally {
      await monitor.dispose();
    }
  });

  it('EXT-MON-006: missing status string returns 400', async () => {
    const monitor = await TomcatStartupMonitor.create({
      serverKey: 'k',
      serverName: 'n',
      logger: noopLogger(),
    });
    try {
      const res = await fetch(monitor.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: monitor.token,
          startupId: monitor.startupId,
        }),
      });
      expect(res.status).toBe(400);
    } finally {
      await monitor.dispose();
    }
  });

  it('EXT-MON-007: unknown status returns 400', async () => {
    const monitor = await TomcatStartupMonitor.create({
      serverKey: 'k',
      serverName: 'n',
      logger: noopLogger(),
    });
    try {
      const res = await fetch(monitor.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: monitor.token,
          startupId: monitor.startupId,
          status: 'pending',
        }),
      });
      expect(res.status).toBe(400);
    } finally {
      await monitor.dispose();
    }
  });

  it('EXT-MON-008: failed status settles outcome with error', async () => {
    const monitor = await TomcatStartupMonitor.create({
      serverKey: 'k',
      serverName: 'n',
      logger: noopLogger(),
    });
    try {
      const res = await fetch(monitor.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: monitor.token,
          startupId: monitor.startupId,
          status: 'failed',
          message: 'Catalina failed',
        }),
      });
      expect(res.status).toBe(204);
      const out = await monitor.waitForOutcome(500);
      expect(out.state).toBe('failed');
      expect(out.message).toContain('Catalina failed');
    } finally {
      await monitor.dispose();
    }
  });

  it('EXT-MON-009: duplicate POST does not throw (settle is idempotent)', async () => {
    const monitor = await TomcatStartupMonitor.create({
      serverKey: 'k',
      serverName: 'n',
      logger: noopLogger(),
    });
    try {
      const body = JSON.stringify({
        token: monitor.token,
        startupId: monitor.startupId,
        status: 'started',
      });
      const r1 = await fetch(monitor.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const r2 = await fetch(monitor.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(r1.status).toBe(204);
      expect(r2.status).toBe(204);
      await expect(monitor.waitForOutcome(200)).resolves.toMatchObject({ state: 'started' });
    } finally {
      await monitor.dispose();
    }
  });

  it('EXT-MON-010: status comparison is case-insensitive', async () => {
    const monitor = await TomcatStartupMonitor.create({
      serverKey: 'k',
      serverName: 'n',
      logger: noopLogger(),
    });
    try {
      const res = await fetch(monitor.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: monitor.token,
          startupId: monitor.startupId,
          status: 'STARTED',
        }),
      });
      expect(res.status).toBe(204);
    } finally {
      await monitor.dispose();
    }
  });
});
