/*
 * Apache Tomcat plugin implementation - Clean, SRP compliant with intelligent helper methods
 * Follows the principle of single responsibility while providing reusable, configurable logic
 */

import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { spawn, ChildProcess } from 'child_process';
import { Result, ok, err } from '../../../utils/result';
import { JsmError } from '../../../errors/JsmError';
import { ErrorCode } from '../../../errors/codes';
import { Logger } from '../../../utils/logger';
import { IServerPlugin } from '../interfaces/IServerPlugin';
import { ServerConfig, DeploymentConfig, ServerState } from '../../../types/domain';
import { ServerStartMode } from '../../../types/runtime';

/**
 * Apache Tomcat server plugin with intelligent helper methods and configurable timeouts
 */
export class TomcatPlugin implements IServerPlugin {
  readonly type = 'tomcat';
  readonly name = 'Apache Tomcat';

  private readonly log = Logger.getInstance().createChild('TomcatPlugin');
  private processes = new Map<string, ChildProcess>();

  /**
   * Start Tomcat server with intelligent connection monitoring
   */
  async start(config: ServerConfig, mode: ServerStartMode, debugPort?: number): Promise<Result<void, JsmError>> {
    try {
      this.log.info(`Starting Tomcat server: ${config.name} in ${mode} mode`);

      if (this.processes.has(config.id)) {
        return err(new JsmError(ErrorCode.SERVER_ALREADY_RUNNING, `Server ${config.name} is already running`));
      }

      // Validate Tomcat installation
      const validationResult = await this.validateTomcatInstallation(config);
      if (!validationResult.ok) {
        return validationResult;
      }

      // Prepare and spawn process
      const env = this.buildEnvironment(config, mode, debugPort);
      const scriptPath = this.getStartupScript(config);
      const process = spawn(scriptPath, [], {
        env,
        cwd: config.homePath,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      this.processes.set(config.id, process);
      this.setupProcessHandlers(process, config);

      // Wait for server to be ready using configurable timeout
      const waitResult = await this.waitForServerReady(config, config.startupTimeout || 30000);
      if (!waitResult.ok) {
        this.cleanup(config.id);
        return waitResult;
      }

      this.log.info(`Tomcat server ${config.name} started successfully`);
      return ok(undefined);

    } catch (error) {
      this.cleanup(config.id);
      return err(new JsmError(ErrorCode.SERVER_STARTUP_ERROR, `Failed to start server: ${error}`, error));
    }
  }

  /**
   * Stop Tomcat server gracefully
   */
  async stop(config: ServerConfig): Promise<Result<void, JsmError>> {
    try {
      this.log.info(`Stopping Tomcat server: ${config.name}`);

      const process = this.processes.get(config.id);
      if (!process) {
        // Try to stop using shutdown script
        const shutdownResult = await this.executeShutdownScript(config);
        if (!shutdownResult.ok) {
          this.log.warn(`Failed to execute shutdown script, server might not be managed by this process`);
        }
        return ok(undefined);
      }

      // Graceful shutdown
      const shutdownResult = await this.executeShutdownScript(config);
      if (shutdownResult.ok) {
        // Wait for graceful shutdown
        const waitResult = await this.waitForProcessExit(process, config.stopTimeout || 10000);
        if (waitResult.ok) {
          this.cleanup(config.id);
          this.log.info(`Tomcat server ${config.name} stopped gracefully`);
          return ok(undefined);
        }
      }

      // Force kill if graceful shutdown failed
      this.log.warn(`Forcefully terminating Tomcat server: ${config.name}`);
      process.kill('SIGKILL');
      this.cleanup(config.id);
      
      return ok(undefined);

    } catch (error) {
      return err(new JsmError(ErrorCode.SERVER_SHUTDOWN_ERROR, `Failed to stop server: ${error}`, error));
    }
  }

  /**
   * Restart server (stop + start)
   */
  async restart(config: ServerConfig, mode: ServerStartMode, debugPort?: number): Promise<Result<void, JsmError>> {
    const stopResult = await this.stop(config);
    if (!stopResult.ok) {
      return stopResult;
    }

    // Wait a moment before restarting
    await new Promise(resolve => setTimeout(resolve, 1000));

    return this.start(config, mode, debugPort);
  }

  /**
   * Get current server status
   */
  async getStatus(config: ServerConfig): Promise<Result<ServerState, JsmError>> {
    try {
      const hasProcess = this.processes.has(config.id);
      
      // Check if port is accessible
      const isPortOpen = await this.checkPortAccess(config.host, config.port);
      
      if (isPortOpen) {
        return ok('running' as ServerState);
      } else {
        return ok(hasProcess ? 'starting' as ServerState : 'stopped' as ServerState);
      }

    } catch (error) {
      return err(new JsmError(ErrorCode.STATUS_CHECK_ERROR, `Failed to get status: ${error}`, error));
    }
  }

  /**
   * Perform health check
   */
  async healthCheck(config: ServerConfig): Promise<Result<boolean, JsmError>> {
    try {
      // Basic connectivity check
      const isPortOpen = await this.checkPortAccess(config.host, config.port);
      if (!isPortOpen) {
        return ok(false);
      }

      // Custom health check URL if provided
      if (config.healthCheckUrl) {
        // Would implement HTTP health check here
        // For now, just return port check result
      }

      return ok(isPortOpen);

    } catch (error) {
      return err(new JsmError(ErrorCode.HEALTH_CHECK_ERROR, `Health check failed: ${error}`, error));
    }
  }

  /**
   * Deploy application to Tomcat
   */
  async deploy(config: ServerConfig, deployment: DeploymentConfig): Promise<Result<void, JsmError>> {
    try {
      this.log.info(`Deploying ${deployment.sourcePath} to ${config.name}`);

      const instanceBase = config.instancePath || config.homePath;
      const webappsDir = path.join(instanceBase, 'webapps');
      
      // Ensure webapps directory exists
      if (!fs.existsSync(webappsDir)) {
        fs.mkdirSync(webappsDir, { recursive: true });
      }

      // Determine deployment name and target path
      const deployName = deployment.deployName || path.basename(deployment.sourcePath, path.extname(deployment.sourcePath));
      
      if (deployment.type === 'war' || deployment.sourcePath.endsWith('.war')) {
        const targetPath = path.join(webappsDir, `${deployName}.war`);
        fs.copyFileSync(deployment.sourcePath, targetPath);
      } else if (deployment.type === 'exploded' || fs.statSync(deployment.sourcePath).isDirectory()) {
        const targetPath = path.join(webappsDir, deployName);
        await this.copyDirectory(deployment.sourcePath, targetPath);
      } else {
        return err(new JsmError(ErrorCode.DEPLOY_ERROR, `Unsupported deployment type or invalid source path: ${deployment.sourcePath}`));
      }

      this.log.info(`Successfully deployed ${deployment.sourcePath} to ${config.name}`);
      return ok(undefined);

    } catch (error) {
      return err(new JsmError(ErrorCode.DEPLOY_ERROR, `Failed to deploy: ${error}`, error));
    }
  }

  /**
   * Undeploy application from Tomcat
   */
  async undeploy(config: ServerConfig, deploymentId: string): Promise<Result<void, JsmError>> {
    try {
      this.log.info(`Undeploying ${deploymentId} from ${config.name}`);

      const instanceBase = config.instancePath || config.homePath;
      const webappsDir = path.join(instanceBase, 'webapps');
      
      // Try to find and remove both WAR file and exploded directory
      const warPath = path.join(webappsDir, `${deploymentId}.war`);
      const folderPath = path.join(webappsDir, deploymentId);

      if (fs.existsSync(warPath)) {
        fs.unlinkSync(warPath);
        this.log.debug(`Removed WAR file: ${warPath}`);
      }

      if (fs.existsSync(folderPath)) {
        fs.rmSync(folderPath, { recursive: true, force: true });
        this.log.debug(`Removed exploded directory: ${folderPath}`);
      }

      this.log.info(`Successfully undeployed ${deploymentId} from ${config.name}`);
      return ok(undefined);

    } catch (error) {
      return err(new JsmError(ErrorCode.UNDEPLOY_ERROR, `Failed to undeploy: ${error}`, error));
    }
  }

  /**
   * Get default Tomcat configuration
   */
  getDefaultConfig(): Partial<ServerConfig> {
    return {
      host: 'localhost',
      port: 8080,
      debug: {
        port: 5005
      },
      startupTimeout: 30000,
      stopTimeout: 10000,
      healthCheckUrl: 'http://localhost:8080'
    };
  }

  /**
   * Detect if the given path is a valid Tomcat installation
   */
  async detect(homePath: string): Promise<Result<boolean, JsmError>> {
    try {
      const requiredPaths = [
        path.join(homePath, 'bin', 'catalina.sh'),
        path.join(homePath, 'bin', 'catalina.bat'),
        path.join(homePath, 'lib', 'catalina.jar'),
        path.join(homePath, 'webapps')
      ];

      // Check if at least one startup script and catalina.jar exist
      const hasScript = fs.existsSync(requiredPaths[0]) || fs.existsSync(requiredPaths[1]);
      const hasCatalinaJar = fs.existsSync(requiredPaths[2]);
      const hasWebapps = fs.existsSync(requiredPaths[3]);

      return ok(hasScript && hasCatalinaJar && hasWebapps);

    } catch (error) {
      return err(new JsmError(ErrorCode.SERVER_TYPE_DETECTION_ERROR, `Detection failed: ${error}`, error));
    }
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    for (const [serverId, process] of this.processes) {
      try {
        if (!process.killed) {
          process.kill('SIGTERM');
        }
        this.processes.delete(serverId);
      } catch (error) {
        this.log.warn(`Failed to cleanup process for server ${serverId}: ${error}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Intelligent wait method that can be reused for different server states
   */
  private async waitForServerReady(config: ServerConfig, timeout: number): Promise<Result<void, JsmError>> {
    const startTime = Date.now();
    const checkInterval = 1000; // Check every second

    while (Date.now() - startTime < timeout) {
      try {
        const isReady = await this.checkPortAccess(config.host, config.port);
        if (isReady) {
          return ok(undefined);
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      } catch (error) {
        // Continue checking
      }
    }

    return err(new JsmError(
      ErrorCode.TIMEOUT_ERROR,
      `Server did not start within ${timeout}ms timeout`
    ));
  }

  /**
   * Wait for process to exit gracefully
   */
  private async waitForProcessExit(process: ChildProcess, timeout: number): Promise<Result<void, JsmError>> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(err(new JsmError(ErrorCode.TIMEOUT_ERROR, `Process did not exit within ${timeout}ms`)));
      }, timeout);

      process.on('exit', () => {
        clearTimeout(timer);
        resolve(ok(undefined));
      });
    });
  }

  /**
   * Validate Tomcat installation
   */
  private async validateTomcatInstallation(config: ServerConfig): Promise<Result<void, JsmError>> {
    if (!fs.existsSync(config.homePath)) {
      return err(new JsmError(ErrorCode.CONFIG_INVALID, `Tomcat home directory not found: ${config.homePath}`));
    }

    const instanceBase = config.instancePath || config.homePath;
    const webappsDir = path.join(instanceBase, 'webapps');
    if (!fs.existsSync(webappsDir)) {
      fs.mkdirSync(webappsDir, { recursive: true });
    }

    return ok(undefined);
  }

  /**
   * Build environment variables for Tomcat process
   */
  private buildEnvironment(config: ServerConfig, mode: ServerStartMode, debugPort?: number): NodeJS.ProcessEnv {
    const env = { ...process.env };
    const instanceBase = config.instancePath || config.homePath;
    
    env.CATALINA_HOME = config.homePath;
    env.CATALINA_BASE = instanceBase;
    env.JAVA_HOME = config.javaHome;

    if (config.vmArgs) {
      env.CATALINA_OPTS = config.vmArgs;
    }

    if (mode === 'debug' && debugPort) {
      const debugArgs = `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=${debugPort}`;
      env.CATALINA_OPTS = env.CATALINA_OPTS ? `${env.CATALINA_OPTS} ${debugArgs}` : debugArgs;
    }

    // Add custom environment variables
    if (config.envVars) {
      Object.assign(env, config.envVars);
    }

    return env;
  }

  /**
   * Get appropriate startup script path
   */
  private getStartupScript(config: ServerConfig): string {
    const scriptName = process.platform === 'win32' ? 'startup.bat' : 'startup.sh';
    return path.join(config.homePath, 'bin', scriptName);
  }

  /**
   * Setup process event handlers
   */
  private setupProcessHandlers(process: ChildProcess, config: ServerConfig): void {
    process.on('exit', (code) => {
      this.log.info(`Tomcat process exited with code: ${code}`);
      this.processes.delete(config.id);
    });

    process.on('error', (error) => {
      this.log.error(`Tomcat process error: ${error}`);
      this.processes.delete(config.id);
    });

    // Log output for debugging
    if (process.stdout) {
      process.stdout.on('data', (data) => {
        this.log.debug(`STDOUT: ${data.toString().trim()}`);
      });
    }

    if (process.stderr) {
      process.stderr.on('data', (data) => {
        this.log.debug(`STDERR: ${data.toString().trim()}`);
      });
    }
  }

  /**
   * Execute Tomcat shutdown script
   */
  private async executeShutdownScript(config: ServerConfig): Promise<Result<void, JsmError>> {
    try {
      const env = this.buildEnvironment(config, 'run');
      const scriptName = process.platform === 'win32' ? 'shutdown.bat' : 'shutdown.sh';
      const scriptPath = path.join(config.homePath, 'bin', scriptName);

      if (!fs.existsSync(scriptPath)) {
        return err(new JsmError(ErrorCode.SERVER_SHUTDOWN_ERROR, `Shutdown script not found: ${scriptPath}`));
      }

      return new Promise((resolve) => {
        const shutdownProcess = spawn(scriptPath, [], {
          env,
          cwd: config.homePath
        });

        shutdownProcess.on('exit', (code) => {
          if (code === 0) {
            resolve(ok(undefined));
          } else {
            resolve(err(new JsmError(ErrorCode.SERVER_SHUTDOWN_ERROR, `Shutdown script exited with code: ${code}`)));
          }
        });

        shutdownProcess.on('error', (error) => {
          resolve(err(new JsmError(ErrorCode.SERVER_SHUTDOWN_ERROR, `Shutdown script error: ${error}`, error)));
        });
      });

    } catch (error) {
      return err(new JsmError(ErrorCode.SERVER_SHUTDOWN_ERROR, `Failed to execute shutdown script: ${error}`, error));
    }
  }

  /**
   * Check if a port is accessible (server is responding)
   */
  private async checkPortAccess(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 3000;

      socket.setTimeout(timeout);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, host);
    });
  }

  /**
   * Copy directory recursively (for exploded deployments)
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const items = fs.readdirSync(src);
    for (const item of items) {
      const srcPath = path.join(src, item);
      const destPath = path.join(dest, item);
      
      if (fs.statSync(srcPath).isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Cleanup process resources
   */
  private cleanup(serverId: string): void {
    const process = this.processes.get(serverId);
    if (process) {
      process.removeAllListeners();
      this.processes.delete(serverId);
    }
  }
}
