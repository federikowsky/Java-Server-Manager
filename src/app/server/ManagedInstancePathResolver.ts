import * as path from 'path';

/**
 * Resolves deterministic managed instance paths inside workspace-scoped
 * extension storage. The provided storageRoot is expected to already be the
 * instances container directory for the workspace.
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
    return path.join(this.storageRoot, serverId);
  }
}