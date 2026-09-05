#!/usr/bin/env node
// scripts/provenance-census.mjs — what does this relay serve, and can a reader
// tell where any of it came from?
//
// WHY. Five defects in one session were found by probes pointed at something
// else: five odds call sites spending unaccounted, every us,eu call charged
// half, a fabricated Germany v Ecuador odds row served for 72 days, 48 stale
// mlbRaw entries, an F# build read as its own source. Every one is the same
// shape -- the system serves a value and nothing in the response says where it
// came from or how old it is. Each was found by accident-adjacency, which is
// not a strategy.
//
// This is the baseline before building anything: how much of what we serve is
// self-describing, and how much is a number with no visible origin.
//
// IT IS A STATIC READ AND SAYS SO. It parses the route table and the code that
// answers each route. It cannot see what a response looks like at runtime --
// that needs live probing, which is the second half of this work and is
// deliberately not faked here.
//
// THE FIRST VERSION OF THIS SCRIPT REPORTED 3.2% AND WAS WRONG. It read only the
// route body, so /budget/odds -- the best-instrumented route in this repo, which
// returns checked_at and a three-state provider view -- came back `none`,
// because every one of those fields is built inside oddsProviderQuota(). The
// error was systematic and one-directional: any route that delegates read as
// bare, and delegating is the normal shape here. A census whose flagship reads
// as bare is not a census.
//
// So it follows the call graph ONE level: helpers actually invoked in the body
// are pulled in and scanned with it. One level, not transitive, because each
// further level trades a real miss for a plausible false positive, and an
// instrument that flatters the system is worse than one that undercounts.
// Routes still unresolved are reported as `unread` -- unknown, never as fine.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';


// Helpers are not all in index.js. /health/sources -- the Stale Data Sentinel,
// which exists to report freshness and is therefore the LAST route that should
// read as having none -- delegates to checkAllSources in stale-data-sentinel.js
// via dynamic import. The third distinct way this script undercounted, after
// same-file delegation and ES6 shorthand. Every sibling module is searched.

// The parser lives in scripts/lib/route-scan.mjs, shared with the manifest
// generator. It used to live here; two tools reading the same 19k-line file
// with two parsers is the drift this whole exercise is about.
import { SRC, lines, routes, bodyOf, withHelpers, decomment,
         AGE, SRC_F, PASSTHROUGH, PROTOCOL } from './lib/route-scan.mjs';

// ── Self-tests. Both directions, because an instrument that only checks it can
// SEE provenance will happily see it everywhere. Each fixture is a shape taken
// from this repo.
function selfTest() {
  const cases = [
    ['colon form',                  'return new Response(JSON.stringify({ ok: true, ts: Date.now() }))',        AGE,   true],
    ['shorthand in a literal',      'return { ok: false, state, checked_at, note };',                           AGE,   true],
    ['shorthand, source',           'return { ok: true, daily, monthly, provider };',                           SRC_F, true],
    ['array destructuring is not',  'const [daily, monthly, provider] = await Promise.all([]);',                SRC_F, false],
    ['a LAST parameter is not',     'function build(env, source) { return 1; }',                                SRC_F, false],
    // The case that actually bit: relayFetch(url, headers, ttl, source, ctx).
    // The version before this one passed the test above and failed this one.
    ['a MIDDLE parameter is not',   'async function relayFetch(url, headers, ttl, source, ctx) { return 1; }',  SRC_F, false],
    ['a local variable is not',     'const source = upstream; await log(source);',                              SRC_F, false],
    ['a bare response has none',    'return new Response(JSON.stringify({ ok: true, rows }))',                  AGE,   false],
    ['a comment mentioning ts',     '// ts: the timestamp we do not send',                                      AGE,   false],
    ['nested response object',      'return new Response(JSON.stringify({ ok: true, meta: { fetched_at: x } }))', AGE, true],
  ];
  let pass = 0, fail = 0;
  for (const [name, text, re, want] of cases) {
    // Comments are stripped the same way the scan does, so the last case is real.
    const stripped = text.split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');
    const got = re.test(stripped);
    if (got === want) pass++; else { fail++; console.error(`  SELFTEST FAIL: ${name} — expected ${want}, got ${got}`); }
  }
  return { pass, fail };
}
const st = selfTest();
if (st.fail) { console.error(`\n  ${st.fail} self-test(s) failed — the census is not trustworthy, not reporting a number.`); process.exit(1); }

