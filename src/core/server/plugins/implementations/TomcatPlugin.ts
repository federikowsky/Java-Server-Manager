/*
 * src/core/plugins/implementations/TomcatPlugin.ts
 * Apache Tomcat plugin implementation
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Result, ok, err } from '../../../utils/result';
import { JsmError } from '../../../errors/JsmError';
import { ErrorCode } from '../../../errors/codes';
import { Logger } from '../../../utils/logger';
import { IServerPlugin } from '../interfaces/IServerPlugin';
import { ServerConfig, DeploymentConfig, ServerState } from '../../../types/domain';
import { ServerStartMode } from '../../../types/runtime';

export class TomcatPlugin implements IServerPlugin {
  readonly type = 'tomcat';
  readonly name = 'Apache Tomcat';
  readonly version = '1.0.0';

  private readonly log = Logger.getInstance().createChild('TomcatPlugin');
  private processes = new Map<string, ChildProcess>();

  async start(config: ServerConfig, mode: ServerStartMode, debugPort?: number): Promise<Result<void, JsmError>> {
    try {
      this.log.info(`Starting Tomcat server: ${config.name} in ${mode} mode`);

      // Check if already running
      if (this.processes.has(config.id)) {
        return err(new JsmError(
          ErrorCode.SERVER_ALREADY_RUNNING,
          `Server ${config.name} is already running`
        ));
      }

      const startScript = process.platform === 'win32' ? 'startup.bat' : 'startup.sh';
      const scriptPath = path.join(config.serverHome, 'bin', startScript);

      if (!fs.existsSync(scriptPath)) {
        return err(new JsmError(
          ErrorCode.SERVER_STARTUP_ERROR,
          `Startup script not found: ${scriptPath}`
        ));
      }

      // Build environment variables
      const env: Record<string, string> = {
        CATALINA_HOME: config.serverHome,
        CATALINA_BASE: config.serverHome,
        JAVA_HOME: config.javaHome
      };

      // Copy process.env, filtering out undefined values
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          env[key] = value;
        }
      }

      // Add debug options if in debug mode
      if (mode === 'debug' && debugPort) {
        env.CATALINA_OPTS = `${env.CATALINA_OPTS || ''} -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=${debugPort}`;
      }

      // Add custom VM args
      if (config.vmArgs) {
        env.CATALINA_OPTS = `${env.CATALINA_OPTS || ''} ${config.vmArgs}`;
      }

      // Add custom environment variables
      if (config.env) {
        const envPairs = config.env.split(' ');
        for (const pair of envPairs) {
          const [key, value] = pair.split('=');
          if (key && value) {
            env[key] = value;
          }
        }
      }

      this.log.debug('Starting Tomcat process...', { script: scriptPath, env: Object.keys(env) });

      const tomcatProcess = spawn(scriptPath, [], {
        cwd: path.join(config.serverHome, 'bin'),
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      tomcatProcess.stdout?.on('data', (data: any) => {
        this.log.debug(`[${config.name}] stdout:`, data.toString().trim());
      });

      tomcatProcess.stderr?.on('data', (data: any) => {
        this.log.debug(`[${config.name}] stderr:`, data.toString().trim());
      });

      tomcatProcess.on('exit', (code: any) => {
        this.log.info(`Tomcat process exited: ${config.name}`, { code });
        this.processes.delete(config.id);
      });

      tomcatProcess.on('error', (error) => {
        this.log.error(`Tomcat process error: ${config.name}`, error);
        this.processes.delete(config.id);
      });

      this.processes.set(config.id, tomcatProcess);

      // Wait a moment to ensure the process started
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (tomcatProcess.killed || tomcatProcess.exitCode !== null) {
        this.processes.delete(config.id);
        return err(new JsmError(
          ErrorCode.SERVER_STARTUP_ERROR,
          `Tomcat process failed to start: ${config.name}`
        ));
      }

      return ok(undefined);
    } catch (error) {
      this.log.error('Failed to start Tomcat', error);
      return err(new JsmError(
        ErrorCode.SERVER_STARTUP_ERROR,
        `Failed to start Tomcat: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      ));
    }
  }

  async stop(config: ServerConfig): Promise<Result<void, JsmError>> {
    try {
      this.log.info(`Stopping Tomcat server: ${config.name}`);

      const serverProcess = this.processes.get(config.id);
      if (!serverProcess) {
        // Already stopped
        return ok(undefined);
      }

      const stopScript = process.platform === 'win32' ? 'shutdown.bat' : 'shutdown.sh';
      const scriptPath = path.join(config.serverHome, 'bin', stopScript);

      if (fs.existsSync(scriptPath)) {
        // Try graceful shutdown first
        const stopProcess = spawn(scriptPath, [], {
          cwd: path.join(config.serverHome, 'bin'),
          env: {
            ...process.env,
            CATALINA_HOME: config.serverHome,
            CATALINA_BASE: config.serverHome,
            JAVA_HOME: config.javaHome
          } as Record<string, string>,
          stdio: 'ignore'
        });

        // Wait for graceful shutdown
        const timeout = config.stopTimeout || 5000;
        await new Promise(resolve => setTimeout(resolve, timeout));
      }

      // Force kill if still running
      if (!serverProcess.killed && serverProcess.exitCode === null) {
        this.log.warn(`Force killing Tomcat process: ${config.name}`);
        serverProcess.kill('SIGTERM');
        
        // Give it a moment to die gracefully
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (!serverProcess.killed && serverProcess.exitCode === null) {
          serverProcess.kill('SIGKILL');
        }
      }

      this.processes.delete(config.id);
      return ok(undefined);
    } catch (error) {
      this.log.error('Failed to stop Tomcat', error);
      return err(new JsmError(
        ErrorCode.SERVER_SHUTDOWN_ERROR,
        `Failed to stop Tomcat: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      ));
    }
  }

  async restart(config: ServerConfig, mode: ServerStartMode, debugPort?: number): Promise<Result<void, JsmError>> {
    try {
      this.log.info(`Restarting Tomcat server: ${config.name} in ${mode} mode`);
      
      const stopResult = await this.stop(config);
      if (!stopResult.ok) {
        return stopResult;
      }

      // Wait a moment before restarting
      await new Promise(resolve => setTimeout(resolve, 2000));

      return await this.start(config, mode, debugPort);
    } catch (error) {
      this.log.error('Failed to restart Tomcat', error);
      return err(new JsmError(
        ErrorCode.SERVER_RESTART_ERROR,
        `Failed to restart Tomcat: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      ));
    }
  }

  async healthCheck(config: ServerConfig): Promise<Result<boolean, JsmError>> {
    try {
      this.log.debug(`Health check for Tomcat server: ${config.name}`);

      // Check if Tomcat installation exists
      if (!fs.existsSync(config.serverHome)) {
        return err(new JsmError(
          ErrorCode.INSTALLATION_VALIDATION_ERROR,
          'Tomcat installation path not found'
        ));
      }

      // Check for required Tomcat files
      const startupScript = process.platform === 'win32' ? 'startup.bat' : 'startup.sh';
      const shutdownScript = process.platform === 'win32' ? 'shutdown.bat' : 'shutdown.sh';
      
      const binPath = path.join(config.serverHome, 'bin');
      const startupPath = path.join(binPath, startupScript);
      const shutdownPath = path.join(binPath, shutdownScript);

      if (!fs.existsSync(startupPath) || !fs.existsSync(shutdownPath)) {
        return err(new JsmError(
          ErrorCode.INSTALLATION_VALIDATION_ERROR,
          'Required Tomcat scripts not found in bin directory'
        ));
      }

      // Check Java installation
      if (!fs.existsSync(config.javaHome)) {
        return err(new JsmError(
          ErrorCode.INSTALLATION_VALIDATION_ERROR,
          'Java installation path not found'
        ));
      }

      return ok(true);
    } catch (error) {
      this.log.error('Health check failed', error);
      return err(new JsmError(
        ErrorCode.HEALTH_CHECK_ERROR,
        `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      ));
    }
  }

  validateConfig(config: ServerConfig): Result<void, JsmError> {
    try {
      // Validate required fields
      if (!config.name || config.name.trim() === '') {
        return err(new JsmError(
          ErrorCode.CONFIG_INVALID,
          'Server name is required'
        ));
      }

      if (!config.javaHome || config.javaHome.trim() === '') {
        return err(new JsmError(
          ErrorCode.CONFIG_INVALID,
          'Java home is required for Tomcat'
        ));
      }

      if (!config.serverHome || config.serverHome.trim() === '') {
        return err(new JsmError(
          ErrorCode.CONFIG_INVALID,
          'Server home is required for Tomcat'
        ));
      }

      // Validate port if specified
      if (config.port < 1 || config.port > 65535) {
        return err(new JsmError(
          ErrorCode.CONFIG_INVALID,
          'Port must be between 1 and 65535'
        ));
      }

      // Validate paths exist
      if (config.validatePaths !== false) {
        if (!fs.existsSync(config.javaHome)) {
          return err(new JsmError(
            ErrorCode.CONFIG_INVALID,
            `Java home does not exist: ${config.javaHome}`
          ));
        }

        if (!fs.existsSync(config.serverHome)) {
          return err(new JsmError(
            ErrorCode.CONFIG_INVALID,
            `Server home does not exist: ${config.serverHome}`
          ));
        }
      }

      return ok(undefined);
    } catch (error) {
      this.log.error('Configuration validation failed', error);
      return err(new JsmError(
        ErrorCode.CONFIG_INVALID,
        `Configuration validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      ));
    }
  }

  getDefaultConfig(): Partial<ServerConfig> {
    return {
      type: 'tomcat',
      host: 'localhost',
      port: 8080,
      autoSync: false,
      validatePaths: true,
      startupTimeout: 30000,
      stopTimeout: 5000
    };
  }

  async deploy(config: ServerConfig, deployment: DeploymentConfig): Promise<Result<void, JsmError>> {
    try {
      this.log.info(`Deploying ${deployment.name} to Tomcat server: ${config.name}`);

      const webappsDir = path.join(config.serverHome, 'webapps');
      if (!fs.existsSync(webappsDir)) {
        return err(new JsmError(
          ErrorCode.DEPLOY_ERROR,
          'Webapps directory not found'
        ));
      }

      // Copy the deployment
      if (deployment.type === 'war') {
        // Copy WAR file
        fs.copyFileSync(deployment.sourcePath, deployment.targetPath);
      } else if (deployment.type === 'exploded') {
        // Copy directory contents
        if (!fs.existsSync(deployment.targetPath)) {
          fs.mkdirSync(deployment.targetPath, { recursive: true });
        }
        // Implementation for copying directory would go here
      }

      this.log.info(`Successfully deployed ${deployment.name}`);
      return ok(undefined);
    } catch (error) {
      this.log.error('Failed to deploy application', error);
      return err(new JsmError(
        ErrorCode.DEPLOY_ERROR,
        `Failed to deploy application: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      ));
    }
  }

  async undeploy(config: ServerConfig, deploymentId: string): Promise<Result<void, JsmError>> {
    try {
      this.log.info(`Undeploying ${deploymentId} from Tomcat server: ${config.name}`);

      const deployment = config.deployments.find(d => d.id === deploymentId);
      if (!deployment) {
        return err(new JsmError(
          ErrorCode.UNDEPLOY_ERROR,
          `Deployment not found: ${deploymentId}`
        ));
      }

      if (fs.existsSync(deployment.targetPath)) {
        if (fs.statSync(deployment.targetPath).isDirectory()) {
          fs.rmSync(deployment.targetPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(deployment.targetPath);
        }
      }

      this.log.info(`Successfully undeployed ${deployment.name}`);
      return ok(undefined);
    } catch (error) {
      this.log.error('Failed to undeploy application', error);
      return err(new JsmError(
        ErrorCode.UNDEPLOY_ERROR,
        `Failed to undeploy application: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      ));
    }
  }

  async getStatus(config: ServerConfig): Promise<Result<ServerState, JsmError>> {
    try {
      const serverProcess = this.processes.get(config.id);
      
      if (!serverProcess) {
        return ok('stopped');
      }
      
      if (serverProcess.killed || serverProcess.exitCode !== null) {
        return ok('stopped');
      }
      
      return ok('running');
    } catch (error) {
      return err(new JsmError(
        ErrorCode.STATUS_CHECK_ERROR,
        `Failed to get server status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      ));
    }
  }

  async detect(serverHome: string): Promise<Result<boolean, JsmError>> {
    return this.detectServerAt(serverHome);
  }

  async dispose(): Promise<void> {
    try {
      // Stop all running processes
      for (const [serverId, process] of this.processes.entries()) {
        try {
          if (!process.killed && process.exitCode === null) {
            process.kill('SIGTERM');
          }
        } catch (error) {
          this.log.warn(`Failed to stop process for server ${serverId}`, error);
        }
      }
      
      this.processes.clear();
      this.log.debug('TomcatPlugin disposed');
    } catch (error) {
      this.log.error('Error during TomcatPlugin disposal', error);
    }
  }

  async detectServerAt(serverHome: string): Promise<Result<boolean, JsmError>> {
    try {
      // Check for typical Tomcat markers
      const catalinaJar = path.join(serverHome, 'lib', 'catalina.jar');
      const tomcatJuli = path.join(serverHome, 'bin', 'tomcat-juli.jar');
      const bootstrapJar = path.join(serverHome, 'bin', 'bootstrap.jar');

      const isTomcat = fs.existsSync(catalinaJar) && 
                      (fs.existsSync(tomcatJuli) || fs.existsSync(bootstrapJar));

      this.log.debug(`Tomcat detection for ${serverHome}: ${isTomcat}`);
      return ok(isTomcat);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.SERVER_TYPE_DETECTION_ERROR,
        `Detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      ));
    }
  }
}
