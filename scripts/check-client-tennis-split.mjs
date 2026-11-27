#!/usr/bin/env node
// Self-tests and mutations for scripts/lib/client-tennis-split.cjs and for the exit rule and artifact of
// scripts/tennis-tier-ladders.mjs.
//
// Rule 90: every assertion below has been made to fail on purpose. What this guards is a loader that reads the
// client's decision out of a page and a replay that judges it against the relay, and its dangerous failures are not
// crashes. They are a loader that extracts the wrong function and answers for a client nobody runs, and a replay that
// checks nothing, or cannot see, and reports no drift. So the mutations aim at exactly those: the current client as a
// fixture (the control that proves the replay can SEE the defect), a picker that always answers null, a predicate that
// is always true, a round name dropped or mistyped in the client's vocabulary, a missing anchor, an empty card, a
// trailing window nobody could read. Lib and detector mutants are applied to a copy of the real file, each anchor
// asserted unique, and the scenario the real file fails must pass on the mutant.
//
// Rule 91: coverage is printed with the result. This checks the loader and the replay against FIXTURES and a fake
// relay. It does NOT reach jubilant-bassoon or the relay over the network; the real reads run inside
// tennis-tier-ladders.mjs on a runner, where a refusal, a pin that does not reproduce, an unread day and a run with
// zero checks all exit 1.

