/*
 * src/core/instance/ServerInstanceManager.ts
 * Core manager for server templates and instances with intelligent cloning
 */

import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import { v4 as uuid } from 'uuid';
import { Result, ok, err } from '../utils/result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { Logger } from '../utils/logger';
import { 
  BaseServerTemplate, 
  ServerInstance, 
  CreateInstanceRequest, 
  RegisterTemplateRequest,
  InstanceStructure,
  InstanceValidation
} from '../types/instance';
import { ServerConfig, ServerType } from '../types/domain';

export class ServerInstanceManager {
  private static readonly log = Logger.getInstance().createChild('InstanceMgr');
  
  // Storage paths
  private readonly baseStoragePath: string;
  private readonly templatesPath: string;
  private readonly instancesPath: string;
  
  // In-memory caches
  private templates = new Map<string, BaseServerTemplate>();
  private instances = new Map<string, ServerInstance>();

  constructor(extensionStoragePath: string) {
    this.baseStoragePath = path.join(extensionStoragePath, '.jsm-server-manager');
    this.templatesPath = path.join(this.baseStoragePath, 'templates');
    this.instancesPath = path.join(this.baseStoragePath, 'instances');
    
    // Initialize storage directories
    this.initializeStorage();
  }

  /* ─────────────────────── Template Management ─────────────────────── */

  /**
   * Register a new base server template
   */
  async registerTemplate(request: RegisterTemplateRequest): Promise<Result<BaseServerTemplate, JsmError>> {
    try {
      const { name, basePath, type } = request;

      // Detect server type if not provided (simple implementation)
      const detectedType = type || this.detectServerType(basePath);
      
      // Basic validation - check if path exists and has basic structure
      if (!fs.existsSync(basePath)) {
        return err(new JsmError(ErrorCode.CONFIG_INVALID, `Server directory does not exist: ${basePath}`));
      }
      
      // Skip detailed validation for custom types, only check for basic directories
      if (detectedType !== 'custom') {
        const requiredDirs = ['bin', 'lib', 'conf'];
        for (const dir of requiredDirs) {
          const dirPath = path.join(basePath, dir);
          if (!fs.existsSync(dirPath)) {
            return err(new JsmError(ErrorCode.CONFIG_INVALID, `Missing required directory: ${dirPath}`));
          }
        }
      }

      // Detect version from server directory
      const version = await this.detectServerVersion(basePath, detectedType);

      const template: BaseServerTemplate = {
        id: uuid(),
        name,
        type: detectedType,
        version,
        basePath,
        isValid: true,
        registeredAt: new Date().toISOString()
      };

      // Save template metadata
      await this.saveTemplateMetadata(template);
      this.templates.set(template.id, template);

      ServerInstanceManager.log.info(`Registered template: ${template.name}`);
      return ok(template);

    } catch (error) {
      return err(new JsmError(ErrorCode.TEMPLATE_REGISTRATION_ERROR, `Failed to register template: ${error}`, error));
    }
  }

  /**
   * Get all registered templates
   */
  getTemplates(): BaseServerTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Get template by ID
   */
  getTemplate(id: string): Result<BaseServerTemplate, JsmError> {
    const template = this.templates.get(id);
    return template ? ok(template) : err(new JsmError(ErrorCode.TEMPLATE_NOT_FOUND, `Template not found: ${id}`));
  }

  /**
   * Rename template
   */
  async renameTemplate(id: string, newName: string): Promise<Result<BaseServerTemplate, JsmError>> {
    try {
      const template = this.templates.get(id);
      if (!template) {
        return err(new JsmError(ErrorCode.TEMPLATE_NOT_FOUND, `Template not found: ${id}`));
      }

      // Create updated template
      const updatedTemplate: BaseServerTemplate = {
        ...template,
        name: newName.trim(),
        lastValidated: new Date().toISOString()
      };

      // Save updated template metadata
      await this.saveTemplateMetadata(updatedTemplate);
      this.templates.set(id, updatedTemplate);

      ServerInstanceManager.log.info(`Renamed template: ${template.name} → ${newName}`);
      return ok(updatedTemplate);

    } catch (error) {
      return err(new JsmError(ErrorCode.TEMPLATE_REGISTRATION_ERROR, `Failed to rename template: ${error}`, error));
    }
  }

