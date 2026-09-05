#!/usr/bin/env node
// scripts/odds-quota-probe.mjs — what does the Odds API itself say is left?
//
// WHY, precisely. This session concluded that jubilant-bassoon's win-probability
// chart may be blocked by Odds API quota. That conclusion rested on an inherited
// claim — "the key is an exhausted free tier" — which src/index.js:568-583
// contradicts: ODDS_API_KEY is a paid 20K-credit key with a 500-credit Starter
// as a runtime fallback. Rule 72 says an inherited claim that influences a
// decision gets verified before it is acted on. This is that verification.
//
// It reads GET /budget/odds, which now returns BOTH views:
//   daily/monthly  what this relay spent, from its own KV counters
//   provider       what the Odds API reports, from X-Requests-Remaining/Used
//
// The gap between them is the finding. Equal-ish means the key is ours alone
// and the counters are honest. A provider number far lower than ours means the
// key is being spent somewhere else. A refusal means the counters were never
// the constraint.
//
// It asserts the SHAPE, not the numbers. A quota of 40,000 or 400 is a fact
// about the account, not a pass/fail — gating on a threshold here would just
// invite the number to be argued with. What must hold is that the endpoint
// answers, that the provider view is present, and that its state is one of the
// three the endpoint promises.

import { writeFileSync, mkdirSync } from 'fs';

const BASE = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const OUT = 'outbox';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      → ${detail}`}`);
  if (!ok) failed++;
};

let body = null, status = 0, err = null;
try {
  const r = await fetch(`${BASE}/budget/odds`, { headers: { Accept: 'application/json' } });
  status = r.status;
  body = await r.json();
} catch (e) { err = String(e && e.message || e); }

const manifest = { base: BASE, checked_at: new Date().toISOString(), status, error: err, body };
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/odds-quota-probe-${STAMP}.json`, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
console.log('');

check('the endpoint answered', status === 200, `HTTP ${status}${err ? ` (${err})` : ''}`);
check('it reports our own counters', !!(body && body.daily !== undefined && body.monthly !== undefined),
  'daily/monthly missing — this predates the provider change or the route regressed');
check('it reports the provider view', !!(body && body.provider),
  'no `provider` key — the deployed worker predates this change');

const p = body && body.provider;
if (p) {
  // Three states, and the check names which one rather than collapsing them.
  const known = ['ok', 'no-key', 'unreachable', 'error'];
  const isStatusCode = /^\d{3}$/.test(String(p.state));
  check('the provider state is one the endpoint promises',
    known.includes(p.state) || isStatusCode,
    `state="${p.state}" is not in ${known.join('|')} or an HTTP status`);

  if (p.state === 'ok') {
    check('the provider sent its quota headers', p.headers_present === true,
      'state is ok but X-Requests-Remaining/Used were absent — the numbers below are null, not zero');
    console.log(`\n  provider: remaining=${p.requests_remaining} used=${p.requests_used} via the ${p.key} key`);
  } else {
    // Not a failure of this probe. It is the answer, and it is the one that
    // matters most: the counters were never the constraint.
    console.log(`\n  provider did NOT report a quota: state="${p.state}"${p.note ? ` — ${p.note}` : ''}`);
    console.log('  That is the finding, not a probe failure.');
  }
  check('no credential value appears in the response',
    !JSON.stringify(body).match(/apiKey=|[a-f0-9]{24,}/i),
    'the response looks like it carries a key — it must never');
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}  ${failed} failing`);
process.exit(failed === 0 ? 0 : 1);