import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB_PATH = path.join(HERE, 'lib', 'client-tennis-split.cjs');
const lib = require(LIB_PATH);
const { loadClient, readClient, runReplay, candidatesOf, makeSandbox, sandboxLeaks, ANCHORS, PINNED_DAYS,
        CLIENT_DEPLOYED_URL, CLIENT_SOURCE_URL } = lib;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
  `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
// A section that throws is a FAILED section, not an aborted run: the cases after it still report.
async function section(title, fn) {
  console.log(`\n${title}`);
  try { await fn(); } catch (e) {
    fail++; console.log(`  FAIL the section threw — ${String(e && e.stack ? e.stack : e).split('\n').slice(0, 3).join(' | ')}`);
  }
}

// A mutation that is not applied, or applied somewhere other than where it was aimed, would leave the test passing
// on clean input. So the anchor must occur exactly once, and the result must differ.
function mutate(text, find, replacement, label) {
  const n = text.split(find).length - 1;
  if (n !== 1) throw new Error(`mutation ${label}: anchor occurs ${n} times, not once: ${find.slice(0, 70)}`);
  const out = text.replace(find, () => replacement);
  if (out === text) throw new Error(`mutation ${label}: not applied`);
  return out;
}

// The library with one edit, loaded as a module of its own. Scenarios are run against the real library and against
// the mutant; the mutant must give the answer the real one is asserted NOT to give.
const LIB_SRC = fs.readFileSync(LIB_PATH, 'utf8');
function libMutant(label, find, replacement) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-libmut-'));
  const file = path.join(dir, 'lib.cjs');
  try { fs.writeFileSync(file, mutate(LIB_SRC, find, replacement, label)); return require(file); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const load = (name, text, where = 'fixture', opts) => {
  try { const c = loadClient(text, where, opts); pass++; console.log(`  ok   ${name}`); return c; }
  catch (e) { fail++; console.log(`  FAIL ${name} — threw: ${e.message}`); return null; }
};
const refuses = (name, text, needle, opts) => {
  let msg = null;
  try { loadClient(text, 'fixture', opts); } catch (e) { msg = e.message; }
  if (msg === null) { fail++; console.log(`  FAIL ${name} — did not throw`); return; }
  if (needle && !msg.includes(needle)) { fail++; console.log(`  FAIL ${name} — threw, but not about ${needle}: ${msg}`); return; }
  pass++; console.log(`  ok   ${name}`);
};

// ── the relay's round vocabulary, as a FIXTURE, and where it is guarded ──────────
// The relay's own list is `const ORDER = [...]` in src/index.js (the draw route). This copy exists so the fake relay
// and the fixed-client fixture below can speak it. The replay itself holds NO copy of it: it reads the vocabulary out of
// the relay's draw payload. A fixture copy that drifted from the relay would make every assertion below true of a
// vocabulary nothing serves, so it is compared with the relay's own source on every run.
const LADDER = ['Round of 128', 'Round of 64', 'Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Final'];
{
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'index.js'), 'latin1');
  const decls = [...src.matchAll(/const ORDER = \[([^\]]*)\];/g)];
  console.log('FIXTURE GUARD — the fixture\'s round vocabulary is the relay\'s, read from src/index.js:');
  ok('src/index.js declares exactly one `const ORDER = [...]`', decls.length === 1, String(decls.length));
  eq('the fixture ladder is the relay\'s ORDER', decls.length === 1 ? [...decls[0][1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : null, LADDER);
}

// ── the client, as a fixture ──────────────────────────────────────────────────
// CURRENT_DEPLOYED is the real shape: the tennis declarations of jubilant-bassoon origin/main 1606d7af after
// scripts/build-bundle.mjs and scripts/strip-comments.js (esbuild turns const into var, normalizes quotes to double
// and leaves /* @__PURE__ */ markers), copied 2026-11-26, with unrelated code between them so extraction is tested
// against noise rather than against a file that holds only what it looks for.
const CURRENT_DEPLOYED = `<!DOCTYPE html><html><body><script type="module">
// GENERATED BY build-bundle.mjs — edit src/legacy/field.js, not this block
function renderSomethingElse() {
  return "}" + ";";
}
var TENNIS_TIERS = /* @__PURE__ */ new Set([
  "grand_slam",
  "masters_1000",
  "atp_1000",
  "wta_1000",
  "atp_500",
  "wta_500",
  "atp_250",
  "wta_250"
]);
var TENNIS_NAMED = /^(ATP Finals|WTA Finals|Next Gen Finals|United Cup|Davis Cup|Billie Jean King Cup( Group I)?)$/;
window._fieldTennisDiag = { ran: false };
function _tennisTierAllowed(m) {
  const cat = m?.tournament?.category;
  if (cat && TENNIS_TIERS.has(cat)) return true;
  return TENNIS_NAMED.test(m?.tournament?.name || "");
}
async function fetchTennisLive() {
  const rows = [];
  return rows.filter(_tennisTierAllowed);
}
var _TENNIS_DRAW_TIER_RANK = {
  grand_slam: 0,
  masters_1000: 1,
  atp_1000: 1,
  wta_1000: 1,
  atp_500: 2,
  wta_500: 2,
  atp_250: 3,
  wta_250: 3
};
var _TENNIS_DRAW_NAMED_RANK = {
  "ATP Finals": 1,
  "WTA Finals": 1,
  "Next Gen Finals": 2,
  "United Cup": 2,
  "Billie Jean King Cup": 2
};
var _TENNIS_DRAW_NO_BRACKET = /^(Davis Cup|Billie Jean King Cup Group I)$/;
function _tennisDrawPick(rows) {
  const seen = /* @__PURE__ */ new Map();
  for (const m of rows || []) {
    const t = m?.tournament;
    if (!t?.id || !_tennisTierAllowed(m)) continue;
    if (m?.is_doubles) continue;
    if (/Doubles|Boys|Girls|Wheelchair|Quad/i.test(t.name || "")) continue;
    if (_TENNIS_DRAW_NO_BRACKET.test(t.name || "")) continue;
    const rank = _TENNIS_DRAW_TIER_RANK[t.category] ?? _TENNIS_DRAW_NAMED_RANK[t.name || ""];
    if (rank == null) continue;
    const prev = seen.get(t.id);
    if (!prev) seen.set(t.id, { id: t.id, name: t.name, category: t.category, rank, count: 1 });
    else prev.count++;
  }
  return [...seen.values()].sort((a, b) => a.rank - b.rank || b.count - a.count)[0] || null;
}
async function fetchTennisDraw() {
  const pick = _tennisDrawPick([]);
  return { pick };
}
</script></body></html>`;

// The same declarations in SOURCE shape: const, single quotes, and the kind of comment the real field.js carries —
// one with a semicolon and a closing brace in it, one quoting an identifier, which a text scan must not mistake for
// a reference. Comments abbreviated; the declarations are the real ones.
const CURRENT_SOURCE = `
const TENNIS_TIERS = new Set([
  'grand_slam', 'masters_1000', 'atp_1000', 'wta_1000',
  'atp_500', 'wta_500', 'atp_250', 'wta_250',
]);
const TENNIS_NAMED = /^(ATP Finals|WTA Finals|Next Gen Finals|United Cup|Davis Cup|Billie Jean King Cup( Group I)?)$/;
/// True when a BSD tennis match belongs to a competition FIELD shows.
function _tennisTierAllowed(m){
  const cat = m?.tournament?.category;
  if (cat && TENNIS_TIERS.has(cat)) return true;
  return TENNIS_NAMED.test(m?.tournament?.name || '');
}
const _TENNIS_DRAW_TIER_RANK = {
  grand_slam: 0, masters_1000: 1, atp_1000: 1, wta_1000: 1,
  atp_500: 2, wta_500: 2, atp_250: 3, wta_250: 3,
};
const _TENNIS_DRAW_NAMED_RANK = {
  'ATP Finals': 1, 'WTA Finals': 1, 'Next Gen Finals': 2, 'United Cup': 2,
  // Rank 2 is the United Cup's; dropping it from the regex below is NOT enough on its own } because
  // category \`other\` has no tier rank, so rank == null would still skip it. _TENNIS_DRAW_NO_BRACKET names the rest.
  'Billie Jean King Cup': 2,
};
// Named so the exclusion is a decision on the page rather than a gap in the table above; this line is what changes.
const _TENNIS_DRAW_NO_BRACKET = /^(Davis Cup|Billie Jean King Cup Group I)$/;
function _tennisDrawPick(rows){
  const seen = new Map();
  for (const m of rows || []) {
    const t = m?.tournament;
    if (!t?.id || !_tennisTierAllowed(m)) continue;
    // Only the singles draws are offered here; a doubles bracket is a different shape.
    if (m?.is_doubles) continue;
    if (/Doubles|Boys|Girls|Wheelchair|Quad/i.test(t.name || '')) continue;
    if (_TENNIS_DRAW_NO_BRACKET.test(t.name || '')) continue;
    const rank = _TENNIS_DRAW_TIER_RANK[t.category] ?? _TENNIS_DRAW_NAMED_RANK[t.name || ''];
    if (rank == null) continue;
    const prev = seen.get(t.id);
    if (!prev) seen.set(t.id, { id: t.id, name: t.name, category: t.category, rank, count: 1 });
    else prev.count++;
  }
  return [...seen.values()].sort((a, b) => a.rank - b.rank || b.count - a.count)[0] || null;
}
`;

// The FIXED client, built by three asserted replacements over the current text (the interface agreed for the client
// fix): the main-draw predicate and its round set, the picker skipping rows that fail it with
// _TENNIS_DRAW_NO_BRACKET deleted, and named events rankable by default.
const roundsLiteral = (names, q) => `new Set([${names.map((r) => q + r + q).join(', ')}])`;
function fix(text, quote) {
  const q = quote;
  let t = text;
  const decl = /(?:var|const) _TENNIS_DRAW_NO_BRACKET = [^\n]*\n/.exec(t);
  if (decl === null) throw new Error('fix: the exclusion list is not in the text it was asked to fix');
  t = mutate(t, decl[0], '', 'fix:delete NO_BRACKET');
  t = mutate(t, 'function _tennisDrawPick(rows)',
    `const _TENNIS_MAIN_DRAW_ROUNDS = ${roundsLiteral(LADDER, q)};\n`
    + `function _tennisRowInMainDraw(m) { return _TENNIS_MAIN_DRAW_ROUNDS.has(String(m?.round_name)) && String(m?.status) !== ${q}cancelled${q}; }\n`
    + 'function _tennisDrawPick(rows)', 'fix:predicate');
  t = mutate(t, `if (_TENNIS_DRAW_NO_BRACKET.test(t.name || ${q}${q})) continue;`,
             'if (!_tennisRowInMainDraw(m)) continue;', 'fix:skip');
  t = mutate(t, `const rank = _TENNIS_DRAW_TIER_RANK[t.category] ?? _TENNIS_DRAW_NAMED_RANK[t.name || ${q}${q}];`,
    `const rank = _TENNIS_DRAW_TIER_RANK[t.category] ?? (TENNIS_NAMED.test(t.name || ${q}${q}) ? (_TENNIS_DRAW_NAMED_RANK[t.name] ?? 2) : null);`,
    'fix:rank');
  return t;
}
const FIXED_DEPLOYED = fix(CURRENT_DEPLOYED, '"');
const FIXED_SOURCE = fix(CURRENT_SOURCE, "'");
// The fixed client with a different round vocabulary, or a different predicate. The anchor is the exact literal the
// fixed text carries, asserted unique by mutate().
const withRounds = (text, quote, names, label) => mutate(text, `_TENNIS_MAIN_DRAW_ROUNDS = ${roundsLiteral(LADDER, quote)};`,
  `_TENNIS_MAIN_DRAW_ROUNDS = ${roundsLiteral(names, quote)};`, label);
const PREDICATE_LINE = /function _tennisRowInMainDraw[^\n]*\n/;

// ── rows ──────────────────────────────────────────────────────────────────────
const T = (id, name, category) => ({ id, name, category, circuit: 'x' });
const row = (t, extra = {}) => ({ id: 1, tournament: t, is_doubles: false, round_name: '', status: 'scheduled',
                                  match_date: '2026-11-26T12:00:00+00:00', ...extra });

console.log('\nSANDBOX — nothing from this process is reachable, and the check that says so can fail:');
{
  eq('a fresh sandbox leaks nothing', sandboxLeaks(makeSandbox()), []);
  const leaky = vm.createContext({ process, require });
  ok('the same check names a sandbox that was handed the process (the assertion can fail)',
     sandboxLeaks(leaky).length >= 2, JSON.stringify(sandboxLeaks(leaky)));
  let evalMsg = null;
  try { vm.runInContext('eval("1+1")', makeSandbox()); } catch (e) { evalMsg = e.message; }
  ok('eval from a string is refused inside it', evalMsg !== null && /code generation|eval/i.test(evalMsg), String(evalMsg));
  let loopMsg = null;
  try { vm.runInContext('for(;;){}', makeSandbox(), { timeout: 100 }); } catch (e) { loopMsg = e.message; }
  ok('a loop is stopped by the time limit', loopMsg !== null && /timed out/i.test(loopMsg), String(loopMsg));
}

console.log('\nLOADER — the real current shapes load, and the optional anchors are reported as absent:');
const curDep = load('the current DEPLOYED shape (esbuild output) loads', CURRENT_DEPLOYED, 'cur-dep');
const curSrc = load('the current SOURCE shape (comments with ; and }) loads', CURRENT_SOURCE, 'cur-src');
const fixDep = load('the FIXED deployed shape loads', FIXED_DEPLOYED, 'fix-dep');
const fixSrc = load('the FIXED source shape loads', FIXED_SOURCE, 'fix-src');
ok('current: the exclusion list is present and the predicate is absent',
   curDep.anchorsPresent.includes('_TENNIS_DRAW_NO_BRACKET')
   && curDep.anchorsAbsent.join() === '_TENNIS_MAIN_DRAW_ROUNDS,_tennisRowInMainDraw', JSON.stringify(curDep.anchorsAbsent));
ok('fixed: the predicate and its round set are present and the exclusion list is absent',
   fixDep.anchorsPresent.includes('_tennisRowInMainDraw') && fixDep.anchorsPresent.includes('_TENNIS_MAIN_DRAW_ROUNDS')
   && fixDep.anchorsAbsent.join() === '_TENNIS_DRAW_NO_BRACKET', JSON.stringify(fixDep.anchorsAbsent));
ok('a comment that quotes an identifier is not a declaration', curSrc.anchorsPresent.length === 7, JSON.stringify(curSrc.anchorsPresent));
ok('the required anchors are the six the picker cannot run without',
   ANCHORS.filter((a) => a.required).map((a) => a.name).join() ===
   'TENNIS_TIERS,TENNIS_NAMED,_TENNIS_DRAW_TIER_RANK,_TENNIS_DRAW_NAMED_RANK,_tennisTierAllowed,_tennisDrawPick');

// The 11 designed cases, named inline: the FIXED shape must make every one come out as designed and the CURRENT shape
// must fail exactly the six that were measured against the real client (A1, A2, B, E, G, H). That ties these fixtures
// to a finding about the real client instead of to this file's own reading of it.
console.log('\nBEHAVIOUR — the 11 designed cases, executed through the loader:');
const CASES = [
  ['A1 WTA Finals round-robin rows only (blank round_name)', [row(T(204, 'WTA Finals', 'other')), row(T(204, 'WTA Finals', 'other'))], null],
  ['A2 round-robin rows + a wta_250 playing Round of 32', [row(T(204, 'WTA Finals', 'other')), row(T(77, 'Some WTA 250', 'wta_250'), { round_name: 'Round of 32' })], 77],
  ['A3 ATP Finals semifinal day', [row(T(209, 'ATP Finals', 'other'), { round_name: 'Semifinals' })], 209],
  ['B  Davis Cup quarterfinal day', [row(T(446, 'Davis Cup', 'other'), { round_name: 'Quarterfinals' })], 446],
  ['B2 Davis Cup qualification rows', [row(T(446, 'Davis Cup', 'other'), { round_name: 'Qualification Round 1' }), row(T(446, 'Davis Cup', 'other'))], null],
  ['D  BJK Cup Group I rubbers, no list needed', [row(T(508, 'Billie Jean King Cup Group I', 'other'))], null],
  ['E  slam qualifying week', [row(T(14, 'Australian Open', 'grand_slam'), { round_name: 'Qualification Round 1' })], null],
  ['F  slam main-draw day', [row(T(14, 'Australian Open', 'grand_slam'), { round_name: 'Round of 128' })], 14],
  ['G  cancelled-only main-draw row', [row(T(77, 'Some WTA 250', 'wta_250'), { round_name: 'Round of 32', status: 'cancelled' })], null],
  ['H  United Cup group day + ATP 250 Round of 32 same day', [row(T(391, 'United Cup', 'other')), row(T(88, 'Brisbane', 'atp_250'), { round_name: 'Round of 32' })], 88],
  ['I  United Cup QF day + ATP 250 Round of 32 same day (rank 2 beats 3)', [row(T(391, 'United Cup', 'other'), { round_name: 'Quarterfinals' }), row(T(88, 'Brisbane', 'atp_250'), { round_name: 'Round of 32' })], 391],
];
const wrong = (c) => CASES.filter(([, rows, want]) => { const p = c.pick(rows); return (p ? p.id : null) !== want; }).map(([l]) => l.slice(0, 2).trim());
eq('fixed deployed shape: 0 of 11 wrong', wrong(fixDep), []);
eq('fixed source shape: 0 of 11 wrong', wrong(fixSrc), []);
eq('current deployed shape: exactly the six that were measured', wrong(curDep), ['A1', 'A2', 'B', 'E', 'G', 'H']);
eq('current source shape: the same six', wrong(curSrc), ['A1', 'A2', 'B', 'E', 'G', 'H']);
eq('the candidate set is the client\'s own predicate, singles only',
   [...candidatesOf(fixDep, [row(T(14, 'Australian Open', 'grand_slam')), row(T(15, 'Australian Open, Boys', 'grand_slam')),
     row(T(16, 'Australian Open', 'grand_slam'), { is_doubles: true }), row(T(17, 'Some UTR', 'utr'))]).keys()], [14]);

console.log('\nMUTATIONS OF THE TEXT — a client this loader cannot read refuses, it never reports no drift:');
for (const [label, text] of [['deployed', FIXED_DEPLOYED], ['source', FIXED_SOURCE]]) {
  for (const a of ANCHORS.filter((x) => x.required)) {
    const re = a.kind === 'function' ? `function ${a.name}(` : `${a.name} =`;
    const mutated = mutate(text, re, a.kind === 'function' ? `function ${a.name}X(` : `${a.name}X =`, `rename ${a.name}`);
    refuses(`M-missing ${label}: ${a.name} renamed`, mutated, `required anchor ${a.kind} ${a.name} not found`);
  }
}
refuses('M-missing: an empty string', '', 'nothing to read');
refuses('M-missing: not a string', null, 'nothing to read');
refuses('M-missing: an error page that answered HTTP 200', '<html>404 Not Found</html>', 'required anchor');
refuses('M-ambiguous: the page carries two copies of the picker', CURRENT_DEPLOYED + CURRENT_DEPLOYED, 'declared 2 times');
refuses('M-reference: the predicate deleted while the picker still calls it',
  mutate(FIXED_DEPLOYED, PREDICATE_LINE.exec(FIXED_DEPLOYED)[0], '', 'delete predicate'),
  '_tennisRowInMainDraw');
refuses('M-reference: its round set deleted while the predicate still reads it',
  mutate(FIXED_SOURCE, /const _TENNIS_MAIN_DRAW_ROUNDS = [^\n]*\n/.exec(FIXED_SOURCE)[0], '', 'delete rounds'),
  '_TENNIS_MAIN_DRAW_ROUNDS');
refuses('M-reference: the exclusion list deleted while the picker still tests it',
  mutate(CURRENT_DEPLOYED, /var _TENNIS_DRAW_NO_BRACKET = [^\n]*\n/.exec(CURRENT_DEPLOYED)[0], '', 'delete NO_BRACKET'),
  '_TENNIS_DRAW_NO_BRACKET');
// On a branch the load-time controls never execute (they run grand_slam and utr rows, never `other`), so ONLY the text
// scan can see this one. With the scan removed the extracted program loads and answers for a client with a hole in it.
refuses('M-reference: a new helper the loader does not know, called on a path the controls do not run',
  mutate(FIXED_DEPLOYED, 'if (!_tennisRowInMainDraw(m)) continue;',
         'if (!_tennisRowInMainDraw(m)) continue;\n    if (t.category === "other" && _tennisSomethingNew(m)) continue;', 'new helper'),
  '_tennisSomethingNew');
refuses('M-reference: the same, in a comment-free source shape',
  mutate(FIXED_SOURCE, 'if (!_tennisRowInMainDraw(m)) continue;',
         "if (!_tennisRowInMainDraw(m)) continue;\n    if (t.category === 'other' && _TENNIS_UNKNOWN_SET.has(t.id)) continue;", 'new const'),
  '_TENNIS_UNKNOWN_SET');
refuses('M-incomplete: the text ends inside the picker', FIXED_DEPLOYED.slice(0, FIXED_DEPLOYED.indexOf('const prev = seen.get(t.id);')),
  'no syntactically complete form');
const PICK_RETURN = 'return [...seen.values()].sort((a, b) => a.rank - b.rank || b.count - a.count)[0] || null;';
refuses('M-garbage: a picker that returns undefined', mutate(CURRENT_DEPLOYED, PICK_RETURN, 'return undefined;', 'undefined'),
  'not null or a tournament');
refuses('M-garbage: a picker that returns a number', mutate(CURRENT_DEPLOYED, PICK_RETURN, 'return 7;', 'number'),
  'neither null nor a tournament');
refuses('M-garbage: a picker that throws', mutate(CURRENT_DEPLOYED, PICK_RETURN, 'throw new Error("boom");', 'throw'),
  'threw');
refuses('M-garbage: and the refusal names the function that threw, not JSON.stringify',
  mutate(CURRENT_DEPLOYED, PICK_RETURN, 'throw new Error("boom");', 'throw'), '_tennisDrawPick threw');
refuses('M-garbage: a picker that never returns',
  mutate(CURRENT_DEPLOYED, 'const seen = /* @__PURE__ */ new Map();', 'const seen = /* @__PURE__ */ new Map(); for (;;) {}', 'loop'),
  'timed out', { timeoutMs: 200 });
refuses('M-control: a predicate that admits every row',
  mutate(CURRENT_DEPLOYED, 'return TENNIS_NAMED.test(m?.tournament?.name || "");', 'return true;', 'always true tier'),
  'control failed');
refuses('M-control: a picker that stopped excluding doubles',
  mutate(CURRENT_DEPLOYED, '    if (m?.is_doubles) continue;\n', '', 'doubles'),
  'control failed');
refuses('M-control: a picker that offers a utr row (the control that names it, not the tier-filter one)',
  mutate(mutate(FIXED_DEPLOYED, 'if (!t?.id || !_tennisTierAllowed(m)) continue;', 'if (!t?.id) continue;', 'utr picker'),
         '  atp_250: 3,', '  atp_250: 3,\n  utr: 3,', 'utr rank'),
  'a utr row was offered');
{
  // A const that reads another at initialisation, declared AFTER it in the page but BEFORE it in the loader's anchor
  // list: the declarations must run in the page's order or this loads as a ReferenceError.
  const block = /var _TENNIS_DRAW_TIER_RANK = \{[\s\S]*?\};\n/.exec(FIXED_DEPLOYED)[0];
  const tiers = /var TENNIS_TIERS = [\s\S]*?\]\);\n/.exec(FIXED_DEPLOYED)[0];
  const reordered = mutate(mutate(FIXED_DEPLOYED, block, '', 'order 1'), tiers, `${block}var TENNIS_TIERS = new Set(Object.keys(_TENNIS_DRAW_TIER_RANK));\n`, 'order 2');
  const c = load('M-order: a const that reads one declared earlier in the page loads (the declarations run in the page\'s order)', reordered, 'reordered');
  eq('M-order: and decides like the fixed client on the 11 cases', c ? wrong(c) : null, []);
}
refuses('M-const: a declaration that does not evaluate',
  mutate(CURRENT_DEPLOYED, 'var TENNIS_NAMED = /^(ATP Finals|WTA Finals|Next Gen Finals|United Cup|Davis Cup|Billie Jean King Cup( Group I)?)$/;',
         'var TENNIS_NAMED = notDefinedAnywhere.x;', 'bad const'),
  'did not evaluate');
{
  // The call label is what a reader sees when the replay hits a row the picker cannot take: the function, not the wrapper.
  const throwsOn = (fn, text) => { const c = loadClient(text, 'fixture'); try { fn(c); } catch (e) { return e.message; } return null; };
  const pickerThrows = mutate(FIXED_DEPLOYED, 'if (!t?.id || !_tennisTierAllowed(m)) continue;',
    'if (!t?.id || !_tennisTierAllowed(m)) continue;\n    if (t.category === "other") throw new Error("boom on a named-event row");', 'throw on other');
  const m1 = throwsOn((c) => c.pick([row(T(446, 'Davis Cup', 'other'), { round_name: 'Quarterfinals' })]), pickerThrows);
  ok('a picker that throws on a replayed row: the message names _tennisDrawPick', m1 !== null && m1.includes('_tennisDrawPick threw') && !m1.includes('JSON.stringify'), String(m1));
  const allowedThrows = mutate(FIXED_DEPLOYED, 'const cat = m?.tournament?.category;', 'const cat = m?.tournament?.category;\n  if (cat === "other") throw new Error("boom in the tier filter");', 'throw in allowed');
  const m2 = throwsOn((c) => c.allowed([row(T(446, 'Davis Cup', 'other'))]), allowedThrows);
  ok('a tier filter that throws on a replayed row: the message names _tennisTierAllowed', m2 !== null && m2.includes('_tennisTierAllowed threw'), String(m2));
}

// ── a hostile page: promise jobs and dynamic import() ─────────────────────────
// Each case runs the loader in a CHILD PROCESS, because the failure under test is the host process dying or hanging:
//   an extracted declaration that queues a promise job which never ends ran outside the vm time limit (the host hung
//   at the next await), and a dynamic import() in one crashed the host (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING). A
//   child with a time limit turns both into a FAIL line here instead of a hung or dead self-test.
// vm.Script's importModuleDynamically callback was tried for the import case and does not help on Node 22: without
// --experimental-vm-modules the import still rejects as an unhandled rejection in the host. The loader therefore
// REFUSES a declaration that mentions import(), a promise or async code, which the replay (synchronous by
// construction) has no use for; a computed promise constructor (nothing in the text for the refusal to see) is
// stopped by the time limit instead, which now covers promise jobs (microtaskMode afterEvaluate).
await section('HOSTILE PAGE — a page that queues promise jobs or imports must refuse, not hang or crash the host:', async () => {
  const CHILD = `
const lib = require(process.argv[2]);
const text = require('node:fs').readFileSync(process.argv[3], 'utf8');
let r;
try { lib.loadClient(text, 'hostile'); r = { loaded: true }; } catch (e) { r = { loaded: false, message: e.message }; }
// A macrotask boundary: an unhandled rejection or a promise job left running by the page would crash or block before this.
setTimeout(() => { console.log(JSON.stringify(r)); }, 100);
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-hostile-'));
  try {
    fs.writeFileSync(path.join(dir, 'child.cjs'), CHILD);
    const named = 'var TENNIS_NAMED = /^(ATP Finals|WTA Finals|Next Gen Finals|United Cup|Davis Cup|Billie Jean King Cup( Group I)?)$/;';
    const hostile = (body) => mutate(CURRENT_DEPLOYED, named, `var TENNIS_NAMED = (function () { ${body} return /^(Davis Cup)$/; })();`, 'hostile');
    const run = (label, text) => {
      fs.writeFileSync(path.join(dir, `${label}.html`), text);
      const r = spawnSync(process.execPath, [path.join(dir, 'child.cjs'), LIB_PATH, path.join(dir, `${label}.html`)],
        { encoding: 'utf8', timeout: 20000 });
      let out = null; try { out = JSON.parse(r.stdout); } catch (_e) { /* a crash or a hang prints nothing */ }
      return { out, status: r.status, signal: r.signal, tail: (r.stderr || '').split('\n').filter(Boolean).slice(0, 3).join(' | ') };
    };
    const refusedAbout = (label, text, needle) => {
      const r = run(label, text);
      ok(`${label}: the host survives and the loader refuses, naming ${needle}`,
         r.status === 0 && r.out !== null && r.out.loaded === false && r.out.message.includes(needle),
         `exit ${r.status} signal ${r.signal} out ${JSON.stringify(r.out)} ${r.tail}`);
    };
    refusedAbout('H1 import() in a declaration', hostile('import("node:fs").then(function () {});'), 'import');
    refusedAbout('H2 a promise job that never ends (named)', hostile('Promise.resolve().then(function () { for (;;) {} });'), 'Promise');
    refusedAbout('H3 an async function', hostile('(async function () { throw new Error("a"); })();'), 'async');
    // Nothing in the text for a scan to see: the constructor is looked up by a computed name. Only the time limit can stop it.
    refusedAbout('H4 a promise job that never ends, constructor named by concatenation (no text to refuse)',
      hostile('var P = globalThis["Prom" + "ise"]; P.resolve().then(function () { for (;;) {} });'), 'timed out');
    const clean = run('H0 the clean page', CURRENT_DEPLOYED);
    ok('H0 the same child loads the clean page (the harness itself can say "loaded")', clean.status === 0 && clean.out && clean.out.loaded === true,
       JSON.stringify(clean));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── a fake relay, built from what the relay was read to serve ─────────────────
// Dates are the real ones: the Davis Cup nodes from /bsd/tennis/draw?tournament=446&season=2026, the ATP Finals from 209,
// the US Open men's from 135, all read 2026-11-26 through probe_relay_route, and the payload SHAPE is the one that
// read showed: `tournament`, `complete`, `rounds[{round,index,...}]`, `roundsOutsideMainDraw`, `nodes[]`. The round
// names and counts outside the main draw are the real ones too (135: three qualifying names; 209: blank x12; 446:
// blank x339 plus two qualifying names). The cards are synthetic rows of the shape the by-date route serves
// (tournament{id,name,category}, is_doubles, round_name, status, match_date).
const DAVIS = T(446, 'Davis Cup', 'other'), ATPF = T(209, 'ATP Finals', 'other');
const USM = T(135, 'US Open, Men', 'grand_slam'), USW = T(136, 'US Open, Women', 'grand_slam');
const USB = T(137, 'US Open, Boys', 'grand_slam'), UTR = T(380, 'UTR PTT Saitama Men 05', 'utr');
const CHALL = T(898, 'Yokohama, Japan', 'challenger');
const TOURS = { 446: DAVIS, 209: ATPF, 135: USM, 136: USW };
const on = (d, extra = {}) => ({ match_date: `${d}T12:00:00+00:00`, ...extra });
const at = (round, ...dates) => dates.map((date) => ({ round, date }));
const QUAL = { 'Qualification Final': 16, 'Qualification Round 2': 32, 'Qualification Round 1': 66 };

// ONE source for the payload builder: the in-process fake relay evaluates it, and the child-process preload below
// embeds it, so the two cannot describe different relays. It mirrors the relay's own construction of `rounds`
// (src/index.js, the draw route): present rounds in ladder order, the entry round and an open innermost round carry
// canonical null, `complete` is passed through.
const PAYLOAD_SRC = [
  'function buildDrawPayload(tour, season, spec) {',
  '  const LADDER = ' + JSON.stringify(LADDER) + ';',
  '  const nodes = spec.nodes.map((n, i) => Object.assign({ id: i, round: "Quarterfinals", status: "finished", isDoubles: false }, n));',
  '  const present = LADDER.filter((r) => nodes.some((n) => n.round === r));',
  '  const complete = spec.complete === true;',
  '  return {',
  '    tournament: tour, season: season, truncated: spec.truncated === true, complete: complete,',
  '    mainDrawMatches: nodes.length, roundsOutsideMainDraw: spec.outside ? spec.outside : {},',
  '    rounds: present.map((r, i) => { const index = LADDER.indexOf(r); const edge = i === 0 || (!complete && i === present.length - 1);',
  '      return { round: r, index: index, matches: nodes.filter((n) => n.round === r).length,',
  '               canonical: spec.badEdge && i === 0 ? 7 : edge ? null : 1 << (LADDER.length - 1 - index), entryRound: i === 0, openInnermostRound: !complete && i === present.length - 1 }; }),',
  '    nodes: nodes.map((n) => Object.assign({}, n, { roundIndex: LADDER.indexOf(n.round) })),',
  '  };',
  '}',
].join('\n');
const buildDrawPayload = new Function(`${PAYLOAD_SRC}\nreturn buildDrawPayload;`)();

const WORLD = {
  cards: {
    '2026-11-25': [row(CHALL, on('2026-11-25', { round_name: 'Round of 32' })),
                   row(DAVIS, on('2026-11-25', { round_name: 'Quarterfinals' })),
                   row(DAVIS, on('2026-11-25')), row(DAVIS, on('2026-11-25'))],
    '2026-11-16': [row(CHALL, on('2026-11-16', { round_name: 'Round of 16' })),
                   row(ATPF, on('2026-11-16')), row(ATPF, on('2026-11-16'))],
    '2026-09-07': [row(USM, on('2026-09-07', { round_name: 'Round of 16' })), row(USM, on('2026-09-07', { round_name: 'Round of 16' })),
                   row(USM, on('2026-09-07', { round_name: 'Round of 16' })), row(USW, on('2026-09-07', { round_name: 'Round of 16' })),
                   row(USW, on('2026-09-07', { round_name: 'Round of 16' })), row(USB, on('2026-09-07', { round_name: 'Round of 16' })),
                   row(UTR, on('2026-09-07'))],
    '2025-12-22': [row(UTR, on('2025-12-22')), row(UTR, on('2025-12-22')), row(UTR, on('2025-12-22'))],
  },
  draws: {
    '446:2026': { complete: false, outside: { '': 339, 'Qualification Final': 7, 'Qualification Round 1': 13 },
      nodes: [...at('Quarterfinals', '2026-11-24T15:00:00+00:00', '2026-11-25T15:00:00+00:00', '2026-11-26T09:00:00+00:00', '2026-11-26T16:15:00+00:00'),
              ...at('Semifinals', '2026-11-27T15:00:00+00:00')] },
    '209:2026': { complete: true, outside: { '': 12 },
      nodes: [...at('Semifinals', '2026-11-21T13:30:00+00:00', '2026-11-21T19:30:00+00:00'), ...at('Final', '2026-11-22T17:10:00+00:00')] },
    '135:2026': { complete: true, outside: QUAL,
      nodes: [...at('Round of 128', '2026-08-31T15:00:00+00:00'), ...at('Round of 64', '2026-09-02T15:00:00+00:00'),
              ...at('Round of 32', '2026-09-05T15:30:00+00:00'),
              ...at('Round of 16', '2026-09-07T18:05:00+00:00', '2026-09-07T20:40:00+00:00', '2026-09-07T21:45:00+00:00'),
              ...at('Quarterfinals', '2026-09-09T03:05:00+00:00'), ...at('Semifinals', '2026-09-11T19:15:00+00:00'),
              ...at('Final', '2026-09-13T18:15:00+00:00')] },
    '136:2026': { complete: true, outside: QUAL,
      nodes: [...at('Round of 16', '2026-09-07T01:30:00+00:00', '2026-09-07T19:00:00+00:00'), ...at('Final', '2026-09-13T20:00:00+00:00')] },
  },
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const worldWith = (edit) => { const w = clone(WORLD); edit(w); return w; };
const dropDay = (spec, day) => ({ ...spec, nodes: spec.nodes.filter((n) => !n.date.startsWith(day)) });

// opts: failCards (dates answered 500), cardStatus ({date: status}), truncatedCards (dates answered 200 truncated:true),
//       status ({"tid:season": status} for the draw route), tours (id -> tournament meta for the payload)
function fakeRelay(world, { failCards = [], cardStatus = {}, truncatedCards = [], status = {} } = {}) {
  const asked = [];
  const get = async (path) => {
    asked.push(path);
    const u = new URL(path, 'https://relay.test');
    if (u.pathname === '/bsd/tennis/matches/by-date') {
      const d = u.searchParams.get('date');
      if (failCards.includes(d)) return { status: 500, json: undefined };
      if (Object.hasOwn(cardStatus, d)) return { status: cardStatus[d], json: { error: 'x' } };
      const results = Object.hasOwn(world.cards, d) ? world.cards[d] : [];
      return { status: 200, json: { count: results.length, declaredCount: results.length, truncated: truncatedCards.includes(d), pages: 1, results } };
    }
    if (u.pathname === '/bsd/tennis/draw') {
      const tid = u.searchParams.get('tournament'), season = u.searchParams.get('season');
      const key = `${tid}:${season}`;
      if (Object.hasOwn(status, key)) return { status: status[key], json: { error: 'ambiguous' } };
      if (!Object.hasOwn(world.draws, key)) return { status: 404, json: { error: 'no matches for that tournament and season' } };
      return { status: 200, json: buildDrawPayload(TOURS[tid] ?? { id: Number(tid) }, season, world.draws[key]) };
    }
    return { status: 404, json: undefined };
  };
  get.asked = asked;
  return get;
}
const TODAY = '2026-11-26';
const replayWith = (L, deployed, world = WORLD, extra = {}, relayOpts) =>
  L.runReplay({ relayGet: fakeRelay(world, relayOpts), deployed, today: TODAY, ...extra });
const replay = (deployed, world, extra, relayOpts) => replayWith(lib, deployed, world, extra, relayOpts);
// Day-level violations (I1, I2) and vocabulary violations (V1, V2) are listed apart: they are different findings.
const kinds = (r) => r.violations.filter((v) => v.window !== 'vocabulary').map((v) => `${v.invariant} ${v.date} ${v.name} (${v.tid}) pin=${v.pin}`);
const vkinds = (r) => r.violations.filter((v) => v.window === 'vocabulary').map((v) => `${v.invariant} ${JSON.stringify(v.round)}`);
const QUAL_V2 = ['V2 ""', 'V2 "Qualification Final"', 'V2 "Qualification Round 1"', 'V2 "Qualification Round 2"'];

console.log('\nPINS — every pinned class has a fixture here, and each names what it rests on:');
ok('four pins, one per class', PINNED_DAYS.length === 4 && new Set(PINNED_DAYS.map((p) => p.id)).size === 4
   && new Set(PINNED_DAYS.map((p) => p.date)).size === 4);
ok('every pin carries its basis (Rule 73)', PINNED_DAYS.every((p) => typeof p.basis === 'string' && p.basis.length > 40));
ok('every pin has a card in the fake relay, and every pin with an event has its draw',
   PINNED_DAYS.every((p) => Object.hasOwn(WORLD.cards, p.date)
     && (p.tid === null || Object.hasOwn(WORLD.draws, `${p.tid}:${p.date.slice(0, 4)}`))));

console.log('\nCONTROL — the CURRENT client must be seen to fail, and only where it does:');
const rCur = await replay(curDep);
eq('current deployed client: exactly an I2 for the Davis Cup pin and an I1 for the ATP Finals pin (day level)', kinds(rCur),
   ['I1 2026-11-16 ATP Finals (209) pin=named-round-robin', 'I2 2026-11-25 Davis Cup (446) pin=named-main-draw']);
eq('current deployed client: and a V2 for every name the relay serves outside the main draw (it offers a tab on any slam row)',
   vkinds(rCur), QUAL_V2);
eq('current deployed client: no harness error', rCur.harness, []);
eq('current deployed client: every pin reproduced', rCur.coverage.pinsReproduced, 4);
eq('current deployed client: coverage derived from the days',
   [rCur.coverage.daysExamined, rCur.coverage.daysWithCandidates, rCur.coverage.daysWithDrawable, rCur.coverage.i1Checks, rCur.coverage.i2Checks],
   [10, 3, 2, 2, 2]);
ok('the coverage line states its denominators',
   rCur.coverageLine.startsWith('checked 10 days, 2 with a drawable event, 2 I1 checks, 2 I2 checks;'), rCur.coverageLine);
{
  const relay = fakeRelay(WORLD);
  await runReplay({ relayGet: relay, deployed: curDep, today: TODAY });
  const draws = relay.asked.filter((p) => p.includes('/draw?'));
  ok('no draw was requested for a boys\' event, and each (event, season) once',
     !draws.some((p) => p.includes('tournament=137')) && new Set(draws).size === draws.length, JSON.stringify(draws));
}
const rCurSrc = await replay(curSrc);
eq('current SOURCE shape reports the same two', kinds(rCurSrc), kinds(rCur));

console.log('\nTHE FIXED CLIENT — the same corpus, no violation, and the checks still ran:');
const rFix = await replay(fixDep);
eq('fixed deployed client: no violation', [kinds(rFix), vkinds(rFix)], [[], []]);
eq('fixed deployed client: no harness error', rFix.harness, []);
eq('fixed deployed client: the checks ran (days, drawable days, I1, I2)',
   [rFix.coverage.daysExamined, rFix.coverage.daysWithDrawable, rFix.coverage.i1Checks, rFix.coverage.i2Checks], [10, 2, 2, 2]);
const davisFixed = rFix.days.find((d) => d.date === '2026-11-25');
eq('the Davis Cup day is offered, and the offer is checked', [davisFixed.pick, davisFixed.i1], ['446 Davis Cup', 'ok']);
const atpFixed = rFix.days.find((d) => d.date === '2026-11-16');
eq('the ATP Finals round-robin day offers nothing, and hides nothing', [atpFixed.pick, atpFixed.i2], [null, 'n/a']);

console.log('\nMUTATIONS OF THE DECISION — each must turn the replay red, for the right reason:');
{
  const bad = load('M-null: the fixed picker made to always answer null (loads)', mutate(FIXED_DEPLOYED, PICK_RETURN, 'return null;', 'always null'));
  const r = await replay(bad);
  eq('M-null: I2 for the Davis Cup pin and for the US Open pin, and no I1', kinds(r),
     ['I2 2026-09-07 US Open, Men (135) pin=tier-draw', 'I2 2026-09-07 US Open, Women (136) pin=tier-draw', 'I2 2026-11-25 Davis Cup (446) pin=named-main-draw']);
  eq('M-null: I1 never had anything to check', r.coverage.i1Checks, 0);
}
{
  const bad = load('M-true: the main-draw predicate made always true (loads)',
    mutate(FIXED_DEPLOYED, PREDICATE_LINE.exec(FIXED_DEPLOYED)[0], 'function _tennisRowInMainDraw(m) { return true; }\n', 'always true'));
  const r = await replay(bad);
  eq('M-true: I1 for the ATP Finals round-robin pin on the days', kinds(r), ['I1 2026-11-16 ATP Finals (209) pin=named-round-robin']);
  eq('M-true: and a V2 for every outside name on the vocabulary', vkinds(r), QUAL_V2);
}
{
  const bad = load('M-unused: the picker no longer consults the predicate (loads)', mutate(FIXED_DEPLOYED, 'if (!_tennisRowInMainDraw(m)) continue;', '', 'predicate unused'));
  eq('M-unused: caught as the same I1', kinds(await replay(bad)), ['I1 2026-11-16 ATP Finals (209) pin=named-round-robin']);
}
{
  const bad = load('M-readmit: a Davis Cup exclusion put back on the fixed picker (loads)',
    mutate(FIXED_DEPLOYED, 'if (!_tennisRowInMainDraw(m)) continue;', 'if (!_tennisRowInMainDraw(m) || t.name === "Davis Cup") continue;', 'readmit'));
  eq('M-readmit: I2 for the Davis Cup pin', kinds(await replay(bad)), ['I2 2026-11-25 Davis Cup (446) pin=named-main-draw']);
}

// ── the round vocabulary, grounded in the relay's own payload ─────────────────
// The reviewer's mutants, written BEFORE the check that catches them. Against a replay that checks only the pinned
// days they ESCAPE: the pins exercise 'Round of 16', 'Quarterfinals' and a blank round_name, so five of the seven names
// could be deleted from the client, or mistyped, with the run green. The vocabulary check reads the names out of the
// complete US Open Men 2026 edition (every round, indices 0..6) and the names outside the main draw out of every draw
// payload the replay read, builds a card row for each, and requires the client's picker to offer the first group and
// refuse the second.
await section('VOCABULARY — a name dropped or mistyped in the client, or a predicate that counts qualifying rows:', async () => {
  const mutants = [];
  for (const name of LADDER) mutants.push([`drop ${name}`, withRounds(FIXED_DEPLOYED, '"', LADDER.filter((r) => r !== name), `drop ${name}`), [`V1 ${JSON.stringify(name)}`]]);
  mutants.push(['typo Semi-finals', withRounds(FIXED_DEPLOYED, '"', LADDER.map((r) => (r === 'Semifinals' ? 'Semi-finals' : r)), 'typo semi'), ['V1 "Semifinals"']]);
  mutants.push(['typo trailing space', withRounds(FIXED_DEPLOYED, '"', LADDER.map((r) => (r === 'Round of 64' ? 'Round of 64 ' : r)), 'typo space'), ['V1 "Round of 64"']]);
  for (const [label, text, want] of mutants) {
    const bad = loadClient(text, `mutant ${label}`);
    const r = await replay(bad);
    eq(`M-vocab ${label}: the vocabulary check names exactly the round the client no longer offers`, vkinds(r), want);
  }
  {
    // The reviewer's wrong predicate: any non-blank round_name is main draw, so qualifying rows get a tab.
    const text = mutate(FIXED_DEPLOYED, PREDICATE_LINE.exec(FIXED_DEPLOYED)[0],
      'function _tennisRowInMainDraw(m) { return String(m?.round_name) !== "" && String(m?.status) !== "cancelled"; }\n', 'nonblank');
    const r = await replay(loadClient(text, 'mutant nonblank'));
    eq('M-vocab non-blank predicate: V2 for each qualifying name (and the blank one is still refused)', vkinds(r), QUAL_V2.slice(1));
    eq('M-vocab non-blank predicate: the pinned days alone did NOT see it (no day-level violation)', kinds(r), []);
  }
  // The right client passes the same check, and the check counts what it did.
  eq('the fixed client: every one of the seven names is offered, every outside name refused, no violation',
     [vkinds(rFix), rFix.coverage.vocabMainChecks, rFix.coverage.vocabOutsideChecks], [[], 7, 4]);
  eq('the vocabulary is the relay\'s: the names checked are the ones the complete edition served, in ladder order',
     rFix.vocabulary && rFix.vocabulary.main, LADDER);
  eq('and the outside names are the union over every draw payload read (blank included)',
     rFix.vocabulary && rFix.vocabulary.outside, ['', 'Qualification Final', 'Qualification Round 1', 'Qualification Round 2']);
  // Without a complete edition to read the vocabulary from, the check says so; it never runs on a subset.
  let r = await replay(fixDep, worldWith((w) => { w.draws['135:2026'].complete = false; }));
  ok('vocabulary edition not complete: a harness error naming it, and no V1 is claimed',
     r.harness.some((h) => h.startsWith('vocabulary edition 135/2026') && h.includes('whole ladder')) && vkinds(r).length === 0, JSON.stringify([r.harness, vkinds(r)]));
  r = await replay(fixDep, worldWith((w) => { w.draws['135:2026'].nodes = w.draws['135:2026'].nodes.filter((n) => n.round !== 'Round of 128'); }));
  ok('vocabulary edition missing its first round (a 96 draw): a harness error, never a shorter vocabulary',
     r.harness.some((h) => h.startsWith('vocabulary edition 135/2026') && h.includes('whole ladder')), JSON.stringify(r.harness));
  r = await replay(fixDep, WORLD, {}, { status: { '135:2026': 500 } });
  ok('vocabulary edition unread: a harness error',
     r.harness.some((h) => h.startsWith('vocabulary edition 135/2026') && h.includes('could not be read')), JSON.stringify(r.harness));
  r = await replay(fixDep, worldWith((w) => { for (const k of Object.keys(w.draws)) w.draws[k].outside = {}; }));
  ok('no round outside the main draw in any payload read: a harness error (the qualifying class cannot be checked)',
     r.harness.some((h) => h.includes('no round outside the main draw')) && r.coverage.vocabOutsideChecks === 0, JSON.stringify(r.harness));
  r = await replay(fixDep, worldWith((w) => { w.draws['135:2026'].truncated = true; }));
  ok('vocabulary edition truncated: a harness error, not a vocabulary read from a clipped payload',
     r.harness.some((h) => h.startsWith('vocabulary edition 135/2026') && h.includes('could not be read in full')), JSON.stringify(r.harness));
});

// A lib that loses a branch of the vocabulary check passes what the real one fails — which is what lets the
// assertions above fail at all.
await section('VOCABULARY — mutants of the check itself (each must pass what the real one fails):', async () => {
  const dropped = loadClient(withRounds(FIXED_DEPLOYED, '"', LADDER.filter((r) => r !== 'Round of 128'), 'lm drop'), 'lm-drop');
  const nonblank = loadClient(mutate(FIXED_DEPLOYED, PREDICATE_LINE.exec(FIXED_DEPLOYED)[0],
    'function _tennisRowInMainDraw(m) { return String(m?.round_name) !== "" && String(m?.status) !== "cancelled"; }\n', 'nonblank'), 'lm-nonblank');
  const real1 = await replay(dropped), real2 = await replay(nonblank);
  ok('(real) both reviewer mutants are red', vkinds(real1).length === 1 && vkinds(real2).length === 3);
  const noV1 = libMutant('LM-V1', 'if (!pick || pick.id !== tour.id)', 'if (false)');
  eq('LM-V1 a check that never reports a missing offer passes the dropped-name client', vkinds(await replayWith(noV1, dropped)), []);
  const noV2 = libMutant('LM-V2', 'if (pick !== null)', 'if (false)');
  eq('LM-V2 a check that never reports an offered outside name passes the non-blank predicate', vkinds(await replayWith(noV2, nonblank)), []);
  // A blank round_name only the ATP Finals and Davis Cup payloads carry: the outside vocabulary is the union over every
  // payload the replay read, not what the vocabulary edition alone holds.
  const blankIsMain = loadClient(mutate(FIXED_DEPLOYED, PREDICATE_LINE.exec(FIXED_DEPLOYED)[0],
    'function _tennisRowInMainDraw(m) { return (_TENNIS_MAIN_DRAW_ROUNDS.has(String(m?.round_name)) || String(m?.round_name) === "") && String(m?.status) !== "cancelled"; }\n', 'blank'), 'lm-blank');
  eq('(real) a client that offers a tab on a blank round_name is told so by the vocabulary, from payloads other than the vocabulary edition\'s',
     vkinds(await replay(blankIsMain)), ['V2 ""']);
  const editionOnly = libMutant('LM-union', 'for (const t of truth.values()) {', 'for (const t of [truth.get(`${vocabulary.tid}:${vocabulary.season}`)]) {');
  eq('LM-union an outside vocabulary taken from the vocabulary edition alone misses it', vkinds(await replayWith(editionOnly, blankIsMain)), []);
  // The relay files a row with no round_name under the key '(absent)'. The row built for it carries NO round_name, which
  // is not the string "(absent)": a client that offers a tab on a missing round_name is the one to be told.
  const nullIsMain = loadClient(mutate(FIXED_DEPLOYED, PREDICATE_LINE.exec(FIXED_DEPLOYED)[0],
    'function _tennisRowInMainDraw(m) { return (m?.round_name == null || _TENNIS_MAIN_DRAW_ROUNDS.has(String(m?.round_name))) && String(m?.status) !== "cancelled"; }\n', 'null'), 'lm-null');
  const withAbsent = worldWith((w) => { w.draws['209:2026'].outside = { '': 12, '(absent)': 2 }; });
  eq('a client that offers a tab on a missing round_name is told so, by the relay\'s "(absent)" key', vkinds(await replay(nullIsMain, withAbsent)), ['V2 "(absent)"']);
  const asString = libMutant('LM-absent', "name === '(absent)' ? null : name, 'finished'", "name, 'finished'");
  eq('LM-absent a check that builds the row with the literal string "(absent)" passes that client', vkinds(await replayWith(asString, nullIsMain, withAbsent)), []);
});

console.log('\nMUTATIONS OF THE RELAY AND THE CORPUS — a harness that cannot see says so:');
{
  const r = await replay(fixDep, { cards: {}, draws: {} });
  ok('M-empty: an empty card for every day is a harness error, not "no drift"',
     r.harness.length > 0 && r.violations.length === 0, JSON.stringify(r.harness));
  ok('M-empty: the three pins with an event no longer reproduce, by name',
     ['named-main-draw', 'named-round-robin', 'tier-draw'].every((id) => r.harness.some((h) => h.startsWith(`pin ${id} `))), JSON.stringify(r.harness));
  ok('M-empty: zero checks is its own failure', r.coverage.i1Checks + r.coverage.i2Checks === 0
     && r.harness.some((h) => h.startsWith('zero checks ran')), JSON.stringify(r.harness));
  ok('M-empty: the empty-day pin still reproduces (it is the one that should)', r.pins.find((p) => p.id === 'empty-day').reproduced);
}
{
  const w = worldWith((x) => { x.draws['446:2026'] = dropDay(x.draws['446:2026'], '2026-11-25'); });
  const r = await replay(curDep, w);
  ok('M-pin: a Davis Cup draw with no node on the pinned day fails the pin as a harness error',
     r.harness.some((h) => h.startsWith('pin named-main-draw ') && h.includes('expects drawn')), JSON.stringify(r.harness));
  eq('M-pin: and it is not reported as drift', kinds(r), ['I1 2026-11-16 ATP Finals (209) pin=named-round-robin']);
  ok('M-pin: the coverage counts the pin that did not reproduce (3 of 4), in the number and in the line',
     r.coverage.pinsReproduced === 3 && r.coverageLine.includes('pins reproduced 3 of 4'), JSON.stringify([r.coverage.pinsReproduced, r.coverageLine]));
}
{
  const r = await replay(curDep, WORLD, {}, { status: { '209:2026': 409 } });
  ok('M-unread: a draw the route refused is unread, not undrawn: the ATP Finals pin fails as a harness error',
     r.harness.some((h) => h.startsWith('pin named-round-robin ') && h.includes('unread')), JSON.stringify(r.harness));
  ok('M-unread: and no I1 is claimed on it', kinds(r).every((k) => !k.includes('ATP Finals')) && r.coverage.truthUnread === 1, JSON.stringify(kinds(r)));
}
{
  const r = await replay(curDep, WORLD, {}, { failCards: ['2026-11-25'] });
  ok('M-card: a pinned day whose card cannot be read is a harness error naming the pin',
     r.harness.some((h) => h.startsWith('pin named-main-draw ') && h.includes('HTTP 500')), JSON.stringify(r.harness));
  const noPinError = libMutant('LM-pin', 'if (day.pin) report.harness.push(', 'if (false) report.harness.push(');
  const m = await replayWith(noPinError, curDep, WORLD, {}, { failCards: ['2026-11-25'] });
  ok('LM-pin a replay that stops reporting an unread pin card does not name the pin (so the assertion above can fail)',
     !m.harness.some((h) => h.startsWith('pin named-main-draw ')), JSON.stringify(m.harness));
}

// ── the trailing window ───────────────────────────────────────────────────────
// 2026-11-26's window is 11-20..11-26. The pins hold 11-25 (and the others sit outside it), so 11-20..11-24 and 11-26
// are the days only the window reads. The finding: a run in which every one of them was unread exited 0, and the
// commit message said that could no longer happen. 'M-card: an unreadable trailing day is not itself a failure' was the
// assertion that pinned the defect; it is reversed here, and it was seen to FAIL on the old rule before the fix.
await section('TRAILING WINDOW — an unread day is counted and named; a window read less than 5 of 7 is blind and fails:', async () => {
  let r = await replay(curDep, WORLD, {}, { failCards: ['2026-11-23'] });
  ok('M-card: ONE unreadable trailing day is counted and named, and is not itself a harness error (one vendor fault must not hold the run red)',
     !r.harness.some((h) => h.startsWith('trailing')) && r.unreadDays.length === 1 && r.unreadDays[0].date === '2026-11-23' && String(r.unreadDays[0].why).includes('HTTP 500'),
     JSON.stringify([r.harness, r.unreadDays]));
  eq('M-card: it is counted in the coverage, the window reads 6 of 7, and the other nine days were examined', [r.coverage.unreadDays, r.coverage.trailingRead, r.coverage.daysExamined], [1, 6, 9]);
  ok('M-card: the coverage LINE says how much of the window was read', r.coverageLine.includes('trailing window: 6 of 7 read') && r.coverageLine.includes('1 day(s)'), r.coverageLine);
  const sixUnread = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-26'];
  r = await replay(fixDep, WORLD, {}, { cardStatus: Object.fromEntries(sixUnread.map((d) => [d, 429])) });
  ok('every non-pinned trailing day answers 429: the window is named blind (1 of 7 read, at least 5 needed) and names every unread day with its reason',
     r.harness.some((h) => h.startsWith('trailing window blind') && h.includes('read 1 of 7') && h.includes('at least 5') && sixUnread.every((d) => h.includes(`${d} (HTTP 429)`))), JSON.stringify(r.harness));
  eq('and the violations are empty — only the harness error can fail this run', r.violations.length, 0);
  r = await replay(fixDep, WORLD, {}, { cardStatus: { '2026-11-21': 503, '2026-11-22': 503, '2026-11-23': 503 } });
  ok('three of seven unread: the window is blind (4 of 7 read)',
     r.harness.some((h) => h.startsWith('trailing window blind') && h.includes('read 4 of 7')), JSON.stringify(r.harness));
  r = await replay(fixDep, WORLD, {}, { cardStatus: { '2026-11-21': 503, '2026-11-22': 503 } });
  ok('two of seven unread: 5 of 7 read is enough, no harness error, and both days are counted',
     r.harness.length === 0 && r.coverage.trailingRead === 5 && r.unreadDays.length === 2, JSON.stringify([r.harness, r.coverage.trailingRead]));
  r = await replay(fixDep, WORLD, {}, { failCards: ['2026-11-25'] });
  eq('a pinned day inside the window that cannot be read is ONE error (the pin\'s), not two',
     r.harness.filter((h) => h.includes('2026-11-25')).length, 1);
  r = await replay(fixDep);
  ok('all seven days read: neither error', !r.harness.some((h) => h.startsWith('trailing')) && r.coverage.trailingRead === 7, JSON.stringify([r.harness, r.coverage]));
});

await section('TRAILING WINDOW — mutants of the rule itself:', async () => {
  const noBlind = libMutant('LM-trail-blind', 'if (trailingRead < TRAILING_MIN_READ)', 'if (false)');
  const six = { cardStatus: Object.fromEntries(['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-26'].map((d) => [d, 429])) };
  const m2 = await replayWith(noBlind, fixDep, WORLD, {}, six);
  ok('LM-trail-blind a replay without the blind-window error does not say the window is blind', !m2.harness.some((h) => h.startsWith('trailing window blind')), JSON.stringify(m2.harness));
  const weak = libMutant('LM-trail-weak', 'if (trailingRead < TRAILING_MIN_READ)', 'if (trailingRead < 3)');
  const three = { cardStatus: { '2026-11-21': 503, '2026-11-22': 503, '2026-11-23': 503 } };
  const m3 = await replayWith(weak, fixDep, WORLD, {}, three);
  ok('LM-trail-weak a threshold of 3 instead of 5 calls a 4-of-7 window sound (so the "three of seven" case can fail)', !m3.harness.some((h) => h.startsWith('trailing window blind')), JSON.stringify(m3.harness));
  const uncounted = libMutant('LM-trail-uncounted', 'report.unreadDays.push({ date: day.date, why });', '');
  const m4 = await replayWith(uncounted, fixDep, WORLD, {}, six);
  ok('LM-trail-uncounted a replay that does not record an unread day believes it read the whole window', m4.coverage.trailingRead === 7 && !m4.harness.some((h) => h.startsWith('trailing window blind')), JSON.stringify([m4.coverage.trailingRead, m4.harness]));
});

{
  const w = { cards: { ...WORLD.cards, '2026-11-24': [row(DAVIS, on('2026-11-24', { round_name: 'Quarterfinals' }))] }, draws: WORLD.draws };
  const rc = await replay(curDep, w);
  ok('M-window: a hidden draw inside the trailing window is reported, and marked as trailing, not pinned',
     rc.violations.some((v) => v.invariant === 'I2' && v.date === '2026-11-24' && v.window === 'trailing' && v.pin === null), JSON.stringify(kinds(rc)));
  eq('M-window: the fixed client clears it', kinds(await replay(fixDep, w)), []);
}
{
  const spec209 = WORLD.draws['209:2026'];
  const withDraw = (spec) => worldWith((w) => { w.draws['209:2026'] = spec; });
  const dbl = { date: '2026-11-16T12:00:00+00:00', round: 'Final', isDoubles: true };
  eq('M-doubles: a doubles main-draw node on the day is not a singles draw (the ATP Finals pin still reads undrawn)',
     kinds(await replay(curDep, withDraw({ ...spec209, nodes: [...spec209.nodes, dbl] }))), kinds(rCur));
  const trunc = await replay(curDep, withDraw({ ...spec209, truncated: true }));
  ok('M-truncated: a clipped draw with no node that day is unread, not undrawn — the pin fails as a harness error and no I1 is claimed',
     trunc.harness.some((h) => h.startsWith('pin named-round-robin ') && h.includes('unread')) && kinds(trunc).every((k) => !k.includes('ATP Finals')),
     JSON.stringify([trunc.harness, kinds(trunc)]));
  const other404 = await replay(curDep, WORLD, {}, { status: { '209:2026': 404 } });
  ok('M-404: a 404 that is not the route\'s own "no matches" answer is unread, not undrawn',
     other404.harness.some((h) => h.startsWith('pin named-round-robin ') && h.includes('unread')) && other404.coverage.truthUnread === 1,
     JSON.stringify(other404.harness));
  const { '209:2026': _gone, ...withoutAtp } = WORLD.draws;
  const noEdition = await replay(curDep, { cards: WORLD.cards, draws: withoutAtp });
  eq('M-404: the route\'s own "no matches for that tournament and season" is an edition with no draw: undrawn, and the I1 stands',
     [kinds(noEdition), noEdition.harness], [kinds(rCur), []]);
  const offDay = await replay(curDep, { cards: { ...WORLD.cards, '2026-11-25': [...WORLD.cards['2026-11-25'], row(CHALL, { match_date: '2026-11-26T01:00:00+00:00' })] }, draws: WORLD.draws });
  eq('M-day: a card row dated on another day is counted, not silently kept', offDay.coverage.rowsOffDay, 1);
  const busyEmpty = await replay(curDep, { cards: { ...WORLD.cards, '2025-12-22': [...WORLD.cards['2025-12-22'], row(T(391, 'United Cup', 'other'), on('2025-12-22'))] }, draws: WORLD.draws });
  ok('M-empty-pin: an allowed event on the "empty" day fails that pin by name',
     busyEmpty.harness.some((h) => h.startsWith('pin empty-day ') && h.includes('expected 0 allowed singles events')), JSON.stringify(busyEmpty.harness));
}

// The season a draw is read in is the year of the DAY, and the window follows the run date across a year boundary.
await section('SEASON AND WINDOW — a card from another year is judged against that year\'s draw:', async () => {
  const w = worldWith((x) => {
    x.cards['2027-01-03'] = [row(DAVIS, on('2027-01-03', { round_name: 'Quarterfinals' }))];
    x.draws['446:2027'] = { complete: false, outside: {}, nodes: at('Quarterfinals', '2027-01-03T15:00:00+00:00') };
  });
  const r = await runReplay({ relayGet: fakeRelay(w), deployed: fixDep, today: '2027-01-04' });
  eq('the 2027 card is checked against the 446/2027 draw and passes; the window runs 2026-12-29..2027-01-04',
     [kinds(r), r.window.from, r.window.to], [[], '2026-12-29', '2027-01-04']);
  const day = r.days.find((d) => d.date === '2027-01-03');
  eq('the Davis Cup was offered and the offer verified', day && [day.pick, day.i1], ['446 Davis Cup', 'ok']);
  const hard = libMutant('LM-season', 'const season = day.date.slice(0, 4);', "const season = '2026';");
  const mut = await hard.runReplay({ relayGet: fakeRelay(w), deployed: fixDep, today: '2027-01-04' });
  ok('LM-season a replay that reads every draw in 2026 reports an I1 on the 2027 day (so the assertion above can fail)',
     kinds(mut).some((k) => k.startsWith('I1 2027-01-03')), JSON.stringify(kinds(mut)));
});
{
  let msg = null;
  try { await runReplay({ relayGet: fakeRelay(WORLD), deployed: curDep, today: '26-11-2026' }); } catch (e) { msg = e.message; }
  ok('a replay with a malformed day refuses to run', msg !== null && msg.includes('YYYY-MM-DD'), String(msg));
}
{
  let msg = null;
  try { await runReplay({ relayGet: fakeRelay(WORLD), deployed: null, today: TODAY }); } catch (e) { msg = e.message; }
  ok('a replay without a deployed client refuses to run', msg !== null && msg.includes('cannot be replayed'), String(msg));
}

// ── Rule 91: what the coverage line counts and says ───────────────────────────
await section('COVERAGE LINE — truncated cards, skipped checks and what the replay cannot see are in the output:', async () => {
  const r = await replay(fixDep, WORLD, {}, { truncatedCards: ['2026-11-22', '2026-11-24'] });
  eq('two clipped cards are counted', r.coverage.truncatedCards, 2);
  ok('and the line says so', r.coverageLine.includes('2 card(s) truncated'), r.coverageLine);
  const trunc = await replay(curDep, worldWith((w) => { w.draws['209:2026'].truncated = true; }));
  ok('a draw that is clipped with no node on the day skips the I1 check, and the skip is counted, not hidden',
     trunc.coverage.i1Skipped === 1 && trunc.coverageLine.includes('skipped checks: I1 1, I2'), JSON.stringify([trunc.coverage.i1Skipped, trunc.coverageLine]));
  {
    // A picker that offers nothing, with the Davis Cup draw unreadable: the I2 check on that day has no truth to compare with.
    const nothing = loadClient(mutate(FIXED_DEPLOYED, PICK_RETURN, 'return null;', 'always null'), 'cov-null');
    const rr = await replay(nothing, WORLD, {}, { status: { '446:2026': 500 } });
    ok('an I2 check with no readable draw behind it is skipped, and the skip is counted and printed',
       rr.coverage.i2Skipped === 1 && rr.coverageLine.includes('skipped checks: I1 0, I2 1'), JSON.stringify([rr.coverage.i2Skipped, rr.coverageLine]));
  }
  ok('the line states what the replay cannot see',
     /NOT SEEN: .*nav/i.test(r.coverageLine) && r.coverageLine.includes('which event') && r.coverageLine.includes('live'), r.coverageLine);
  ok('and the vocabulary counts are in the line', r.coverageLine.includes('vocabulary: 7 main-draw name(s) offered, 4 outside name(s) refused'), r.coverageLine);
  ok('the trailing window\'s read count is in the line', r.coverageLine.includes('trailing window: 7 of 7 read'), r.coverageLine);
});

// ── retry: one more read of a transient, never of a 4xx ───────────────────────
await section('RETRY — a read that threw or answered 5xx is made once more; a 4xx is the answer:', async () => {
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); };
  const scripted = (...answers) => { let i = 0; const f = async () => { const a = answers[Math.min(i++, answers.length - 1)]; if (a instanceof Error) throw a; return a; }; f.calls = () => i; return f; };
  const run = (L, f, pauseMs = 1234) => L.readOnceMore(f, { sleep, pauseMs });
  let f = scripted({ status: 503 }, { status: 200 });
  eq('a 503 then a 200: the 200 is returned after exactly two reads and one pause', [(await run(lib, f)).status, f.calls(), sleeps.splice(0)], [200, 2, [1234]]);
  f = scripted(new Error('ECONNRESET'), { status: 200 });
  eq('a thrown read then a 200: the 200 is returned', [(await run(lib, f)).status, f.calls(), sleeps.splice(0)], [200, 2, [1234]]);
  f = scripted({ status: 503 }, { status: 502 });
  eq('a 503 then a 502: the second answer stands, and there is no third read', [(await run(lib, f)).status, f.calls()], [502, 2]);
  sleeps.splice(0);
  f = scripted(new Error('a'), new Error('b'));
  let msg = null; try { await run(lib, f); } catch (e) { msg = e.message; }
  eq('two thrown reads: the SECOND error is raised (not swallowed into a status)', [msg, f.calls()], ['b', 2]);
  sleeps.splice(0);
  for (const code of [400, 401, 403, 404, 408, 409, 410, 422, 429, 499]) {
    f = scripted({ status: code }, { status: 200 });
    const got = await run(lib, f);
    ok(`HTTP ${code} is the answer: read once, not retried`, got.status === code && f.calls() === 1 && sleeps.length === 0, JSON.stringify([got, f.calls(), sleeps]));
  }
  f = scripted({ status: 200 }, { status: 503 });
  eq('a 200 is read once', [(await run(lib, f)).status, f.calls()], [200, 1]);
  const retry4xx = libMutant('LM-retry4xx', 'r.status >= 500', 'r.status >= 400');
  f = scripted({ status: 429 }, { status: 200 });
  eq('LM-retry4xx a reader that retries a 4xx re-reads a 429 (so the cases above can fail)', [(await run(retry4xx, f)).status, f.calls()], [200, 2]);
  const noSecondRead = libMutant('LM-noretry', 'return read();', 'return first;');
  f = scripted({ status: 503 }, { status: 200 });
  eq('LM-noretry a reader that never reads again returns the 503 (so the 503-then-200 case can fail)', [(await run(noSecondRead, f)).status, f.calls()], [503, 1]);
  ok('the default pause is a real wait (not zero)', lib.RETRY_PAUSE_MS >= 500, String(lib.RETRY_PAUSE_MS));
});

console.log('\nreadClient — which texts it reads, and every refusal path:');
const fake = (handler) => {
  const asked = [];
  const f = async (url) => { asked.push(url); return handler(url); };
  f.asked = asked;
  return f;
};
const body = (text) => ({ ok: true, status: 200, text: async () => text });
const httpErr = (status) => ({ ok: false, status, text: async () => '' });
const noWait = { sleep: async () => {}, pauseMs: 0 };
{
  const f = fake((u) => body(u === CLIENT_DEPLOYED_URL ? CURRENT_DEPLOYED : CURRENT_SOURCE));
  const r = await readClient(f, noWait);
  ok('reads exactly two urls', f.asked.length === 2, JSON.stringify(f.asked));
  ok('one is the deployed page', f.asked.includes(CLIENT_DEPLOYED_URL));
  ok('one is field.js on main, not index.html', f.asked.includes(CLIENT_SOURCE_URL) && !f.asked.some((u) => u.includes('index.html')));
  ok('both load, no refusals', !!r.deployed && !!r.source && r.refusals.length === 0, JSON.stringify(r.refusals));
  const agree = await runReplay({ relayGet: fakeRelay(WORLD), deployed: r.deployed, source: r.source, today: TODAY });
  eq('the same decision on both texts agrees on every day', [agree.sourceAgreesWithDeployed, agree.sourceDiffs.length], [true, 0]);
}
{
  const f = fake((u) => body(u === CLIENT_DEPLOYED_URL ? CURRENT_DEPLOYED : FIXED_SOURCE));
  const r = await readClient(f, noWait);
  const split = await runReplay({ relayGet: fakeRelay(WORLD), deployed: r.deployed, source: r.source, today: TODAY });
  eq('a fix on main that has not shipped is reported as disagreement, on the days it changes',
     [split.sourceAgreesWithDeployed, split.sourceDiffs.map((d) => d.date)], [false, ['2026-11-16', '2026-11-25']]);
}
{
  const r = await readClient(fake((u) => (u === CLIENT_DEPLOYED_URL ? httpErr(503) : body(CURRENT_SOURCE))), noWait);
  ok('R1 deployed HTTP error refuses and leaves deployed null', r.deployed === null && r.refusals.some((x) => x.includes('HTTP 503')), JSON.stringify(r.refusals));
  ok('R1 does not fall back to source for the verdict', r.source !== null && r.deployed === null);
}
{
  const r = await readClient(fake(() => { throw new Error('getaddrinfo ENOTFOUND'); }), noWait);
  ok('R2 a network throw refuses both', r.deployed === null && r.source === null && r.refusals.length === 2, JSON.stringify(r.refusals));
}
{
  const r = await readClient(fake(() => body('<html>404 Not Found</html>')), noWait);
  ok('R3 an error PAGE with HTTP 200 still refuses — no anchor is in it',
     r.deployed === null && r.source === null && r.refusals.length === 2, JSON.stringify(r.refusals));
}
{
  const r = await readClient(fake((u) => body(mutate(u === CLIENT_DEPLOYED_URL ? CURRENT_DEPLOYED : CURRENT_SOURCE,
    u === CLIENT_DEPLOYED_URL ? 'function _tennisDrawPick(rows) {' : 'function _tennisDrawPick(rows){', 'function _tennisDrawPickX(rows){', 'R4')), noWait));
  ok('R4 a client whose picker was renamed refuses on both reads, naming the anchor',
     r.deployed === null && r.source === null && r.refusals.every((x) => x.includes('_tennisDrawPick')), JSON.stringify(r.refusals));
}
{
  // One retry of the same URL on a transient; no other source is consulted and a 4xx is the answer.
  let n = 0;
  const f = fake((u) => { if (u === CLIENT_SOURCE_URL && n++ === 0) return httpErr(503); return body(u === CLIENT_DEPLOYED_URL ? CURRENT_DEPLOYED : CURRENT_SOURCE); });
  const r = await readClient(f, noWait);
  ok('R5 a 503 on the source read is read once more, from the same URL, and then loads',
     r.source !== null && r.refusals.length === 0 && f.asked.filter((u) => u === CLIENT_SOURCE_URL).length === 2 && f.asked.length === 3, JSON.stringify([r.refusals, f.asked]));
  const g = fake((u) => (u === CLIENT_SOURCE_URL ? httpErr(503) : body(CURRENT_DEPLOYED)));
  const r2 = await readClient(g, noWait);
  ok('R5 a source that answers 503 twice is a refusal, after exactly two reads',
     r2.source === null && r2.refusals.length === 1 && g.asked.filter((u) => u === CLIENT_SOURCE_URL).length === 2, JSON.stringify([r2.refusals, g.asked]));
  const h = fake((u) => (u === CLIENT_DEPLOYED_URL ? httpErr(404) : body(CURRENT_SOURCE)));
  const r3 = await readClient(h, noWait);
  ok('R5 a 404 on the deployed page is read once, not retried',
     r3.deployed === null && h.asked.filter((u) => u === CLIENT_DEPLOYED_URL).length === 1, JSON.stringify(h.asked));
  let m = 0;
  const k = fake((u) => { if (u === CLIENT_DEPLOYED_URL && m++ === 0) throw new Error('socket hang up'); return body(u === CLIENT_DEPLOYED_URL ? CURRENT_DEPLOYED : CURRENT_SOURCE); });
  const r4 = await readClient(k, noWait);
  ok('R5 a network error on the deployed read is read once more and then loads', r4.deployed !== null && r4.refusals.length === 0, JSON.stringify(r4.refusals));
}

// ── the detector itself, run for real with fetch replaced ─────────────────────
// The loader and the replay are tested above. What turns their findings into a red workflow is the DETECTOR'S exit
// rule and its artifact keys, and nothing else exercises those off a runner. So tennis-tier-ladders.mjs is run as a
// child process with a preloaded fetch that serves a client text and the fake relay above, in a throwaway directory
// (it writes outbox/ there), and its exit code and artifact are read. Its exit rule is then mutated, in a copy, and
// each mutant must PASS input the real one fails: that is what proves the assertions on the real one can fail.
// The clock is frozen (the preload replaces Date), so the replay window is the same on every day this runs.
console.log('\nTHE DETECTOR, run end to end (tennis-tier-ladders.mjs with fetch replaced):');
const NOW = '2026-11-26T12:00:00.000Z';
const PRELOAD = `
import fs from 'node:fs';
const cfg = JSON.parse(fs.readFileSync(process.env.TTL_FAKE, 'utf8'));
${PAYLOAD_SRC}
if (cfg.now) {
  const RealDate = Date, fixed = RealDate.parse(cfg.now);
  globalThis.Date = class extends RealDate { constructor(...a) { if (a.length === 0) super(fixed); else super(...a); } static now() { return fixed; } };
}
const json = (status, obj) => ({ status, ok: status < 400, text: async () => JSON.stringify(obj) });
const fired = new Map();
globalThis.fetch = async (url) => {
  const u = new URL(url);
  const id = u.hostname + u.pathname + u.search;
  fs.appendFileSync(process.env.TTL_LOG, id + '\\n');
  for (const f of cfg.faults || []) {
    if (!id.includes(f.match)) continue;
    const n = (fired.get(f.match) || 0) + 1; fired.set(f.match, n);
    if (f.times !== undefined && n > f.times) continue;
    if (f.throw) throw new Error('fake network failure');
    return json(f.status, { error: 'fault' });
  }
  if (u.hostname.endsWith('jubilant-bassoon.jeffunglesbee.workers.dev')) return { ok: true, status: 200, text: async () => cfg.deployedText };
  if (u.hostname === 'raw.githubusercontent.com') return { ok: true, status: 200, text: async () => cfg.sourceText };
  if (u.hostname !== 'field-relay-nba.jeffunglesbee.workers.dev') throw new Error('unexpected host ' + u.hostname);
  if (u.pathname === '/bsd/tennis/tournaments') {
    return json(200, { results: cfg.census, read: cfg.census.length, declaredCount: cfg.census.length, truncated: false, pages: 1 });
  }
  if (u.pathname === '/bsd/tennis/matches/by-date') {
    const d = u.searchParams.get('date');
    const results = Object.hasOwn(cfg.cards, d) ? cfg.cards[d] : [];
    return json(200, { count: results.length, declaredCount: results.length, truncated: false, pages: 1, results });
  }
  if (u.pathname === '/bsd/tennis/draw') {
    const tid = u.searchParams.get('tournament'), season = u.searchParams.get('season');
    const key = tid + ':' + (season === null ? '2026' : season);
    if (!Object.hasOwn(cfg.draws, key)) return json(404, { error: 'no matches for that tournament and season' });
    return json(200, buildDrawPayload(cfg.tours[tid] || { id: Number(tid) }, key.split(':')[1], cfg.draws[key]));
  }
  return json(404, {});
};
`;
const CENSUS = [{ id: 135, name: 'US Open, Men', category: 'grand_slam' }, { id: 446, name: 'Davis Cup', category: 'other' },
                { id: 209, name: 'ATP Finals', category: 'other' }];
let detectorRuns = 0, mutantRuns = 0;
function runDetector({ deployedText, sourceText, cards = WORLD.cards, draws = WORLD.draws, faults = [], now = NOW,
                       census = CENSUS, mutateDetector = null, mutateLib = null }) {
  detectorRuns++;
  if (mutateDetector || mutateLib) mutantRuns++;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-detector-'));
  try {
    // Only what the detector loads: itself and its one library.
    fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(path.join(HERE, 'tennis-tier-ladders.mjs'), path.join(dir, 'scripts', 'tennis-tier-ladders.mjs'));
    fs.copyFileSync(LIB_PATH, path.join(dir, 'scripts', 'lib', 'client-tennis-split.cjs'));
    const script = path.join(dir, 'scripts', 'tennis-tier-ladders.mjs');
    if (mutateDetector) fs.writeFileSync(script, mutateDetector(fs.readFileSync(script, 'utf8')));
    const libCopy = path.join(dir, 'scripts', 'lib', 'client-tennis-split.cjs');
    if (mutateLib) fs.writeFileSync(libCopy, mutateLib(fs.readFileSync(libCopy, 'utf8')));
    fs.writeFileSync(path.join(dir, 'preload.mjs'), PRELOAD);
    fs.writeFileSync(path.join(dir, 'fake.json'), JSON.stringify({ deployedText, sourceText, cards, draws, faults, now, tours: TOURS, census }));
    const log = path.join(dir, 'requests.log');
    fs.writeFileSync(log, '');
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(path.join(dir, 'preload.mjs')).href, script],
      { cwd: dir, encoding: 'utf8', timeout: 90000, env: { ...process.env, TTL_FAKE: path.join(dir, 'fake.json'), TTL_LOG: log, PER_TIER: '5',
                                  RETRY_PAUSE_MS: '0', RELAY_BASE: 'https://field-relay-nba.jeffunglesbee.workers.dev' } });
    const latest = path.join(dir, 'outbox', 'tennis-tier-ladders-latest.json');
    const artifact = fs.existsSync(latest) ? JSON.parse(fs.readFileSync(latest, 'utf8')) : null;
    const requests = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
    return { code: r.status, out: r.stdout + r.stderr, summary: artifact ? artifact.summary : null, artifact, requests };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const asked = (r, needle) => r.requests.filter((x) => x.includes(needle)).length;
const replayOf = (r) => (r.summary ? r.summary.clientDecisionReplay : null);
const statusOf = (r) => (replayOf(r) ? replayOf(r).status : undefined);

const D_CUR = runDetector({ deployedText: CURRENT_DEPLOYED, sourceText: CURRENT_SOURCE });
ok('D1 the CURRENT client: the workflow step exits 1', D_CUR.code === 1, `exit ${D_CUR.code}: ${D_CUR.out.slice(-300)}`);
eq('D1 summary.clientSplitDrift is the two day violations first (as sentences), then the four vocabulary ones',
   D_CUR.summary && D_CUR.summary.clientSplitDrift.map((x) => x.split(' ').slice(0, 2).join(' ')),
   ['I1 2026-11-16', 'I2 2026-11-25', 'V2 vocabulary', 'V2 vocabulary', 'V2 vocabulary', 'V2 vocabulary']);
ok('D1 summary.clientDecisionReplay carries the coverage and ran',
   D_CUR.summary && D_CUR.summary.clientDecisionReplay.ran === true
   && D_CUR.summary.clientDecisionReplay.coverage.i1Checks > 0 && D_CUR.summary.clientDecisionReplay.coverage.i2Checks > 0
   && /^checked \d+ days, \d+ with a drawable event, \d+ I1 checks, \d+ I2 checks/.test(D_CUR.summary.clientDecisionReplay.coverageLine),
   JSON.stringify(D_CUR.summary && D_CUR.summary.clientDecisionReplay.coverageLine));
ok('D1 the printed log says so', D_CUR.out.includes('COVERAGE (replay): checked ') && D_CUR.out.includes('DRIFT: I2 2026-11-25 Davis Cup'));
eq('D1 the artifact states the replay\'s status: drift', statusOf(D_CUR), 'drift');
ok('D1 the closing line names the status and does not claim a match', /client Draw-tab replay status: drift/.test(D_CUR.out) && !/matches what the relay serves on every replayed day: true/.test(D_CUR.out));
eq('D1 the replay window is the one the frozen clock says (2026-11-20..2026-11-26)',
   [replayOf(D_CUR).window.from, replayOf(D_CUR).window.to], ['2026-11-20', '2026-11-26']);

const D_FIX = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE });
ok('D2 the FIXED client: exits 0', D_FIX.code === 0, `exit ${D_FIX.code}: ${D_FIX.out.slice(-300)}`);
ok('D2 clientSplitDrift is [] and the replay still ran its checks',
   D_FIX.summary && D_FIX.summary.clientSplitDrift.length === 0 && D_FIX.summary.clientDecisionReplay.ran === true
   && D_FIX.summary.clientDecisionReplay.coverage.i1Checks > 0 && D_FIX.summary.clientDecisionReplay.coverage.i2Checks > 0);
