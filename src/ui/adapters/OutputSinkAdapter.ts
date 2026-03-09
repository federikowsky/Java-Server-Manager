import * as vscode from 'vscode';
import type { OutputSink } from '@core/types';

/**
 * Bridges the core OutputSink interface to a VS Code OutputChannel (§5.5).
 */
export class OutputSinkAdapter implements OutputSink {
  private readonly channel: vscode.OutputChannel;

  constructor(channel: vscode.OutputChannel) {
    this.channel = channel;
  }

  append(text: string): void {
    this.channel.append(text);
  }

  appendLine(text: string): void {
    this.channel.appendLine(text);
  }

  clear(): void {
    this.channel.clear();
  }
}
