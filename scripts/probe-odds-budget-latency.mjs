#!/usr/bin/env node
/**
 * Task 0d of CC-CMD-2026-09-18-atomic-odds-counter: what did Task 2 cost?
 *
 * The measurement happens IN THE WORKER, at POST /debug/odds-budget-latency,
 * because "on the same isolate" is the whole point — timing a D1 batch from a
 * GitHub runner measures the runner's path to Cloudflare, not the worker's path
 * to D1. This script calls that route, reads the medians, and turns three
 * numbers into the comparison Task 6 has to report.
 *
 * IN CI RATHER THAN THE SANDBOX because the sandbox's egress proxy denies
 * CONNECT to the worker (measured 2026-09-19: connect_rejected).
 */
import { writeFileSync } from 'node:fs';

/** The three series the route returns, and what each one answers. */
export const SERIES = {
  kv_four_ops:               'the OLD guard: four sequential KV ops, every call',
  d1_batch_warm:             'the NEW guard, warm: one batch, every call after the first',
  d1_first_call_on_isolate:  'the NEW guard, cold: DDL + KV seed read + batch, once per isolate',
};

/**
 * @param {object} m  median_ms, keyed by series
 * @returns one of the states below. Pure; every branch is self-tested.
 */
export function verdict(m) {
  const need = Object.keys(SERIES);
  if (!m || need.some(k => typeof m[k] !== 'number')) return 'incomplete';
  if (need.some(k => m[k] < 0)) return 'impossible';
  // The comparison Task 3.2 turned on: is the warm path — which is what a
  // per-request caller actually pays — cheaper than what it replaced?
  if (m.d1_batch_warm < m.kv_four_ops) return 'warm-cheaper';
  if (m.d1_batch_warm > m.kv_four_ops) return 'warm-dearer';
  return 'warm-equal';
}

/** What each state means for Task 2, so a reader does not have to derive it. */
export function consequence(state) {
  switch (state) {
    case 'warm-cheaper':
      return 'Task 2 bought atomicity AND took latency off the per-request path. '
           + 'The cold-call cost is paid once per isolate and is reported beside it '
           + 'rather than averaged into it.';
    case 'warm-dearer':
      return 'Task 2 bought atomicity and CHARGED for it on every request. That is '
           + 'not a reason to revert — two counters that cannot agree were the '
           + 'defect — but the number belongs in the record, and fetchSportOddsLive '
           + 'runs per request (STANDARDS Rule 24).';
    case 'warm-equal':
      return 'The two forms cost the same at this resolution. Atomicity was free on '
           + 'the per-request path.';
    case 'incomplete':
      return 'NOTHING IS KNOWN. The route did not return all three medians, so no '
           + 'comparison is available. Do not read a verdict off this run.';
    case 'impossible':
      return 'A negative median. The route or the clock is wrong; fix the probe '
           + 'rather than reading it.';
    default:
      return 'unknown state';
  }
}