eq('D2 status ok, no harness error, and the vocabulary was checked (7 offered, 4 refused)',
   [statusOf(D_FIX), replayOf(D_FIX).harness, replayOf(D_FIX).coverage.vocabMainChecks, replayOf(D_FIX).coverage.vocabOutsideChecks], ['ok', [], 7, 4]);
eq('D2 the artifact carries the vocabulary it checked (the relay\'s seven names, four outside names)',
   [(replayOf(D_FIX).vocabulary || {}).main, (replayOf(D_FIX).vocabulary || {}).outside], [LADDER, ['', 'Qualification Final', 'Qualification Round 1', 'Qualification Round 2']]);
ok('D2 the closing line says ok and points at the coverage', /client Draw-tab replay status: ok/.test(D_FIX.out) && D_FIX.out.includes('COVERAGE (replay)'));
ok('D2 the coverage line in the artifact says what is not seen', replayOf(D_FIX).coverageLine.includes('NOT SEEN'));

const D_REF = runDetector({ deployedText: mutate(CURRENT_DEPLOYED, 'function _tennisDrawPick(rows) {', 'function _tennisDrawPickX(rows) {', 'D3'),
                            sourceText: CURRENT_SOURCE });
ok('D3 a deployed client with a renamed picker: exits 1, names the anchor, and did not replay',
   D_REF.code === 1 && D_REF.summary.clientSplitRefusals.length === 1 && D_REF.summary.clientSplitRefusals[0].includes('_tennisDrawPick')
   && D_REF.summary.clientDecisionReplay.ran === false, `exit ${D_REF.code}`);
