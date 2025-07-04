// src/core/utils/FileUtils.ts
// Centralized cross-platform file operations following KISS principles

import * as fs from 'fs';
import * as path from 'path';
import { ExtensionContext } from 'vscode';
import { Result, ok, err } from './result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';

export class FileUtils {
  private static extensionContext: ExtensionContext | null = null;

  static initialize(context: ExtensionContext): void {
    this.extensionContext = context;
  }

  static getExtensionStoragePath(): Result<string, JsmError> {
    if (!this.extensionContext) {
      return err(new JsmError(ErrorCode.CONFIG_INVALID, 'FileUtils not initialized with extension context'));
    }

    const globalStoragePath = this.extensionContext.globalStorageUri.fsPath;
    return ok(globalStoragePath);
  }

  static async ensureDirectory(dirPath: string): Promise<Result<void, JsmError>> {
    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.CONFIG_INVALID,
        `Failed to create directory ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      ));
    }
  }

  static async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  static async readJsonFile<T>(filePath: string): Promise<Result<T, JsmError>> {
    try {
      const exists = await this.fileExists(filePath);
      if (!exists) {
        return err(new JsmError(ErrorCode.CONFIG_INVALID, `File not found: ${filePath}`));
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as T;
      return ok(data);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.CONFIG_INVALID,
        `Failed to read JSON file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      ));
    }
  }

  static async writeJsonFile<T>(filePath: string, data: T): Promise<Result<void, JsmError>> {
    try {
      const dirPath = path.dirname(filePath);
      const dirResult = await this.ensureDirectory(dirPath);
      if (!dirResult.ok) return dirResult;

      const tempPath = `${filePath}.tmp`;
      const content = JSON.stringify(data, null, 2);
      
      await fs.promises.writeFile(tempPath, content, 'utf-8');
      await fs.promises.rename(tempPath, filePath);
      
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.CONFIG_INVALID,
        `Failed to write JSON file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      ));
    }
  }

  static async deleteFile(filePath: string): Promise<Result<void, JsmError>> {
    try {
      const exists = await this.fileExists(filePath);
      if (exists) {
        await fs.promises.unlink(filePath);
      }
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.CONFIG_INVALID,
        `Failed to delete file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      ));
    }
  }

  static getTemplatesDirectoryPath(): Result<string, JsmError> {
    const storageResult = this.getExtensionStoragePath();
    if (!storageResult.ok) {
      return err(storageResult.error);
    }

    const templatesPath = path.join(storageResult.value, 'templates');
    return ok(templatesPath);
  }
}
