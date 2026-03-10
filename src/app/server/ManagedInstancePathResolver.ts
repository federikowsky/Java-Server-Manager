import * as path from 'path';

const INSTANCES_DIR = 'instances';

/**
 * Resolves deterministic managed instance paths inside workspace-scoped
 * extension storage.
 */
export class ManagedInstancePathResolver {
  private readonly storageRoot: string;

  constructor(storageRoot: string) {
    this.storageRoot = storageRoot;
  }

  getStorageRoot(): string {
    return this.storageRoot;
  }

  resolve(serverId: string): string {
    return path.join(this.storageRoot, INSTANCES_DIR, serverId);
  }
}