eq('D3 status refused, and the closing line does not say true', [statusOf(D_REF), /status: refused/.test(D_REF.out), /: true\s*$/m.test(D_REF.out)], ['refused', true, false]);

const D_EMPTY = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, cards: {} });
ok('D4 every card empty: exits 1 with the zero-check harness error, and clientSplitDrift is not what says so',
   D_EMPTY.code === 1 && D_EMPTY.summary.clientDecisionReplay.harness.some((h) => h.startsWith('zero checks ran'))
   && D_EMPTY.summary.clientSplitDrift.length === 0, `exit ${D_EMPTY.code}`);
eq('D4 status harness-error: the key a reader checks says so even though clientSplitDrift is []', statusOf(D_EMPTY), 'harness-error');

// Which client decides, and which direction a disagreement points.
const D_SPLIT = runDetector({ deployedText: CURRENT_DEPLOYED, sourceText: FIXED_SOURCE });
ok('D5 a fix on main that has not shipped: exits 1 and says the two decide differently',
   D_SPLIT.code === 1 && D_SPLIT.summary.clientSplitContradictions.length === 1
   && D_SPLIT.summary.clientSplitContradictions[0].includes('decide differently on 2026-11-16, 2026-11-25'), `exit ${D_SPLIT.code}`);
ok('D5 the verdict is judged on the DEPLOYED text: the current client\'s two day violations are in clientSplitDrift',
   D_SPLIT.summary.clientSplitDrift.filter((x) => /^I[12] /.test(x)).length === 2, JSON.stringify(D_SPLIT.summary.clientSplitDrift));
