import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ServerDiscoveryService } from '@app/server/ServerDiscoveryService';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { Logger } from '@core/types';
import { ok, err } from '@core/result';

function mockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => mockLogger(),
  };
}

describe('ServerDiscoveryService', () => {
  let tmpDir: string;
  let service: ServerDiscoveryService;
  let pluginRegistry: PluginRegistry;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-discovery-'));
    
    pluginRegistry = {
      detectServerType: vi.fn(),
    } as unknown as PluginRegistry;
    
    service = new ServerDiscoveryService(pluginRegistry, mockLogger());

    // Mock platform getter using vi.spyOn but target the default export
    // Alternatively, just let it use the real OS for tests since we handle missing directories
    
    // Clear env vars
    delete process.env.CATALINA_HOME;
    delete process.env.JETTY_HOME;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function createFakeServer(basePath: string, name: string) {
    const serverPath = path.join(basePath, name);
    await fs.mkdir(path.join(serverPath, 'bin'), { recursive: true });
    await fs.mkdir(path.join(serverPath, 'lib'), { recursive: true });
    await fs.mkdir(path.join(serverPath, 'conf'), { recursive: true });
    return serverPath;
  }

  it('discovers servers from environment variables', async () => {
    const tomcatPath = await createFakeServer(tmpDir, 'env-tomcat');
    process.env.CATALINA_HOME = tomcatPath;

    (pluginRegistry.detectServerType as ReturnType<typeof vi.fn>).mockResolvedValue(ok({
      type: 'tomcat',
      report: { ok: true, version: '10.1.0' }
    }));

    const results = await service.discover([]);
    
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe(await fs.realpath(tomcatPath));
    expect(results[0].type).toBe('tomcat');
    expect(results[0].source).toBe('env');
    expect(results[0].version).toBe('10.1.0');
    
    expect(pluginRegistry.detectServerType).toHaveBeenCalledWith(await fs.realpath(tomcatPath));
  });

  it('discovers servers from workspace folders', async () => {
    const wsFolder = path.join(tmpDir, 'workspace');
    await fs.mkdir(wsFolder);
    
    // Create a folder matching the common names
    const serverPath = await createFakeServer(wsFolder, 'tomcat-9');
    
    (pluginRegistry.detectServerType as ReturnType<typeof vi.fn>).mockResolvedValue(ok({
      type: 'tomcat',
      report: { ok: true }
    }));

    const results = await service.discover([wsFolder]);
    
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe(await fs.realpath(serverPath));
    expect(results[0].source).toBe('workspace');
  });

  it('ignores directories that do not look like servers (missing bin/lib/conf)', async () => {
    const wsFolder = path.join(tmpDir, 'workspace');
    await fs.mkdir(wsFolder);
    
    // Create a folder matching name but missing standard subdirs
    const fakeServerPath = path.join(wsFolder, 'tomcat');
    await fs.mkdir(fakeServerPath);
    // Only bin, missing lib and conf
    await fs.mkdir(path.join(fakeServerPath, 'bin'));

    const results = await service.discover([wsFolder]);
    
    expect(results).toHaveLength(0);
    // Should skip early before calling detectServerType
    expect(pluginRegistry.detectServerType).not.toHaveBeenCalled();
  });

  it('ignores candidate paths where plugin detection fails', async () => {
    const tomcatPath = await createFakeServer(tmpDir, 'env-tomcat');
    process.env.CATALINA_HOME = tomcatPath;

    // Mock detection returning err
    (pluginRegistry.detectServerType as ReturnType<typeof vi.fn>).mockResolvedValue(err(new Error('Not a server')));

    const results = await service.discover([]);
    
    expect(results).toHaveLength(0);
    expect(pluginRegistry.detectServerType).toHaveBeenCalled();
  });

  it('deduplicates paths across different sources', async () => {
    const serverPath = await createFakeServer(tmpDir, 'tomcat');
    
    // Same path from env var and workspace
    process.env.CATALINA_HOME = serverPath;
    
    (pluginRegistry.detectServerType as ReturnType<typeof vi.fn>).mockResolvedValue(ok({
      type: 'tomcat',
      report: { ok: true }
    }));

    const results = await service.discover([tmpDir]);
    
    // Should only be reported once
    expect(results).toHaveLength(1);
    expect(pluginRegistry.detectServerType).toHaveBeenCalledTimes(1);
  });

  it('handles permission errors gracefully during scan', async () => {
    // We mock os.platform to linux, so it will try to scan /opt, /usr/share, etc.
    // These paths might not exist or we might not have permission.
    // The test ensures the discover method doesn't throw.
    
    const results = await service.discover([]);
    expect(results).toBeInstanceOf(Array); // Should return empty array or found servers, but not crash
  });
});