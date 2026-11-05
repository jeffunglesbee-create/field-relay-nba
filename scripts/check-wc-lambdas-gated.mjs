// THE WC LAMBDA CALL MUST NOT BE UNCONDITIONAL, AND THE SPORT LIST MUST BE ONE LIST.
//
// getWCPregameLambdas spends 4 credits per charged attempt — markets h2h,totals
// over regions us,eu, and ODDS_REGIONS_MULTIPLY is true (measured 2026-09-05).
// Its only cache is `_wcLambdaCache`, module-level inside a Worker isolate, so
// it does not survive across isolates and a cold one charges again.
//
// It was awaited unconditionally in handleV2Games, for every sport and every
// date. Measured 2026-10-07 from /budget/odds: by_site getWCPregameLambdas read
// 2536 against 4 the day before — 634 charged attempts — and the day's 3800
// ceiling was gone by 01:16:29Z. The provider billed 514 across the same 24.6h
// window, so almost none of those attempts reached the vendor; the edge cache
// answered them while the counter charged the estimate.
//
// THE WINDOW HALF, added 2026-11-05 (docs/CC-CMD-2026-10-23-odds-spend-without-need.md).
// The sport and liveness halves left every live CLUB soccer game charging for the
// World Cup key all year: 6261 calls on 26 of 29 ledger days from 2026-10-08, 1801
// reconciled, every one kept 0. The gate must also require the tournament window,
// and the window must be the one scheduled() already uses: two Dates at module
// scope, declared once (scripts/measure-odds-consumer-demand.mjs throws on any
// other count). The predicate's TEXT is evaluated here at five instants, because
// a regex that finds `wcWindowOpenNow()` in the gate cannot tell a window from
// `return true`.
//
// This checks the SOURCE, because the behaviour lives in a Worker that cannot be
// imported here. SCOPED TO handleV2Games's body, for the reason
// check-ceiling-reached.mjs records: an unscoped regex matches a lookalike
// elsewhere and goes green while proving nothing about the code it names.
import { readFileSync } from 'node:fs';
import { blankCommentsAndStrings } from './lib/blank-comments.mjs';

const SRC = process.env.RELAY_SRC || 'src/index.js';
const LIST = "['baseball', 'football', 'basketball', 'australian-football']";
const CONST = 'V2_NON_SOCCER_WP_SPORTS';

/** handleV2Games's body, or null. Sliced at the next top-level `}` the way the
 *  sibling checks do, so a regex below cannot wander into another handler. */
export function sliceHandler(whole) {
  const i = whole.indexOf('async function handleV2Games');
  if (i < 0) return null;
  const j = whole.indexOf('\n}\n', i);
  if (j < 0) return null;
  return whole.slice(i, j);
}

/** Split an expression at its TOP-LEVEL `&&`, and say whether a top-level `||`
 *  or `,` exists. Depth counts () [] {}. Pure over a comment-blanked string. */
export function topLevel(expr) {
  const terms = []; let depth = 0, cur = '', hasOr = false, hasComma = false;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i], d = expr[i + 1];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if (depth === 0 && c === '&' && d === '&') { terms.push(cur.trim()); cur = ''; i++; continue; }
    if (depth === 0 && c === '|' && d === '|') hasOr = true;
    if (depth === 0 && c === ',') hasComma = true;
    cur += c;
  }
  terms.push(cur.trim());
  return { terms: terms.map(t => t.replace(/\s+/g, ' ')), hasOr, hasComma };
}

/** The window predicate, evaluated from the real text of `whole` at five
 *  instants. Pure over the string. Returns findings, [] when it is right.
 *  Everything is located in the COMMENT-BLANKED text (offsets are identical), so
 *  a declaration that lives in a comment is not a declaration, and a function
 *  inside a template literal is not at module scope. */
