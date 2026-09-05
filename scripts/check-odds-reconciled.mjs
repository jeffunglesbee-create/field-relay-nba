#!/usr/bin/env node
// scripts/check-odds-reconciled.mjs — every charged odds call is reconciled
// against the provider's receipt. Blocking in deploy.yml.
//
// oddsCreditCost has to answer BEFORE the call; that is what a circuit breaker
// is for. But the provider says afterwards what the call actually cost, in
// X-Requests-Last, and a ledger that keeps the guess and discards the receipt
// drifts in whichever direction the guess is wrong.
//
// Measured 2026-09-05T03:26:20Z: /wc/odds-probs reported provider cost "0"
// against charged 4. Out of season the request returns nothing and the provider
// bills nothing, and the ledger recorded four credits of spend that never
// happened. The mirror image of the morning's defect, which was the same ledger
// under-counting real spend by half.
//
// Both directions make ODDS_HARD_LIMIT mean something other than what it says.
// A floor you cannot trust in either direction is not a floor.

import { readFileSync } from 'node:fs';
import { reconcileOddsCredit } from '../src/budget-helpers.js';

let failed = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : `\n         → ${d}`}`); if (!ok) failed++; };

// ── Every function that charges must also reconcile ──────────────────────────
const FILES = ['src/index.js', 'src/ambient-do.js', 'src/wp-resolver.js'];
function fnBounds(lines, i) {
  let start = 0;
  for (let j = i; j >= 0; j--) {
    if (/^(export\s+)?(async\s+)?function\s/.test(lines[j])) { start = j; break; }
    if (/^\s{4}(async\s+)?[_a-zA-Z][\w]*\s*\(/.test(lines[j]) && !/^\s*(if|for|while|switch|catch|return)\b/.test(lines[j].trim())) { start = j; break; }
  }
  let end = lines.length;
  for (let k = start + 1; k < lines.length; k++) {
    if (/^(export\s+)?(async\s+)?function\s/.test(lines[k])) { end = k; break; }
    if (/^\s{4}(async\s+)?[_a-zA-Z][\w]*\s*\(/.test(lines[k]) && !/^\s*(if|for|while|switch|catch|return)\b/.test(lines[k].trim())) { end = k; break; }
  }
  return [start, end];
}

const unreconciled = [];
let charged = 0;
for (const f of FILES) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('//')) return;
    if (!/(consumeOddsCredit|_consumeAmbientOddsCredit)\s*\(/.test(line)) return;
    if (/^(export\s+)?(async\s+)?function\s+(consumeOddsCredit|_consumeAmbientOddsCredit)/.test(line)) return; // the definition
    charged++;
    const [a, b] = fnBounds(lines, i);
    if (!lines.slice(a, b).join('\n').includes('reconcileOddsCredit(')) unreconciled.push(`${f}:${i + 1}`);
  });
}
console.log(`  ${charged} charging site(s); ${charged - unreconciled.length} reconciled`);
check('every charged odds call reconciles against the receipt', unreconciled.length === 0,
  `unreconciled: ${unreconciled.join(', ')} — these keep the estimate forever`);

// ── The five states, against the real exported function ──────────────────────
const store = new Map();
const key = `odds:daily:${new Date().toISOString().slice(0, 10)}`;
store.set(key, '100');
const env = { FIELD_JOURNALISM: { get: k => Promise.resolve(store.get(k) ?? null),
                                  put: (k, v) => { store.set(k, v); return Promise.resolve(); } } };
const R = h => ({ headers: { get: k => h[k] ?? null } });

let r = await reconcileOddsCredit(env, 4, R({ 'x-requests-last': '0' }), 't');
check('a zero receipt refunds the estimate', r.state === 'reconciled' && r.delta === -4);
check('the counter actually moved', store.get(key) === '96', `counter is ${store.get(key)}`);

r = await reconcileOddsCredit(env, 3, R({ 'x-requests-last': '6' }), 't');
check('a receipt larger than the estimate charges the difference', r.delta === 3);

// The subtle one: a cache hit replays the ORIGINAL call's receipt.
r = await reconcileOddsCredit(env, 4, R({ 'cf-cache-status': 'HIT', 'x-requests-last': '6' }), 't');
check('a cache hit is worth zero, not the receipt it replays',
  r.state === 'cache-hit' && r.actual === 0 && r.delta === -4,
  'reconciling a hit to its replayed header charges full price for a request that never left the edge');

r = await reconcileOddsCredit(env, 4, R({}), 't');
check('no receipt leaves the estimate standing', r.state === 'no-header' && r.delta === 0,
  'an unreconciled charge is safe; an invented correction is not');

r = await reconcileOddsCredit(env, 4, R({ 'x-requests-last': 'abc' }), 't');
check('a malformed receipt is not parsed into a number', r.state === 'bad-header' && r.delta === 0);

// Never negative: a lost race must not hand back headroom that was spent.
store.set(key, '2');
await reconcileOddsCredit(env, 40, R({ 'x-requests-last': '0' }), 't');
check('a counter is clamped at zero', store.get(key) === '0', `counter is ${store.get(key)}`);

// Never break the caller.
const hostile = { FIELD_JOURNALISM: { get: () => { throw new Error('kv down'); }, put: () => {} } };
r = await reconcileOddsCredit(hostile, 4, R({ 'x-requests-last': '0' }), 't');
check('a KV failure is reported, not thrown', r.state === 'error');
r = await reconcileOddsCredit(null, 4, R({ 'x-requests-last': '0' }), 't');
check('a missing binding is reported, not thrown', r.state === 'no-kv');

console.log(failed === 0 ? '  PASS — the ledger records what was spent, not what was guessed' : `  FAIL — ${failed}`);
process.exit(failed === 0 ? 0 : 1);
