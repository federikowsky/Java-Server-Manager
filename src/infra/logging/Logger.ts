import type { Logger as ILogger } from '@core/types/logger';
import type { OutputSink } from '@core/types';
import { RING_BUFFER_MAX_LINES, RING_BUFFER_MAX_BYTES } from '../../constants';

// ── Structured Log Entry (§11.2) ────────────────────────────────────────────

export interface LogEntry {
  ts: string;       // ISO string
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;    // Module path (e.g. 'core.ops')
  serverId?: string;
  operationId?: string;
  msg: string;
  data?: unknown;
}

// ── Ring Buffer (§11.3) ─────────────────────────────────────────────────────

export class RingBuffer {
  private readonly lines: string[] = [];
  private readonly maxLines: number;
  private readonly maxBytes: number;
  private currentBytes = 0;

  constructor(maxLines = RING_BUFFER_MAX_LINES, maxBytes = RING_BUFFER_MAX_BYTES) {
    this.maxLines = maxLines;
    this.maxBytes = maxBytes;
  }

  push(line: string): void {
    const lineBytes = Buffer.byteLength(line, 'utf-8');
    this.lines.push(line);
    this.currentBytes += lineBytes;

    while (
      this.lines.length > this.maxLines ||
      this.currentBytes > this.maxBytes
    ) {
      const removed = this.lines.shift();
      if (removed) {
        this.currentBytes -= Buffer.byteLength(removed, 'utf-8');
      }
    }
  }

  getAll(): readonly string[] {
    return this.lines;
  }

  get size(): number {
    return this.lines.length;
  }

  get bytes(): number {
    return this.currentBytes;
  }

  clear(): void {
    this.lines.length = 0;
    this.currentBytes = 0;
  }
}

// ── Logger Implementation ───────────────────────────────────────────────────

export interface LoggerOptions {
  scope: string;
  sink?: OutputSink;
  serverId?: string;
  minLevel?: LogEntry['level'];
}

const LEVEL_ORDER: Record<LogEntry['level'], number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger implements ILogger {
  private readonly scope: string;
  private readonly sink?: OutputSink;
  private readonly serverId?: string;
  private readonly ringBuffer: RingBuffer;
  private readonly minLevel: number;

  constructor(opts: LoggerOptions, ringBuffer?: RingBuffer) {
    this.scope = opts.scope;
    this.sink = opts.sink;
    this.serverId = opts.serverId;
    this.minLevel = LEVEL_ORDER[opts.minLevel ?? 'debug'];
    this.ringBuffer = ringBuffer ?? new RingBuffer();
  }

  debug(msg: string, ...args: unknown[]): void { this.log('debug', msg, args); }
  info(msg: string, ...args: unknown[]): void { this.log('info', msg, args); }
  warn(msg: string, ...args: unknown[]): void { this.log('warn', msg, args); }
  error(msg: string, ...args: unknown[]): void { this.log('error', msg, args); }

  /** Get the ring buffer for diagnostics extraction. */
  getRingBuffer(): RingBuffer {
    return this.ringBuffer;
  }

  /** Create a child logger with a narrower scope, sharing the same ring buffer and sink. */
  child(subscope: string, overrides?: { serverId?: string; operationId?: string }): Logger {
    const childScope = `${this.scope}.${subscope}`;
    return new Logger(
      { scope: childScope, sink: this.sink, serverId: overrides?.serverId ?? this.serverId, minLevel: this.levelName() },
      this.ringBuffer,
    );
  }

  private log(level: LogEntry['level'], msg: string, args: unknown[]): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      scope: this.scope,
      msg,
      ...(this.serverId && { serverId: this.serverId }),
      ...(args.length > 0 && { data: args.length === 1 ? args[0] : args }),
    };

    const formatted = this.format(entry);
    this.ringBuffer.push(formatted);
    this.sink?.appendLine(formatted);
  }

  private format(entry: LogEntry): string {
    const prefix = entry.serverId ? `[${entry.scope}|${entry.serverId}]` : `[${entry.scope}]`;
    const dataStr = entry.data !== undefined ? ` ${JSON.stringify(entry.data)}` : '';
    return `${entry.ts} ${entry.level.toUpperCase().padEnd(5)} ${prefix} ${entry.msg}${dataStr}`;
  }

  private levelName(): LogEntry['level'] {
    for (const [name, val] of Object.entries(LEVEL_ORDER)) {
      if (val === this.minLevel) return name as LogEntry['level'];
    }
    return 'debug';
  }
}
