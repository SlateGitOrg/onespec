/**
 * One schema, three enforcement points.
 *
 * The core idea of the project.
 *
 * A field is optional in the UI, required in the API, and NOT NULL in the
 * database. The user gets a 500 on submit. Nobody wrote this bug deliberately;
 * three people wrote three definitions at three different times, and nothing
 * in the build could possibly have noticed they disagreed.
 *
 * So all three are GENERATED from this one schema - and, crucially, by three
 * genuinely different mechanisms:
 *
 *   client  - a compiled closure, built once and reused per request
 *   server  - an interpreter that walks the schema per validation
 *   sql     - CHECK constraints evaluated by the database
 *
 * That difference is the whole point of the parity test. If all three were the
 * same function called three times, agreement would be tautological and the
 * suite would prove nothing. Because they are independent implementations, a
 * property test that throws 10,000 adversarial inputs at all three and demands
 * identical accept/reject is a real check.
 */

export type FieldType = 'string' | 'integer' | 'number' | 'boolean';

export interface FieldSpec {
  readonly name: string;
  readonly type: FieldType;
  readonly required?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly pattern?: string;
  readonly enum?: readonly string[];
}

/** "this field is required only when another field has a given value" */
export interface ConditionalRule {
  readonly kind: 'requiredIf';
  readonly field: string;
  readonly whenField: string;
  readonly equals: string;
}

/** "field A must be <= field B" */
export interface ComparisonRule {
  readonly kind: 'lessThanOrEqual';
  readonly left: string;
  readonly right: string;
}

export type CrossFieldRule = ConditionalRule | ComparisonRule;

export interface Spec {
  readonly name: string;
  readonly fields: readonly FieldSpec[];
  readonly rules?: readonly CrossFieldRule[];
}

export type Row = Record<string, unknown>;

export interface ValidationResult {
  readonly valid: boolean;
  /** Sorted, so three implementations can be compared exactly. */
  readonly errors: readonly string[];
}

export function ok(errors: string[]): ValidationResult {
  return { valid: errors.length === 0, errors: [...errors].sort() };
}

/** A realistic KYC onboarding form - conditional and cross-field rules are
 *  exactly where hand-mirrored validators diverge first. */
export const KYC: Spec = {
  name: 'kyc_application',
  fields: [
    { name: 'full_name', type: 'string', required: true, minLength: 2,
      maxLength: 80 },
    { name: 'country', type: 'string', required: true,
      enum: ['GB', 'DE', 'FR', 'US'] },
    { name: 'age', type: 'integer', required: true, minimum: 18, maximum: 120 },
    { name: 'iban', type: 'string', pattern: '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,26}$' },
    { name: 'tax_id', type: 'string', minLength: 4, maxLength: 20 },
    { name: 'income_low', type: 'integer', minimum: 0 },
    { name: 'income_high', type: 'integer', minimum: 0 },
    { name: 'marketing_opt_in', type: 'boolean' },
  ],
  rules: [
    // US applicants must supply a tax id. This is the rule the UI forgets.
    { kind: 'requiredIf', field: 'tax_id', whenField: 'country', equals: 'US' },
    { kind: 'lessThanOrEqual', left: 'income_low', right: 'income_high' },
  ],
};
