import { DatabaseSync } from 'node:sqlite';
import {
  ok, type ComparisonRule, type ConditionalRule, type FieldSpec, type Row,
  type Spec, type ValidationResult,
} from './schema.ts';

/* ===========================================================================
 * TARGET 1 - CLIENT: a compiled validator.
 * Each field becomes a closure built once at compile time.
 * ======================================================================== */

type Check = (row: Row, errors: string[]) => void;

function compileField(f: FieldSpec): Check[] {
  const inner: Check[] = [];
  const present = (v: unknown) => v !== undefined && v !== null && v !== '';

  // A type error short-circuits the remaining checks for this field. Reporting
  // `age:type` AND `age:minimum` for the string "thirty" is noise, and - more
  // importantly - the interpreted server target stops after a type error, so
  // continuing here would make the two disagree on the error set.
  const typeCheck: Check = (r, e) => {
    const v = r[f.name];
    if (!present(v)) return;
    const bad =
      f.type === 'string' ? typeof v !== 'string'
      : f.type === 'boolean' ? typeof v !== 'boolean'
      : f.type === 'integer' ? typeof v !== 'number' || !Number.isInteger(v)
      : typeof v !== 'number';
    if (bad) e.push(`${f.name}:type`);
  };

  if (f.minLength !== undefined) {
    inner.push((r, e) => {
      const v = r[f.name];
      if (typeof v === 'string' && v.length < f.minLength!) e.push(`${f.name}:minLength`);
    });
  }
  if (f.maxLength !== undefined) {
    inner.push((r, e) => {
      const v = r[f.name];
      if (typeof v === 'string' && v.length > f.maxLength!) e.push(`${f.name}:maxLength`);
    });
  }
  if (f.minimum !== undefined) {
    inner.push((r, e) => {
      const v = r[f.name];
      if (typeof v === 'number' && v < f.minimum!) e.push(`${f.name}:minimum`);
    });
  }
  if (f.maximum !== undefined) {
    inner.push((r, e) => {
      const v = r[f.name];
      if (typeof v === 'number' && v > f.maximum!) e.push(`${f.name}:maximum`);
    });
  }
  if (f.pattern !== undefined) {
    const re = new RegExp(f.pattern);
    inner.push((r, e) => {
      const v = r[f.name];
      if (typeof v === 'string' && v !== '' && !re.test(v)) e.push(`${f.name}:pattern`);
    });
  }
  if (f.enum !== undefined) {
    const allowed = new Set(f.enum);
    inner.push((r, e) => {
      const v = r[f.name];
      if (typeof v === 'string' && v !== '' && !allowed.has(v)) e.push(`${f.name}:enum`);
    });
  }
  return [
    (r, e) => {
      if (f.required && !present(r[f.name])) e.push(`${f.name}:required`);
    },
    (r, e) => {
      // An absent value - undefined, null, or empty string - is not subject to
      // the constraint checks. Running minLength against "" reports
      // `tax_id:minLength` for a field the user simply left blank, which is
      // both wrong and divergent from the other two targets.
      if (!present(r[f.name])) return;
      const before = e.length;
      typeCheck(r, e);
      // Short-circuit: a value of the wrong type cannot meaningfully be
      // range- or pattern-checked, and the server target stops here too.
      if (e.length > before) return;
      for (const c of inner) c(r, e);
    },
  ];
}

export function compileClientValidator(spec: Spec): (row: Row) => ValidationResult {
  const checks: Check[] = spec.fields.flatMap(compileField);

  for (const rule of spec.rules ?? []) {
    if (rule.kind === 'requiredIf') {
      const r0 = rule as ConditionalRule;
      checks.push((r, e) => {
        const trigger = r[r0.whenField];
        const v = r[r0.field];
        if (trigger === r0.equals && (v === undefined || v === null || v === '')) {
          e.push(`${r0.field}:requiredIf`);
        }
      });
    } else {
      const r0 = rule as ComparisonRule;
      checks.push((r, e) => {
        const a = r[r0.left], b = r[r0.right];
        if (typeof a === 'number' && typeof b === 'number' && a > b) {
          e.push(`${r0.left}:lessThanOrEqual`);
        }
      });
    }
  }

  return (row: Row) => {
    const errors: string[] = [];
    for (const c of checks) c(row, errors);
    return ok(errors);
  };
}

