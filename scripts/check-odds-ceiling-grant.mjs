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
// RE-ANCHORED 2026-09-19, NOT LOOSENED. This matched `used + units > ceiling`,
// a JS comparison that no longer exists: Task 2 moved the ceiling into the SQL
// `WHERE`, so there is no read-then-decide window to compare in. The INVARIANT
// is unchanged — the guard must enforce the GRANTED ceiling, not the standing
// one — so the assertion now follows it to where it lives: `_dailyCeiling()`
// is what gets bound into the charge statement.
//
// Both halves are load-bearing. Drop the first and mutation R4 (swap
// `_dailyCeiling()` for `ODDS_DAILY_CEILING`) stops being caught; drop the
// second and the ceiling could be computed correctly and then never sent.
//
// BOUNDED BY THE FUNCTION, NOT BY A CHARACTER COUNT. This was a 1600-char
// window after `const ceiling = _dailyCeiling();`. When the month joined the
// day's batch on 2026-10-18 the distance grew, and three more lines of comment
// would have overflowed it: a window overflow reported as "the guard ignores
// the grant", which is a false semantic failure. Raising the number would only
// move the cliff, so the slice now runs to the end of the function that
// computes the ceiling, whatever that function is called.
const _gi = SRC.indexOf('const ceiling = _dailyCeiling();');
const _gj = _gi < 0 ? -1 : SRC.indexOf('\n}\n', _gi);
const guard = (_gi < 0 || _gj < 0) ? '' : SRC.slice(_gi, _gj);
// SINCE 2026-10-28 ONE STATEMENT DECIDES (Task 3 of
// docs/CC-CMD-2026-09-16-odds-spend-attribution.md): `gate` carries the day's
// ceiling, the month's hard limit and the site's cap, and the three charges obey
// its token. So the granted day ceiling has ONE place to reach, not three. Bound to
// the standing ceiling, a granted day would be refused by the gate once the
// pre-charge day passed 3,800, and the grant silently revoked.
eq('the gate compares against the granted ceiling',
   /ODDS_BUDGET_SQL\.gate\)\.bind\(token, date, units, ceiling, month,/.test(guard), true);
// AND THE SITE'S CAP, with a grant's `siteExtra` for that date: bound to the
// standing cap, a granted day could not spend through a capped site, which would
// defeat the grant for exactly the work it was issued for.
eq('the gate carries the site cap from siteCeilingFor, grants included',
   /const siteCeiling = siteCeilingFor\(site, date\);/.test(guard)
   && /ODDS_HARD_LIMIT, date, site, units, siteCeiling\)/.test(guard), true);
// THE DEFAULT GRANT TABLE. siteCeilingFor takes `grants` so a harness can inject
// one, and its default must stay the real table: a default of [] leaves every
// siteExtra inert, so an approved backfill is refused at the site's cap.
eq('siteCeilingFor defaults to the real grant table',
   /export function siteCeilingFor\(site, date = .+?, grants = ODDS_CEILING_GRANTS\)/.test(SRC), true);
// A SITE GRANT IS BOUNDED TOO, and expires by its date like the day's.
eq('every siteExtra is a bounded positive integer',
   grants.every(g => !g.siteExtra || Object.values(g.siteExtra).every(v => Number.isInteger(v) && v > 0 && v <= 5000)), true);

console.log(`\n${failed ? 'FAILED' : 'PASS'}: ${checked - failed}/${checked}`
          + ` — ${grants.length} grant(s), standing ceiling ${base}`);
console.log('COVERAGE: SOURCE TEXT of src/budget-helpers.js and a re-parse of its grant table. It');
console.log('never executes a grant. The granted day run through chargeOdds and peekDailyOdds, and');
console.log('siteCeilingFor with injected grants, are in scripts/check-odds-site-caps.mjs.');
process.exit(failed ? 1 : 0);
