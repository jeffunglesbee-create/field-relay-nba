// THE GUARD MUST RETURN BEFORE THE CHARGE, AND MUST NOT OUTLIVE THE DEFECT.
//
// `_fetchLiveOdds` called /v4/sports/{sport}/odds-live, which the vendor does
// not serve (404 on both sport keys, run 38186065943, /odds returning 401 on
// the same keys as the control). Every call was a 404, so the function never
// produced an odds row — while the line above its fetch charged our own ledger
// 2 credits per attempt. 1037 calls / 2074 credits on 2026-10-10, all recorded
// by reconcile as `no-header` because a 404 carries no x-requests-last.
//
// FOUR WAYS THIS COMES BACK, and the fourth is the one reading would miss:
//   1. the constant deleted
//   2. the constant flipped to false
//   3. the guard deleted from _fetchLiveOdds
//   4. the guard moved BELOW the charge — still disabled, still spending
//
// And the reciprocal, so the guard cannot outlive what it guards: if the URL
// stops saying odds-live, the guard must go with it, or a repointed endpoint is
// silently never called.
import { readFileSync } from 'node:fs';
import { blankCommentsAndStrings } from './lib/blank-comments.mjs';

const SRC = process.env.AMBIENT_DO_SRC || 'src/ambient-do.js';

// FOUND BY SHAPE, IN CODE, INSIDE _fetchLiveOdds. Until 2026-10-19 the guard and
// the charge were exact-text anchors searched over the whole file. That was
// harmless while this step ran only in guards.yml; once it joined deploy.yml,
// the final review pass showed two correct rewrites blocking the deploy:
// hoisting the cost into a const (the charge text changed) and wrapping the
// 133-character charge line (ditto). Comments and strings are blanked, so a
// guard or a charge that survives only in a comment is not counted.
const GUARD_RE  = /if\s*\(\s*ODDS_LIVE_PATH_404\s*\)\s*(?:\{\s*return\s*;?\s*\}|return\s*;?)/;
const DECL_RE   = /const\s+ODDS_LIVE_PATH_404\s*=\s*(true|false)\s*;?/;
const CHARGE    = '_consumeAmbientOddsCredit(';
const GUARD     = 'if (ODDS_LIVE_PATH_404) return;';   // the text a mutation writes back