/* ===========================================================================
 * TARGET 2 - SERVER: an interpreter.
 * Walks the schema on every call. Deliberately a different mechanism from the
 * compiled client, so agreement between them is evidence rather than tautology.
 * ======================================================================== */

export function validateOnServer(spec: Spec, row: Row): ValidationResult {
  const errors: string[] = [];
  const present = (v: unknown) => v !== undefined && v !== null && v !== '';

  for (const f of spec.fields) {
    const v = row[f.name];
    if (f.required && !present(v)) errors.push(`${f.name}:required`);
    if (!present(v)) continue;

    const typeOk =
      f.type === 'string' ? typeof v === 'string'
      : f.type === 'boolean' ? typeof v === 'boolean'
      : f.type === 'integer' ? typeof v === 'number' && Number.isInteger(v)
      : typeof v === 'number';
    if (!typeOk) { errors.push(`${f.name}:type`); continue; }

    if (typeof v === 'string') {
      if (f.minLength !== undefined && v.length < f.minLength) {
        errors.push(`${f.name}:minLength`);
      }
      if (f.maxLength !== undefined && v.length > f.maxLength) {
        errors.push(`${f.name}:maxLength`);
      }
      if (f.pattern !== undefined && !new RegExp(f.pattern).test(v)) {
        errors.push(`${f.name}:pattern`);
      }
      if (f.enum !== undefined && !f.enum.includes(v)) errors.push(`${f.name}:enum`);
    }
    if (typeof v === 'number') {
      if (f.minimum !== undefined && v < f.minimum) errors.push(`${f.name}:minimum`);
      if (f.maximum !== undefined && v > f.maximum) errors.push(`${f.name}:maximum`);
    }
  }

  for (const rule of spec.rules ?? []) {
    if (rule.kind === 'requiredIf') {
      if (row[rule.whenField] === rule.equals && !present(row[rule.field])) {
        errors.push(`${rule.field}:requiredIf`);
      }
    } else {
      const a = row[rule.left], b = row[rule.right];
      if (typeof a === 'number' && typeof b === 'number' && a > b) {
        errors.push(`${rule.left}:lessThanOrEqual`);
      }
    }
  }
  return ok(errors);
}

/* ===========================================================================
 * TARGET 3 - SQL: CHECK constraints, evaluated by the database.
 * ======================================================================== */

/**
 * Every column is declared ANY inside a STRICT table, with the real type
 * enforced by a generated typeof() CHECK.
 *
 * This looks odd until you try the obvious thing. Declare `full_name TEXT` and
 * SQLite applies column affinity: the number 42 is losslessly converted to the
 * string '42' before any CHECK runs, so `typeof(full_name) = 'text'` passes and
 * the database accepts a row the client and server both rejected. STRICT does
 * not help - it permits exactly these lossless conversions. ANY suppresses the
 * conversion, so the CHECK sees what was actually bound.
 *
 * On PostgreSQL, which has real types, the column type does this job directly.
 */
const SQL_TYPE: Record<string, string> = {
  string: 'ANY', integer: 'ANY', number: 'ANY', boolean: 'ANY',
};

