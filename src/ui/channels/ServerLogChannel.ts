import * as vscode from 'vscode';
import type { ServerId } from '@core/types';
import { SERVER_CHANNEL_PREFIX } from '../../constants';

/**
 * Per-server output channel manager (§11.1).
 * Manages creation, log attachment, and lifecycle of per-server output channels.
 */
export class ServerLogChannel {
  private readonly channels = new Map<ServerId, vscode.OutputChannel>();

  constructor() {}


  /**
   * Get or create the output channel for a server.
   */
  getChannel(serverId: ServerId, serverName: string): vscode.OutputChannel {
    let channel = this.channels.get(serverId);
    if (!channel) {
      channel = vscode.window.createOutputChannel(`${SERVER_CHANNEL_PREFIX}${serverName}`);
      this.channels.set(serverId, channel);
    }
    return channel;
  }

  /**
   * Show the log channel for a server and bring it to focus.
   */
  showLogs(serverId: ServerId, serverName: string): void {
    const channel = this.getChannel(serverId, serverName);
    channel.show(true);
  }

  /**
   * Append a line to a server's output channel.
   * Trims trailing newlines from text to avoid double newlines (process often sends lines ending with \n).
   */
  appendLine(serverId: ServerId, serverName: string, text: string): void {
    const channel = this.getChannel(serverId, serverName);
    channel.appendLine(text.replace(/\n+$/, ''));
  }

  /**
   * Detach and dispose the channel for a server.
   */
  detach(serverId: ServerId): void {
    const channel = this.channels.get(serverId);
    if (channel) {
      channel.dispose();
      this.channels.delete(serverId);
    }
  }

  /**
   * Dispose all channels.
   */
  dispose(): void {
    for (const channel of this.channels.values()) {
      channel.dispose();
    }
    this.channels.clear();
  }
}