ok('D5 the message does not assert a direction (it is wrong when the deployed page is the newer one)',
   !D_SPLIT.summary.clientSplitContradictions[0].includes('has not shipped'));
const D_REV = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: CURRENT_SOURCE });
ok('D5r the reverse (the deployed page is the fixed one, main reverted): exits 1 on the disagreement alone',
   D_REV.code === 1 && D_REV.summary.clientSplitDrift.length === 0 && D_REV.summary.clientSplitContradictions.length === 1
   && D_REV.summary.clientSplitContradictions[0].includes('decide differently on'), `exit ${D_REV.code} ${JSON.stringify(D_REV.summary && D_REV.summary.clientSplitContradictions)}`);
eq('D5r status drift (a disagreement between the two is not an ok), with an empty clientSplitDrift', [statusOf(D_REV), D_REV.summary.clientSplitDrift], ['drift', []]);

// Both at once: the source could not be read AND the replay could not see. 'refused' outranks 'harness-error': a client
// this run could not read is the more basic failure, and the order is what a reader's one-word check relies on.
const D_BOTH = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, cards: {}, faults: [{ match: 'raw.githubusercontent.com', status: 503 }] });
eq('D8 a refused source and an empty replay at once: exits 1 and the status is refused (with the harness error still listed)',
   [D_BOTH.code, statusOf(D_BOTH), replayOf(D_BOTH).harness.some((h) => h.startsWith('zero checks ran'))], [1, 'refused', true]);

