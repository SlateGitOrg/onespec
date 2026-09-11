import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { KYC, type Row, type Spec } from '../src/schema.ts';
import {
  compileClientValidator, validateOnServer, makeSqlValidator, generateDdl,
} from '../src/targets.ts';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Adversarial input generator. Deliberately biased toward the boundaries -
 * empty strings, off-by-one lengths, non-integers in integer fields, the
 * conditional trigger value - because uniformly random inputs are rejected by
 * everything and prove nothing.
 */
const MUTATIONS: Record<string, readonly unknown[]> = {
  full_name: ['', 'A', 'Jo', 'x'.repeat(80), 'x'.repeat(81), 42, undefined, null],
  country: ['GB', 'US', 'DE', 'ZZ', '', 'us', undefined, 7],
  age: [17, 18, 19, 120, 121, 30.5, -1, 'thirty', undefined, null],
  iban: ['GB29NWBK60161331926819', 'NOTANIBAN', '', 'gb29nwbk60161331926819', 99],
  tax_id: ['', 'abc', '1234', 'x'.repeat(21), '123456789', undefined],
  income_low: [0, 100, 5000, -5, 10_000, '100', undefined],
  income_high: [0, 100, 4000, 50_000, undefined],
  marketing_opt_in: [true, false, 'yes', 1, undefined],
};

/**
 * Start from a valid row and apply 0-3 adversarial mutations.
 *
 * Generating every field independently from an adversarial pool sounds more
 * thorough and is in fact useless: with eight fields, virtually every row is
 * invalid for several reasons at once, so the suite only ever exercises the
 * reject path and agreement on ACCEPT is never tested at all. Mutating a valid
 * baseline keeps both outcomes well represented.
 */
function generateRow(rnd: () => number): Row {
  const row: Row = {
    full_name: 'Alice Smith',
    country: 'GB',
    age: 34,
    iban: 'GB29NWBK60161331926819',
    tax_id: '123456789',
    income_low: 100,
    income_high: 4000,
    marketing_opt_in: true,
  };
  const names = Object.keys(MUTATIONS);
  const n = Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const f = names[Math.floor(rnd() * names.length)]!;
    const pool = MUTATIONS[f]!;
    row[f] = pool[Math.floor(rnd() * pool.length)];
  }
  return row;
}

describe('three-way parity', () => {
  const client = compileClientValidator(KYC);
  const sql = makeSqlValidator(KYC);
  const N = 10_000;

  test(`THE HEADLINE: ${N} adversarial inputs, all three targets agree`, () => {
    const rnd = mulberry32(20260911);
    let accepted = 0;
    let rejected = 0;
    const disagreements: Array<{ row: Row; c: boolean; s: boolean; q: boolean }> = [];

    for (let i = 0; i < N; i++) {
      const row = generateRow(rnd);
      const c = client(row).valid;
      const s = validateOnServer(KYC, row).valid;
      const q = sql(row).valid;
      if (c !== s || s !== q) disagreements.push({ row, c, s, q });
      if (c) accepted++; else rejected++;
    }

    assert.deepEqual(
      disagreements.slice(0, 3), [],
      `${disagreements.length} inputs where client/server/sql disagreed - ` +
      'each one is a 500 waiting to happen',
    );
    // A suite where everything is rejected proves nothing about agreement.
    assert.ok(accepted > N * 0.05, `only ${accepted}/${N} accepted - too few`);
    assert.ok(rejected > N * 0.05, `only ${rejected}/${N} rejected - too few`);
  });

  test('the client and server also agree on WHICH rule failed', () => {
    // The SQL target can only report accept/reject, but the two JavaScript
    // targets should produce identical error sets.
    const rnd = mulberry32(7);
    for (let i = 0; i < 2_000; i++) {
      const row = generateRow(rnd);
      assert.deepEqual(
        client(row).errors, validateOnServer(KYC, row).errors,
        `error sets diverged for ${JSON.stringify(row)}`,
      );
    }
  });
});