export function windowFindings(whole) {
  const out = [];
  const code = blankCommentsAndStrings(whole);
  const at = (re) => [...code.matchAll(re)].map(m => m.index);
  const inTemplate = (idx) => ((code.slice(0, idx).match(/`/g) || []).length % 2) === 1;
  const where = (name) => {
    const any = at(new RegExp(`const\\s+${name}\\s*=\\s*new Date\\(`, 'g'));
    const top = at(new RegExp(`^const\\s+${name}\\s*=\\s*new Date\\(`, 'gm')).filter(i => !inTemplate(i));
    if (any.length !== 1 || top.length !== 1) {
      out.push(`${name} is declared ${any.length} time(s), ${top.length} at module scope — it must be declared exactly once, at module scope, in code`);
      return null;
    }
    const end = code.indexOf(';', top[0]);
    return whole.slice(top[0], end + 1);
  };
  const open = where('_wcOpen');
  const close = where('_wcClose');
  // scheduled() must still read the same Dates, or the hoist orphaned them.
  if (!/const\s+_isWCWindow\s*=[^;]*\b_wcOpen\b[^;]*\b_wcClose\b/.test(code)) {
    out.push('_isWCWindow no longer reads _wcOpen and _wcClose — scheduled() and the lambdas gate would use different windows');
  }
  const fnAny = at(/function\s+wcWindowOpenNow\b/g);
  const fnTop = at(/^function wcWindowOpenNow\(\)\s*\{/gm).filter(i => !inTemplate(i));
  let fn = null;
  if (fnAny.length !== 1 || fnTop.length !== 1) {
    out.push(`wcWindowOpenNow is declared ${fnAny.length} time(s), ${fnTop.length} at module scope — it must be declared exactly once, at module scope, in code`);
  } else {
    const end = code.indexOf('\n}', fnTop[0]);
    if (end < 0) out.push('wcWindowOpenNow has no closing brace at column 0 — the window cannot be evaluated');
    else fn = whole.slice(fnTop[0], end + 2);
  }
  if (!open || !close || !fn) return out;
  const evalAt = (iso) => {
    const ms = Date.parse(iso);
    // Date.now() is pinned as well as `new Date()`: a predicate written either way is the same predicate.
    class Pinned extends Date { constructor(...a) { if (a.length) super(...a); else super(ms); } static now() { return ms; } }
    return new Function('Date', `${open}\n${close}\n${fn}\nreturn wcWindowOpenNow();`)(Pinned);
  };
  const CASES = [
    ['2026-06-10T23:59:59.999Z', false, 'one ms before the open'],
    ['2026-06-11T00:00:00.000Z', true,  'the open instant'],
    ['2026-07-19T23:59:59.999Z', true,  'one ms before the close'],
    ['2026-07-20T00:00:00.000Z', false, 'the close instant'],
    ['2026-11-05T12:00:00.000Z', false, 'a day this tournament is over'],
  ];
  for (const [iso, want, label] of CASES) {
    let got;
    try { got = evalAt(iso); } catch (e) { out.push(`wcWindowOpenNow threw at ${iso}: ${e.message}`); continue; }
    if (got !== want) out.push(`wcWindowOpenNow() at ${iso} (${label}) returned ${got}, expected ${want}`);
  }
  return out;
}

/** Every finding, as an array so an empty one is the pass. Pure over the two
 *  strings, so the self-test can drive it with fixtures. */
export function findings(whole, slice) {
  const out = [];
  if (slice === null) return ['handleV2Games was not found in the source — nothing else ran'];

  const calls = (slice.match(/getWCPregameLambdas\(/g) || []).length;
  if (calls !== 1) out.push(`expected exactly 1 getWCPregameLambdas( call in handleV2Games, found ${calls}`);

  // The defect, exactly as it was: assigned with no condition in front of it.
  if (/const\s+wcLambdas\s*=\s*await\s+getWCPregameLambdas\(/.test(slice)) {
    out.push('getWCPregameLambdas is awaited UNCONDITIONALLY — every /v2/games request charges 4 credits');
  }

  // Both halves of the gate, named. A gate on only the sport still charges on
  // every soccer request with no live game; a gate on only liveness still
  // charges on a live NFL slate, which is what 2026-10-07 was.
  const gate = slice.match(/const\s+_wcWpPossible\s*=([\s\S]{0,400}?);/);
  if (!gate) out.push('no _wcWpPossible gate found in handleV2Games');
  else {
    if (!gate[1].includes(CONST)) out.push(`the gate does not test ${CONST} — a live NFL slate would charge`);
    if (!/state\s*===\s*'live'/.test(gate[1])) out.push("the gate does not test state === 'live' — a soccer day with no live game would charge");
    if (!/\.situation/.test(gate[1])) out.push('the gate does not test g.situation — the loop requires it and this must match');
    // The window must be IN the gate. A window tested only inside the callee
    // still lets the call charge, because the charge is taken inside it.
    // Judged on the COMMENT-BLANKED gate, as a TOP-LEVEL conjunct: a commented-out
    // term, `!wcWindowOpenNow()`, `(wcWindowOpenNow() || true)`, `(wcWindowOpenNow(), true)`
    // and a top-level `||` all contain the token and none of them is a window.
    const blankedGate = blankCommentsAndStrings(slice).match(/const\s+_wcWpPossible\s*=([\s\S]{0,400}?);/);
    const tl = blankedGate ? topLevel(blankedGate[1]) : null;
    if (!tl || !tl.terms.includes('wcWindowOpenNow()')) {
      out.push('the gate does not test wcWindowOpenNow() as an un-negated top-level && term — a live club soccer game outside the tournament would charge for the World Cup key');
    } else if (tl.hasOr || tl.hasComma) {
      out.push('the gate has a top-level || or comma — wcWindowOpenNow() is then not a conjunct that must hold');
    }
  }
  out.push(...windowFindings(whole));
  // THE CALL MUST BE ON THE GATE'S TRUE BRANCH. Matching only
  // `wcLambdas = _wcWpPossible ?` passed an INVERTED ternary, which charges on
  // exactly the requests the gate exists to spare. Found by mutation M6, which
  // was written to catch "gate present, call not behind it" and instead showed
  // the assertion could not tell the two branches apart.
  if (!/wcLambdas\s*=\s*_wcWpPossible\s*\?\s*await\s+getWCPregameLambdas\(/.test(slice)) {
    out.push('the call is not on the TRUE branch of _wcWpPossible — an inverted or absent gate charges the requests it should spare');
  }

  // ONE LIST. Two copies of the literal is the drift this hoist removed, and the
  // loop's own `continue` is the other reader.
  const literals = (whole.split(LIST).length - 1);
  if (literals > 1) out.push(`the sport list literal appears ${literals} times — it must appear once, as ${CONST}`);
  if (!new RegExp(`const\\s+${CONST}\\s*=\\s*\\[`).test(whole)) out.push(`${CONST} is not declared`);
  if ((slice.match(new RegExp(CONST, 'g')) || []).length < 2) {
    out.push(`${CONST} is read fewer than twice in handleV2Games — the gate and the loop's continue both need it`);
  }
  return out;
}

if (process.argv.includes('--self-test')) {
  let pass = 0, fail = 0, ran = 0;
  let controls = 0;
  const okC = (...a) => { controls++; return ok(...a); };
  const ok = (label, cond, detail = '') => { ran++; cond ? (pass++, console.log(`  PASS  ${label}`))
    : (fail++, console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`)); };

  const GOOD = `const ${CONST} = ${LIST};
const _wcOpen  = new Date('2026-06-11T00:00:00Z');
const _wcClose = new Date('2026-07-20T00:00:00Z');
function wcWindowOpenNow() {
    const t = new Date();
    return t >= _wcOpen && t < _wcClose;
}
async function getWCPregameLambdas(env) { return null; }
async function scheduled(event, env, ctx) {
        const _now = new Date();
        const _isWCWindow = _now >= _wcOpen && _now < _wcClose;
}
async function handleV2Games(url, env, ctx, request = null) {
    const cfg   = V2_LEAGUES[sport];
        const _wcWpPossible = !${CONST}.includes(cfg.espnSport)
            && wcWindowOpenNow()
            && games.some(g => g.state === 'live' && g.situation);
        const wcLambdas = _wcWpPossible ? await getWCPregameLambdas(env) : null;
        for (const g of games) {
            if (g.state !== 'live' || !g.situation) continue;
            if (${CONST}.includes(cfg.espnSport)) continue;
            if (wcLambdas) { }
        }
}
async function somethingElse() { const wcLambdas = await getWCPregameLambdas(env); }
`;
  const sl = (w) => sliceHandler(w);
  okC('the fixed shape has no findings', findings(GOOD, sl(GOOD)).length === 0, JSON.stringify(findings(GOOD, sl(GOOD))));
  okC('a copy in ANOTHER function is not read as the defect', !findings(GOOD, sl(GOOD)).some(f => f.includes('UNCONDITIONAL')),
     'the slice is why — an unscoped regex would match the last line');

  const M = (from, to) => { const w = GOOD.replace(from, to); return findings(w, sl(w)); };
  ok('M1 the gate removed is CAUGHT',
     M("const wcLambdas = _wcWpPossible ? await getWCPregameLambdas(env) : null;",
       "const wcLambdas = await getWCPregameLambdas(env);").some(f => f.includes('UNCONDITIONAL')));
  ok('M2 the liveness half dropped is CAUGHT',
     M("            && games.some(g => g.state === 'live' && g.situation);", "            && true;")
       .some(f => f.includes("state === 'live'")));
  ok('M3 the sport half dropped is CAUGHT',
     M(`!${CONST}.includes(cfg.espnSport)\n`, 'true\n').some(f => f.includes(CONST)));
  ok('M4 a second copy of the list literal is CAUGHT',
     M("if (wcLambdas) { }", `if (${LIST}.includes(x)) { }`).some(f => f.includes('appears 2 times')));
  ok('M5 the constant undeclared is CAUGHT',
     M(`const ${CONST} = ${LIST};`, '').some(f => f.includes('not declared')));
  ok('M6 an INVERTED gate is CAUGHT',
     M("const wcLambdas = _wcWpPossible ? await getWCPregameLambdas(env) : null;",
       "const wcLambdas = _wcWpPossible ? null : await getWCPregameLambdas(env);")
       .some(f => f.includes('not on the TRUE branch')));
  ok('M7 a missing handler refuses rather than passing',
     findings('nothing here', sliceHandler('nothing here'))[0].includes('was not found'),
     'an empty findings list on an unreadable source would be a green that read nothing');
  ok('M8 the loop losing the constant is CAUGHT',
     M(`            if (${CONST}.includes(cfg.espnSport)) continue;`, '            if (false) continue;')
       .some(f => f.includes('fewer than twice')));

  // THE WINDOW HALF. Each mutant is applied to the fixture and must be CAUGHT;
  // `MM` takes several replacements because M10 needs two. A mutant whose anchor
  // is absent or not unique mutates nothing and would report NOT CAUGHT on clean
  // source, so every anchor is asserted to occur exactly once first.
  const MM = (pairs) => {
    let w = GOOD;
    for (const [from, to] of pairs) {
      const n = w.split(from).length - 1;
      if (n !== 1) throw new Error(`mutant anchor occurs ${n} times, expected 1: ${from.slice(0, 60)}`);
      w = w.replace(from, to);
    }
    return findings(w, sl(w));
  };
  const GATE_LINE = "            && wcWindowOpenNow()\n";
  ok('M9 the window conjunct removed from the gate is CAUGHT',
     MM([[GATE_LINE, '']]).some(f => f.includes('does not test wcWindowOpenNow()')));
  ok('M10 the window tested only INSIDE the callee is CAUGHT',
     MM([[GATE_LINE, ''],
         ['async function getWCPregameLambdas(env) { return null; }',
          'async function getWCPregameLambdas(env) { if (!wcWindowOpenNow()) return null; return null; }']])
       .some(f => f.includes('does not test wcWindowOpenNow()')));
  ok('M11 a predicate that is always true is CAUGHT (the gate text alone cannot tell)',
     MM([['    return t >= _wcOpen && t < _wcClose;', '    return true;']])
       .some(f => f.includes('returned true, expected false')));
  ok('M12 an inclusive close (<=) is CAUGHT at the close instant',
     MM([['t >= _wcOpen && t < _wcClose;', 't >= _wcOpen && t <= _wcClose;']])
       .some(f => f.includes('the close instant')));
  ok('M13 an OR in place of the AND is CAUGHT',
     MM([['t >= _wcOpen && t < _wcClose;', 't >= _wcOpen || t < _wcClose;']])
       .some(f => f.includes('returned true, expected false')));
  ok('M14 a second copy of the Dates (a local in scheduled()) is CAUGHT',
     MM([["        const _now = new Date();\n",
          "        const _now = new Date();\n        const _wcOpen  = new Date('2026-06-11T00:00:00Z');\n"]])
       .some(f => f.includes('_wcOpen is declared 2 time(s)')));
  ok('M15 the Dates moved out of module scope (indented) is CAUGHT',
     MM([["const _wcClose = new Date('2026-07-20T00:00:00Z');", "  const _wcClose = new Date('2026-07-20T00:00:00Z');"]])
       .some(f => f.includes('0 at module scope') || f.includes('not found at module scope')));
  ok('M16 _isWCWindow no longer reading the module Dates is CAUGHT',
     MM([['const _isWCWindow = _now >= _wcOpen && _now < _wcClose;', 'const _isWCWindow = false;']])
       .some(f => f.includes('_isWCWindow no longer reads')));
  ok('M17 a window predicate that throws is CAUGHT, not passed',
     MM([['    const t = new Date();', '    const t = nope.nope;']])
       .some(f => f.includes('threw')));
  const NOT = 'does not test wcWindowOpenNow()';
  ok('M18 a NEGATED conjunct (&& !wcWindowOpenNow()) is CAUGHT',
     MM([["            && wcWindowOpenNow()\n", "            && !wcWindowOpenNow()\n"]]).some(f => f.includes(NOT)));
  ok('M19 a LINE-COMMENTED conjunct is CAUGHT',
     MM([["            && wcWindowOpenNow()\n", "            // && wcWindowOpenNow()\n"]]).some(f => f.includes(NOT)));
  ok('M20 a BLOCK-COMMENTED conjunct is CAUGHT',
     MM([["            && wcWindowOpenNow()\n", "            /* && wcWindowOpenNow() */\n"]]).some(f => f.includes(NOT)));
  ok('M21 a conjunct that is or-ed with true is CAUGHT',
     MM([["            && wcWindowOpenNow()\n", "            && (wcWindowOpenNow() || true)\n"]]).some(f => f.includes(NOT)));
  ok('M22 a conjunct behind the comma operator is CAUGHT',
     MM([["            && wcWindowOpenNow()\n", "            && (wcWindowOpenNow(), true)\n"]]).some(f => f.includes(NOT)));
  ok('M23 the window joined by a top-level || is CAUGHT',
     MM([["            && wcWindowOpenNow()\n", "            || wcWindowOpenNow()\n"]]).some(f => f.includes('top-level || or comma') || f.includes(NOT)));
  ok('M24 the Dates and the predicate inside a BLOCK COMMENT are CAUGHT',
     MM([["const _wcOpen  = new Date('2026-06-11T00:00:00Z');", "/* const _wcOpen  = new Date('2026-06-11T00:00:00Z');"],
         ["    return t >= _wcOpen && t < _wcClose;\n}", "    return t >= _wcOpen && t < _wcClose;\n} */"]])
       .some(f => f.includes('declared 0 time(s)')));
  ok('M25 the predicate inside a TEMPLATE LITERAL is CAUGHT',
     MM([["function wcWindowOpenNow() {\n    const t = new Date();\n    return t >= _wcOpen && t < _wcClose;\n}",
          "const _t = `\nfunction wcWindowOpenNow() {\n    const t = new Date();\n    return t >= _wcOpen && t < _wcClose;\n}\n`;"]])
       .some(f => f.includes('0 at module scope')));
  okC('C1 the same predicate written with Date.now() is NOT a finding (a refactor must not read as a defect)',
      MM([['    const t = new Date();', '    const t = Date.now();']]).length === 0,
      JSON.stringify(MM([['    const t = new Date();', '    const t = Date.now();']])));

  // REAL-SOURCE MUTANTS (Rule 90). The fixture proves the logic can fire; these
  // prove it can match THIS file, which is the other half of "failed on purpose".
  // R0 is the control: the unmutated source must be clean or no mutant means
  // anything. Every anchor is asserted to occur exactly once, because an anchor
  // that matches nothing mutates nothing and reports CAUGHT on a red source.
  let real = null;
  try { real = readFileSync(SRC, 'utf8'); } catch { /* reported below */ }
  if (real === null) {
    ok('R0 the real source is readable for the mutants', false, `${SRC} could not be read`);
  } else {
    const clean = findings(real, sliceHandler(real));
    okC('R0 the real source is clean (control for R1-R10)', clean.length === 0, JSON.stringify(clean));
    const RM = (from, to) => {
      const n = real.split(from).length - 1;
      if (n !== 1) throw new Error(`real-source anchor occurs ${n} times, expected 1: ${from.slice(0, 60)}`);
      const w = real.replace(from, to);
      return findings(w, sliceHandler(w));
    };
    const RGATE = "            && wcWindowOpenNow()\n";
    ok('R1 the window conjunct removed from the real gate is CAUGHT',
       RM(RGATE, '').some(f => f.includes('does not test wcWindowOpenNow()')));
    ok('R2 the real predicate made always-true is CAUGHT',
       RM('    return t >= _wcOpen && t < _wcClose;', '    return true;').some(f => f.includes('returned true, expected false')));
    ok('R3 the real close made inclusive is CAUGHT',
       RM('return t >= _wcOpen && t < _wcClose;', 'return t >= _wcOpen && t <= _wcClose;').some(f => f.includes('the close instant')));
    ok('R4 the hoist undone (local Dates back in scheduled()) is CAUGHT',
       RM('        const _isWCWindow = _now >= _wcOpen && _now < _wcClose;',
          "        const _wcOpen  = new Date('2026-06-11T00:00:00Z');\n        const _wcClose = new Date('2026-07-20T00:00:00Z');\n        const _isWCWindow = _now >= _wcOpen && _now < _wcClose;")
         .some(f => f.includes('is declared 2 time(s)')));
    ok('R5 the conjunct moved from the gate to the call line is CAUGHT',
       RM(RGATE + "            && games.some", "            && games.some").some(f => f.includes('does not test wcWindowOpenNow()')));
    ok('R6 scheduled() left reading nothing (_isWCWindow = false) is CAUGHT',
       RM('const _isWCWindow = _now >= _wcOpen && _now < _wcClose;', 'const _isWCWindow = false;').some(f => f.includes('_isWCWindow no longer reads')));
    ok('R7 the real conjunct negated is CAUGHT',
       RM(RGATE, "            && !wcWindowOpenNow()\n").some(f => f.includes('does not test wcWindowOpenNow()')));
    ok('R8 the real conjunct commented out is CAUGHT',
       RM(RGATE, "            // && wcWindowOpenNow()\n").some(f => f.includes('does not test wcWindowOpenNow()')));
    ok('R9 the real conjunct or-ed with true is CAUGHT',
       RM(RGATE, "            && (wcWindowOpenNow() || true)\n").some(f => f.includes('does not test wcWindowOpenNow()')));
    ok('R10 the real Dates and predicate inside a block comment are CAUGHT', (() => {
      const from = "const _wcOpen  = new Date('2026-06-11T00:00:00Z');";
      if (real.split(from).length - 1 !== 1) throw new Error('R10 anchor is not unique');
      const w1 = real.replace(from, '/* ' + from);
      const k = w1.indexOf('function wcWindowOpenNow() {');
      const e = w1.indexOf('\n}', k) + 2;
      const w2 = w1.slice(0, e) + ' */' + w1.slice(e);
      return findings(w2, sliceHandler(w2)).some(f => f.includes('declared 0 time(s)'));
    })());
  }

  console.log(fail ? `\n${fail} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`);
  console.log(`COVERAGE: ${ran} assertion(s): ${ran - controls} mutants (fixture M-series and real-source R-series) and ${controls} unmutated controls.`);
  console.log(`The window predicate is evaluated at 5 instants, with Date.now() pinned too.`);
  console.log(`It reads source only — it cannot see what the`);
  console.log(`deployed worker charges, which is what /budget/odds by_site reports.`);
  process.exit(fail ? 1 : 0);
}

const whole = readFileSync(SRC, 'utf8');
const found = findings(whole, sliceHandler(whole));
if (found.length) {
  console.log(`FAIL  ${found.length} finding(s) in ${SRC}:`);
  found.forEach((f) => console.log(`   ${f}`));
  process.exit(1);
}
console.log(`PASS  the WC lambda call is gated on both halves and the sport list is one list (${SRC})`);
console.log(`COVERAGE: source only, scoped to handleV2Games's body. The charge it prevents`);
console.log(`is visible as by_site.getWCPregameLambdas on /budget/odds, not here.`);
