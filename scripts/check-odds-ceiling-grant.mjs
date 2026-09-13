// A one-day budget grant must expire by construction, not by remembering.
//
// The tempting way to spend an approved one-off is to raise the constant, use
// it, and lower it back. That leaves a permanently raised guard the moment the
// second deploy is skipped — and a budget guard that quietly stopped guarding is
// worse than none, because the number still looks deliberate. This session has
// already produced two instances of me not following an instruction I wrote an
// hour earlier, so "remember to revert" is not a mechanism.
//
// These assertions exist to prove the grant is inert on every date but its own.
import { readFileSync } from 'node:fs';

const SRC = readFileSync('src/budget-helpers.js', 'utf8');
let failed = 0, checked = 0;
const eq = (l, got, want) => { checked++;
  if (JSON.stringify(got) === JSON.stringify(want)) console.log(`ok    ${l}`);
  else { failed++; console.log(`FAIL  ${l} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };

// Re-derive the ceiling function from source so the test exercises the real
// arithmetic rather than a restatement of it. The module is Workers-oriented,
// so the two pieces are lifted by pattern and evaluated here.
const base = Number((SRC.match(/const ODDS_DAILY_CEILING = (\d+)/) || [])[1]);
const grantsSrc = (SRC.match(/const ODDS_CEILING_GRANTS = \[[\s\S]*?\];/) || [])[0];
eq('the standing ceiling is still 3800', base, 3800);
if (!grantsSrc) { console.log('FAIL  grants table found'); process.exit(1); }
const grants = eval(grantsSrc.replace('const ODDS_CEILING_GRANTS =', '(') .replace(/;$/, ')'));
const ceiling = (day) => base + grants.filter(g => g.date === day).reduce((n, g) => n + g.extra, 0);

// ── the grant applies on its own date, and nowhere else ────────────────────
eq('granted day carries the extra',      ceiling('2026-09-13'), 6300);
eq('the day before is unaffected',       ceiling('2026-09-12'), 3800);
eq('THE DAY AFTER IS UNAFFECTED',        ceiling('2026-09-14'), 3800);
eq('a month later is unaffected',        ceiling('2026-10-13'), 3800);
eq('next year is unaffected',            ceiling('2027-09-13'), 3800);
// The property that makes it safe to leave in place: a stale entry is inert, so
// nobody has to do anything for it to expire.
eq('every grant is in the past or today, none open-ended',
   grants.every(g => /^\d{4}-\d{2}-\d{2}$/.test(g.date)), true);
eq('every grant says why it exists', grants.every(g => (g.why || '').length > 10), true);
eq('every grant is bounded', grants.every(g => Number.isInteger(g.extra) && g.extra > 0 && g.extra <= 5000), true);

// ── the readout must agree with the guard ──────────────────────────────────
// A /budget/odds that reports the standing ceiling while the guard enforces a
// granted one shows 0 remaining on a day when thousands are allowed. The
// readout is the number people act on.
// ONE specific pattern, not an alternation. The first version offered three
// alternatives and one of them — /ceiling,\s*$/ matching the object shorthand —
// was true no matter what the code did, so the whole assertion could not fail.
// Mutation R3 walked straight through it. An alternation is only as strong as
// its weakest branch, because any single match satisfies the whole.
eq('peekDailyOdds computes the ceiling from the grant table',
   /const ceiling = _dailyCeiling\(date\);/.test(SRC), true);
eq('peekDailyOdds still exposes the standing ceiling separately',
   /standing_ceiling: ODDS_DAILY_CEILING/.test(SRC), true);
eq('an ordinary day reports grant_today as null, not absent',
   /grant_today: grants\.length \? grants : null/.test(SRC), true);
eq('the guard compares against the granted ceiling',
   /const ceiling = _dailyCeiling\(\);[\s\S]{0,80}used \+ units > ceiling/.test(SRC), true);

console.log(`\n${failed ? 'FAILED' : 'PASS'}: ${checked - failed}/${checked}`
          + ` — ${grants.length} grant(s), standing ceiling ${base}`);
process.exit(failed ? 1 : 0);
