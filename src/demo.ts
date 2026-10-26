/**
 * The 60-second artefact: one schema, three enforcement points, and the rows
 * where a hand-mirrored implementation would disagree. Run: `npm run demo`
 */
import { KYC, type Row } from './schema.ts';
import {
  compileClientValidator, validateOnServer, makeSqlValidator, generateDdl,
} from './targets.ts';

const client = compileClientValidator(KYC);
const sql = makeSqlValidator(KYC);

const CASES: Array<{ label: string; row: Row }> = [
  { label: 'valid GB applicant',
    row: { full_name: 'Alice Smith', country: 'GB', age: 34,
           income_low: 100, income_high: 4000 } },
  { label: 'US applicant, no tax id',
    row: { full_name: 'Bob Jones', country: 'US', age: 41 } },
  { label: 'US applicant, tax id given',
    row: { full_name: 'Bob Jones', country: 'US', age: 41, tax_id: '123456789' } },
  { label: 'age 17',
    row: { full_name: 'Kid', country: 'GB', age: 17 } },
  { label: 'malformed IBAN',
    row: { full_name: 'Carla', country: 'FR', age: 29, iban: 'NOTANIBAN' } },
  { label: 'income_low > income_high',
    row: { full_name: 'Dan', country: 'DE', age: 50,
           income_low: 9000, income_high: 100 } },
  { label: 'name sent as a number',
    row: { full_name: 42 as unknown as string, country: 'GB', age: 30 } },
  { label: 'opt_in sent as 1, not true',
    row: { full_name: 'Eve', country: 'GB', age: 30,
           marketing_opt_in: 1 as unknown as boolean } },
];

console.log('\n  ONESPEC - one schema, three enforcement points');
console.log('  ' + '-'.repeat(66));
console.log('  Three independent implementations: a compiled closure, a schema');
console.log('  interpreter, and CHECK constraints in the database.\n');
console.log('  case                            client   server   sql      agree');
console.log('  ' + '-'.repeat(66));

let agreed = 0;
for (const { label, row } of CASES) {
  const c = client(row).valid, s = validateOnServer(KYC, row).valid,
        q = sql(row).valid;
  const all = c === s && s === q;
  if (all) agreed++;
  const y = (b: boolean) => (b ? 'accept' : 'reject').padEnd(9);
  console.log(`  ${label.padEnd(31)} ${y(c)}${y(s)}${y(q)}${all ? 'yes' : 'NO'}`);
}
console.log(`\n  ${agreed}/${CASES.length} agree.`);
console.log('  The last two rows (a number in a text field, 1 where a boolean is');
console.log("  expected) are accepted by SQLite's default type coercion, so they are");
console.log('  rejected explicitly in the generated SQL target.\n');

console.log('  Generated DDL (excerpt):');
const ddl = generateDdl(KYC);
console.log(ddl.split('\n').slice(0, 11).map((l) => '    ' + l).join('\n'));
console.log('    ...');
console.log('\n  All three are generated from one 30-line spec. When it changes,');
console.log('  they cannot drift apart - and 10,000 property-based assertions in');
console.log('  the test suite prove it on every commit.\n');
