#!/usr/bin/env node
// scripts/provenance-runtime-probe.mjs — does the DEPLOYED worker stamp?
//
// The census is a static read of src/. It has never once looked at a response.
// That gap is the whole "is this the source, or a copy of the source?" question:
// the manifest is generated from code that may not be what is running, and a
// wrapper that works in a unit test can still be absent in production.
//
// It hits a deliberately mixed set -- a store route, an upstream route, a proxy
// whose response comes back frozen from fetch(), a trigger that reads nothing,
// and a path that does not exist -- because each exercises a different branch of
// the stamp, and a probe that only calls one route proves only that one branch.
//
// Cost: zero. Every route chosen is cached or free; none spends Odds API credit.

import { writeFileSync, mkdirSync } from 'node:fs';
import { ROUTE_PROVENANCE, provenanceFor } from '../src/route-provenance.js';

const BASE = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const TARGETS = [
  { path: '/health',           why: 'the cheapest route in the worker' },
  { path: '/budget/odds',      why: 'store-backed, and the route that started all of this' },
  { path: '/wc/odds-probs',    why: 'upstream, cached, no credit spent — and the route the fabricated row lived in', wc: true },
  { path: '/odds/v4/sports',   why: 'proxy: the response comes back FROZEN from fetch(), the rebuild branch' },
  { path: '/provenance/kv?prefix=odds', why: 'the write half: KV metadata read back out of the store', kv: true },
  { path: '/nothing/here',     why: 'unmapped: must say so rather than guess', expectUnmapped: true },
];

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `\n         → ${detail}`}`);
  if (!ok) failed++;
};

const readings = [];
for (const t of TARGETS) {
  let r = null, err = null;
  try { r = await fetch(`${BASE}${t.path}`, { headers: { Accept: 'application/json' } }); }
  catch (e) { err = String(e && e.message || e); }
  readings.push({
    ...t,
    status: r ? r.status : 0,
    error: err,
    route:    r && r.headers.get('x-field-route'),
    source:   r && r.headers.get('x-field-source'),
    kind:     r && r.headers.get('x-field-kind'),
    servedAt: r && r.headers.get('x-field-served-at'),
    manifest: r && r.headers.get('x-field-manifest'),
    exposed:  r && r.headers.get('access-control-expose-headers'),
    body:     null,
  });
  // The KV target is the only one whose BODY is the finding. Headers prove the
  // response wrapper runs; only the body proves a WRITE recorded anything.
  if ((t.kv || t.wc) && r && r.ok) { try { readings[readings.length - 1].body = await r.json(); } catch (_) {} }
}

mkdirSync('outbox', { recursive: true });
const manifest = { base: BASE, checked_at: new Date().toISOString(), readings };
writeFileSync(`outbox/provenance-runtime-probe-${STAMP}.json`, JSON.stringify(manifest, null, 2));
writeFileSync('outbox/provenance-runtime-probe-latest.json', JSON.stringify(manifest, null, 2));
for (const x of readings) {
  console.log(`  ${x.path.padEnd(20)} ${String(x.status).padEnd(4)} kind=${String(x.kind).padEnd(15)} src=${x.source}`);
}
console.log('');

const answered = readings.filter(r => r.status > 0);
check('every target answered', answered.length === TARGETS.length,
  readings.filter(r => !r.status).map(r => `${r.path}: ${r.error}`).join('; '));
check('every response carries X-FIELD-Route', answered.every(r => r.route),
  `unstamped: ${answered.filter(r => !r.route).map(r => r.path).join(', ') || '(none)'}`);
check('the route header echoes the path asked for', answered.every(r => r.route === r.path));
check('the proxy route is stamped too', !!readings.find(r => r.path === '/odds/v4/sports')?.route,
  'the frozen-response rebuild branch did not run in production');
check('an unmapped path is labelled unmapped',
  readings.find(r => r.expectUnmapped)?.kind === 'unmapped');

// THE ASSERTION THIS PROBE WAS MISSING ON ITS FIRST RUN. It recorded
// /odds/v4/sports as kind=unmapped and PASSED, because every check it had was
// satisfied by the stamp being present at all. The defect sat in the output in
// plain text and a human had to read it -- which is the job the probe exists to
// do. A real route resolving to `unmapped` means the manifest cannot see a
// route the router serves, and that is a failure, not a note.
const wronglyUnmapped = answered.filter(r => !r.expectUnmapped && r.kind === 'unmapped');
check('every real route resolves in the manifest', wronglyUnmapped.length === 0,
  `${wronglyUnmapped.length} served but unmapped: ${wronglyUnmapped.map(r => r.path).join(', ')} - the manifest cannot see a route the router answers`);
check('the headers are exposed to a browser',
  answered.every(r => (r.exposed || '').includes('X-FIELD-Source')));

// THE POINT OF A RUNTIME PROBE: the deployed manifest must be the committed one.
// A stale worker answers confidently with a map of code that no longer exists,
// which is indistinguishable from a correct answer unless something compares.
const drift = answered.filter(r => {
  const local = provenanceFor(r.path);
  const expect = local ? (local.s || 'none (reads nothing)') : 'unmapped';
  return r.source !== expect;
});
check('the deployed manifest agrees with the committed one', drift.length === 0,
  drift.map(d => `${d.path}: deployed "${d.source}" vs local "${(provenanceFor(d.path)?.s) ?? 'unmapped'}"`).join('; '));

const ts = answered.map(r => r.servedAt).filter(Boolean);
check('Served-At is a real timestamp, not a placeholder',
  ts.length > 0 && ts.every(v => Math.abs(Date.now() - Date.parse(v)) < 600000),
  `values: ${ts.join(', ')}`);

// ── No hand-entered row in a live response ──────────────────────────────────
// The deploy gate proves the fabricated Germany v Ecuador row is out of the
// SOURCE. This proves it is out of what the deployed worker actually serves,
// which is a different claim -- the row survived 377 commits to that file
// precisely because everyone was reading source and nobody was reading the
// response. It stays here permanently: the check that would have caught it on
// day one is the check worth keeping forever.
const wc = readings.find(r => r.wc);
if (wc && wc.body && Array.isArray(wc.body.probs)) {
  const rows = wc.body.probs;
  const bad = rows.filter(p =>
    /injected|consensus|screenshot|hand/i.test(String(p.lambdaSource || '')) ||
    ((p.home_team === 'Germany' && p.away_team === 'Ecuador') ||
     (p.home_team === 'Ecuador' && p.away_team === 'Germany')));
  console.log(`\n  /wc/odds-probs served ${rows.length} row(s); provider cost=${JSON.stringify(wc.body.cost)}, charged=${wc.body.charged}`);
  const srcs = [...new Set(rows.map(p => p.lambdaSource))];
  if (srcs.length) console.log(`         lambdaSource values: ${srcs.join(', ')}`);
  check('no hand-entered row in the served response', bad.length === 0,
    `${bad.length} fabricated row(s) live: ${bad.map(p => `${p.home_team} v ${p.away_team} (${p.lambdaSource})`).join(', ')}`);
  // Zero rows is CORRECT out of season and must not read as a failure. What
  // matters is that whatever is served came from the market.
  check('every served row derives from market data',
    rows.every(p => ['totals', 'h2h-inversion'].includes(p.lambdaSource)),
    `undeclared source: ${srcs.filter(x => !['totals', 'h2h-inversion'].includes(x)).join(', ')}`);
}

// ── The write half ──────────────────────────────────────────────────────────
// A stamp on a response proves the wrapper runs. It proves nothing about
// whether a VALUE sitting in the store knows where it came from, and that is
// the half that survives being saved, logged or read back tomorrow.
const kv = readings.find(r => r.kv);
if (kv && kv.body && kv.body.ok) {
  const c = kv.body.counts || {};
  console.log(`\n  kv:FIELD_JOURNALISM prefix="odds" — ${c.stamped} stamped, ${c.unstamped} unstamped of ${c.listed} listed`);
  for (const [wr, n] of Object.entries(kv.body.writers || {})) console.log(`         ${String(n).padStart(3)}  ${wr}`);
  // Deliberately NOT "stamped > 0". Every key written before the wrap shipped is
  // legitimately unstamped and expires on its own TTL, so a fresh deploy would
  // fail that assertion while being completely correct. What must hold is that
  // the survey works and reports both states distinguishably, so unstamped can
  // be watched down to zero instead of asserted away on day one.
  check('the survey reports stamped and unstamped as distinct numbers',
    typeof c.stamped === 'number' && typeof c.unstamped === 'number',
    'a survey that cannot say "not recorded yet" reports absence as success');
  check('no stored value appears in the survey', !JSON.stringify(kv.body).includes('"value"'),
    'the survey returns keys, ages and writers - never content');
} else if (kv) {
  check('the KV survey answers', false, `status ${kv.status}: ${JSON.stringify(kv.body)}`);
}

console.log(`\n  ${Object.keys(ROUTE_PROVENANCE).length} routes in the committed manifest`);
console.log(failed === 0 ? '  PASS — the deployed worker stamps what the code says it stamps' : `  FAIL — ${failed}`);
process.exit(failed === 0 ? 0 : 1);
