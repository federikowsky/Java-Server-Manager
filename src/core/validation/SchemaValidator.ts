import Ajv, { type ValidateFunction, type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { ok, err, type Result } from '../result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';

/**
 * JSON schema validator using AJV.
 * Compiles each schema once during initialization and caches validators (§5.5).
 */
export class SchemaValidator {
  private readonly ajv: Ajv;
  private readonly validators = new Map<string, ValidateFunction>();

  constructor() {
    this.ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(this.ajv);
  }

  /** Register a JSON schema under a schema ID. Compiles and caches immediately. */
  addSchema(schemaId: string, schema: object): void {
    const validate = this.ajv.compile({ ...schema, $id: undefined });
    this.validators.set(schemaId, validate);
  }

  /** Validate data against a previously registered schema. */
  validate(data: unknown, schemaId: string): Result<void, JsmError> {
    const validate = this.validators.get(schemaId);
    if (!validate) {
      return err(new JsmError({
        code: ErrorCode.ValidationFailed,
        message: `Unknown schema: ${schemaId}`,
      }));
    }

    const valid = validate(data);
    if (valid) return ok(undefined);

    const details = formatErrors(validate.errors ?? []);
    return err(new JsmError({
      code: ErrorCode.ValidationFailed,
      message: 'Config validation failed',
      details,
      suggestedFix: ['Check the config file against the schema', 'Open the server form to fix values'],
    }));
  }
}

function formatErrors(errors: ErrorObject[]): string {
  return errors
    .map(e => `${e.instancePath || '/'} ${e.message ?? 'unknown error'}`)
    .join('; ');
}