  /**
   * Delete template and cleanup
   */
  async deleteTemplate(id: string): Promise<Result<void, JsmError>> {
    try {
      const template = this.templates.get(id);
      if (!template) {
        return err(new JsmError(ErrorCode.TEMPLATE_NOT_FOUND, `Template not found: ${id}`));
      }

      // Remove template metadata file
      const templateFile = path.join(this.templatesPath, `${id}.json`);
      if (await this.pathExists(templateFile)) {
        await this.removeFile(templateFile);
      }

      // Remove from memory
      this.templates.delete(id);

      ServerInstanceManager.log.info(`Deleted template: ${template.name}`);
      return ok(undefined);

    } catch (error) {
      return err(new JsmError(ErrorCode.TEMPLATE_DELETION_ERROR, `Failed to delete template: ${error}`, error));
    }
  }

  /* ─────────────────────── Instance Management ─────────────────────── */

  /**
   * Create new server instance from template
   */
  async createInstance(request: CreateInstanceRequest): Promise<Result<ServerInstance, JsmError>> {
    try {
      const { name, templateId, config: overrides = {} } = request;

      // Get template
      const templateResult = this.getTemplate(templateId);
      if (!templateResult.ok) return templateResult as any;
      
      const template = templateResult.value;
      const instanceId = uuid();
      const instancePath = path.join(this.instancesPath, instanceId);
      
      // Build instance directory structure
      const structure = this.buildInstanceStructure(instancePath);
      
      // Setup directories and symlinks
      const setupResult = await this.setupInstanceDirectories(template, structure);
      if (!setupResult.ok) return setupResult;

      // Generate server configuration
      const serverConfig = this.generateInstanceConfig(instanceId, name, template, structure, overrides);

      // Create instance metadata
      const instance: ServerInstance = {
        id: instanceId,
        name,
        templateId,
        instancePath,
        config: serverConfig,
        createdAt: new Date().toISOString()
      };

      // Save instance metadata
      await this.saveInstanceMetadata(instance);
      this.instances.set(instanceId, instance);

      ServerInstanceManager.log.info(`Created instance: ${instance.name} from template ${template.name}`);
      return ok(instance);

    } catch (error) {
      return err(new JsmError(ErrorCode.INSTANCE_CREATION_ERROR, `Failed to create instance: ${error}`, error));
    }
  }

  /**
   * Get all instances
   */
  getInstances(): ServerInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Get instance by ID
   */
  getInstance(id: string): Result<ServerInstance, JsmError> {
    const instance = this.instances.get(id);
    return instance ? ok(instance) : err(new JsmError(ErrorCode.INSTANCE_NOT_FOUND, `Instance not found: ${id}`));
  }

  /**
   * Remove instance and cleanup directories
   */
  async removeInstance(id: string): Promise<Result<void, JsmError>> {
    try {
      const instanceResult = this.getInstance(id);
      if (!instanceResult.ok) return instanceResult as any;
      
      const instance = instanceResult.value;

      // Remove instance directory
      const removeResult = await this.removeRecursive(instance.instancePath);
      if (!removeResult.ok) return removeResult;

      // Remove metadata
      await this.removeInstanceMetadata(id);
      this.instances.delete(id);

      ServerInstanceManager.log.info(`Removed instance: ${instance.name}`);
      return ok(undefined);

    } catch (error) {
      return err(new JsmError(ErrorCode.INSTANCE_REMOVAL_ERROR, `Failed to remove instance: ${error}`, error));
    }
  }

