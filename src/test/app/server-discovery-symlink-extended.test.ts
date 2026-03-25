/**
 * Extended coverage: discovery deduplication via realpath (Alternate / Stateful).
 * Maps to feature F-DISCOVERY.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ServerDiscoveryService } from '@app/server/ServerDiscoveryService';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { Logger } from '@core/types';
import { ok } from '@core/result';

function mockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => mockLogger(),
  };
}

describe('ServerDiscoveryService symlink dedup (extended)', () => {
  let tmpDir: string;
  let pluginRegistry: PluginRegistry;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-symdisc-'));
    pluginRegistry = {
      detectServerType: vi.fn(),
    } as unknown as PluginRegistry;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function fakeTomcatLayout(dir: string): Promise<void> {
    await fs.mkdir(path.join(dir, 'bin'), { recursive: true });
    await fs.mkdir(path.join(dir, 'lib'), { recursive: true });
    await fs.mkdir(path.join(dir, 'conf'), { recursive: true });
  }

  it('EXT-DISC-001: two workspace symlinks to same real Tomcat yield one discovery', async () => {
    const realHome = path.join(tmpDir, 'real-tomcat');
    await fakeTomcatLayout(realHome);
    const ws = path.join(tmpDir, 'ws');
    await fs.mkdir(ws);
    const linkA = path.join(ws, 'tomcat-a');
    const linkB = path.join(ws, 'tomcat-b');
    await fs.symlink(realHome, linkA);
    await fs.symlink(realHome, linkB);

    (pluginRegistry.detectServerType as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({ type: 'tomcat', report: { ok: true, version: '9' } }),
    );

    const service = new ServerDiscoveryService(pluginRegistry, mockLogger());
    const results = await service.discover([ws]);
    expect(results).toHaveLength(1);
    expect(pluginRegistry.detectServerType).toHaveBeenCalledTimes(1);
    expect(results[0].path).toBe(await fs.realpath(realHome));
  });
});
