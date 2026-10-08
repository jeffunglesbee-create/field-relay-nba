// THE GUARD FELL OPEN 245 TIMES AND NOTHING SAID WHAT THREW.
//
// checkAndIncrementDailyOdds and chargeMonthlyOdds both end in a catch that
// degrades OPEN: the odds call proceeds and spends at the vendor while the
// counter never moves. Both were `catch (_)` — the error discarded — so
// /budget/odds could say how often it happened and never why. Measured from the
// route: 245 events and 1263 credits on 2026-10-07, 125 and 821 by 17:42 on
// 10-08. Three different causes reach that catch (ensureOddsBudgetTables
// throwing with no ARCHIVE_DB, db.batch throwing, chargedFromBatch throwing by
// design on an unexpected shape) and they have three different fixes.
//
// Two halves: the HISTOGRAM is pure and is imported and run; the CATCHES are in
// a Worker and are checked as source.
import { readFileSync } from 'node:fs';
import { bumpReason, DEGRADE_REASON_CAP, DEGRADE_OTHER_KEY } from '../src/budget-helpers.js';

const SRC = process.env.BUDGET_HELPERS_SRC || 'src/budget-helpers.js';

export function findings(src) {
  const out = [];

  // WALK BACK FROM THE CALL, don't scan forward from a catch. The first version
  // matched `} catch (X) { ... _countDegradeOpen(env, units` with a 1400-char
  // window, and inside chargeMonthlyOdds there is an unrelated `catch (_)`
  // around the threshold warn a few lines above the degrade catch — so it
  // reported the monthly guard as still discarding its error when it does not.
  // The positive control caught that; reading the regex had not.
  // The DEFINITION matches the same pattern — `async function
  // _countDegradeOpen(env, units, reason = '')` — so it has to be excluded by
  // name or the count is always one too high and every assertion below is
  // skipped by the early return. That is what 7 of 14 failing looked like, and
  // the one that named it was the unmutated positive control.
  const calls = [...src.matchAll(/_countDegradeOpen\(env, units([^)]*)\)/g)]
    .filter((m) => !/function\s+$/.test(src.slice(Math.max(0, m.index - 24), m.index)));
  if (calls.length !== 2) {
    out.push(`expected 2 calls to _countDegradeOpen, found ${calls.length} — a third degrade site would be unchecked here`);
    return out;
  }
  for (const [i, m] of calls.entries()) {
    const which = i === 0 ? 'the monthly guard' : 'the daily guard';
    const before = src.slice(0, m.index);
    const k = before.lastIndexOf('} catch (');
    if (k < 0) { out.push(`${which}: no enclosing catch found before the call`); continue; }
    const head = src.slice(k, k + 20);
    const body = src.slice(k, m.index);
    if (/^\} catch \(_\)/.test(head)) {
      out.push(`${which} still uses \`catch (_)\` — the error is discarded and the cause is unknowable`);
    }
    if (!/,\s*`(month|daily):/.test(m[1])) {
      out.push(`${which} passes no reason to _countDegradeOpen — the count would say how often, never why`);
    }
    if (!/console\.warn\(/.test(body)) out.push(`${which} does not log the error`);
  }
  if (!/export function bumpReason\(/.test(src)) out.push('bumpReason is not exported — the cap cannot be tested');
  if (!/reasons,\n/.test(src)) out.push('the histogram is not written into the degrade counter value');
  return out;
}

if (process.argv.includes('--self-test')) {
  let pass = 0, fail = 0, ran = 0;
  const ok = (label, cond, detail = '') => { ran++; cond ? (pass++, console.log(`  PASS  ${label}`))
    : (fail++, console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`)); };

  console.log('THE HISTOGRAM — bumpReason, imported and run:');
  ok('a repeat increments', JSON.stringify(bumpReason(bumpReason({}, 'a'), 'a')) === '{"a":2}');
  ok('a new object is returned, the input untouched', (() => {
    const p = { a: 1 }; bumpReason(p, 'a'); return p.a === 1;
  })(), 'mutating the stored value in place is how a concurrent read sees a half-written map');
  ok('an empty reason is named, not dropped', JSON.stringify(bumpReason(null, '')) === '{"unnamed":1}',
     'an unnamed throw is still a throw (Rule 99)');
  ok('a non-object previous value is ignored', JSON.stringify(bumpReason([1, 2], 'x')) === '{"x":1}');
  ok('the message is truncated', Object.keys(bumpReason({}, 'z'.repeat(400)))[0].length === 120,
     'a stack trace as a KV key is how a diagnostic becomes the outage');
  {
    let h = {};
    for (let i = 0; i < DEGRADE_REASON_CAP + 4; i++) h = bumpReason(h, `k${i}`);
    ok(`the cap holds at ${DEGRADE_REASON_CAP} named keys plus one overflow`,
       Object.keys(h).length === DEGRADE_REASON_CAP + 1 && h[DEGRADE_OTHER_KEY] === 4,
       JSON.stringify(h));
    const before = h.k0;
    h = bumpReason(h, 'k0');
    ok('AN EXISTING KEY KEEPS COUNTING PAST THE CAP', h.k0 === before + 1,
       'the recurring throw is the one this exists to find; capping it out is the opposite of the point');
  }

  console.log('\nTHE CATCHES — the real source, unmutated:');
  const live = readFileSync(SRC, 'utf8');
  ok('no findings against the live source', findings(live).length === 0, JSON.stringify(findings(live)));

  console.log('\nMUTATIONS — each must be CAUGHT:');
  const M = (from, to) => findings(live.replace(from, to));
  ok('M1 the daily catch back to `catch (_)`',
     M(`} catch (e) {
        // DEGRADE-OPEN, AND NOW WITNESSED.`, `} catch (_) {
        // DEGRADE-OPEN, AND NOW WITNESSED.`).some((x) => x.includes('discarded')));
  ok('M2 the daily reason dropped',
     M("await _countDegradeOpen(env, units, `daily: ${String(e && e.message || e)}`);",
       'await _countDegradeOpen(env, units);').some((x) => x.includes('passes no reason')));
  ok('M3 the monthly reason dropped',
     M("await _countDegradeOpen(env, units, `month: ${String(e && e.message || e)}`);",
       'await _countDegradeOpen(env, units);').some((x) => x.includes('passes no reason')));
  ok('M4 the histogram no longer written',
     M('            reasons,\n', '').some((x) => x.includes('not written into the degrade counter')));
  ok('M5 bumpReason un-exported',
     M('export function bumpReason(', 'function bumpReason(').some((x) => x.includes('not exported')));
  ok('M6 a third degrade site refuses rather than checking two of three',
     M('export const DEGRADE_REASON_CAP = 8;',
       'async function _x() { try { x(); } catch (_) { await _countDegradeOpen(env, units); } }\nexport const DEGRADE_REASON_CAP = 8;')
       .some((x) => x.includes('found 3')));

  console.log(fail ? `\n${fail} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`);
  console.log(`COVERAGE: ${ran} assertion(s) — bumpReason RUN including at and past its`);
  console.log(`cap, and both catches checked as source with six mutations. It does NOT`);
  console.log(`read the live counter; degraded_open.reasons on /budget/odds is where the`);
  console.log(`cause actually appears.`);
  process.exit(fail ? 1 : 0);
}

const found = findings(readFileSync(SRC, 'utf8'));
if (found.length) {
  console.log(`FAIL  ${found.length} finding(s) in ${SRC}:`);
  found.forEach((x) => console.log(`   ${x}`));
  process.exit(1);
}
console.log(`PASS  both degrade-open catches name their error and count it by reason (${SRC})`);
console.log(`COVERAGE: source and the pure histogram. The reasons themselves appear as`);
console.log(`degraded_open.reasons on /budget/odds, which is the only place they are readable.`);