  /**
   * Delete server instance and cleanup
   */
  async deleteInstance(id: string): Promise<Result<void, JsmError>> {
    try {
      const instanceResult = this.getInstance(id);
      if (!instanceResult.ok) {
        return instanceResult as any;
      }

      const instance = instanceResult.value;

      // Remove instance directory
      if (await this.pathExists(instance.instancePath)) {
        await this.removeRecursive(instance.instancePath);
        ServerInstanceManager.log.info(`Removed instance directory: ${instance.instancePath}`);
      }

      // Remove from memory cache
      this.instances.delete(id);

      // Remove instance metadata file
      const instanceMetadataPath = path.join(this.instancesPath, `${id}.json`);
      if (await this.pathExists(instanceMetadataPath)) {
        await fsPromises.unlink(instanceMetadataPath);
      }

      ServerInstanceManager.log.info(`Deleted instance: ${instance.name}`);
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(ErrorCode.INSTANCE_REMOVAL_ERROR, `Failed to remove instance: ${error}`, error));
    }
  }

  /* ─────────────────────── Validation & Maintenance ─────────────────────── */

  /**
   * Validate instance integrity
   */
  async validateInstance(id: string): Promise<Result<InstanceValidation, JsmError>> {
    try {
      const instanceResult = this.getInstance(id);
      if (!instanceResult.ok) return instanceResult as any;
      
      const instance = instanceResult.value;
      const structure = this.buildInstanceStructure(instance.instancePath);
      
      const issues: string[] = [];
      let isValid = true;

      // Check if instance directory exists
      if (!await this.pathExists(instance.instancePath)) {
        issues.push('Instance directory does not exist');
        isValid = false;
      }

      // Validate symlinks
      if (!await this.validateSymlinks(structure)) {
        issues.push('Invalid or broken symlinks detected');
        isValid = false;
      }

      // Validate configuration
      if (!this.validateInstanceConfig(instance.config)) {
        issues.push('Invalid server configuration');
        isValid = false;
      }

      const validation: InstanceValidation = {
        isValid,
        templateExists: true, // TODO: check if template still exists
        instanceExists: await this.pathExists(instance.instancePath),
        symlinkCheck: await this.validateSymlinks(structure),
        configValid: this.validateInstanceConfig(instance.config),
        errors: issues
      };

      return ok(validation);

    } catch (error) {
      return err(new JsmError(ErrorCode.INSTANCE_VALIDATION_ERROR, `Failed to validate instance: ${error}`, error));
    }
  }

  /* ─────────────────────── Private Implementation ─────────────────────── */

  private async initializeStorage(): Promise<void> {
    await this.ensureDir(this.baseStoragePath);
    await this.ensureDir(this.templatesPath);
    await this.ensureDir(this.instancesPath);
    
    // Load existing templates and instances
    await this.loadExistingTemplates();
    await this.loadExistingInstances();
  }

  private buildInstanceStructure(instancePath: string): InstanceStructure {
    return {
      root: instancePath,
      bin: path.join(instancePath, 'bin'),
      lib: path.join(instancePath, 'lib'),
      conf: path.join(instancePath, 'conf'),
      webapps: path.join(instancePath, 'webapps'),
      logs: path.join(instancePath, 'logs'),
      work: path.join(instancePath, 'work'),
      temp: path.join(instancePath, 'temp')
    };
  }

  private async setupInstanceDirectories(
    template: BaseServerTemplate, 
    structure: InstanceStructure
  ): Promise<Result<void, JsmError>> {
    try {
      // Create instance root
      await this.ensureDir(structure.root);

      // Create symlinks for shared binaries
      await this.createSymlink(
        path.join(template.basePath, 'bin'),
        structure.bin
      );
      
      await this.createSymlink(
        path.join(template.basePath, 'lib'),
        structure.lib
      );

      // Copy configuration files (instance-specific)
      await this.copyRecursive(
        path.join(template.basePath, 'conf'),
        structure.conf
      );

      // Create isolated directories
      await this.ensureDir(structure.webapps);
      await this.ensureDir(structure.logs);
      await this.ensureDir(structure.work);
      await this.ensureDir(structure.temp);

      return ok(undefined);

    } catch (error) {
      return err(new JsmError(ErrorCode.INSTANCE_CREATION_ERROR, `Failed to setup instance directories: ${error}`, error));
    }
  }

  private generateInstanceConfig(
    instanceId: string,
    name: string,
    template: BaseServerTemplate,
    structure: InstanceStructure,
    overrides: Partial<ServerConfig>
  ): ServerConfig {
    const baseConfig: Partial<ServerConfig> = {
      id: instanceId,
      name,
      type: template.type,
      serverHome: structure.root,
      ...overrides
    };

    // Apply simple server defaults instead of ConfigTransformer
    return {
      id: instanceId,
      name,
      type: template.type,
      serverHome: structure.root,
      javaHome: process.env.JAVA_HOME || '',
      host: 'localhost',
      port: 8080,
      state: 'stopped',
      autoSync: true,
      deployments: [],
      pidFile: '',
      debug: { enable: false },
      ...overrides
    };
  }

  private detectServerType(basePath: string): ServerType {
    // Simple server type detection
    if (fs.existsSync(path.join(basePath, 'bin', 'catalina.sh'))) {
      return 'tomcat';
    }
    if (fs.existsSync(path.join(basePath, 'bin', 'standalone.sh'))) {
      return 'jboss';
    }
    if (fs.existsSync(path.join(basePath, 'bin', 'jetty.sh'))) {
      return 'jetty';
    }
    return 'custom';
  }

  private async detectServerVersion(basePath: string, type: ServerType): Promise<string> {
    // Implementation would examine server files to detect version
    // For now, return a placeholder
    return 'unknown';
  }

  private async validateSymlinks(structure: InstanceStructure): Promise<boolean> {
    try {
      const binResult = await this.validateSymlink(structure.bin);
      const libResult = await this.validateSymlink(structure.lib);
      return binResult.ok && libResult.ok;
    } catch {
      return false;
    }
  }

  private validateInstanceConfig(config: ServerConfig): boolean {
    // Basic validation - ensure required fields are present
    return !!(config.id && config.name && config.type && config.serverHome);
  }

  private async saveTemplateMetadata(template: BaseServerTemplate): Promise<void> {
    try {
      const templateFile = path.join(this.templatesPath, `${template.id}.json`);
      await this.writeJson(templateFile, template);
      ServerInstanceManager.log.debug(`Saved template metadata: ${template.name}`);
    } catch (error) {
      ServerInstanceManager.log.error(`Failed to save template metadata: ${error}`);
      throw error;
    }
  }

  private async saveInstanceMetadata(instance: ServerInstance): Promise<void> {
    try {
      const instanceFile = path.join(this.instancesPath, `${instance.id}.json`);
      await this.writeJson(instanceFile, instance);
      ServerInstanceManager.log.debug(`Saved instance metadata: ${instance.name}`);
    } catch (error) {
      ServerInstanceManager.log.error(`Failed to save instance metadata: ${error}`);
      throw error;
    }
  }

  private async removeInstanceMetadata(id: string): Promise<void> {
    try {
      const instanceFile = path.join(this.instancesPath, `${id}.json`);
      if (await this.pathExists(instanceFile)) {
        await this.removeFile(instanceFile);
        ServerInstanceManager.log.debug(`Removed instance metadata: ${id}`);
      }
    } catch (error) {
      ServerInstanceManager.log.error(`Failed to remove instance metadata: ${error}`);
      throw error;
    }
  }

  private async loadExistingTemplates(): Promise<void> {
    try {
      if (!await this.pathExists(this.templatesPath)) {
        return;
      }

      const files = await this.listFiles(this.templatesPath, '.json');
      for (const file of files) {
        try {
          const template: BaseServerTemplate = await this.readJson(file);
          this.templates.set(template.id, template);
          ServerInstanceManager.log.debug(`Loaded template: ${template.name}`);
        } catch (error) {
          ServerInstanceManager.log.warn(`Failed to load template from ${file}: ${error}`);
        }
      }
      
      ServerInstanceManager.log.info(`Loaded ${this.templates.size} templates`);
    } catch (error) {
      ServerInstanceManager.log.error(`Failed to load existing templates: ${error}`);
    }
  }

  private async loadExistingInstances(): Promise<void> {
    try {
      if (!await this.pathExists(this.instancesPath)) {
        return;
      }

      const files = await this.listFiles(this.instancesPath, '.json');
      for (const file of files) {
        try {
          const instance: ServerInstance = await this.readJson(file);
          this.instances.set(instance.id, instance);
          ServerInstanceManager.log.debug(`Loaded instance: ${instance.name}`);
        } catch (error) {
          ServerInstanceManager.log.warn(`Failed to load instance from ${file}: ${error}`);
        }
      }
      
      ServerInstanceManager.log.info(`Loaded ${this.instances.size} instances`);
    } catch (error) {
      ServerInstanceManager.log.error(`Failed to load existing instances: ${error}`);
    }
  }

  /* ─────────────────────── Private Utility Methods ─────────────────────── */

  private async pathExists(filepath: string): Promise<boolean> {
    try {
      await fsPromises.access(filepath);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureDir(dirPath: string): Promise<void> {
    await fsPromises.mkdir(dirPath, { recursive: true });
  }

  private async removeRecursive(dirPath: string): Promise<Result<void, JsmError>> {
    try {
      if (await this.pathExists(dirPath)) {
        await fsPromises.rm(dirPath, { recursive: true, force: true });
      }
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(ErrorCode.FS_DELETE, `Failed to remove directory: ${dirPath}`, error));
    }
  }

  private async copyRecursive(src: string, dest: string): Promise<void> {
    await fsPromises.mkdir(path.dirname(dest), { recursive: true });
    const stats = await fsPromises.stat(src);
    
    if (stats.isDirectory()) {
      await fsPromises.mkdir(dest, { recursive: true });
      const entries = await fsPromises.readdir(src);
      for (const entry of entries) {
        await this.copyRecursive(path.join(src, entry), path.join(dest, entry));
      }
    } else {
      await fsPromises.copyFile(src, dest);
    }
  }

  private async createSymlink(target: string, linkPath: string): Promise<void> {
    try {
      // Remove existing symlink/file if it exists
      if (await this.pathExists(linkPath)) {
        await fsPromises.unlink(linkPath);
      }
      await fsPromises.symlink(target, linkPath, 'dir');
    } catch (error) {
      // Fallback to copying if symlink fails (Windows issues, permissions, etc.)
      ServerInstanceManager.log.warn(`Symlink failed, copying instead: ${error}`);
      await this.copyRecursive(target, linkPath);
    }
  }

  private async validateSymlink(linkPath: string): Promise<Result<void, JsmError>> {
    try {
      const stats = await fsPromises.lstat(linkPath);
      if (stats.isSymbolicLink()) {
        // Check if the symlink target exists
        await fsPromises.access(linkPath);
        return ok(undefined);
      } else if (stats.isDirectory()) {
        // It's a directory (fallback copy), which is also valid
        return ok(undefined);
      } else {
        return err(new JsmError(ErrorCode.INSTANCE_VALIDATION_ERROR, 'Invalid link type'));
      }
    } catch (error) {
      return err(new JsmError(ErrorCode.INSTANCE_VALIDATION_ERROR, 'Symlink validation failed', error));
    }
  }

  private async writeJson(filepath: string, data: any): Promise<void> {
    await fsPromises.mkdir(path.dirname(filepath), { recursive: true });
    await fsPromises.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
  }

  private async readJson<T>(filepath: string): Promise<T> {
    const content = await fsPromises.readFile(filepath, 'utf8');
    return JSON.parse(content) as T;
  }

  private async listFiles(dirPath: string, extension: string): Promise<string[]> {
    try {
      const entries = await fsPromises.readdir(dirPath);
      return entries
        .filter(entry => entry.endsWith(extension))
        .map(entry => path.join(dirPath, entry));
    } catch (error) {
      return [];
    }
  }

  private async removeFile(filepath: string): Promise<void> {
    if (await this.pathExists(filepath)) {
      await fsPromises.unlink(filepath);
    }
  }
}
