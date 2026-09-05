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
  { path: '/wc/odds-probs',    why: 'upstream — cached, so no credit is spent' },
  { path: '/odds/v4/sports',   why: 'proxy: the response comes back FROZEN from fetch(), the rebuild branch' },
  { path: '/nothing/here',     why: 'unmapped — must say so rather than guess' },
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
  });
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
  readings.find(r => r.path === '/nothing/here')?.kind === 'unmapped');
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

console.log(`\n  ${Object.keys(ROUTE_PROVENANCE).length} routes in the committed manifest`);
console.log(failed === 0 ? '  PASS — the deployed worker stamps what the code says it stamps' : `  FAIL — ${failed}`);
process.exit(failed === 0 ? 0 : 1);
