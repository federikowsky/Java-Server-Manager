/*
 * src/core/validation/SchemaValidator.ts
 * ULTRA-PURE Schema Validator - Single Responsibility: AJV Validation Only
 * ZERO business logic, ONLY JSON Schema validation
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { Result, ok, err } from '../utils/result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import * as schema from '../config/schema/jsm.server.schema.json';

/**
 * Pure Schema Validator - Single Responsibility: JSON Schema Validation
 * ONLY validates against AJV schema - ZERO business rules
 */
export class SchemaValidator {
  private static instance: SchemaValidator | null = null;
  private ajv: Ajv;
  private validateFn: any;

  private constructor() {
    this.ajv = new Ajv({ 
      allErrors: true,
      verbose: true,
      strict: false 
    });
    
    addFormats(this.ajv);
    this.validateFn = this.ajv.compile(schema);
  }

  static getInstance(): SchemaValidator {
    if (!SchemaValidator.instance) {
      SchemaValidator.instance = new SchemaValidator();
    }
    return SchemaValidator.instance;
  }

  /**
   * Validate full config against schema
   */
  validateConfig(config: unknown): Result<void, JsmError> {
    const isValid = this.validateFn(config);
    
    if (isValid) {
      return ok(undefined);
    }

    const errorMessage = this.buildErrorMessage(this.validateFn.errors);
    return err(new JsmError(ErrorCode.CONFIG_INVALID, errorMessage));
  }

  /**
   * Validate single server against schema
   */
  validateServer(server: unknown): Result<void, JsmError> {
    // Wrap server in config structure for schema validation
    const tempConfig = { servers: [server] };
    
    const isValid = this.validateFn(tempConfig);
    
    if (isValid) {
      return ok(undefined);
    }

    // Extract server-specific errors
    const errors = this.validateFn.errors || [];
    const serverErrors = errors.filter((error: any) => 
      error.instancePath?.startsWith('/servers/0') || 
      error.schemaPath?.includes('/servers/')
    );
    
    const errorMessage = this.buildServerErrorMessage(serverErrors);
    return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, errorMessage));
  }

  /**
   * Build error message from AJV errors
   */
  private buildErrorMessage(errors: any[]): string {
    if (!errors || errors.length === 0) {
      return 'Schema validation failed';
    }

    const messages = errors.map((error: any) => {
      const path = error.instancePath || error.schemaPath || '';
      const message = error.message || 'validation failed';
      return path ? `${path}: ${message}` : message;
    });

    return `Schema validation failed: ${messages.join(', ')}`;
  }

  /**
   * Build server-specific error message
   */
  private buildServerErrorMessage(errors: any[]): string {
    if (!errors || errors.length === 0) {
      return 'Server validation failed';
    }

    const messages = errors.map((error: any) => {
      let path = error.instancePath || error.schemaPath || '';
      path = path.replace('/servers/0', '').replace(/^\//, '');
      const message = error.message || 'validation failed';
      return path ? `${path}: ${message}` : message;
    });

    return `Server validation failed: ${messages.join(', ')}`;
  }
}
