import * as vscode from 'vscode';
import type { KeyValueStore } from '@core/types';

/**
 * Bridges vscode.Memento to the core KeyValueStore interface (§5.5).
 * Used for both globalState and workspaceState.
 */
export class MementoAdapter implements KeyValueStore {
  private readonly memento: vscode.Memento;

  constructor(memento: vscode.Memento) {
    this.memento = memento;
  }

  get<T>(key: string): T | undefined {
    return this.memento.get<T>(key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.memento.update(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.memento.update(key, undefined);
  }
}
