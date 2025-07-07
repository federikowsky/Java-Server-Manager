/*
 * src/core/templates/TemplateManager.ts
 * Template management with persistent storage following KISS principles
 */

import * as path from 'path';
import { ServerTemplate } from '../types/domain';
import { Result, ok, err } from '../utils/result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { FileUtils } from '../utils/FileUtils';

interface TemplateStorage {
  templates: ServerTemplate[];
  version: string;
  lastModified: string;
}

/**
 * TemplateManager - Singleton for persistent template management
 * Stores templates in VS Code extension storage directory
 */
export class TemplateManager {
  private static instance: TemplateManager | null = null;
  private templates: Map<string, ServerTemplate> = new Map();
  private readonly TEMPLATES_FILE = 'templates.json';
  private readonly STORAGE_VERSION = '1.0.0';

  private constructor() {}

  static getInstance(): TemplateManager {
    if (!TemplateManager.instance) {
      TemplateManager.instance = new TemplateManager();
    }
    return TemplateManager.instance;
  }

  /**
   * Initialize template manager and load existing templates
   */
  async initialize(): Promise<Result<void, JsmError>> {
    try {
      const loadResult = await this.loadTemplates();
      if (!loadResult.ok) {
        // If templates file doesn't exist, create empty storage
        if (loadResult.error.message.includes('File not found')) {
          return this.saveTemplates();
        }
        return loadResult;
      }
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.CONFIG_INVALID,
        `Failed to initialize TemplateManager: ${error instanceof Error ? error.message : 'Unknown error'}`
      ));
    }
  }

  /**
   * Get all templates
   */
  getAllTemplates(): ServerTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Get template by ID
   */
  getTemplate(id: string): Result<ServerTemplate, JsmError> {
    const template = this.templates.get(id);
    if (!template) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Template with ID ${id} not found`));
    }
    return ok(template);
  }

  /**
   * Add new template
   */
  async addTemplate(template: ServerTemplate): Promise<Result<void, JsmError>> {
    // Validate template
    const validationResult = this.validateTemplate(template);
    if (!validationResult.ok) return validationResult;

    // Check for duplicate ID
    if (this.templates.has(template.id)) {
      return err(new JsmError(ErrorCode.CONFIG_INVALID, `Template with ID ${template.id} already exists`));
    }

    // Check for duplicate name
    const existingByName = Array.from(this.templates.values()).find(t => t.name === template.name);
    if (existingByName) {
      return err(new JsmError(ErrorCode.CONFIG_INVALID, `Template with name "${template.name}" already exists`));
    }

    // Save current state for rollback
    const backup = new Map(this.templates);

    try {
      // Add template
      this.templates.set(template.id, template);

      // Save to disk
      const saveResult = await this.saveTemplates();
      if (!saveResult.ok) {
        // Rollback on save failure
        this.templates = backup;
        return saveResult;
      }

      return ok(undefined);
    } catch (error) {
      // Rollback on any error
      this.templates = backup;
      return err(new JsmError(
        ErrorCode.CONFIG_INVALID,
        `Failed to add template: ${error instanceof Error ? error.message : 'Unknown error'}`
      ));
    }
  }

  /**
   * Update existing template
   */
  async updateTemplate(template: ServerTemplate): Promise<Result<void, JsmError>> {
    // Validate template
    const validationResult = this.validateTemplate(template);
    if (!validationResult.ok) return validationResult;

    // Check if template exists
    if (!this.templates.has(template.id)) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Template with ID ${template.id} not found`));
    }

    // Check for duplicate name (excluding current template)
    const existingByName = Array.from(this.templates.values()).find(t => t.name === template.name && t.id !== template.id);
    if (existingByName) {
      return err(new JsmError(ErrorCode.CONFIG_INVALID, `Template with name "${template.name}" already exists`));
    }

    // Save current state for rollback
    const backup = new Map(this.templates);

    try {
      // Update template
      this.templates.set(template.id, template);

      // Save to disk
      const saveResult = await this.saveTemplates();
      if (!saveResult.ok) {
        // Rollback on save failure
        this.templates = backup;
        return saveResult;
      }

      return ok(undefined);
    } catch (error) {
      // Rollback on any error
      this.templates = backup;
      return err(new JsmError(
        ErrorCode.CONFIG_INVALID,
        `Failed to update template: ${error instanceof Error ? error.message : 'Unknown error'}`
      ));
    }
  }

  /**
   * Delete template
   */
  async deleteTemplate(id: string): Promise<Result<void, JsmError>> {
    if (!this.templates.has(id)) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Template with ID ${id} not found`));
    }

    // Save current state for rollback
    const backup = new Map(this.templates);

    try {
      // Remove template
      this.templates.delete(id);

      // Save to disk
      const saveResult = await this.saveTemplates();
      if (!saveResult.ok) {
        // Rollback on save failure
        this.templates = backup;
        return saveResult;
      }

      return ok(undefined);
    } catch (error) {
      // Rollback on any error
      this.templates = backup;
      return err(new JsmError(
        ErrorCode.CONFIG_INVALID,
        `Failed to delete template: ${error instanceof Error ? error.message : 'Unknown error'}`
      ));
    }
  }

  /**
   * Validate template structure
   */
  private validateTemplate(template: ServerTemplate): Result<void, JsmError> {
    if (!template.id || typeof template.id !== 'string') {
      return err(new JsmError(ErrorCode.CONFIG_INVALID, 'Template ID is required and must be a string'));
    }

    if (!template.name || typeof template.name !== 'string' || template.name.trim().length === 0) {
      return err(new JsmError(ErrorCode.CONFIG_INVALID, 'Template name is required and must be a non-empty string'));
    }

    if (!template.defaultConfig || typeof template.defaultConfig !== 'object') {
      return err(new JsmError(ErrorCode.CONFIG_INVALID, 'Template defaultConfig is required and must be an object'));
    }

    return ok(undefined);
  }

  /**
   * Load templates from disk
   */
  private async loadTemplates(): Promise<Result<void, JsmError>> {
    const templatesPathResult = FileUtils.getTemplatesDirectoryPath();
    if (!templatesPathResult.ok) return templatesPathResult;

    const filePath = path.join(templatesPathResult.value, this.TEMPLATES_FILE);
    
    const loadResult = await FileUtils.readJsonFile<TemplateStorage>(filePath);
    if (!loadResult.ok) return loadResult;

    const storage = loadResult.value;

    // Validate storage structure
    if (!storage.templates || !Array.isArray(storage.templates)) {
      return err(new JsmError(ErrorCode.CONFIG_INVALID, 'Invalid templates file format'));
    }

    // Load templates into memory
    this.templates.clear();
    for (const template of storage.templates) {
      const validationResult = this.validateTemplate(template);
      if (validationResult.ok) {
        this.templates.set(template.id, template);
      } else {
        console.warn(`Skipping invalid template: ${validationResult.error.message}`);
      }
    }

    return ok(undefined);
  }

  /**
   * Save templates to disk
   */
  private async saveTemplates(): Promise<Result<void, JsmError>> {
    const templatesPathResult = FileUtils.getTemplatesDirectoryPath();
    if (!templatesPathResult.ok) return templatesPathResult;

    const filePath = path.join(templatesPathResult.value, this.TEMPLATES_FILE);
    
    const storage: TemplateStorage = {
      templates: this.getAllTemplates(),
      version: this.STORAGE_VERSION,
      lastModified: new Date().toISOString()
    };

    return FileUtils.writeJsonFile(filePath, storage);
  }
}