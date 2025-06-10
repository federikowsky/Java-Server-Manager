/*
 * src/core/config/ConfigValidator.ts
 * Wrapper around AJV 2020 for validating servers.json against schema.
 */

import Ajv, { ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import { Result, ok, err } from '../utils/result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import schema from './schema/jsm.server.schema.json';

export class ConfigValidator {
  private readonly validateFn: ValidateFunction;

  constructor() {
    const ajv = new Ajv({ allowUnionTypes: true, allErrors: true });
    addFormats(ajv);
    ajv.addMetaSchema(draft7MetaSchema);
    this.validateFn = ajv.compile(schema as any);
  }

  validate(json: unknown): Result<void, JsmError> {
    const valid = this.validateFn(json);
    if (valid) return ok(undefined);
    return err(
      new JsmError(
        ErrorCode.CONFIG_INVALID,
        'servers.json does not match schema',
        this.validateFn.errors
      )
    );
  }
}
