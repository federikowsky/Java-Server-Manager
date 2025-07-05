import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { Result, ok, err } from '../../utils/result';
import { JsmError } from '../../errors/JsmError';
import * as schema from './jsm.server.schema.json';
import { ErrorCode } from '../../errors/codes';

/**
 * Simple AJV-based validation manager following KISS principle.
 * Validates JSON against the JSM server schema.
 */
export class ValidationManager {
  private static instance: ValidationManager;
  private ajv: Ajv;
  private validateFn: any; // Type for AJV validate function
  private schema: any; // Store schema for access to definitions

  private constructor() {
    this.ajv = new Ajv({ 
      allErrors: true,
      verbose: true,
      strict: false 
    });
    
    // Add format support for uri, etc.
    addFormats(this.ajv);
    
    // Store schema and compile the main validator
    this.schema = schema;
    this.validateFn = this.ajv.compile(schema);
  }

  public static getInstance(): ValidationManager {
    if (!ValidationManager.instance) {
      ValidationManager.instance = new ValidationManager();
    }
    return ValidationManager.instance;
  }

  /**
   * Validate JSON data against the JSM server schema.
   * @param json - The JSON data to validate
   * @returns Result with void on success, JsmError on failure
   */
  public validate(json: unknown): Result<void, JsmError> {
    const isValid = this.validateFn(json);
    
    if (isValid) {
      return ok(undefined);
    }

    // Build error message from AJV errors
    const errors = this.validateFn.errors || [];
    const errorMessages = errors.map((error: any) => {
      const path = error.instancePath || error.schemaPath || '';
      const message = error.message || 'validation failed';
      return path ? `${path}: ${message}` : message;
    });

    const errorMessage = errorMessages.length > 0 
      ? `Schema validation failed: ${errorMessages.join(', ')}`
      : 'Schema validation failed';

    return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, errorMessage));
  }

  /**
   * Validates a single server configuration against the server schema definition.
   * @param serverConfig - The server config to validate
   * @returns Result with void on success, JsmError on failure
   */
  public validateServer(serverConfig: unknown): Result<void, JsmError> {
    // Get the server schema definition from the main schema
    const serverSchema = this.schema.definitions?.server;
    if (!serverSchema) {
      return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, 'Server schema definition not found'));
    }

    // Compile validator for single server
    const validateServerFn = this.ajv.compile(serverSchema);
    const isValid = validateServerFn(serverConfig);
    
    if (isValid) {
      return ok(undefined);
    }

    // Build error message from AJV errors
    const errors = validateServerFn.errors || [];
    const errorMessages = errors.map((error: any) => {
      const path = error.instancePath || error.schemaPath || '';
      const message = error.message || 'validation failed';
      return path ? `${path}: ${message}` : message;
    });

    const errorMessage = errorMessages.length > 0 
      ? `Server validation failed: ${errorMessages.join(', ')}`
      : 'Server validation failed';

    return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, errorMessage));
  }

  /**
   * Validate and check for unique server names within the config.
   * @param json - The JSON data to validate
   * @returns Result with void on success, JsmError on failure
   */
  public validateWithUniqueNames(json: unknown): Result<void, JsmError> {
    // First validate against schema
    const schemaResult = this.validate(json);
    if (!schemaResult.ok) {
      return schemaResult;
    }

    // Check for unique server names
    const config = json as { servers: Array<{ name: string }> };
    const serverNames = config.servers.map(server => server.name);
    const duplicates = serverNames.filter((name, index) => serverNames.indexOf(name) !== index);
    
    if (duplicates.length > 0) {
      const uniqueDuplicates = [...new Set(duplicates)];
      return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, 
        `Duplicate server names found: ${uniqueDuplicates.join(', ')}. Server names must be unique.`
      ));
    }

    return ok(undefined);
  }
}
