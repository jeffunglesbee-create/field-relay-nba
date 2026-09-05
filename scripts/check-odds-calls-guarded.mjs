#!/usr/bin/env node
// Every fetch to the Odds API is charged to the monthly ledger, or says why not.
//
// WHY THIS EXISTS. On 2026-09-05 the provider reported 23,544 credits used while
// our own counter reported 5,749. The gap was not one bug: FOUR call sites spent
// provider quota and contributed nothing to the counter ODDS_HARD_LIMIT reads.
//
//   src/index.js      getWCPregameLambdas    live WP path, charged nothing
//   src/index.js      handleWCOddsProbs      public route, charged nothing
//   src/index.js      handleCFLOddsProbs     public route, charged nothing
//   src/ambient-do.js _captureClosingOdds    charged the DAILY layer only, and
//                                            charged 1 for a 3-market call
//
// Three of those were findable by reading the file. The fourth was not -- it had
// a guard call, it just called the wrong guard, so every grep for "is this site
// guarded" returned yes. That is the check this script has to make: not whether
// a guard is called, but whether the MONTHLY one is.
//
// The emergency floor that exists to prevent another quota wipeout was blind to
// four of the eight ways this worker spends money. A grep is not a gate; this is.

import { readFileSync } from 'node:fs';

const FILES = ['src/index.js', 'src/ambient-do.js', 'src/wp-resolver.js'];

// A guard that charges the MONTHLY counter. checkAndIncrementDailyOdds is
// deliberately NOT in this list -- it is the daily layer only, and treating it
// as sufficient is exactly the defect _captureClosingOdds had.
const MONTHLY_GUARDS = ['consumeOddsCredit(', '_consumeAmbientOddsCredit('];

