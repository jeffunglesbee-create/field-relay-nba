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
// This checks the SOURCE, because the behaviour lives in a Worker that cannot be
// imported here. SCOPED TO handleV2Games's body, for the reason
// check-ceiling-reached.mjs records: an unscoped regex matches a lookalike
// elsewhere and goes green while proving nothing about the code it names.
import { readFileSync } from 'node:fs';

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
  }
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
  const ok = (label, cond, detail = '') => { ran++; cond ? (pass++, console.log(`  PASS  ${label}`))
    : (fail++, console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`)); };

  const GOOD = `const ${CONST} = ${LIST};
async function handleV2Games(url, env, ctx, request = null) {
    const cfg   = V2_LEAGUES[sport];
        const _wcWpPossible = !${CONST}.includes(cfg.espnSport)
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
  ok('the fixed shape has no findings', findings(GOOD, sl(GOOD)).length === 0, JSON.stringify(findings(GOOD, sl(GOOD))));
  ok('a copy in ANOTHER function is not read as the defect', !findings(GOOD, sl(GOOD)).some(f => f.includes('UNCONDITIONAL')),
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

  console.log(fail ? `\n${fail} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`);
  console.log(`COVERAGE: ${ran} assertion(s) over FIXTURES, one unmutated positive control`);
  console.log(`and ${ran - 2} mutations. It reads source only — it cannot see what the`);
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
