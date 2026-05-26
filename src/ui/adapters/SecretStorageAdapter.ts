import * as vscode from 'vscode';
import type { SecretStore } from '@core/types';

/**
 * Bridges vscode.SecretStorage to the core SecretStore interface.
 * Secret material stays outside managed inventory and JSON exports.
 */
export class SecretStorageAdapter implements SecretStore {
  private readonly storage: vscode.SecretStorage;

  constructor(storage: vscode.SecretStorage) {
    this.storage = storage;
  }

  async get(key: string): Promise<string | undefined> {
    return this.storage.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.storage.store(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.storage.delete(key);
  }
}
