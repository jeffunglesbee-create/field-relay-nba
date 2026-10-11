// DID THE MONTHLY GUARD STOP DEGRADING OPEN?
//
// The done condition for the two-statement batch fix, and it is a probe output
// rather than "the deploy succeeded". chargeMonthlyOdds threw on every call
// because its two-statement batch went to a helper demanding three; the throw
// was caught and counted as `month: odds budget batch returned 2 result(s),
// expected 3` in degraded_open.reasons on /budget/odds.
//
// TWO SAMPLES, NOT ONE. The counter is cumulative for the UTC day with a 2-day
// TTL, so a single reading cannot distinguish "the fix landed" from "this
// day's count was already there before the deploy". What the fix predicts is
// that the count STOPS GROWING.
//
// AND IT MUST PROVE SOMETHING HAPPENED IN BETWEEN. A flat count across an
// interval in which no odds call was made proves nothing at all, so the
// interval has to show real odds activity or the result is INCONCLUSIVE — a
// third state, reported as itself and never rounded to a pass.
//
// READ-ONLY. Two GETs of /budget/odds. The route reads KV and D1 and calls no
// vendor, so this spends no credits.
const RELAY  = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const WAIT_S = Number(process.env.PROBE_WAIT_SECONDS || 420);

/** The reason key the fix is about. Matched as a prefix: the message carries a
 *  parenthesised statement list since the fix, and an old entry does not. */
export const MONTH_BATCH_REASON = 'month: odds budget batch returned 2 result(s), expected 3';

/** Every degrade reason whose key starts with the monthly batch complaint. */
export function monthBatchCount(reasons) {
  if (!reasons || typeof reasons !== 'object') return 0;
  let n = 0;
  for (const [k, v] of Object.entries(reasons)) {
    if (k.startsWith(MONTH_BATCH_REASON)) n += Number(v) || 0;
  }
  return n;
}

/** PASS / FAIL / INCONCLUSIVE from two samples. Pure, so it can be made to fail. */
export function verdict(a, b) {
  const grew = monthBatchCount(b.reasons) - monthBatchCount(a.reasons);
  const activity = (Number(b.used) || 0) - (Number(a.used) || 0);
  const degradeEvents = (Number(b.events) || 0) - (Number(a.events) || 0);
  if (grew > 0) {
    return { state: 'FAIL', grew, activity, degradeEvents,
      detail: `the monthly batch reason grew by ${grew} across the interval — the guard is still degrading open` };
  }
  if (activity <= 0 && degradeEvents <= 0) {
    return { state: 'INCONCLUSIVE', grew, activity, degradeEvents,
      detail: `the reason did not grow, but neither did the day's odds counter (+${activity}) nor any degrade (+${degradeEvents}) — nothing happened in this interval, so a flat count proves nothing` };
  }
  return { state: 'PASS', grew, activity, degradeEvents,
    detail: `the monthly batch reason did not grow (+0) across an interval that charged ${activity} credit(s) and saw ${degradeEvents} other degrade(s)` };
}

const sample = async () => {
  const res = await fetch(`${RELAY}/budget/odds`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`/budget/odds returned HTTP ${res.status}`);
  const j = await res.json();
  const d = j?.degraded_open || {};
  return {
    at: new Date().toISOString(),
    used: j?.daily?.used ?? j?.used ?? null,
    events: d.events ?? 0,
    credits: d.credits ?? 0,
    reasons: d.reasons || null,
    monthly_used: j?.monthly?.used ?? null,
  };
};

if (process.argv.includes('--self-test')) {
  let ran = 0, fail = 0;
  const ok = (n, c, d = '') => { ran++; if (!c) { fail++; console.log(`  FAIL  ${n}${d ? `\n          ${d}` : ''}`); } else console.log(`  ok    ${n}`); };
  const S = (reasons, used, events = 0) => ({ reasons, used, events });
  const R = `${MONTH_BATCH_REASON} (monthSeed, monthCharge)`;

  ok('a growing reason FAILS', verdict(S({ [MONTH_BATCH_REASON]: 10 }, 100), S({ [MONTH_BATCH_REASON]: 14 }, 200)).state === 'FAIL');
  ok('a flat reason over real spend PASSES', verdict(S({ [MONTH_BATCH_REASON]: 10 }, 100), S({ [MONTH_BATCH_REASON]: 10 }, 200)).state === 'PASS');
  ok('a flat reason over NO spend is INCONCLUSIVE', verdict(S({ [MONTH_BATCH_REASON]: 10 }, 100), S({ [MONTH_BATCH_REASON]: 10 }, 100)).state === 'INCONCLUSIVE',
     'this is the one that matters — a quiet interval must not read as a pass');
  ok('the reason absent entirely, over real spend, PASSES', verdict(S({}, 100), S({}, 200)).state === 'PASS');
  ok('a null reasons object counts as zero rather than throwing', monthBatchCount(null) === 0);
  ok('the post-fix message variant still matches by prefix', monthBatchCount({ [R]: 3 }) === 3,
     'the fix appends a statement list; a key match would stop seeing it and read as a pass');
  ok('an unrelated degrade reason is not counted', monthBatchCount({ 'daily: ARCHIVE_DB unavailable': 9 }) === 0);
  ok('a degrade with no odds spend still counts as activity',
     verdict(S({ [MONTH_BATCH_REASON]: 1 }, 100, 0), S({ [MONTH_BATCH_REASON]: 1 }, 100, 4)).state === 'PASS');

  console.log(fail ? `\n${fail} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`);
  console.log(`COVERAGE: ${ran} assertion(s) on the pure verdict, including the quiet-interval`);
  console.log(`case. It does NOT reach the relay — run without --self-test for that.`);
  process.exitCode = fail ? 1 : 0;
} else {
  const a = await sample();
  console.log(`=== month degrade probe  utc=${a.at} ===\n`);
  console.log(`  sample 1        : used ${a.used}  monthly ${a.monthly_used}  degrade events ${a.events} credits ${a.credits}`);
  console.log(`  reasons         : ${a.reasons ? JSON.stringify(a.reasons) : 'none'}`);
  console.log(`  monthly batch   : ${monthBatchCount(a.reasons)}`);
  console.log(`\n  waiting ${WAIT_S}s for the */5 cron to fire at least once...\n`);
  await new Promise((r) => setTimeout(r, WAIT_S * 1000));
  const b = await sample();
  console.log(`  sample 2        : used ${b.used}  monthly ${b.monthly_used}  degrade events ${b.events} credits ${b.credits}`);
  console.log(`  reasons         : ${b.reasons ? JSON.stringify(b.reasons) : 'none'}`);
  console.log(`  monthly batch   : ${monthBatchCount(b.reasons)}`);

  const v = verdict(a, b);
  console.log(`\n  verdict: ${v.state}`);
  console.log(`  ${v.detail}`);
  console.log(`\nCOVERAGE: 2 sample(s) of /budget/odds, ${WAIT_S}s apart, on ${a.at.slice(0, 10)}.`);
  console.log(`It sees the UTC day's cumulative degrade counter only. A monthly batch throw`);
  console.log(`that happens outside this interval is invisible here, which is why the`);
  console.log(`interval has to show spend before a flat count is read as a pass.`);
  process.exitCode = v.state === 'FAIL' ? 1 : 0;
  if (v.state === 'INCONCLUSIVE') console.log(`\nINCONCLUSIVE is not a pass. Re-run during an active slate.`);
}
