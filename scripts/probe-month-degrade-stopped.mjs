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

/** The four states `degraded_open` can be in, kept apart (Rule 99).
 *
 *  The route is explicit that this matters: "Reported as an OBJECT or null —
 *  never as 0 — because 'no degradation today' and 'the degrade counter could
 *  not be read' are different answers and only one is good news." An absent KV
 *  key comes back as {events:0,credits:0,last:null}, so absent and zero are the
 *  same answer here and a null is the one that is not.
 *
 *  The first version of this probe coerced with `?? 0` and printed both as
 *  "degrade events 0". On a day with real spend that would have read an
 *  unreadable counter as proof the reason was gone — the probe passing because
 *  it could not see, which is the failure this file exists to avoid. */
export function degradeState(block) {
  if (block === null) return 'unreadable';
  if (block === undefined) return 'not-reported';
  if (typeof block !== 'object' || Array.isArray(block)) return 'unreadable';
  return 'read';
}

/** PASS / FAIL / INCONCLUSIVE / UNREADABLE from two samples. Pure, so it can be made to fail. */
export function verdict(a, b) {
  if (a.degradeState !== 'read' || b.degradeState !== 'read') {
    return { state: 'UNREADABLE', grew: null, activity: null, degradeEvents: null,
      detail: `the degrade counter was ${a.degradeState}/${b.degradeState} across the two samples — nothing can be concluded about a reason that cannot be read` };
  }
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

const sample = async (date = null) => {
  const q = date ? `?date=${date}` : '';
  const res = await fetch(`${RELAY}/budget/odds${q}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`/budget/odds${q} returned HTTP ${res.status}`);
  const j = await res.json();
  // NOT `|| {}`. The whole point of the state above is that the block's own
  // shape carries an answer, and defaulting it away destroys that answer.
  const block = Object.prototype.hasOwnProperty.call(j, 'degraded_open') ? j.degraded_open : undefined;
  const d = (block && typeof block === 'object') ? block : {};
  return {
    at: new Date().toISOString(),
    forDate: date,
    degradeState: degradeState(block),
    raw: block === undefined ? '(key absent from the response)' : JSON.stringify(block),
    used: j?.daily?.used ?? j?.used ?? null,
    ceiling: j?.daily?.ceiling ?? null,
    events: d.events ?? null,
    credits: d.credits ?? null,
    reasons: d.reasons ?? null,
    monthly_used: j?.monthly?.used ?? null,
  };
};

if (process.argv.includes('--self-test')) {
  let ran = 0, fail = 0;
  const ok = (n, c, d = '') => { ran++; if (!c) { fail++; console.log(`  FAIL  ${n}${d ? `\n          ${d}` : ''}`); } else console.log(`  ok    ${n}`); };
  const S = (reasons, used, events = 0) => ({ reasons, used, events, degradeState: 'read' });
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

  // RULE 99, AND THE REASON THIS SECTION EXISTS. The first version of this
  // probe coerced `degraded_open` with `?? 0`, so a null counter printed as
  // "degrade events 0" and, on a day with spend, would have read as a PASS.
  ok('an UNREADABLE counter cannot produce a pass',
     verdict({ ...S({}, 100), degradeState: 'unreadable' }, S({}, 200)).state === 'UNREADABLE',
     'a null degraded_open must not be read as "no degradation"');
  ok('an unreadable SECOND sample is caught too',
     verdict(S({}, 100), { ...S({}, 200), degradeState: 'unreadable' }).state === 'UNREADABLE');
  ok('a degraded_open absent from the response is its own state',
     degradeState(undefined) === 'not-reported');
  ok('null is unreadable, not empty', degradeState(null) === 'unreadable');
  ok('an object is read', degradeState({ events: 0 }) === 'read');
  ok('an array is not a counter', degradeState([]) === 'unreadable');

  console.log(fail ? `\n${fail} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`);
  console.log(`COVERAGE: ${ran} assertion(s) on the pure verdict, including the quiet-interval`);
  console.log(`case. It does NOT reach the relay — run without --self-test for that.`);
  process.exitCode = fail ? 1 : 0;
} else {
  const show = (label, s) => {
    console.log(`  ${label} : used ${s.used}/${s.ceiling}  monthly ${s.monthly_used}`);
    console.log(`  ${' '.repeat(label.length)}   degraded_open is ${s.degradeState.toUpperCase()} — ${s.raw}`);
    console.log(`  ${' '.repeat(label.length)}   monthly batch reason count ${monthBatchCount(s.reasons)}`);
  };

  const a = await sample();
  console.log(`=== month degrade probe  utc=${a.at} ===\n`);
  show('sample 1', a);

  // THE CONTROL, and it is the half that tells you whether the counter works at
  // all. A zero today is two different facts — nothing degraded, or nothing is
  // being recorded — and a closed day inside the 2-day TTL separates them. Run
  // 38168748424 is why this is here: it read zero events against a monthly
  // counter that had grown 3065 in the same day, and those two cannot both be
  // true of a path that throws on every call.
  const prev = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  try {
    const y = await sample(prev);
    console.log('');
    show(`closed ${prev}`, y);
  } catch (e) {
    console.log(`\n  closed ${prev} : unavailable — ${String(e.message || e)}`);
  }

  console.log(`\n  waiting ${WAIT_S}s for the */5 cron to fire at least once...\n`);
  await new Promise((r) => setTimeout(r, WAIT_S * 1000));
  const b = await sample();
  show('sample 2', b);

  const v = verdict(a, b);
  console.log(`\n  verdict: ${v.state}`);
  console.log(`  ${v.detail}`);
  console.log(`\nCOVERAGE: 2 sample(s) of /budget/odds, ${WAIT_S}s apart, on ${a.at.slice(0, 10)}.`);
  console.log(`It sees the UTC day's cumulative degrade counter only. A monthly batch throw`);
  console.log(`that happens outside this interval is invisible here, which is why the`);
  console.log(`interval has to show spend before a flat count is read as a pass.`);
  process.exitCode = (v.state === 'FAIL' || v.state === 'UNREADABLE') ? 1 : 0;
  if (v.state === 'INCONCLUSIVE') console.log(`\nINCONCLUSIVE is not a pass. Re-run during an active slate — the daily`);
  if (v.state === 'INCONCLUSIVE') console.log(`ceiling resets at 00:00 UTC and charges resume with the */5 cron.`);
  if (v.state === 'UNREADABLE') console.log(`\nUNREADABLE fails on purpose: a counter that cannot be read is not evidence.`);
}