// A loaded client whose picker throws on a replayed row: the worst outcome is a green meaning "I could not look".
const THROWS = mutate(FIXED_DEPLOYED, 'if (!t?.id || !_tennisTierAllowed(m)) continue;',
  'if (!t?.id || !_tennisTierAllowed(m)) continue;\n    if (t.category === "other") throw new Error("boom on a named-event row");', 'D6');
const D_THROW = runDetector({ deployedText: THROWS, sourceText: FIXED_SOURCE });
ok('D6 a client that loads and then throws on a replayed row: exits 1, replay did not run, and the reason names the function',
   D_THROW.code === 1 && D_THROW.summary.clientDecisionReplay.ran === false
   && D_THROW.summary.clientDecisionReplay.harness.some((h) => h.includes('the replay refused to run') && h.includes('_tennisDrawPick threw')),
   `exit ${D_THROW.code} ${JSON.stringify(D_THROW.summary && D_THROW.summary.clientDecisionReplay)}`);
eq('D6 status harness-error', statusOf(D_THROW), 'harness-error');

// Season and window wiring: a run on 2027-01-04 reads the 2027 draw for a 2027 card.
{
  const draws = clone(WORLD.draws); draws['446:2027'] = { complete: false, outside: {}, nodes: at('Quarterfinals', '2027-01-03T15:00:00+00:00') };
  const cards = clone(WORLD.cards); cards['2027-01-03'] = [row(DAVIS, on('2027-01-03', { round_name: 'Quarterfinals' }))];
  const D_2027 = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, cards, draws, now: '2027-01-04T09:00:00.000Z' });
  ok('D7 on 2027-01-04 the window is 2026-12-29..2027-01-04 and a 2027 card is read against the 2027 draw',
     D_2027.code === 0 && replayOf(D_2027).window.from === '2026-12-29' && replayOf(D_2027).window.to === '2027-01-04'
     && asked(D_2027, 'tournament=446&season=2027') === 1, `exit ${D_2027.code} ${JSON.stringify(replayOf(D_2027) && replayOf(D_2027).window)} ${D_2027.out.slice(-200)}`);
}

