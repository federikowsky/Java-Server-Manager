import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'http';
import { randomBytes, randomUUID } from 'crypto';
import type { ChildProcess } from 'child_process';

import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { Logger } from '@core/types';
import type { StartupMonitor, StartupOutcome } from '@plugins/interfaces/IServerPlugin';

export interface TomcatStartupMonitorCreateOptions {
  serverKey: string;
  serverName: string;
  logger: Logger;
}

interface StartupCallbackBody {
  token?: string;
  startupId?: string;
  status?: string;
  message?: string;
}

function timeoutError(serverName: string, timeoutMs: number): JsmError {
  return new JsmError({
    code: ErrorCode.Timeout,
    message: `Timed out waiting for Tomcat startup callback for '${serverName}' after ${timeoutMs}ms`,
  });
}

function exitError(serverName: string, code: number | null, signal: string | null): JsmError {
  const suffix = code !== null
    ? `exit code ${code}`
    : `signal ${signal ?? 'unknown'}`;

  return new JsmError({
    code: ErrorCode.ProcessSpawnFailed,
    message: `Tomcat process for '${serverName}' exited before startup completed (${suffix})`,
  });
}

export class TomcatStartupMonitor implements StartupMonitor {
  static async create(options: TomcatStartupMonitorCreateOptions): Promise<TomcatStartupMonitor> {
    const monitor = new TomcatStartupMonitor(options);
    await monitor.listen();
    return monitor;
  }

  readonly startupId = randomUUID();
  readonly token = randomBytes(24).toString('hex');

  private readonly serverKey: string;
  private readonly serverName: string;
  private readonly logger: Logger;
  private readonly server: HttpServer;
  private readonly outcomePromise: Promise<StartupOutcome>;

  private resolveOutcome!: (outcome: StartupOutcome) => void;
  private settledOutcome: StartupOutcome | undefined;
  private childExitHandler?: (code: number | null, signal: string | null) => void;
  private childProcess?: ChildProcess;
  private listeningPort?: number;

  private constructor(options: TomcatStartupMonitorCreateOptions) {
    this.serverKey = options.serverKey;
    this.serverName = options.serverName;
    this.logger = options.logger;
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    this.outcomePromise = new Promise(resolve => {
      this.resolveOutcome = resolve;
    });
  }

  get callbackUrl(): string {
    if (!this.listeningPort) {
      throw new Error('TomcatStartupMonitor callbackUrl accessed before listen()');
    }

    return `http://127.0.0.1:${this.listeningPort}/tomcat-startup`;
  }

  bindProcess(child: ChildProcess): void {
    this.childProcess = child;
    this.childExitHandler = (code, signal) => {
      this.settle({
        state: 'failed',
        message: `Tomcat process exited before startup completed`,
        error: exitError(this.serverName, code, signal),
      });
    };
    child.on('exit', this.childExitHandler);
  }

  async waitForOutcome(timeoutMs: number): Promise<StartupOutcome> {
    if (this.settledOutcome) {
      return this.settledOutcome;
    }

    let timer: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        this.outcomePromise,
        new Promise<StartupOutcome>((_, reject) => {
          timer = setTimeout(() => reject(timeoutError(this.serverName, timeoutMs)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.childProcess && this.childExitHandler) {
      this.childProcess.off('exit', this.childExitHandler);
      this.childExitHandler = undefined;
    }

    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', reject);
        const address = this.server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Tomcat startup callback server failed to bind to localhost'));
          return;
        }

        this.listeningPort = address.port;
        this.server.unref();
        resolve();
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST' || req.url !== '/tomcat-startup') {
      res.statusCode = 404;
      res.end();
      return;
    }

    const body = await this.readJsonBody(req);
    if (!body || body.token !== this.token || body.startupId !== this.startupId) {
      res.statusCode = 403;
      res.end();
      return;
    }

    if (typeof body.status !== 'string') {
      res.statusCode = 400;
      res.end();
      return;
    }

    const normalized = body.status.toLowerCase();

    if (normalized === 'started') {
      this.logger.info(`TomcatStartupMonitor: startup callback received for ${this.serverKey}`);
      this.settle({ state: 'started', message: body.message });
      res.statusCode = 204;
      res.end();
      return;
    }

    if (normalized === 'failed') {
      const error = new JsmError({
        code: ErrorCode.ProcessSpawnFailed,
        message: body.message ?? `Tomcat '${this.serverName}' reported a startup failure`,
      });
      this.settle({ state: 'failed', message: error.message, error });
      res.statusCode = 204;
      res.end();
      return;
    }

    res.statusCode = 400;
    res.end();
  }

  private async readJsonBody(req: IncomingMessage): Promise<StartupCallbackBody | undefined> {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    try {
      const payload = Buffer.concat(chunks).toString('utf-8');
      return JSON.parse(payload) as StartupCallbackBody;
    } catch {
      return undefined;
    }
  }

  private settle(outcome: StartupOutcome): void {
    if (this.settledOutcome) {
      return;
    }

    this.settledOutcome = outcome;
    this.resolveOutcome(outcome);
  }
}