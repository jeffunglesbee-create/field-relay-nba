#!/usr/bin/env node
// scripts/odds-cost-model-probe.mjs — does `regions` multiply the credit cost?
//
// THIS PROBE SPENDS REAL CREDITS. It is dispatch-only and must never be put on a
// schedule. It calls two billable routes to make the provider bill us and then
// tell us what it billed, which is the only instrument that answers the
// question. Expected spend per run: 2-4 credits for /wc/odds-probs plus 3-6 for
// /cfl/odds-probs, depending on which model turns out to be right — under 10,
// against 76,456 remaining as of 2026-09-05.
//
// THE QUESTION. commit "five odds call sites spent provider quota and charged
// the ledger nothing" introduced oddsCreditCost(url), whose model is markets-
// only, because that is what this repository's own two guarded sites already
// asserted (3 markets -> 3, historical -> 10x) and nothing here has ever
// mentioned a regions factor. Whether the provider ALSO multiplies by regions
// was left explicitly unverified rather than guessed, with ODDS_REGIONS_MULTIPLY
// = false and one line to flip.
//
// THE INSTRUMENT. Both routes now return `cost` (the provider's own
// X-Requests-Last header for that exact call) beside `charged` (what we billed
// ourselves). Two routes, same regions, DIFFERENT market counts:
//
//   /wc/odds-probs    regions=us,eu  markets=h2h,totals          2 markets
//   /cfl/odds-probs   regions=us,eu  markets=h2h,spreads,totals  3 markets
//
//   cost 2 and 3  -> markets-only. oddsCreditCost is correct as written.
//   cost 4 and 6  -> regions multiply. Flip ODDS_REGIONS_MULTIPLY to true.
//   anything else -> the model is neither, and the numbers say what it is.
//   cost null     -> no such header. The question needs another instrument and
//                    this probe says so instead of inferring from a delta.
//
// Two routes rather than one because a single reading cannot distinguish
// "markets multiply" from "every call costs 2". Two market counts can.
//
// CACHING. Both routes are CF edge-cached (WC 300s, CFL 120s). A cached response
// replays the ORIGINAL call's headers, so `cost` stays truthful about what that
// call cost while `remaining` goes stale. That is fine for this question and is
// why the manifest records both.

import { writeFileSync, mkdirSync } from 'fs';

const BASE = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const OUT = 'outbox';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      → ${detail}`}`);
  if (!ok) failed++;
};

const ROUTES = [
  { path: '/wc/odds-probs',  markets: 2, regions: 2, label: 'WC (h2h,totals over us,eu)' },
  { path: '/cfl/odds-probs', markets: 3, regions: 2, label: 'CFL (h2h,spreads,totals over us,eu)' },
];

const readings = [];
for (const r of ROUTES) {
  let body = null, status = 0, err = null;
  try {
    const resp = await fetch(`${BASE}${r.path}`, { headers: { Accept: 'application/json' } });
    status = resp.status;
    body = await resp.json();
  } catch (e) { err = String(e && e.message || e); }
  readings.push({
    ...r, status, error: err,
    cost:      body && body.cost !== undefined ? body.cost : undefined,
    charged:   body && body.charged,
    remaining: body && body.remaining,
    guarded:   !!(body && body.guarded),
    ok:        !!(body && body.ok),
  });
}

// The verdict is three-state on purpose. "Unresolved" and "wrong" are different
// answers and a boolean would collapse them into the second.
function verdict(rs) {
  if (rs.some(r => r.cost === undefined))         return { state: 'unresolved', why: 'a route did not return `cost` — the deployed worker predates this change' };
  if (rs.some(r => r.cost === null))              return { state: 'unresolved', why: 'the provider sends no X-Requests-Last header — this question needs another instrument' };
  if (rs.some(r => r.guarded))                    return { state: 'unresolved', why: 'the credit guard declined a call, so no provider reading was taken' };
  const n = rs.map(r => ({ ...r, n: Number(r.cost) }));
  if (n.some(r => !Number.isFinite(r.n)))         return { state: 'unresolved', why: `cost was not a number: ${n.map(r => JSON.stringify(r.cost)).join(', ')}` };
  if (n.every(r => r.n === r.markets))            return { state: 'markets-only', why: 'cost equals the market count on both routes — oddsCreditCost is correct as written' };
  if (n.every(r => r.n === r.markets * r.regions))return { state: 'regions-multiply', why: 'cost equals markets x regions on both routes — flip ODDS_REGIONS_MULTIPLY to true in src/budget-helpers.js' };
  return { state: 'neither', why: `costs ${n.map(r => `${r.path}=${r.n}`).join(' ')} match neither markets-only nor markets x regions` };
}

const v = verdict(readings);
const manifest = { base: BASE, checked_at: new Date().toISOString(), verdict: v, readings };
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/odds-cost-model-probe-${STAMP}.json`, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
console.log('');

for (const r of readings) {
  console.log(`  ${r.path.padEnd(18)} http=${r.status} cost=${JSON.stringify(r.cost)} charged=${r.charged} remaining=${r.remaining}  ${r.label}`);
}
console.log(`\n  VERDICT: ${v.state} — ${v.why}\n`);

check('both routes answered', readings.every(r => r.status === 200),
  readings.map(r => `${r.path} HTTP ${r.status}${r.error ? ` (${r.error})` : ''}`).join('; '));
check('both routes charged themselves something', readings.every(r => Number(r.charged) >= 1),
  'a route reported charged<1 — a call that bills the provider must bill the ledger');
check('the cost model is resolved', v.state !== 'unresolved', v.why);
check('the deployed model matches the provider', v.state === 'markets-only',
  v.state === 'regions-multiply'
    ? 'ACT ON THIS: set ODDS_REGIONS_MULTIPLY = true in src/budget-helpers.js. Every site corrects at once.'
    : v.why);
check('no credential value appears in either response',
  !JSON.stringify(readings).match(/apiKey=|[a-f0-9]{24,}/i),
  'a response looks like it carries a key — it must never');

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}  ${failed} failing`);
process.exit(failed === 0 ? 0 : 1);
