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

import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
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
    dataAge:  r && r.headers.get('x-field-data-age-seconds'),
    dataAt:   r && r.headers.get('x-field-data-written-at'),
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
// A store-backed route reads from KV, so it can say how old its data is. That
// the header is ABSENT on a route that read nothing is the correct answer, not a
// gap -- so this asserts only where an age must exist.
const stores = answered.filter(r => r.kind === 'store' && !r.expectUnmapped);
if (stores.length) {
  for (const r of stores) console.log(`         ${r.path.padEnd(30)} data age ${r.dataAge === null ? '(none recorded yet)' : r.dataAge + 's'}`);
  check('a store-backed route reports an age or says it has none',
    stores.every(r => r.dataAge === null || Number.isFinite(Number(r.dataAge))),
    'an age that is neither a number nor absent is a third thing nobody can read');
}

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

  // UNSTAMPED MUST NEVER INCREASE, and this only became assertable once the
  // Durable Objects wrapped their own env. The worker's two entry points cover
  // every write beneath a request or a cron tick; a DO holds its own env and was
  // the one remaining way an unstamped key could still be created. With all of
  // them covered, every new key is stamped by construction, so the unstamped
  // count can only fall as old keys reach their TTL.
  //
  // A rise means something is writing outside every wrap -- a new entry point, a
  // new DO, or a binding nobody added to KV_BINDINGS -- which is a finding, not
  // drift. Compared against the previous committed reading rather than a
  // hardcoded number, so it needs no maintenance and cannot go stale.
  // NOT a silent catch. The first version of this block referenced an undefined
  // OUT constant, and the try swallowed the ReferenceError -- so it reported "no
  // previous reading" on every run and compared nothing, while printing ok. A
  // check that cannot see reports clean, which is the failure this whole probe
  // exists to prevent. A missing-file case is expected and quiet; anything else
  // is surfaced.
  let prev = null;
  try {
    const older = readdirSync('outbox').filter(f => /^provenance-runtime-probe-\d/.test(f)).sort();
    for (let i = older.length - 1; i >= 0; i--) {
      const j = JSON.parse(readFileSync(`outbox/${older[i]}`, 'utf8'));
      const k = (j.readings || []).find(r => r.kv && r.body && r.body.ok && r.body.prefix === kv.body.prefix);
      if (k) { prev = { at: j.checked_at, ...k.body.counts }; break; }
    }
  } catch (e) {
    if (!/ENOENT/.test(String(e && e.message))) {
      check('the previous-reading comparison is able to run', false, String(e && e.message || e));
    }
  }
  if (prev) {
    console.log(`         previous reading ${prev.at}: ${prev.stamped} stamped, ${prev.unstamped} unstamped`);
    check('unstamped never increases', c.unstamped <= prev.unstamped,
      `${prev.unstamped} -> ${c.unstamped}. Every write path is wrapped, so a rise means one is not: a new entry point, a new Durable Object, or a binding missing from KV_BINDINGS.`);
  } else {
    console.log('         no previous reading to compare against — the trend starts here');
  }
} else if (kv) {
  check('the KV survey answers', false, `status ${kv.status}: ${JSON.stringify(kv.body)}`);
}

// ── The cf-cache-status vocabulary, accumulated rather than assumed ─────────
// reconcileOddsCredit treats exactly one status -- HIT -- as zero-cost, because
// a hit replays the original call's receipt. The first live reading came back
// EXPIRED, a value outside the two that were reasoned about, which behaved
// correctly but showed the vocabulary is wider than assumed.
//
// STALE and UPDATING would also serve from cache without waiting on the origin
// and would currently be charged a replayed receipt rather than zero. That
// over-charges, which is the safe direction, and it is deliberately not "fixed"
// by adding statuses from memory -- writing a cross-boundary fact from memory is
// the defect this session kept finding. So the set is accumulated here from what
// this worker actually produces, and the constant is widened once the observed
// set says to.
const statuses = new Map();
try {
  for (const f of readdirSync('outbox').filter(f => /^provenance-runtime-probe-\d/.test(f))) {
    const j = JSON.parse(readFileSync(`outbox/${f}`, 'utf8'));
    for (const r of j.readings || []) {
      const v = r.body && r.body.cached;
      if (v) statuses.set(v, (statuses.get(v) || 0) + 1);
    }
  }
} catch (e) {
  if (!/ENOENT/.test(String(e && e.message))) {
    check('the cache-status tally is able to run', false, String(e && e.message || e));
  }
}
const here = readings.map(r => r.body && r.body.cached).filter(Boolean);
for (const v of here) statuses.set(v, (statuses.get(v) || 0) + 1);
if (statuses.size) {
  console.log(`\n  cf-cache-status seen across all runs: ${[...statuses.entries()].map(([k, n]) => `${k}(${n})`).join(', ')}`);
  const ZERO_COST = new Set(['HIT']);
  const undecided = [...statuses.keys()].filter(v => !ZERO_COST.has(v) && ['STALE', 'UPDATING'].includes(v));
  check('no observed status is one the reconciler mis-prices', undecided.length === 0,
    `${undecided.join(', ')} observed. These serve from cache without contacting the provider, so they are worth zero, but reconcileOddsCredit only treats HIT that way and charges them the replayed receipt. Widen ZERO_COST_STATUSES in src/budget-helpers.js now that they have been seen.`);
}

// Rule 91: the denominator goes where the result is read. This probe checks a
// handful of routes and printed PASS; status reports then claimed "186/186
// verified live" for hours, because a PASS with an invisible denominator is a
// claim about everything.
const coverage = `checked ${TARGETS.length} of ${Object.keys(ROUTE_PROVENANCE).length} routes`;
manifest.coverage = { checked: TARGETS.length, of: Object.keys(ROUTE_PROVENANCE).length };
writeFileSync(`outbox/provenance-runtime-probe-${STAMP}.json`, JSON.stringify(manifest, null, 2));
writeFileSync('outbox/provenance-runtime-probe-latest.json', JSON.stringify(manifest, null, 2));
console.log(`\n  ${coverage} — this is a SAMPLE. A pass here says the mechanism works on those ${TARGETS.length}, not that the other ${Object.keys(ROUTE_PROVENANCE).length - TARGETS.length} were tested.`);
console.log(failed === 0 ? `  PASS (${coverage}) — the deployed worker stamps what the code says it stamps, on the routes sampled` : `  FAIL — ${failed}`);
process.exit(failed === 0 ? 0 : 1);
