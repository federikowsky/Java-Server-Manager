/*
 * src/core/types/instance.ts
 * Type definitions for server instance management system
 */

import { ServerConfig, ServerType } from './domain';

/**
 * Base server template configuration
 * Immutable reference installation of a server type
 */
export interface BaseServerTemplate {
  id: string;                    // Unique template ID
  name: string;                  // Display name (e.g., "Apache Tomcat 9.0.65")
  type: ServerType;              // Server type
  version: string;               // Server version
  basePath: string;              // Path to immutable server installation
  isValid: boolean;              // Template validation status
  registeredAt: string;          // ISO timestamp of registration
  lastValidated?: string;        // Last validation check
}

/**
 * Server instance configuration
 * Represents a specific server instance created from a template
 */
export interface ServerInstance {
  id: string;                    // Unique instance ID (matches ServerConfig.id)
  name: string;                  // Instance display name
  templateId: string;            // Reference to base template
  instancePath: string;          // Path to instance directory
  config: ServerConfig;          // Full server configuration
  createdAt: string;             // ISO timestamp of creation
  lastUsed?: string;             // Last startup timestamp
}

/**
 * Instance creation request
 */
export interface CreateInstanceRequest {
  name: string;                  // Instance name
  templateId: string;            // Base template to clone from
  config?: Partial<ServerConfig>; // Override configuration
}

/**
 * Template registration request
 */
export interface RegisterTemplateRequest {
  name: string;                  // Template display name
  basePath: string;              // Path to server installation
  type?: ServerType;             // Server type (auto-detected if not provided)
}

/**
 * Instance directory structure
 */
export interface InstanceStructure {
  root: string;                  // Instance root directory
  bin: string;                   // Symlink to template/bin
  lib: string;                   // Symlink to template/lib
  conf: string;                  // Instance-specific configuration
  webapps: string;               // Instance-specific deployments
  logs: string;                  // Instance-specific logs
  work: string;                  // Instance-specific work directory
  temp: string;                  // Instance-specific temp directory
}

/**
 * Filesystem operation result
 */
export interface FilesystemOperation {
  operation: 'create' | 'symlink' | 'copy' | 'remove';
  source?: string;               // Source path (for copy/symlink)
  target: string;                // Target path
  success: boolean;              // Operation success
  error?: string;                // Error message if failed
}

/**
 * Instance validation result
 */
export interface InstanceValidation {
  isValid: boolean;              // Overall validation status
  templateExists: boolean;       // Base template still exists
  instanceExists: boolean;       // Instance directory exists
  symlinkCheck: boolean;         // Symlinks are valid
  configValid: boolean;          // Configuration is valid
  errors: string[];              // Validation errors
}