describe('the conditional rule the UI always forgets', () => {
  const client = compileClientValidator(KYC);
  const sql = makeSqlValidator(KYC);
  const base: Row = {
    full_name: 'Alice Smith', country: 'GB', age: 30,
    income_low: 10, income_high: 20,
  };

  test('a GB applicant needs no tax id', () => {
    for (const v of [client(base).valid, validateOnServer(KYC, base).valid,
                     sql(base).valid]) {
      assert.equal(v, true);
    }
  });

  test('a US applicant without a tax id is rejected by ALL THREE', () => {
    const row = { ...base, country: 'US' };
    assert.equal(client(row).valid, false);
    assert.equal(validateOnServer(KYC, row).valid, false);
    assert.equal(sql(row).valid, false);
    assert.ok(client(row).errors.includes('tax_id:requiredIf'));
  });

  test('a US applicant with a tax id is accepted by all three', () => {
    const row = { ...base, country: 'US', tax_id: '123456789' };
    assert.equal(client(row).valid, true);
    assert.equal(validateOnServer(KYC, row).valid, true);
    assert.equal(sql(row).valid, true);
  });

  test('an empty-string tax id does not satisfy the rule', () => {
    const row = { ...base, country: 'US', tax_id: '' };
    assert.equal(client(row).valid, false);
    assert.equal(sql(row).valid, false);
  });
});

describe('the cross-field comparison', () => {
  const client = compileClientValidator(KYC);
  const sql = makeSqlValidator(KYC);
  const base: Row = { full_name: 'Bob Jones', country: 'DE', age: 44 };

  test('income_low > income_high is rejected by all three', () => {
    const row = { ...base, income_low: 900, income_high: 100 };
    assert.equal(client(row).valid, false);
    assert.equal(validateOnServer(KYC, row).valid, false);
    assert.equal(sql(row).valid, false);
  });

  test('equal values are allowed', () => {
    const row = { ...base, income_low: 100, income_high: 100 };
    assert.equal(client(row).valid, true);
    assert.equal(sql(row).valid, true);
  });

  test('the rule does not fire when one side is absent', () => {
    const row = { ...base, income_low: 900 };
    assert.equal(client(row).valid, true);
    assert.equal(sql(row).valid, true);
  });
});

describe('drift detection', () => {
  test('THE MUTATION TEST: breaking a generated target is caught', () => {
    // Hand-edit the schema as a careless change would, regenerate only ONE
    // target, and confirm the parity check notices. Without this, the parity
    // suite could be testing a generator against itself.
    const drifted: Spec = {
      ...KYC,
      fields: KYC.fields.map((f) =>
        f.name === 'age' ? { ...f, minimum: 21 } : f),
    };
    const clientOld = compileClientValidator(KYC);
    const sqlNew = makeSqlValidator(drifted);

    const row: Row = {
      full_name: 'Carol', country: 'GB', age: 19, income_low: 1, income_high: 2,
    };
    assert.equal(clientOld(row).valid, true, 'old client still allows 19');
    assert.equal(sqlNew(row).valid, false, 'new SQL rejects 19');
    // A real CI run compares these and fails. Here we assert they differ, which
    // proves the parity assertion has the power to detect drift at all.
  });

  test('the generated DDL contains the constraints, not just the columns', () => {
    const ddl = generateDdl(KYC);
    assert.match(ddl, /CREATE TABLE kyc_application/);
    assert.match(ddl, /CHECK/);
    assert.match(ddl, /country IN \('GB', 'DE', 'FR', 'US'\)/);
    assert.match(ddl, /age >= 18/);
    assert.match(ddl, /CAST\(age AS INTEGER\) = age/);
    assert.match(ddl, /regexp\(/, 'the pattern rule must reach the database too');
    assert.match(ddl, /STRICT/);
    assert.match(ddl, /income_low <= income_high/);
  });
});