// A line that builds a URL we will fetch and be billed for. The sport key may be
// a template slot (${sportKey}) or a literal (soccer_fifa_world_cup) -- an earlier
// draft required the slot, and silently saw none of the three literal-key sites
// that were the reason this file exists.
const BILLED = /(the-odds-api\.com|\$\{ODDS_BASE\})\/v4\/(sports\/[^\/`'"\s]+\/odds|historical\/)/;
// The sports LIST. Believed free, and that belief is now labelled rather than
// assumed: a site claiming it must carry ODDS-FREE and name what would disprove.
const SPORTS_LIST = /the-odds-api\.com\/v4\/sports\?|\$\{ODDS_BASE\}\/v4\/sports[`'"]/;
const FREE_MARK = 'ODDS-FREE:';

// The guard may sit either side of the URL line -- deriving the cost from the URL
// means the const is often declared first. So the window is the WHOLE enclosing
// function, not the lines above the call. The 'guarded and derived passes'
// self-test is the one that caught this: it has exactly that shape.
function functionStart(lines, i) {
    for (let j = i; j >= 0; j--) {
        const L = lines[j];
        if (/^(export\s+)?(async\s+)?function\s/.test(L)) return j;   // top-level
        if (/^\s{4}(async\s+)?[_a-zA-Z][\w]*\s*\(/.test(L) && !/^\s*(if|for|while|switch|catch|return)\b/.test(L.trim())) return j; // class method
    }
    return 0;
}

function functionEnd(lines, start) {
    for (let j = start + 1; j < lines.length; j++) {
        if (/^(export\s+)?(async\s+)?function\s/.test(lines[j])) return j;
        if (/^\s{4}(async\s+)?[_a-zA-Z][\w]*\s*\(/.test(lines[j])
            && !/^\s*(if|for|while|switch|catch|return)\b/.test(lines[j].trim())) return j;
    }
    return lines.length;
}

function scan(file, src) {
    const lines = src.split('\n');
    const out = [];
    lines.forEach((line, i) => {
        if (line.trimStart().startsWith('//')) return;
        const billed = BILLED.test(line);
        const list   = SPORTS_LIST.test(line);
        if (!billed && !list) return;
        const from = functionStart(lines, i);
        const body = lines.slice(from, functionEnd(lines, from)).join('\n');
        if (list) {
            const window = lines.slice(Math.max(0, i - 12), i + 3).join('\n');
            out.push({
                file, line: i + 1, kind: 'sports-list',
                ok: window.includes(FREE_MARK),
                why: `a /v4/sports call must carry an ${FREE_MARK} note saying why it is not charged`,
            });
            return;
        }
        const guarded = MONTHLY_GUARDS.some(g => body.includes(g));
        const derived = body.includes('oddsCreditCost(');
        out.push({
            file, line: i + 1, kind: 'billed',
            ok: guarded && derived,
            why: !guarded ? 'no monthly guard (consumeOddsCredit / _consumeAmbientOddsCredit) in the enclosing function'
               : !derived ? 'guarded, but the cost is hardcoded — must be oddsCreditCost(url) so it cannot drift from the URL'
               : '',
        });
    });
    return out;
}

// ── Self-tests. The gate has to be able to fail, and to fail for the right
// reason. Each fixture is one of the four real defects, reduced.
function selfTest() {
    const cases = [
        ['unguarded billed call is caught', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const r = await fetch(u);
}`, false],
        ['daily-only guard is NOT accepted', `
async function f(env) {
  if (!(await checkAndIncrementDailyOdds(env, 1))) return;
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
}`, false],
        ['guarded but hardcoded cost is caught', `
async function f(env) {
  if (!(await consumeOddsCredit(env, 3))) return;
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
}`, false],
        ['guarded and derived passes', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  if (!(await consumeOddsCredit(env, oddsCreditCost(u)))) return;
}`, true],
        ['a guard in a DIFFERENT function does not count', `
async function a(env) {
  if (!(await consumeOddsCredit(env, oddsCreditCost(x)))) return;
}
async function b(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
}`, false],
        ['class method is its own scope', `
class D {
    async m(env) {
        const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
    }
}`, false],
        ['sports-list without ODDS-FREE is caught', `
async function f(env) {
  const r = await fetch(\`https://api.the-odds-api.com/v4/sports?apiKey=\${k}\`);
}`, false],
        ['sports-list with ODDS-FREE passes', `
async function f(env) {
  // ODDS-FREE: the sports list is not billed. Disproof: cost != null here.
  const r = await fetch(\`https://api.the-odds-api.com/v4/sports?apiKey=\${k}\`);
}`, true],
        ['a commented-out call is not a call', `
async function f(env) {
  // const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
}`, null],
    ];
    let pass = 0, fail = 0;
    for (const [name, src, expect] of cases) {
        const r = scan('fixture', src);
        const got = expect === null ? (r.length === 0 ? null : !!r.every(x => x.ok))
                                    : (r.length > 0 && r.every(x => x.ok));
        if (got === expect) { pass++; }
        else { fail++; console.error(`  SELFTEST FAIL: ${name} — expected ${expect}, got ${got} (${r.length} finding(s))`); }
    }
    console.log(`  self-tests: ${pass} passed, ${fail} failed`);
    return fail === 0;
}

// ── The cost model, tested against the REAL function, not a copy of it.
async function costTests() {
    const { oddsCreditCost, ODDS_REGIONS_MULTIPLY } = await import('../src/budget-helpers.js');
    const B = 'https://api.the-odds-api.com';
    const cases = [
        // The two numbers this repo already committed to, before the helper existed.
        // If either of these moves, the helper has changed the ledger's meaning.
        [`${B}/v4/sports/x/odds?apiKey=K&markets=h2h,spreads,totals&regions=us&oddsFormat=american`, 3, 'fetchSportOddsLive, was the literal 3'],
        [`${B}/v4/historical/sports/x/odds?apiKey=K&date=D&markets=h2h,spreads,totals&regions=us&oddsFormat=american`, 30, 'fetchSportOddsHistorical, was the literal 30'],
        // The four that were charging nothing.
        [`${B}/v4/sports/soccer_fifa_world_cup/odds?apiKey=K&markets=h2h,totals&regions=us,eu&oddsFormat=decimal`, 2, 'getWCPregameLambdas + /wc/odds-probs'],
        [`${B}/v4/sports/americanfootball_cfl/odds?apiKey=K&markets=h2h,spreads,totals&regions=us,eu&oddsFormat=decimal`, 3, '/cfl/odds-probs'],
        [`${B}/v4/sports/x/odds-live?apiKey=K&regions=us,eu&markets=h2h&oddsFormat=decimal`, 1, 'AmbientDO live poll, was the literal 1'],
        [`${B}/v4/sports/x/odds?apiKey=K&regions=us&markets=h2h,spreads,totals&oddsFormat=american`, 3, '_captureClosingOdds, was the literal 1'],
        // A call can never be free by accident.
        [`${B}/v4/sports/x/odds`, 1, 'no markets param still costs at least 1'],
        ['not a url at all', 1, 'unparseable still costs at least 1'],
    ];
    let pass = 0, fail = 0;
    for (const [url, want, why] of cases) {
        const got = oddsCreditCost(url);
        if (got === want) pass++;
        else { fail++; console.error(`  COST FAIL: ${why} — expected ${want}, got ${got}`); }
    }
    console.log(`  cost model: ${pass} passed, ${fail} failed (ODDS_REGIONS_MULTIPLY=${ODDS_REGIONS_MULTIPLY})`);
    return fail === 0;
}

const okSelf = selfTest();
const okCost = await costTests();

let findings = [];
for (const f of FILES) findings = findings.concat(scan(f, readFileSync(f, 'utf8')));

const bad = findings.filter(x => !x.ok);
console.log(`  call sites: ${findings.length} found, ${findings.length - bad.length} accounted`);
for (const x of findings) {
    console.log(`    ${x.ok ? 'ok  ' : 'FAIL'} ${x.file}:${x.line} [${x.kind}]${x.ok ? '' : ' — ' + x.why}`);
}

// A ratchet on the count, so a NEW odds call site is visible even if it is
// correctly guarded. This table is how the worker spends money; it should not
// grow without someone saying so.
const EXPECTED_SITES = 9;
if (findings.length !== EXPECTED_SITES) {
    console.error(`  FAIL: expected ${EXPECTED_SITES} odds call sites, found ${findings.length}.`);
    console.error(`  If this is a deliberate add or removal, update EXPECTED_SITES in this file in the same commit.`);
}

// The tenth site, which the scan above CANNOT see and must not pretend to.
// The /odds/* proxy builds its target through oddsUrl(cleanPath, ...) -- the
// path is a variable, so no regex over this source will ever match a URL there,
// and a gate that reported "9 of 9 accounted" while the one publicly reachable
// billable route stood unguarded would be asserting something false. It gets a
// structural check instead of a pattern match.
const routeSrc = readFileSync('src/index.js', 'utf8');
const proxyStart = routeSrc.indexOf("if (pathname.startsWith('/odds')) {");
const proxyBody  = proxyStart < 0 ? '' : routeSrc.slice(proxyStart, proxyStart + 1600);
const proxyOk = proxyStart >= 0
    && proxyBody.includes('oddsBillablePath(')
    && proxyBody.includes('consumeOddsCredit(')
    && proxyBody.includes('oddsCreditCost(');
console.log(`    ${proxyOk ? 'ok  ' : 'FAIL'} src/index.js [/odds/* proxy] — variable path, checked structurally`);
if (!proxyOk) {
    console.error('  FAIL: the /odds/* proxy forwards billable paths with our key.');
    console.error('  It must call oddsBillablePath() and charge oddsCreditCost() through consumeOddsCredit().');
}

const ok = okSelf && okCost && bad.length === 0 && findings.length === EXPECTED_SITES && proxyOk;
console.log(ok ? 'PASS — every odds call is charged to the monthly ledger' : 'FAIL');
process.exit(ok ? 0 : 1);
