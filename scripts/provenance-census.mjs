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

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';

const SRC = 'src/index.js';
const src = readFileSync(SRC, 'utf8');
const lines = src.split('\n');

// Helpers are not all in index.js. /health/sources -- the Stale Data Sentinel,
// which exists to report freshness and is therefore the LAST route that should
// read as having none -- delegates to checkAllSources in stale-data-sentinel.js
// via dynamic import. The third distinct way this script undercounted, after
// same-file delegation and ES6 shorthand. Every sibling module is searched.
const SIBLINGS = readdirSync('src').filter(f => f.endsWith('.js') && f !== 'index.js')
  .map(f => ({ file: `src/${f}`, lines: readFileSync(`src/${f}`, 'utf8').split('\n') }));
const ALL_FILES = [{ file: SRC, lines }, ...SIBLINGS];

// ── What counts as provenance ────────────────────────────────────────────────
// Two independent questions, kept separate on purpose. "When" without "where"
// is a timestamp on an anonymous number; "where" without "when" cannot be
// judged stale. A route needs both to be readable without reading the source.
//
// AND IT HAS TO MATCH SHORTHAND. The second version of this script still read
// /budget/odds as bare, with the helper correctly followed: oddsProviderQuota
// returns `{ ok: false, state, checked_at, note }` -- ES6 shorthand -- and the
// pattern demanded `checked_at:` with a colon. It matched nothing and reported
// that as absence. Same shape as the `_mounted.add(el)` assertion earlier this
// session that matched its own commented-out line: a pattern that cannot match
// the code it is aimed at, reporting a clean result.
//
// AND THE FOURTH VERSION WAS WRONG THE OTHER WAY. Accepting shorthand in any
// object-literal position matched `, source,` inside relayFetch's PARAMETER
// LIST -- relayFetch(url, headers, ttl, source, ctx) -- which reclassified all
// 23 proxy routes as self-describing. The self-test that was supposed to catch
// this used a LAST parameter (`, source)`, followed by a paren) and passed.
//
// So the rule is now semantic rather than positional: provenance counts only
// where a RESPONSE IS BUILT -- inside JSON.stringify(...) or a returned object
// literal. A parameter named source is not provenance no matter where it sits,
// and a field in the response is provenance no matter how it is written. This
// is the rule that should have been written first; the three positional
// versions before it were each a cheaper approximation of it that broke in a
// different direction (undercount, undercount, overcount).
const AGE_NAMES   = 'ts|timestamp|updated_at|updatedAt|checked_at|checkedAt|fetched_at|fetchedAt|generated_at|generatedAt|captured_at|capturedAt|created_at|createdAt|as_of|asOf|cached_at|cachedAt|age_seconds|ageSeconds|last_updated|lastUpdated|freshness';
const SRC_NAMES   = 'source|sources|provider|origin|via|dataSource|data_source|upstream|lambdaSource|feed|derivedFrom|computed_by';
const field = names => new RegExp(`\\b(?:${names})\\s*:|[{,]\\s*(?:${names})\\s*[,}]`);
const AGE_RE   = field(AGE_NAMES);
const SRC_RE   = field(SRC_NAMES);

