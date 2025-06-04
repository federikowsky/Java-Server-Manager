/*
 * src/core/utils/logger.ts
 * Centralised, leveled logger. Uses VS Code OutputChannel under the hood.
 */

import { LogOutputChannel, window } from 'vscode';
import { JSM_LOG_CHANNEL_NAME } from '../../constants';

export enum LogLevel {
  TRACE,
  DEBUG,
  INFO,
  WARN,
  ERROR
}

export class Logger {
  private static instance: Logger;
  private readonly channel: LogOutputChannel;
  level: LogLevel = LogLevel.INFO;
  private readonly prefix: string;

  private constructor(prefix = '') {
    this.channel = window.createOutputChannel(JSM_LOG_CHANNEL_NAME, {
      log: true
    });
    this.prefix = prefix;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /** Creates a child logger with fixed prefix */
  createChild(prefix: string): Logger {
    return new Logger(prefix);
  }

  getChannel(): LogOutputChannel {
    return this.channel;
  }

  trace(msg: string, ...meta: any[]): void {
    if (this.level <= LogLevel.TRACE) this.log('TRACE', msg, meta);
  }
  debug(msg: string, ...meta: any[]): void {
    if (this.level <= LogLevel.DEBUG) this.log('DEBUG', msg, meta);
  }
  info(msg: string, ...meta: any[]): void {
    if (this.level <= LogLevel.INFO) this.log('INFO', msg, meta);
  }
  warn(msg: string, ...meta: any[]): void {
    if (this.level <= LogLevel.WARN) this.log('WARN', msg, meta);
  }
  error(msg: string, ...meta: any[]): void {
    if (this.level <= LogLevel.ERROR) this.log('ERROR', msg, meta);
  }

  private log(sev: string, message: string, meta: any[]): void {
    const time = new Date().toISOString();
    const prefix = this.prefix ? `[${this.prefix}]` : '';
    this.channel.appendLine(`${time}  ${sev} ${prefix} ${message}`);
    if (meta.length) {
      this.channel.appendLine(JSON.stringify(meta, null, 2));
    }
  }
}