export function generateDdl(spec: Spec): string {
  const cols: string[] = [];
  const checks: string[] = [];

  for (const f of spec.fields) {
    const nn = f.required ? ' NOT NULL' : '';
    cols.push(`  ${f.name} ${SQL_TYPE[f.type]}${nn}`);
    const q = f.name;
    if (f.required) checks.push(`(${q} IS NOT NULL AND ${q} <> '')`);
    const guard = (c: string) => `(${q} IS NULL OR ${q} = '' OR (${c}))`;
    if (f.minLength !== undefined) checks.push(guard(`LENGTH(${q}) >= ${f.minLength}`));
    if (f.maxLength !== undefined) checks.push(guard(`LENGTH(${q}) <= ${f.maxLength}`));
    if (f.minimum !== undefined) checks.push(guard(`${q} >= ${f.minimum}`));
    if (f.maximum !== undefined) checks.push(guard(`${q} <= ${f.maximum}`));
    if (f.enum !== undefined) {
      checks.push(guard(`${q} IN (${f.enum.map((v) => `'${v}'`).join(', ')})`));
    }
    // Omitting this is the classic divergence: the UI and the API reject a
    // malformed IBAN, the database happily stores it, and the row that gets in
    // through a bulk import is the one that breaks a payment run later.
    if (f.pattern !== undefined) {
      checks.push(guard(`regexp('${f.pattern.replace(/'/g, "''")}', ${q})`));
    }
    // SQLite has dynamic typing and will happily coerce '42' into an INTEGER
    // column. typeof() checks the STORED type, which is what makes this target
    // agree with the two JavaScript ones instead of silently accepting more.
    // JavaScript has a single number type, so 19 arrives bound as a REAL.
    // Integrality is therefore a property of the VALUE, not of how SQLite
    // stored it - `typeof(x) = 'integer'` would reject every integer sent from
    // Node and make the SQL target disagree with the other two on valid input.
    if (f.type === 'integer') {
      checks.push(guard(
        `typeof(${q}) IN ('integer', 'real') AND CAST(${q} AS INTEGER) = ${q}`));
    }
    if (f.type === 'number') {
      checks.push(guard(`typeof(${q}) IN ('integer', 'real')`));
    }
    if (f.type === 'string') checks.push(guard(`typeof(${q}) = 'text'`));
    // SQLite has no boolean type. Encoding true as 1 would make it
    // indistinguishable from the integer 1 - which the client and server both
    // reject as a type error - so the SQL target would silently accept more
    // than the other two. Encoding as text keeps the distinction.
    if (f.type === 'boolean') checks.push(guard(`${q} IN ('true', 'false')`));
  }

  for (const rule of spec.rules ?? []) {
    if (rule.kind === 'requiredIf') {
      checks.push(
        `(${rule.whenField} IS NULL OR ${rule.whenField} <> '${rule.equals}' ` +
        `OR (${rule.field} IS NOT NULL AND ${rule.field} <> ''))`,
      );
    } else {
      checks.push(
        `(${rule.left} IS NULL OR ${rule.right} IS NULL OR ` +
        `${rule.left} <= ${rule.right})`,
      );
    }
  }

  // STRICT is doing real work here. Without it SQLite applies column affinity
  // and silently coerces the number 42 into the text '42' before the CHECK
  // runs - so a type error the client and server both catch slips through the
  // database, and the three targets disagree. That coercion is a genuine
  // source of production data corruption, not a testing artefact.
  return `CREATE TABLE ${spec.name} (\n${cols.join(',\n')},\n` +
         `  CHECK (${checks.join('\n     AND ')})\n) STRICT;`;
}

export function makeSqlValidator(spec: Spec): (row: Row) => ValidationResult {
  const db = new DatabaseSync(':memory:');
  // SQLite has no built-in REGEXP. Registering one keeps the pattern rule
  // enforceable in the database rather than quietly dropping it.
  db.function('regexp', (pattern: unknown, value: unknown) => {
    if (value === null || value === undefined) return 1;
    return new RegExp(String(pattern)).test(String(value)) ? 1 : 0;
  });
  db.exec(generateDdl(spec));
  const names = spec.fields.map((f) => f.name);
  const stmt = db.prepare(
    `INSERT INTO ${spec.name} (${names.join(', ')}) ` +
    `VALUES (${names.map(() => '?').join(', ')})`,
  );
  const del = db.prepare(`DELETE FROM ${spec.name}`);

  return (row: Row) => {
    const args = names.map((n) => {
      const v = row[n];
      if (v === undefined || v === null) return null;
      // Booleans are encoded as text so they stay distinguishable from 0/1.
      // Everything else is bound as-is, including values of the wrong type -
      // masking those here would be testing the adapter, not the constraints.
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      return v as string | number;
    });
    try {
      stmt.run(...args);
      del.run();
      return ok([]);
    } catch (e) {
      // The database reports "a constraint failed", not which one. All three
      // targets are therefore compared on the ACCEPT/REJECT decision, which is
      // the thing that actually produces the 500.
      return ok([`sql:${(e as Error).message.includes('CHECK') ? 'check' : 'type'}`]);
    }
  };
}
