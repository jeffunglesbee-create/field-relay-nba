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

const SRC = process.env.AMBIENT_DO_SRC || 'src/ambient-do.js';

const GUARD  = 'if (ODDS_LIVE_PATH_404) return;';
const CHARGE = '_consumeAmbientOddsCredit(this.env, oddsCreditCost(buildUrl';

export function findings(src) {
  const out = [];
  const urlSaysOddsLive = /\/odds-live\?apiKey=/.test(src);
  const declared = /const ODDS_LIVE_PATH_404 = (true|false);/.exec(src);
  const guardAt  = src.indexOf(GUARD);
  const chargeAt = src.indexOf(CHARGE);

  if (chargeAt === -1) {
    out.push(`the charge call (${CHARGE}…) is not in ${SRC} — this check can no longer tell whether the guard precedes it`);
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
    out.push(`the guard "${GUARD}" is not in ${SRC} while the URL still says odds-live — every call is a 404 and every call is charged`);
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

  ok('M1 the constant flipped to false',
     M('const ODDS_LIVE_PATH_404 = true;', 'const ODDS_LIVE_PATH_404 = false;')
       .some((x) => x.includes('resumes charging')));
  ok('M2 the constant deleted',
     M('const ODDS_LIVE_PATH_404 = true;', '').some((x) => x.includes('not declared')));
  ok('M3 the guard deleted',
     M(GUARD, '').some((x) => x.includes('every call is a 404 and every call is charged')));

  // THE ONE READING WOULD MISS. Still disabled, still spending.
  //
  // The first version of this mutation did `.replace(CHARGE, GUARD + ' ' + CHARGE)`,
  // which put the guard back in FRONT of the charge — it asserted the opposite
  // of its own name and reported NOT CAUGHT on a check that was working. The
  // anchor has to be the whole charge STATEMENT so the guard can follow it.
  //
  // BY SHAPE since 2026-10-19, when this step joined deploy.yml: the one line
  // that calls _consumeAmbientOddsCredit with the live poll's site, in whatever
  // spelling, trimmed. An exact-text anchor would fail this self-test, and so
  // the deploy, on a correct reformat of that line.
  const chargeLines = live.split('\n').map((L) => L.trim())
    .filter((L) => !L.startsWith('//') && L.includes('_consumeAmbientOddsCredit(') && L.includes("'ambientFetchLiveOdds'"));
  const CHARGE_STMT = chargeLines.length === 1 ? chargeLines[0] : '\u0000no unique charge statement\u0000';
  ok('M4 the guard moved below the charge',
     (live.includes(CHARGE_STMT) && live.split(CHARGE_STMT).length - 1 === 1)
       ? findings(live.replace(GUARD, '').replace(CHARGE_STMT, `${CHARGE_STMT}\n            ${GUARD}`))
           .some((x) => x.includes('AFTER the charge'))
       : false,
     'a guard that returns after the credit is taken costs exactly as much as no guard — and this assertion is false if its own anchor is missing or not unique');

  // The reciprocal.
  ok('M5 the URL repointed while the guard stays',
     M('/odds-live?apiKey=', '/odds?apiKey=').some((x) => x.includes('never called')));
  ok('M6 the URL repointed AND the guard removed is clean',
     findings(live.replace('/odds-live?apiKey=', '/odds?apiKey=').replace(GUARD, '')).length === 0,
     'this check must not block the real fix');

  console.log(fail ? `\n${fail} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`);
  console.log(`COVERAGE: ${ran} assertion(s) over ${SRC}, as SOURCE. It checks the guard's`);
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