for (const r of routes) {
  const b = bodyOf(r.line);
  r.via = b.via;
  r.unresolved = !b.resolved;
  if (PROTOCOL.test(r.path)) { r.state = 'protocol'; continue; }
  if (!b.resolved)           { r.state = 'unread';   continue; }
  // Comments stripped: a comment describing a field the response does not carry
  // must not count as the field. This is the census equivalent of the regex that
  // matched `// _mounted.add(el);`.
  const decommented = b.text.split('\n').filter(l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*')).join('\n');
  const expanded = withHelpers(decommented);
  r.followed = expanded.followed.length;
  // Passthrough is decided on the ROUTE's own body, not on what its helpers
  // contain. A proxy route stamps nothing regardless of what relayFetch does
  // internally; that is precisely what makes it passthrough.
  if (PASSTHROUGH.test(decommented) && !AGE.test(decommented) && !SRC_F.test(decommented)) { r.state = 'passthrough'; continue; }
  const age = AGE.test(expanded.text), source = SRC_F.test(expanded.text);
  r.age = age; r.source = source;
  r.state = age && source ? 'both' : age ? 'age-only' : source ? 'source-only' : 'none';
}

// Dedupe: the same path can appear on several dispatch lines (method variants,
// a guard list plus the real handler). Keep the strongest state per path, so
// the census does not report a route as bare because a guard mentioned it.
const RANK = { both: 5, 'source-only': 4, 'age-only': 3, passthrough: 2, none: 1, unread: 0, protocol: -1 };
const byPath = new Map();
for (const r of routes) {
  const prev = byPath.get(r.path);
  if (!prev || RANK[r.state] > RANK[prev.state]) byPath.set(r.path, r);
}
const uniq = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));

// --explain <path>: show exactly what was read for one route. A census you
// cannot interrogate per-route is a number you have to take on faith, and the
// first version of this script earned no faith.
const explainIdx = process.argv.indexOf('--explain');
if (explainIdx > -1) {
  const target = process.argv[explainIdx + 1];
  const hits = routes.filter(r => r.path === target);
  if (!hits.length) { console.log(`no dispatch line for ${target}`); process.exit(1); }
  for (const r of hits) {
    const b = bodyOf(r.line);
    const e = withHelpers(b.text);
    console.log(`\n  ${target}  line ${r.line}  via=${b.via}  resolved=${b.resolved}`);
    console.log(`  body lines: ${b.text.split('\n').length}`);
    console.log(`  helpers followed (${e.followed.length}): ${e.followed.join(', ') || '(none)'}`);
    console.log(`  AGE match:    ${(AGE.exec(e.text) || ['no'])[0]}`);
    console.log(`  SOURCE match: ${(SRC_F.exec(e.text) || ['no'])[0]}`);
    console.log(`  state: ${r.state}`);
  }
  process.exit(0);
}

const tally = {};
for (const r of uniq) tally[r.state] = (tally[r.state] || 0) + 1;

const dataSurfaces = uniq.filter(r => r.state !== 'protocol');
const selfDescribing = dataSurfaces.filter(r => r.state === 'both').length;
const pct = n => `${(100 * n / dataSurfaces.length).toFixed(1)}%`;

console.log(`\n  ${SRC}: ${routes.length} dispatch lines, ${uniq.length} distinct paths\n`);
console.log(`  ${dataSurfaces.length} data surfaces (protocol routes excluded)\n`);
const ORDER = ['both', 'source-only', 'age-only', 'none', 'passthrough', 'unread'];
const LABEL = {
  both:          'source AND age — a reader can judge it without the source',
  'source-only': 'says where, never when — cannot be judged stale',
  'age-only':    'says when, never where — a timestamp on an anonymous number',
  none:          'neither — a value with no visible origin',
  passthrough:   "someone else's bytes, unstamped by us",
  unread:        'this script could not find the handler — counted as unknown, not as fine',
};
for (const k of ORDER) if (tally[k]) console.log(`    ${String(tally[k]).padStart(3)}  ${pct(tally[k]).padStart(6)}  ${k.padEnd(12)} ${LABEL[k]}`);
if (tally.protocol) console.log(`    ${String(tally.protocol).padStart(3)}          protocol     OAuth/MCP transport — excluded, not a data surface`);

console.log(`\n  SELF-DESCRIBING: ${selfDescribing} of ${dataSurfaces.length} (${pct(selfDescribing)})\n`);

const out = { generated_at: new Date().toISOString(), file: SRC, method: 'static parse of the route table and each answering function; not a live probe',
  totals: { dispatch_lines: routes.length, distinct_paths: uniq.length, data_surfaces: dataSurfaces.length, self_describing: selfDescribing }, tally,
  self_tests: st,
  routes: uniq.map(({ path, match, line, method, via, state, age, source, followed }) => ({ path, match, line, method, via, state, age: !!age, source: !!source, helpers_followed: followed ?? 0 })) };
mkdirSync('outbox', { recursive: true });
writeFileSync('outbox/provenance-census-latest.json', JSON.stringify(out, null, 2));

// Append one row per run. The point of a baseline is the second reading: a
// single census says how bad it is, a series says whether anything is being
// done about it. Same-day re-runs replace rather than stack, so iterating on
// the instrument does not manufacture a trend.
const HIST = 'outbox/provenance-census-history.json';
let hist = [];
try { hist = JSON.parse(readFileSync(HIST, 'utf8')); } catch (_) { hist = []; }
const day = out.generated_at.slice(0, 10);
hist = hist.filter(h => h.date !== day);
hist.push({ date: day, ...out.totals, ...tally });
hist.sort((a, b) => a.date.localeCompare(b.date));
writeFileSync(HIST, JSON.stringify(hist, null, 2));
console.log(`  history:  ${HIST} (${hist.length} reading${hist.length === 1 ? '' : 's'})`);
console.log(`  written: outbox/provenance-census-latest.json`);