// ── trailing days and the retry, end to end ───────────────────────────────────
await section('THE DETECTOR — a blind trailing window fails the run, one unread day does not, a transient is read once more, a 4xx is not:', async () => {
  const six = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-26'];
  const blind = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE,
    faults: six.map((d) => ({ match: `by-date?date=${d}`, status: 429 })) });
  ok('T1 the reviewer\'s repro (every non-pinned trailing day answers 429): exits 1, no violation, ONE harness error names the blind window and every unread day',
     blind.code === 1 && replayOf(blind).violations.length === 0
     && replayOf(blind).harness.some((h) => h.startsWith('trailing window blind') && six.every((d) => h.includes(`${d} (HTTP 429)`))), `exit ${blind.code} ${JSON.stringify(replayOf(blind) && replayOf(blind).harness)}`);
  eq('T1 status harness-error, and a 429 was asked for once per day (a 4xx is not retried)', [statusOf(blind), asked(blind, 'by-date?date=2026-11-23')], ['harness-error', 1]);

  const persistent = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, faults: [{ match: 'by-date?date=2026-11-23', status: 503 }] });
  ok('T2 one trailing day that answers 503 every time: green (6 of 7 read), the day is named as unread in the artifact and the output, after exactly two reads',
     persistent.code === 0 && statusOf(persistent) === 'ok' && replayOf(persistent).unreadDays.length === 1 && replayOf(persistent).unreadDays[0].date === '2026-11-23'
     && persistent.out.includes('unread day 2026-11-23') && asked(persistent, 'by-date?date=2026-11-23') === 2,
     `exit ${persistent.code} reads ${asked(persistent, 'by-date?date=2026-11-23')} ${persistent.out.slice(-240)}`);

  const flaky = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, faults: [{ match: 'by-date?date=2026-11-23', status: 503, times: 1 }] });
  ok('T3 one trailing day that answers 503 once: read again and the run is green',
     flaky.code === 0 && statusOf(flaky) === 'ok' && replayOf(flaky).harness.length === 0 && asked(flaky, 'by-date?date=2026-11-23') === 2,
     `exit ${flaky.code} reads ${asked(flaky, 'by-date?date=2026-11-23')} ${flaky.out.slice(-200)}`);

  const flakyDraw = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, faults: [{ match: 'draw?tournament=446&season=2026', status: 502, times: 1 }] });
  ok('T4 a pinned draw read that answers 502 once: read again, green', flakyDraw.code === 0 && asked(flakyDraw, 'tournament=446&season=2026') === 2, `exit ${flakyDraw.code}`);

  const flakyNet = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, faults: [{ match: 'by-date?date=2026-11-24', throw: true, times: 1 }] });
  ok('T5 a card read that throws once (a dropped connection): read again, green', flakyNet.code === 0 && asked(flakyNet, 'by-date?date=2026-11-24') === 2, `exit ${flakyNet.code}`);

  const flakyCensus = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, faults: [{ match: '/bsd/tennis/tournaments', status: 503, times: 1 }] });
  ok('T6 the census read that answers 503 once: read again, green', flakyCensus.code === 0 && asked(flakyCensus, '/bsd/tennis/tournaments') === 2, `exit ${flakyCensus.code} ${flakyCensus.out.slice(-200)}`);

  const flakySrc = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, faults: [{ match: 'raw.githubusercontent.com', status: 503, times: 1 }] });
  ok('T7 the source read that answers 503 once: read again, green, and the source agreed',
     flakySrc.code === 0 && asked(flakySrc, 'raw.githubusercontent.com') === 2 && replayOf(flakySrc).sourceAgreesWithDeployed === true, `exit ${flakySrc.code}`);

  const deadSrc = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, faults: [{ match: 'raw.githubusercontent.com', status: 503 }] });
  ok('T8 the source read that answers 503 twice: a refusal (exit 1, status refused), not a fall back to anything',
     deadSrc.code === 1 && statusOf(deadSrc) === 'refused' && asked(deadSrc, 'raw.githubusercontent.com') === 2, `exit ${deadSrc.code} ${statusOf(deadSrc)}`);

  const pinDown = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, faults: [{ match: 'by-date?date=2026-09-07', status: 503 }] });
  ok('T9 a pinned card that is unreadable: exits 1 with the pin named', pinDown.code === 1 && replayOf(pinDown).harness.some((h) => h.startsWith('pin tier-draw ')), `exit ${pinDown.code}`);

  const conflict = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, faults: [{ match: 'draw?tournament=209&season=2026', status: 409 }] });
  ok('T10 a 409 from a draw read (the Antalya shape) is asked for once and is the answer',
     asked(conflict, 'tournament=209&season=2026') === 1, `reads ${asked(conflict, 'tournament=209&season=2026')}`);

  const down = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, faults: [{ match: 'by-date?date=2026-11-22', throw: true }] });
  ok('T11 a card read that throws every time (no answer at all): the day is named as unread with the reason, after two reads, and the run is not green about a blind window only when 3 or more days are lost',
     down.code === 0 && replayOf(down).unreadDays.some((u) => u.date === '2026-11-22' && String(u.why).includes('fake network failure')) && asked(down, 'by-date?date=2026-11-22') === 2,
     `exit ${down.code} ${JSON.stringify(replayOf(down) && replayOf(down).unreadDays)}`);
  const safeGetMut = libMutant('LM-safeGet', 'catch (e) { return { status: 0, why: e.message }; }', 'catch (e) { return { status: 200, json: { results: [] } }; }');
  const rr = await replayWith(safeGetMut, fixDep, WORLD, {}, {});
  ok('(sanity) a replay whose relay reads never throw is unaffected by that mutant', rr.harness.length === 0);
  const thrower = async (p) => { if (p.includes('date=2026-11-22')) throw new Error('boom'); return fakeRelay(WORLD)(p); };
  const real = await lib.runReplay({ relayGet: thrower, deployed: fixDep, today: TODAY });
  const mut = await safeGetMut.runReplay({ relayGet: thrower, deployed: fixDep, today: TODAY });
  ok('LM-safeGet a relay read that throws is a named unread day carrying the reason; a replay that turns the throw into an empty answer records nothing (so T11 can fail)',
     real.unreadDays.some((u) => u.date === '2026-11-22' && String(u.why).includes('boom')) && mut.unreadDays.length === 0,
     JSON.stringify([real.unreadDays, mut.unreadDays]));

  const edge = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE,
    draws: worldWith((w) => { w.draws['135:2026'].badEdge = true; }).draws });
  ok('T12 an edge round that carries a canonical size fails the run on its own, and the client replay is still ok',
     edge.code === 1 && edge.summary.edgeRuleViolations >= 1 && statusOf(edge) === 'ok', `exit ${edge.code} ${edge.summary && edge.summary.edgeRuleViolations} ${statusOf(edge)}`);

  const noCensus = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, census: [] });
  ok('T13 a census with no tournaments exits 1 ("not a no") and writes its artifact',
     noCensus.code === 1 && noCensus.out.includes('no tournaments read') && noCensus.artifact !== null, `exit ${noCensus.code}`);
});