// The regions of a body where a response is actually constructed. Everything
// outside them -- parameter lists, local variables, SQL, log calls -- cannot
// supply a response field, so it is not read.
function responseRegions(text) {
  const out = [];
  const starts = [];
  const RE_START = /JSON\.stringify\s*\(|return\s*\{/g;
  let m;
  while ((m = RE_START.exec(text)) !== null) starts.push(m.index + m[0].length - 1);
  for (const i of starts) {
    const open = text[i];
    const close = open === '(' ? ')' : '}';
    let depth = 0;
    for (let k = i; k < Math.min(i + 4000, text.length); k++) {
      const ch = text[k];
      if (ch === open) depth++;
      else if (ch === close) { depth--; if (depth === 0) { out.push(text.slice(i, k + 1)); break; } }
    }
  }
  return out.join('\n');
}
const AGE   = { test: t => AGE_RE.test(responseRegions(t)),  exec: t => AGE_RE.exec(responseRegions(t)) };
const SRC_F = { test: t => SRC_RE.test(responseRegions(t)),  exec: t => SRC_RE.exec(responseRegions(t)) };

// Routes that answer with someone else's bytes. Their provenance is the
// upstream's and the relay adds none -- a distinct state from "none", because
// the fix is different (wrap and stamp, vs add fields to our own response).
const PASSTHROUGH = /relayFetch\s*\(|proxyFetch\s*\(/;
// Not data surfaces. OAuth/MCP transport and redirects answer protocol, not
// values, and asking them for a data source is a category error.
const PROTOCOL = /^\/(\.well-known|oauth)\//;

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

// ── Extract the route table ──────────────────────────────────────────────────
const routes = [];
const RE = /pathname\s*(===|\.startsWith\()\s*'([^']+)'/g;
lines.forEach((line, i) => {
  if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(line)) !== null) {
    const method = (line.match(/request\.method\s*===\s*'(\w+)'/) || [])[1] || 'ANY';
    routes.push({ path: m[2], match: m[1] === '===' ? 'exact' : 'prefix', line: i + 1, method, guardOnly: !/^\s*if\s*\(/.test(line) && !line.includes('return') });
  }
});

// ── For each route, find the code that answers it ────────────────────────────
// Either a named handler (`return handleFoo(...)`) whose body we then read, or
// the inline block that follows.
function bodyOf(startLine) {
  // Delegation: `return someHandler(` on the dispatch line or the next few.
  for (let j = startLine - 1; j < Math.min(startLine + 3, lines.length); j++) {
    const d = lines[j].match(/return\s+(\w+)\s*\(/);
    if (d && /^(handle|build|run|get|serve)/i.test(d[1])) {
      const fnLine = lines.findIndex(l => new RegExp(`^(export\\s+)?(async\\s+)?function\\s+${d[1]}\\b`).test(l));
      if (fnLine >= 0) {
        let end = lines.length;
        for (let k = fnLine + 1; k < lines.length; k++) {
          if (/^(export\s+)?(async\s+)?function\s/.test(lines[k])) { end = k; break; }
        }
        return { text: lines.slice(fnLine, end).join('\n'), via: d[1], resolved: true };
      }
      return { text: '', via: d[1], resolved: false };
    }
  }
  // Inline: brace-balance from the dispatch line.
  let depth = 0, started = false, end = startLine;
  for (let k = startLine - 1; k < Math.min(startLine + 400, lines.length); k++) {
    for (const ch of lines[k]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth <= 0) { end = k + 1; break; }
  }
  return { text: lines.slice(startLine - 1, end).join('\n'), via: 'inline', resolved: true };
}

// Body of a named top-level function, or '' when it is not one (imported,
// arrow-assigned, or a method). Cached -- peek helpers are called from many
// routes and the file is 19k lines.
const fnCache = new Map();
function functionBody(name) {
  if (fnCache.has(name)) return fnCache.get(name);
  const decl = new RegExp(`^(export\\s+)?(async\\s+)?function\\s+${name}\\b`);
  let text = '';
  for (const f of ALL_FILES) {
    const start = f.lines.findIndex(l => decl.test(l));
    if (start < 0) continue;
    let end = f.lines.length;
    for (let k = start + 1; k < f.lines.length; k++) {
      if (/^(export\s+)?(async\s+)?function\s/.test(f.lines[k])) { end = k; break; }
    }
    text = f.lines.slice(start, end).join('\n');
    break;
  }
  fnCache.set(name, text);
  return text;
}

// The route body plus the bodies of the helpers it actually calls, one level.
// Without this, delegation reads as absence.
const CALL = /\b([a-z_$][\w$]*)\s*\(/g;
// `const { checkAllSources } = await import('./stale-data-sentinel.js');`
// names its helper in a destructuring, not a call. Caught explicitly.
const DESTRUCTURED_IMPORT = /const\s*\{([^}]+)\}\s*=\s*await\s+import\(/g;
const NOT_A_HELPER = /^(if|for|while|switch|catch|return|typeof|await|new|function|parseInt|parseFloat|String|Number|Boolean|Array|Object|JSON|Math|Date|Promise|fetch|console|require|import|map|filter|find|reduce|forEach|push|slice|split|join|replace|match|test|includes|startsWith|endsWith|trim|toFixed|toString|keys|values|entries|stringify|parse|all|allSettled|resolve|reject|then|bind|prepare|get|put|set|has|add)$/;
function withHelpers(text) {
  const seen = new Set();
  let m; CALL.lastIndex = 0;
  while ((m = CALL.exec(text)) !== null) {
    const n = m[1];
    if (NOT_A_HELPER.test(n) || seen.has(n)) continue;
    seen.add(n);
  }
  DESTRUCTURED_IMPORT.lastIndex = 0;
  while ((m = DESTRUCTURED_IMPORT.exec(text)) !== null) {
    for (const n of m[1].split(',').map(x => x.trim().split(/\s+as\s+/).pop().trim())) {
      if (n && !NOT_A_HELPER.test(n)) seen.add(n);
    }
  }
  let out = text;
  const followed = [];
  for (const n of seen) {
    const b = functionBody(n);
    if (b) {
      out += '\n' + b.split('\n').filter(l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*')).join('\n');
      followed.push(n);
    }
  }
  return { text: out, followed };
}

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
console.log(`  written: outbox/provenance-census-latest.json`);