// [start, end) of _fetchLiveOdds in `code`, or null.
function liveSpan(code) {
  const start = code.search(/^ {4}async _fetchLiveOdds\s*\(/m);
  if (start < 0) return null;
  const re = /^ {4}(?:async\s+)?(?!(?:if|for|while|switch|catch|return)\b)[_a-zA-Z]\w*\s*\(/gm;
  re.lastIndex = start + 1;
  const next = re.exec(code);
  return [start, next ? next.index : code.length];
}

// Offsets of the guard (with its matched text) and of the charge, in the raw
// source, or -1 / null.
function locate(src) {
  const code = blankCommentsAndStrings(src);
  const span = liveSpan(code);
  if (!span) return { guardAt: -1, guardText: null, chargeAt: -1, declared: DECL_RE.exec(code) };
  const body = code.slice(span[0], span[1]);
  const g = GUARD_RE.exec(body);
  const c = body.indexOf(CHARGE);
  return {
    guardAt:   g ? span[0] + g.index : -1,
    guardText: g ? src.slice(span[0] + g.index, span[0] + g.index + g[0].length) : null,
    chargeAt:  c < 0 ? -1 : span[0] + c,
    declared:  DECL_RE.exec(code),
  };
}

export function findings(src) {
  const out = [];
  // Template text survives the blanking; a URL quoted in a comment does not.
  const urlSaysOddsLive = /\/odds-live\?apiKey=/.test(blankCommentsAndStrings(src));
  const { guardAt, chargeAt, declared } = locate(src);

  if (chargeAt === -1) {
    out.push(`the charge call (${CHARGE}…) is not in _fetchLiveOdds in ${SRC} — this check can no longer tell whether the guard precedes it`);
    return out;
  }

  if (!urlSaysOddsLive) {
    // The defect is gone. The guard must be gone too, or the repointed call is
    // dead code that never runs.
    if (guardAt !== -1) {
      out.push('the odds-live URL is gone but the guard remains — whatever it was repointed at is never called, because the guard returns first');
    }
    return out;
  }

  if (!declared) {
    out.push('ODDS_LIVE_PATH_404 is not declared — the guard below has nothing to read and the 404 loop is back');
  } else if (declared[1] !== 'true') {
    out.push(`ODDS_LIVE_PATH_404 is declared ${declared[1]} — the vendor still 404s this path, so this resumes charging 2 credits per call for nothing`);
  }

  if (guardAt === -1) {
    out.push(`the guard "${GUARD}" is not in _fetchLiveOdds in ${SRC} while the URL still says odds-live — every call is a 404 and every call is charged`);
  } else if (guardAt > chargeAt) {
    out.push('the guard sits AFTER the charge — the call is still disabled but the credits are still spent, which is the worst of both');
  }
  return out;
}

if (process.argv.includes('--self-test')) {
  let ran = 0, fail = 0;
  const ok = (n, c, d = '') => { ran++; if (!c) { fail++; console.log(`  FAIL  ${n}${d ? `\n          ${d}` : ''}`); } else console.log(`  ok    ${n}`); };

  console.log('THE REAL SOURCE, unmutated:');
  const live = readFileSync(SRC, 'utf8');
  ok('no findings against the live source', findings(live).length === 0, JSON.stringify(findings(live)));

  console.log('\nMUTATIONS — each must be CAUGHT:');
  const M = (from, to) => {
    if (!live.includes(from)) return [`MUTATION ANCHOR NOT FOUND: ${from.slice(0, 60)}`];
    if (live.split(from).length - 1 !== 1) return [`MUTATION ANCHOR NOT UNIQUE: ${from.slice(0, 60)}`];
    return findings(live.replace(from, to));
  };

  // Every anchor below is read off the live source BY SHAPE (locate()), so a
  // correct reformat of the declaration, the guard or the charge cannot leave
  // a mutation with nothing to bite and block the deploy.
  const loc = locate(live);
  const declText = loc.declared ? live.slice(loc.declared.index, loc.declared.index + loc.declared[0].length) : '\u0000no declaration\u0000';
  const guardText = loc.guardText ?? '\u0000no guard\u0000';

  ok('M1 the constant flipped to false',
     M(declText, 'const ODDS_LIVE_PATH_404 = false;')
       .some((x) => x.includes('resumes charging')));
  ok('M2 the constant deleted',
     M(declText, '').some((x) => x.includes('not declared')));
  ok('M3 the guard deleted',
     M(guardText, '').some((x) => x.includes('every call is a 404 and every call is charged')));

  // THE ONE READING WOULD MISS. Still disabled, still spending.
  //
  // The first version of this mutation did `.replace(CHARGE, GUARD + ' ' + CHARGE)`,
  // which put the guard back in FRONT of the charge — it asserted the opposite
  // of its own name and reported NOT CAUGHT on a check that was working. The
  // guard has to follow the whole charge STATEMENT: found here by shape, from
  // the charge to the first `;` outside brackets, however it is wrapped.
  const noGuard = live.split(guardText).length - 1 === 1 ? live.replace(guardText, '') : null;
  const chargeAt = noGuard === null ? -1 : locate(noGuard).chargeAt;
  let stmtEnd = -1;
  if (chargeAt >= 0) {
    const code = blankCommentsAndStrings(noGuard);
    for (let k = chargeAt, depth = 0; k < code.length; k++) {
      const c = code[k];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ';' && depth <= 0) { stmtEnd = k + 1; break; }
    }
  }
  ok('M4 the guard moved below the charge',
     stmtEnd > 0
       ? findings(`${noGuard.slice(0, stmtEnd)}\n            ${GUARD}${noGuard.slice(stmtEnd)}`)
           .some((x) => x.includes('AFTER the charge'))
       : false,
     'a guard that returns after the credit is taken costs exactly as much as no guard — and this assertion is false if its own anchor is missing or not unique');

  // The reciprocal.
  ok('M5 the URL repointed while the guard stays',
     M('/odds-live?apiKey=', '/odds?apiKey=').some((x) => x.includes('never called')));
  ok('M6 the URL repointed AND the guard removed is clean',
     findings(live.replace('/odds-live?apiKey=', '/odds?apiKey=').replace(guardText, '')).length === 0,
     'this check must not block the real fix');

  // CORRECT REWRITES STAY CLEAN, and copies in comments or strings do not
  // count. On a fixed fixture, not the live file, so these assertions cannot
  // themselves go red on a reformat of src/ (final review pass, 2026-10-19).
  const ranLive = ran;
  console.log('\nFIXTURE — correct rewrites must stay clean, comment and string copies must not count:');
  const FX = `const ODDS_LIVE_PATH_404 = true;
class D {
    async _fetchLiveOdds() {
        if (ODDS_LIVE_PATH_404) return;
        // a key comment
        const buildUrl = (k) =>
            \`https://vendor.invalid/v4/sports/s/odds-live?apiKey=\${k}&markets=h2h\`;
        if (!(await _consumeAmbientOddsCredit(this.env, oddsCreditCost(buildUrl('')), 'ambientFetchLiveOdds'))) return;
        const r = await fetch(buildUrl(k));
    }
    async _captureClosingOdds() {
        if (!(await _consumeAmbientOddsCredit(this.env, oddsCreditCost(url), 'ambientCaptureClosingOdds'))) return;
    }
}`;
  const FX_CHARGE = "        if (!(await _consumeAmbientOddsCredit(this.env, oddsCreditCost(buildUrl('')), 'ambientFetchLiveOdds'))) return;";
  const FX_GUARD  = '        if (ODDS_LIVE_PATH_404) return;';
  const fx = (from, to) => (FX.split(from).length - 1 === 1 ? findings(FX.replace(from, to)) : [`FIXTURE ANCHOR NOT UNIQUE: ${from.slice(0, 50)}`]);
  ok('F0 the fixture itself is clean', findings(FX).length === 0, JSON.stringify(findings(FX)));
  ok('E1 the cost hoisted into a const is clean',
     fx(FX_CHARGE, "        const liveCost = oddsCreditCost(buildUrl(''));\n        if (!(await _consumeAmbientOddsCredit(this.env, liveCost, 'ambientFetchLiveOdds'))) return;").length === 0);
  ok('E2 the charge wrapped across lines is clean',
     fx(FX_CHARGE, "        if (!(await _consumeAmbientOddsCredit(\n            this.env, oddsCreditCost(buildUrl('')), 'ambientFetchLiveOdds'))) return;").length === 0);
  ok('E3 the guard written with braces is clean',
     fx(FX_GUARD, '        if (ODDS_LIVE_PATH_404) { return; }').length === 0);
  ok('N1 the guard deleted, a commented copy left, is caught',
     fx(FX_GUARD, '        // if (ODDS_LIVE_PATH_404) return;').some((x) => x.includes('every call is charged')));
  ok('N2 the guard deleted, a copy in a string left, is caught',
     fx(FX_GUARD, "        const note = 'if (ODDS_LIVE_PATH_404) return;';").some((x) => x.includes('every call is charged')));
  ok('N3 the guard moved into the next method is caught',
     findings(FX.replace(FX_GUARD + '\n', '').replace("    async _captureClosingOdds() {\n", `    async _captureClosingOdds() {\n${FX_GUARD}\n`))
       .some((x) => x.includes('every call is charged')));

  console.log(fail ? `\n${fail} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`);
  console.log(`COVERAGE: ${ran} assertion(s): ${ranLive} over ${SRC} as SOURCE, ${ran - ranLive} on a fixed fixture. It checks the guard's`);
  console.log(`presence, its value and its position relative to the charge. It does NOT ask`);
  console.log(`the vendor anything — scripts/probe-odds-live-endpoint.mjs is what measured`);
  console.log(`the 404, and re-running that is how you would learn the path had come back.`);
  process.exitCode = fail ? 1 : 0;
} else {
  const found = findings(readFileSync(SRC, 'utf8'));
  if (found.length) {
    console.log(`FAIL  ${found.length} finding(s) in ${SRC}:`);
    found.forEach((x) => console.log(`   ${x}`));
    process.exitCode = 1;
  } else {
    console.log(`PASS  the odds-live 404 path returns before the charge (${SRC})`);
    console.log(`COVERAGE: source only — guard present, true, and ahead of the charge.`);
  }
}