// Each mutant of the detector or the library must PASS the input the real one fails.
const exitRule = '|| client.refusals.length || harnessErrors.length ? 1 : 0';
const feed = 'if (replay) splitDrift.push(...replay.violations.map((v) => v.text));';
const refusal = '|| contradictory.length\n            || client.refusals.length';
const dm1 = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, cards: {},
  mutateDetector: (t) => mutate(t, exitRule, '|| client.refusals.length ? 1 : 0', 'DM1') });
ok('DM1 an exit rule that ignores harness errors passes the empty-card run (so D4 can fail)', dm1.code === 0, `exit ${dm1.code}`);
const dm2 = runDetector({ deployedText: CURRENT_DEPLOYED, sourceText: CURRENT_SOURCE,
  mutateDetector: (t) => mutate(t, feed, '', 'DM2') });
ok('DM2 a detector that never feeds the violations into clientSplitDrift passes the current client (so D1 can fail)',
   dm2.code === 0 && dm2.summary.clientSplitDrift.length === 0, `exit ${dm2.code}`);
const dm3 = runDetector({ deployedText: mutate(CURRENT_DEPLOYED, 'function _tennisDrawPick(rows) {', 'function _tennisDrawPickX(rows) {', 'DM3'),
  sourceText: CURRENT_SOURCE, mutateDetector: (t) => mutate(t, refusal, '|| contradictory.length\n            ', 'DM3') });
ok('DM3 an exit rule that ignores refusals passes a client it could not read (so D3 can fail)', dm3.code === 0, `exit ${dm3.code}`);
const dm4 = runDetector({ deployedText: THROWS, sourceText: FIXED_SOURCE,
  mutateDetector: (t) => mutate(t, "if (replayRefusal !== null) harnessErrors.push(`the replay refused to run: ${replayRefusal}`);", '', 'DM4') });
ok('DM4 a detector that drops a replay that threw passes the client that throws (so D6 can fail): the green that means "I could not look"',
   dm4.code === 0, `exit ${dm4.code}`);
const dm5 = runDetector({ deployedText: CURRENT_DEPLOYED, sourceText: FIXED_SOURCE,
  mutateDetector: (t) => mutate(t, 'deployed: client.deployed, source: client.source,', 'deployed: client.source, source: client.deployed,', 'DM5') });
ok('DM5 a detector that judges the SOURCE and not the deployed page reports no drift on a deployed client that is wrong (so D5 can fail)',
   dm5.summary && dm5.summary.clientSplitDrift.filter((x) => /^I[12] /.test(x)).length === 0, JSON.stringify(dm5.summary && dm5.summary.clientSplitDrift));
const dm6 = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE,
  mutateDetector: (t) => mutate(t, 'today: TS.slice(0, 10) });', "today: '2026-11-26' });", 'DM6'), now: '2027-01-04T09:00:00.000Z' });
ok('DM6 a detector with a fixed "today" reads the wrong window on 2027-01-04 (so D7 can fail)',
   dm6.summary && replayOf(dm6).window.to === '2026-11-26', JSON.stringify(replayOf(dm6) && replayOf(dm6).window));
const dm7 = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, faults: [{ match: 'draw?tournament=446&season=2026', status: 502, times: 1 }],
  mutateDetector: (t) => mutate(t, 'readOnceMore(() => getOnce(path, timeout), { pauseMs: RETRY_PAUSE_MS })', 'getOnce(path, timeout)', 'DM7') });
ok('DM7 a detector whose relay reads are single-shot fails the run on one transient 502 of a pinned draw read (so T4 can fail)', dm7.code === 1, `exit ${dm7.code}`);
const dm7b = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, faults: [{ match: 'by-date?date=2026-11-23', status: 503, times: 1 }],
  mutateDetector: (t) => mutate(t, 'readOnceMore(() => getOnce(path, timeout), { pauseMs: RETRY_PAUSE_MS })', 'getOnce(path, timeout)', 'DM7b') });
ok('DM7b a single-shot detector asks for a transiently failing trailing card once, not twice (so T3\'s read count can fail)', asked(dm7b, 'by-date?date=2026-11-23') === 1, `reads ${asked(dm7b, 'by-date?date=2026-11-23')}`);
const dm8 = runDetector({ deployedText: mutate(CURRENT_DEPLOYED, 'function _tennisDrawPick(rows) {', 'function _tennisDrawPickX(rows) {', 'DM8'),
  sourceText: CURRENT_SOURCE, mutateDetector: (t) => mutate(t, "client.refusals.length ? 'refused'", "client.refusals.length ? 'ok'", 'DM8') });
ok('DM8 a status that calls a refused client ok says ok where the real one says refused (so D3 can fail)', statusOf(dm8) === 'ok', String(statusOf(dm8)));
const TRAIL_BLIND = ['if (trailingRead < TRAILING_MIN_READ)', 'if (false)'];
const TRAIL_WEAK = ['if (trailingRead < TRAILING_MIN_READ)', 'if (trailingRead < 3)'];
const sixDown = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-26'].map((d) => ({ match: `by-date?date=${d}`, status: 429 }));
const dm9 = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, faults: sixDown, mutateLib: (t) => mutate(t, ...TRAIL_BLIND, 'DM9') });
ok('DM9 a detector without the blind-window rule exits 0 on the run where every non-pinned trailing day was unread — the green the review found (so T1 can fail)',
   dm9.code === 0 && replayOf(dm9).harness.length === 0, `exit ${dm9.code} ${JSON.stringify(replayOf(dm9) && replayOf(dm9).harness)}`);
const threeDown = ['2026-11-21', '2026-11-22', '2026-11-23'].map((d) => ({ match: `by-date?date=${d}`, status: 429 }));
const dm10 = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, faults: threeDown, mutateLib: (t) => mutate(t, ...TRAIL_WEAK, 'DM10') });
ok('DM10 a threshold of 3 passes a window of which 3 days were unread (4 of 7 read), so the real threshold can fail it', dm10.code === 0, `exit ${dm10.code}`);
const real10 = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, faults: threeDown });
ok('(real) the same three unread days fail the run as a blind window (4 of 7 read)',
   real10.code === 1 && replayOf(real10).harness.length === 1 && replayOf(real10).harness[0].startsWith('trailing window blind') && replayOf(real10).harness[0].includes('read 4 of 7'), `exit ${real10.code} ${JSON.stringify(replayOf(real10).harness)}`);
const twoDown = ['2026-11-21', '2026-11-22'].map((d) => ({ match: `by-date?date=${d}`, status: 429 }));
const real11 = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, faults: twoDown });
ok('(real) two unread days (5 of 7 read) are named in the output and do not fail the run',
   real11.code === 0 && statusOf(real11) === 'ok' && replayOf(real11).unreadDays.length === 2 && real11.out.includes('unread day 2026-11-21') && real11.out.includes('trailing window: 5 of 7 read'), `exit ${real11.code} ${real11.out.slice(-300)}`);

const dm11 = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, draws: worldWith((w) => { w.draws['135:2026'].badEdge = true; }).draws,
  mutateDetector: (t) => mutate(t, 'process.exit(edgeBad.length || splitDrift.length ||', 'process.exit(splitDrift.length ||', 'DM11') });
ok('DM11 an exit rule that ignores edge-rule violations passes the bad-edge run (so T12 can fail)', dm11.code === 0, `exit ${dm11.code}`);
const dm12 = runDetector({ deployedText: FIXED_DEPLOYED, sourceText: FIXED_SOURCE, census: [],
  mutateDetector: (t) => mutate(t, 'if (!all.length) {', 'if (false) {', 'DM12') });
ok('DM12 a detector that carries on with an empty census exits 0 (so T13 can fail)', dm12.code === 0, `exit ${dm12.code}`);

// Derived, never written down. A hardcoded total is how `self-test: 28/28` kept printing 28 after three assertions
// were added, in this same repo.
console.log(`\nCOVERAGE: ${pass + fail} assertion(s) over the LOADER, the REPLAY and the DETECTOR's exit rule and artifact, against fixtures and a fake relay —`);
console.log(`  the client's deployed (esbuild) and source shapes, the fixed client built by three asserted edits, the 11 designed cases,`);
console.log(`  ${ANCHORS.filter((a) => a.required).length * 2} missing-anchor mutations plus ambiguity, reference, garbage, control, sandbox and hostile-page cases (promise jobs and`);
console.log(`  import() run in child processes), the round vocabulary (each of the seven names dropped, two typos, a predicate that counts`);
console.log(`  qualifying rows, an unreadable or incomplete vocabulary edition), the pinned-day failures, the trailing window (one day, six`);
console.log(`  days, a blind window), the retry (a transient read once more, every 4xx not), and tennis-tier-ladders.mjs run as a child process`);
console.log(`  on ${detectorRuns} client/relay/fault combinations with a frozen clock (${mutantRuns} of them mutants of it or of the library).`);
console.log(`  The relay's round vocabulary used by the fixtures is compared with src/index.js on every run.`);
console.log(`  It does NOT reach jubilant-bassoon or the relay over the network; the real reads run inside`);
console.log(`  tennis-tier-ladders.mjs, where a refusal, a pin that does not reproduce, an unread day and zero checks all exit 1.`);
console.log(fail ? `\n${fail} FAILED of ${pass + fail}` : `\nself-test: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
