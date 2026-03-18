import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { ServerType, Logger } from '@core/types';

export interface DiscoveredServer {
  path: string;
  type: ServerType;
  version?: string;
  source: 'env' | 'os-common' | 'workspace';
}

export class ServerDiscoveryService {
  constructor(
    private readonly pluginRegistry: PluginRegistry,
    private readonly logger: Logger,
  ) {}

  /**
   * Discover Java servers from environment variables, common OS paths, and shallow workspace folders.
   */
  async discover(workspaceFolders: string[] = []): Promise<DiscoveredServer[]> {
    const candidates = new Map<string, 'env' | 'os-common' | 'workspace'>();

    // 1. Gather from Environment Variables
    this.addEnvCandidates(candidates);

    // 2. Gather from common OS paths
    await this.addOsCommonCandidates(candidates);

    // 3. Gather from shallow workspace check
    await this.addWorkspaceCandidates(workspaceFolders, candidates);

    // 4. Probe candidates
    const results: DiscoveredServer[] = [];
    
    // Deduplicate by realpath if possible (resolves symlinks)
    const processedPaths = new Set<string>();

    for (const [candidatePath, source] of candidates.entries()) {
      try {
        const stat = await fs.stat(candidatePath);
        if (!stat.isDirectory()) continue;

        const realPath = await fs.realpath(candidatePath);
        if (processedPaths.has(realPath)) continue;
        processedPaths.add(realPath);

        // Fast pre-check: looks like a server?
        if (!(await this.looksLikeServer(realPath))) continue;

        // Ask plugins
        const detection = await this.pluginRegistry.detectServerType(realPath);
        if (detection.ok) {
          results.push({
            path: realPath,
            type: detection.value.type,
            version: detection.value.report.version,
            source,
          });
        }
      } catch (err) {
        // Ignore EACCES or ENOENT
        this.logger.debug(`ServerDiscoveryService: skipping ${candidatePath}`, err);
      }
    }

    return results;
  }

  /**
   * Quick heuristic to avoid calling plugin detection on every single directory.
   * Most Java servers have at least bin/, lib/, and conf/ directories.
   */
  private async looksLikeServer(dirPath: string): Promise<boolean> {
    try {
      const checks = await Promise.all([
        fs.stat(path.join(dirPath, 'bin')).catch(() => null),
        fs.stat(path.join(dirPath, 'lib')).catch(() => null),
        fs.stat(path.join(dirPath, 'conf')).catch(() => null),
      ]);
      return checks.every(stat => stat?.isDirectory());
    } catch {
      return false;
    }
  }

  private addEnvCandidates(candidates: Map<string, 'env' | 'os-common' | 'workspace'>): void {
    const envVars = ['CATALINA_HOME', 'JETTY_HOME', 'JBOSS_HOME', 'WILDFLY_HOME'];
    for (const envVar of envVars) {
      const val = process.env[envVar];
      if (val && val.trim().length > 0) {
        candidates.set(val.trim(), 'env');
      }
    }
  }

  private async addOsCommonCandidates(candidates: Map<string, 'env' | 'os-common' | 'workspace'>): Promise<void> {
    const platform = os.platform();
    const commonParents: string[] = [];

    if (platform === 'darwin') {
      commonParents.push(
        '/opt/homebrew/opt',   // Apple Silicon brew
        '/usr/local/opt',      // Intel brew
        '/opt',
        '/Library',
      );
    } else if (platform === 'linux') {
      commonParents.push(
        '/opt',
        '/usr/share',
        '/usr/local',
        '/var/lib',
        '/snap',
      );
    } else if (platform === 'win32') {
      commonParents.push(
        'C:\\Program Files\\Apache Software Foundation',
        'C:\\',
      );
    }

    const prefixes = ['tomcat', 'jetty', 'wildfly', 'jboss'];

    for (const parent of commonParents) {
      try {
        const entries = await fs.readdir(parent, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
          
          const name = entry.name.toLowerCase();
          if (prefixes.some(p => name.includes(p))) {
            candidates.set(path.join(parent, entry.name), 'os-common');
          }
        }
      } catch {
        // Ignore permission errors on system folders
      }
    }
  }

  private async addWorkspaceCandidates(
    workspaceFolders: string[],
    candidates: Map<string, 'env' | 'os-common' | 'workspace'>
  ): Promise<void> {
    const commonNames = ['server', 'tomcat', '.server', 'jetty'];
    
    for (const ws of workspaceFolders) {
      try {
        const entries = await fs.readdir(ws, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
          
          const name = entry.name.toLowerCase();
          if (commonNames.some(c => name.includes(c))) {
            candidates.set(path.join(ws, entry.name), 'workspace');
          }
        }
      } catch {
        // Ignore read errors
      }
    }
  }
}