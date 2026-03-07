/*
 * src/services/ServerLogChannel.ts
 * Per-server live log tail in a dedicated VS Code OutputChannel.
 *
 * One channel is created per server (named after it). When the server starts,
 * the channel is shown automatically, existing log content is loaded, and new
 * writes are streamed in real time via fs.watch. When the server stops the
 * watcher is removed but the channel stays visible with frozen content.
 */

import * as fs from 'fs';
import * as path from 'path';
import { OutputChannel, window } from 'vscode';
import { Logger } from '../core/utils/logger';
import { ServerConfig } from '../core/types/domain';

interface ChannelEntry {
  channel: OutputChannel;
  watcher: fs.FSWatcher | null;
  position: number;
  /** Set to false by detach/dispose to abort an in-flight attach poll. */
  tailing: boolean;
}

export class ServerLogChannel {
  private static readonly POLL_INTERVAL_MS = 500;
  private static readonly POLL_TIMEOUT_MS = 10_000;

  private readonly entries = new Map<string, ChannelEntry>();
  private readonly log = Logger.getInstance().createChild('ServerLogChannel');

  /**
   * Called when a server transitions to 'running'.
   *
   * Synchronously creates or clears the server's OutputChannel (so `show()`
   * can be called immediately after), then asynchronously resolves the log
   * file path, loads existing content, and starts a live tail watcher.
   */
  async attach(config: ServerConfig): Promise<void> {
    // — sync portion — channel available for show() right after this block —
    const existing = this.entries.get(config.id);
    if (existing) {
      if (existing.watcher) {
        existing.watcher.close();
        existing.watcher = null;
      }
      existing.channel.clear();
      existing.position = 0;
      existing.tailing = true;
    } else {
      this.entries.set(config.id, {
        channel: window.createOutputChannel(config.name),
        watcher: null,
        position: 0,
        tailing: true
      });
    }

    const entry = this.entries.get(config.id)!;

    // — async portion — resolve file path, load content, start watcher —
    const logPath =
      (await this.resolveLogPath(config)) ??
      (await this.pollForLogFile(config));

    if (!this.entries.get(config.id)?.tailing) return; // detached while polling

    if (!logPath) {
      this.log.warn(`No log file found for server "${config.name}" after waiting`);
      entry.channel.appendLine(
        '[JSM] Log file not found — the server may not have written any logs yet.'
      );
      return;
    }

    await this.loadExistingContent(entry, logPath);

    if (!this.entries.get(config.id)?.tailing) return; // detached during load

    this.startWatcher(config.id, entry, logPath);
  }

  /**
   * Bring the server channel into focus without stealing editor focus.
   * Returns false if no channel exists (server has never been started).
   */
  show(serverId: string): boolean {
    const entry = this.entries.get(serverId);
    if (!entry) return false;
    entry.channel.show(true);
    return true;
  }

  /**
   * Stop tailing but keep the channel visible with the last session's content.
   * Called when the server stops or enters error state.
   */
  detach(serverId: string): void {
    const entry = this.entries.get(serverId);
    if (!entry) return;
    entry.tailing = false;
    if (entry.watcher) {
      entry.watcher.close();
      entry.watcher = null;
    }
  }

  /**
   * Fully dispose the channel for a server. Call when the server is removed.
   */
  dispose(serverId: string): void {
    const entry = this.entries.get(serverId);
    if (!entry) return;
    entry.tailing = false;
    if (entry.watcher) {
      entry.watcher.close();
    }
    entry.channel.dispose();
    this.entries.delete(serverId);
  }

  disposeAll(): void {
    for (const serverId of [...this.entries.keys()]) {
      this.dispose(serverId);
    }
  }

  // ───────────────────────── private ─────────────────────────

  private async loadExistingContent(entry: ChannelEntry, logPath: string): Promise<void> {
    try {
      const stat = await fs.promises.stat(logPath);
      if (stat.size === 0) return;

      const fd = await fs.promises.open(logPath, 'r');
      try {
        const buf = Buffer.alloc(stat.size);
        const { bytesRead } = await fd.read(buf, 0, stat.size, 0);
        entry.channel.append(buf.subarray(0, bytesRead).toString('utf8'));
        entry.position = bytesRead;
      } finally {
        await fd.close();
      }
    } catch (err) {
      this.log.warn(`Failed to read existing log content: ${err}`);
    }
  }

  private startWatcher(serverId: string, entry: ChannelEntry, logPath: string): void {
    try {
      const watcher = fs.watch(logPath, async (eventType) => {
        if (eventType !== 'change') return;
        const current = this.entries.get(serverId);
        if (!current?.tailing) return;

        try {
          const stat = await fs.promises.stat(logPath);

          if (stat.size < current.position) {
            // Log rotation — reset to start
            current.position = 0;
          }
          if (stat.size === current.position) return;

          const toRead = stat.size - current.position;
          const fd = await fs.promises.open(logPath, 'r');
          try {
            const buf = Buffer.alloc(toRead);
            const { bytesRead } = await fd.read(buf, 0, toRead, current.position);
            current.channel.append(buf.subarray(0, bytesRead).toString('utf8'));
            current.position += bytesRead;
          } finally {
            await fd.close();
          }
        } catch (err) {
          this.log.warn(`Error tailing log for server ${serverId}: ${err}`);
        }
      });

      entry.watcher = watcher;
    } catch (err) {
      this.log.warn(`Failed to start watcher for ${logPath}: ${err}`);
    }
  }

  private async pollForLogFile(config: ServerConfig): Promise<string | undefined> {
    const deadline = Date.now() + ServerLogChannel.POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, ServerLogChannel.POLL_INTERVAL_MS));
      if (!this.entries.get(config.id)?.tailing) return undefined; // aborted
      const logPath = await this.resolveLogPath(config);
      if (logPath) return logPath;
    }
    return undefined;
  }

  async resolveLogPath(config: Pick<ServerConfig, 'homePath' | 'logPath' | 'instancePath'>): Promise<string | undefined> {
    const configured = config.logPath?.trim();
    if (configured && (await this.exists(configured))) return configured;

    const base = config.instancePath || config.homePath;
    const logsDir = path.join(base, 'logs');
    if (!(await this.exists(logsDir))) return undefined;

    for (const name of ['catalina.out', 'catalina.log', 'stdout.log']) {
      const candidate = path.join(logsDir, name);
      if (await this.exists(candidate)) return candidate;
    }

    try {
      const files = await fs.promises.readdir(logsDir);
      const fallback = files
        .filter((f) => f.endsWith('.log') || f.endsWith('.out') || f.includes('catalina'))
        .sort()
        .pop();
      return fallback ? path.join(logsDir, fallback) : undefined;
    } catch {
      return undefined;
    }
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await fs.promises.access(p, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