if (process.argv.includes('--self-test')) {
  let bad = 0;
  const one = (label, got, want, why) => {
    if (got === want) console.log(`  PASS  ${label} -> ${JSON.stringify(got)}  (${why})`);
    else { bad++; console.log(`  FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`); }
  };
  const m = (o) => ({ kv_four_ops: 40, d1_batch_warm: 20, d1_first_call_on_isolate: 90, ...o });

  one('warm beats the four KV ops', verdict(m()), 'warm-cheaper', 'the answer Task 2 hoped for');
  one('warm loses to the four KV ops', verdict(m({ d1_batch_warm: 60 })), 'warm-dearer', 'equally publishable; the point is to measure, not to win');
  one('a dead heat', verdict(m({ d1_batch_warm: 40 })), 'warm-equal', 'equal is its own answer, not a rounding of either side');
  one('a missing series', verdict(m({ d1_batch_warm: undefined })), 'incomplete', 'two of three medians is not a comparison');
  one('no medians at all', verdict(null), 'incomplete', 'the ordinary shape of a failed call');
  one('a negative median', verdict(m({ kv_four_ops: -1 })), 'impossible', 'a clock going backwards is a broken probe, not a fast path');

  // THE COLD SERIES MUST NOT DECIDE THE VERDICT. It is once per isolate; letting
  // it swing a per-request comparison is the averaging this probe exists to avoid.
  one('the cold number does not change the verdict',
      [verdict(m({ d1_first_call_on_isolate: 5 })), verdict(m({ d1_first_call_on_isolate: 5000 }))].join('/'),
      'warm-cheaper/warm-cheaper',
      'it is reported BESIDE the comparison, never inside it');
  // ...but it must still be REQUIRED, or "reported beside" quietly becomes "absent".
  one('the cold number is still required to be present',
      verdict(m({ d1_first_call_on_isolate: undefined })), 'incomplete',
      'not deciding the verdict is not the same as not being needed');

  const STATES = ['warm-cheaper', 'warm-dearer', 'warm-equal', 'incomplete', 'impossible'];
  one('every enumerated state has a consequence',
      STATES.every(s => consequence(s) !== 'unknown state'), true,
      'a verdict the reader interprets is one that gets interpreted wrongly');
  one('AN UNENUMERATED STATE DOES NOT READ AS SUCCESS',
      /unknown/i.test(consequence('a-state-nobody-wrote')), true,
      'the line above never reaches default, so on its own it is vacuous');
  one('...and default is not any real state\'s text',
      STATES.some(s => consequence(s) === consequence('a-state-nobody-wrote')), false,
      'default must differ from every answer, not only from the good one');
  one('every state verdict() can return is enumerated above',
      STATES.length, 5,
      'a state added without a row here is a state nothing checks');

  console.log(bad ? `\n${bad} FAILED` : '\nself-test: 12/12');
  console.log('COVERAGE: the verdict function only. It makes NO network call and');
  console.log('cannot tell whether the route is deployed or what it measures.');
  process.exit(bad ? 1 : 0);
}

// ---- live ----
const BASE = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const AUTH = process.env.RELAY_GATE;
if (!AUTH) { console.error('RELAY_GATE not set — refusing to guess the header value.'); process.exit(1); }

const out = [];
const say = (s) => { out.push(s); console.log(s); };

say(`=== Task 0d: what Task 2 cost in latency  utc=${new Date().toISOString()} ===\n`);

let body = null, status = 0;
try {
  const r = await fetch(`${BASE}/debug/odds-budget-latency`, {
    method: 'POST',
    headers: { 'X-FIELD-Relay': AUTH, 'Content-Type': 'application/json' },
    body: '{}',
  });
  status = r.status;
  const text = await r.text();
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
} catch (e) {
  body = { error: String(e && e.message || e) };
}

const m = body && body.median_ms;
say(`  route POST /debug/odds-budget-latency -> ${status || 'no response'}`);
if (body && body.error) say(`  route error: ${body.error}`);
say('');
for (const [k, what] of Object.entries(SERIES)) {
  const v = m && typeof m[k] === 'number' ? `${m[k]} ms` : 'MISSING';
  say(`  ${String(v).padStart(8)}   ${k}`);
  say(`             ${what}`);
}

const state = verdict(m);
say(`\n  verdict: ${state}`);
if (state === 'warm-cheaper' || state === 'warm-dearer' || state === 'warm-equal') {
  const d = m.d1_batch_warm - m.kv_four_ops;
  say(`  per-request delta: ${d >= 0 ? '+' : ''}${d} ms (new warm minus old four-op)`);
  say(`  once-per-isolate:  ${m.d1_first_call_on_isolate} ms, paid on the first call only`);
}
say(`\n  ${consequence(state)}`);

if (body && body.samples) {
  say('\n  raw samples (ms), in call order:');
  for (const k of Object.keys(SERIES)) say(`    ${k}: ${JSON.stringify(body.samples[k])}`);
}
if (body && body.note) for (const k of Object.keys(body.note)) say(`\n  NOTE (${k}): ${body.note[k]}`);
if (body && body.cleaned) say(`\n  cleaned up: ${JSON.stringify(body.cleaned)}`);

say(`\nCOVERAGE: ONE isolate on whichever colo answered this request, 7 iterations`);
say(`per series. It does NOT measure contention, cold starts, other regions, or`);
say(`the real guard in situ — two of the three series are reconstructions, which`);
say(`the route's own notes above say in its own words.`);

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
writeFileSync(`outbox/odds-budget-latency-${stamp}.log`, out.join('\n') + '\n');
console.log(`\nwrote outbox/odds-budget-latency-${stamp}.log`);
process.exit(['warm-cheaper', 'warm-dearer', 'warm-equal'].includes(state) ? 0 : 1);
