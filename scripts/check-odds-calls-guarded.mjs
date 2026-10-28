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
import { blankCommentsAndStrings } from './lib/blank-comments.mjs';

// THE CLAIM IS ABOUT THE WORKER, NOT THE REPO. "Every odds call is charged to
// the monthly ledger" was measured over three src/ files and read as though it
// covered everything that spends money. It does not: the excluded CI scripts
// below call the same vendor with the same key and appear in NO ledger. That
// gap is real and unclosed — see the provider-vs-ledger delta recorded by
// scripts/watch-odds-pairing-rate.mjs. Listing them here does not fix it; it
// stops the claim being read as wider than it is.
// SCOPE: api\.the-odds-api\.com|ODDS_API_BASE|ODDS_BASE
// scripts/mutate-scope-claims.mjs entered this population minutes after the
// scope check shipped: it QUOTES the regex as a mutation anchor and makes no
// odds call. That it had to be named rather than silently ignored is the
// mechanism working.
// src/budget-helpers.js DEFINES the guards and the cost model; it names
// ODDS_BASE only in a comment recording that provenance-census's analyser
// mentions the constant without calling it (2026-09-18 degrade-open work).
// Excluded by name rather than by the list quietly being shorter.
//
// src/odds-consumer-rules.js and src/odds-shape.js entered this population on
// 2026-10-11 the same way mutate-scope-claims did: each gained ONE comment line
// pointing at `const ODDS_BASE` in src/index.js, where
// docs/CC-CMD-2026-10-10-bsd-odds-substitution-refused.md records why the
// metered vendor is not replaced by BSD. Neither file fetches anything.
//
// The cost of not noticing is on the record. Those two comment lines pulled
// both files into this scope, the scope gate went red, and **Deploy RELAY
// Worker failed on four consecutive commits** (c35997b, 9f1d763, 4a1505b,
// defc1e1) — so four route blocks sat unshipped while their documents read
// DONE. A prose pointer is enough to widen a population; a widened population
// is enough to stop a deploy.
// probe-odds-live-endpoint.mjs reaches the vendor host unguarded, deliberately
// and harmlessly: it sends the literal string INVALID_KEY_FOR_PATH_TEST to ask
// whether a PATH resolves (401) or does not (404). Neither answer is billable,
// so there is no credit for a guard to charge. It is dispatch-only and is the
// run that established /odds-live is a 404.
// scripts/measure-odds-consumer-demand.mjs QUOTES each consumer's URL statement
// as a source anchor, so it can price that consumer's demand with
// oddsCreditCost. It calls no vendor: its only fetch is the relay's
// /d1/execute, read-only (CC-CMD-2026-09-16 Task 2).
// scripts/check-ambient-capture-write.mjs names the vendor host only to answer
// it: its fake fetch serves the capture's /odds call from memory, so the real
// guarded call in src/ambient-do.js can be run. It reaches no network.
// scripts/check-odds-label-split.mjs names the vendor host only to answer it: its
// stub fetch serves the three routes' odds calls from memory, so the real guarded
// calls in src/index.js can be run and the site row they charge read. It reaches
// no network.
// SCOPE-EXCLUDES: src/budget-helpers.js src/odds-consumer-rules.js src/odds-shape.js scripts/mutate-scope-claims.mjs .github/scripts/odds-backfill.js scripts/targeted-odds-fill.mjs scripts/probe-odds-api.mjs scripts/odds-spread-shape-probe.mjs scripts/diagnose-cfb-name-join.mjs scripts/watch-odds-pairing-rate.mjs src/route-provenance.js scripts/build-route-provenance.mjs scripts/check-odds-reconciled.mjs scripts/check-scope-claims.mjs scripts/probe-odds-live-endpoint.mjs scripts/measure-odds-consumer-demand.mjs scripts/check-ambient-capture-write.mjs scripts/check-odds-label-split.mjs
const FILES = ['src/index.js', 'src/ambient-do.js', 'src/wp-resolver.js'];

// A guard that charges the MONTHLY counter. checkAndIncrementDailyOdds was
// deliberately NOT in this list -- it was the daily layer only, and treating it
// as sufficient is exactly the defect _captureClosingOdds had. Since 2026-10-18
// it no longer exists (chargeOdds charges the day, site and month in one
// batch); the self-test fixture below keeps its name as the daily-only shape.
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

// Comments and quoted strings are blanked before any guard is credited, by
// scripts/lib/blank-comments.mjs (finding 4: a guard named in a comment or
// string credited a site whose real guard call was gone). check-odds-live-
// disabled.mjs reads the same module, so the two checks agree on what is code.

// A guard whose verdict is not used is not a guard: `await consumeOddsCredit(...)`
// on its own line charges, and a refusal no longer stops the fetch (review,
// 2026-10-19; the site-level twin of the CC-CMD's finding 2). Credited forms:
// the call negated, as every live site has it, `if (!(await G(...))) return`
// or `... && !(await G(...))`; or `const|let x = await G(...)` then `!x`.
//
// AND THE VERDICT MUST STOP THE CALL. The final review pass of 2026-10-19 found
// a negated guard credited when nothing exits: `if (!(await G(...))) {
// console.warn(...); }` logs the refusal and the fetch below still runs. That
// passed all 25 deploy-path odds steps, at wp-resolver and at the /odds/*
// proxy. So the `if` whose condition holds the negated verdict must END in a
// `return` or `throw`: its consequent's last top-level statement. A `return`
// that is itself conditional (`{ log(); if (x) return; }`) does not count.
// All nine live guard sites have this shape; ambient-do's closing capture logs
// first and returns last.
const GUARD_NAMES = ['consumeOddsCredit', '_consumeAmbientOddsCredit'];

// Index of the bracket that closes the one at `open`, over blanked code, or -1.
function closeOf(code, open) {
    let depth = 0;
    for (let k = open; k < code.length; k++) {
        const c = code[k];
        if (c === '(' || c === '{' || c === '[') depth++;
        else if ((c === ')' || c === '}' || c === ']') && --depth === 0) return k;
    }
    return -1;
}

// The `if` whose parenthesised condition contains offset `at`, and the span of
// its consequent: a `{...}` block, or one statement up to its `;`. An if
// cannot sit inside another if's condition, so at most one encloses `at`.
function enclosingIf(code, at) {
    for (const m of code.matchAll(/\bif\s*\(/g)) {
        if (m.index >= at) break;
        const open = m.index + m[0].length - 1;
        const close = closeOf(code, open);
        if (close < at) continue;
        let s = close + 1;
        while (/\s/.test(code[s] ?? '')) s++;
        let e = s;
        if (code[s] === '{') e = closeOf(code, s) + 1;
        else {
            for (let depth = 0; e < code.length; e++) {
                const c = code[e];
                if (c === '(' || c === '{' || c === '[') depth++;
                else if (c === ')' || c === '}' || c === ']') { if (depth-- === 0) break; }
                else if (c === ';' && depth === 0) { e++; break; }
            }
        }
        return { ifAt: m.index, condOpen: open, condClose: close, consStart: s, consEnd: e };
    }
    return null;
}

// What the refusal itself does is NOT checked here, and that is deliberate
// (docs/CC-CMD-2026-10-19-odds-guard-condition-and-exit.md, task 2). The
// review's two shapes are both already red under the ordering rule below:
//   - P4, `return relayFetch(targetUrl, ...)` as the refusal: that call sits
//     before the consequent ends, and every fetch-like call must come after;
//   - E7, `throw` into a `catch` that only logs: the `if` then sits in the
//     try block, and a fetch after the catch is outside the block that holds
//     the `if`, which is red. A fetch inside that try block is skipped by the
//     throw, which is a working guard, and stays green.
// Measured at 323990ea: both CAUGHT through all 25 deploy-path odds steps,
// with no rule of their own. A separate "no fetch in the refusal" or "no
// swallowing catch" rule could never be the only reason a case goes red, so it
// could not be made to fail on purpose (Rule 90) and is not added. The
// fixtures P4 and E7 below hold the ordering rule to it: drop either half of
// that rule and they go red. A refusal that calls a helper which fetches
// (anything other than fetch, relayFetch, oddsFetchWithFallback) is not seen,
// for the same reason as task 3's helper-built calls; see FETCH_CALL.
function consequentExits(code, s, e) {
    let body = code.slice(s, e).trim();
    if (body.startsWith('{')) body = body.slice(1, -1);
    const stmts = [];
    let depth = 0, cur = '';
    for (const c of body) {
        if (c === '(' || c === '{' || c === '[') depth++;
        else if (c === ')' || c === '}' || c === ']') depth--;
        if (c === ';' && depth === 0) { stmts.push(cur); cur = ''; } else cur += c;
    }
    stmts.push(cur);
    const last = stmts.map((x) => x.trim()).filter(Boolean).pop() || '';
    return /^(return|throw)\b/.test(last);
}

// Offsets, in blanked code, of each negated guard verdict (`!(await G(` or the
// `!x` that tests a named one). The live mutation self-test walks these too.
function verdictTests(code) {
    const out = [];
    for (const g of GUARD_NAMES) {
        for (const m of code.matchAll(new RegExp(`!\\s*\\(\\s*await\\s+${g}\\(`, 'g'))) out.push(m.index);
        for (const m of code.matchAll(new RegExp(`\\b(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*await\\s+${g}\\(`, 'g'))) {
            const from = m.index + m[0].length;
            for (const n of code.slice(from).matchAll(new RegExp(`!\\s*${m[1].replace(/\$/g, '\\$')}\\b`, 'g'))) out.push(from + n.index);
        }
    }
    return out;
}

// AND IT MUST RUN BEFORE THE VENDOR CALL (docs/CC-CMD-2026-10-19-odds-guard-before-fetch.md).
// A stopping guard placed below its fetch refuses after the vendor has billed,
// and the second review of 2026-10-19 showed that passing all 25 deploy-path
// odds steps at fetchSportOddsLive, wp-resolver, the closing capture and the
// /odds/* proxy. So every fetch-like call in the span must come AFTER the
// crediting `if` ends, and INSIDE the block that holds that `if`. That block is
// the function body, or the live poll's per-sport callback, so a guard tucked
// into a branch, a try or a loop the fetch sits outside of does not count. A
// span with no fetch-like call at all cannot be ordered and does not count.
//
// Not "a top-level statement of the function body", which the CC-CMD first
// proposed: the live poll's real guard sits inside a per-sport callback, and
// that rule would have blocked the deploy on it (TASK 0 probe, 2026-10-19).
const FETCH_CALL = /\b(?:fetch|relayFetch|oddsFetchWithFallback)\s*\(/g;

// [open, close] offsets of the innermost {...} block holding offset `at`, or null.
function blockAround(code, at) {
    const stack = [];
    for (let k = 0; k < at; k++) {
        if (code[k] === '{') stack.push(k);
        else if (code[k] === '}') stack.pop();
    }
    if (!stack.length) return null;
    const open = stack[stack.length - 1];
    return [open, closeOf(code, open)];
}

function runsBeforeFetch(code, f) {
    const calls = [...code.matchAll(FETCH_CALL)].map((m) => m.index);
    const b = blockAround(code, f.ifAt);
    return calls.length > 0 && !!b && calls.every((k) => k >= f.consEnd && k > b[0] && k < b[1]);
}

// AND THE VERDICT MUST BE THE WHOLE CONDITION (docs/CC-CMD-2026-10-19-odds-guard-condition-and-exit.md,
// task 1). The rule above credited any `if` whose condition merely CONTAINED a
// negated verdict, so `X && !(await G(...))` passed for any X: a guard that is
// never evaluated. The second review of 2026-10-19 showed one `!` at the proxy
// (`!oddsBillablePath(cleanPath) && ...`, metering only the free paths) passing
// all 25 deploy-path odds steps. The condition must now be exactly:
//   - `!(await G(...))`, nothing else inside the negation and nothing beside it;
//   - or `!x`, where the nearest declaration of x before the `if`, in the same
//     block, is `const x = await G(...);` with nothing else in the initializer.
//     A `let` can be overwritten before the test (R1), `|| flag` overrules the
//     refusal at the source (R2), and a nearer or inner declaration is not the
//     verdict, so none of those count;
//   - at the /odds/* proxy only, `oddsBillablePath(cleanPath) && !(await G(...))`.
//     Its sports list is free and is not charged; the one conjunct is written
//     exactly, so its negation (P3) or a second conjunct is red.
// All nine live guard sites have one of these shapes (TASK 0 probe, 2026-10-19).
const VERDICT_CALL = new RegExp(`^await\\s+(?:${GUARD_NAMES.join('|')})\\s*\\(`);
const PROXY_CONJUNCT = /^oddsBillablePath\s*\(\s*cleanPath\s*\)\s*&&\s*/;

// True if `text` (blanked) is exactly `await G(...)`, ignoring whitespace.
function isBareVerdictCall(text) {
    const t = text.trim();
    const m = VERDICT_CALL.exec(t);
    if (!m) return false;
    const close = closeOf(t, m[0].length - 1);
    return close === t.length - 1;
}

// True if the `if` at `f` has a credited condition (the three shapes above).
function exactCondition(code, f, { proxyConjunct = false } = {}) {
    let cond = code.slice(f.condOpen + 1, f.condClose).trim();
    if (proxyConjunct) {
        const m = PROXY_CONJUNCT.exec(cond);
        if (m) cond = cond.slice(m[0].length);
    }
    if (cond.startsWith('!')) {
        const inner = cond.slice(1).trim();
        if (inner.startsWith('(') && closeOf(inner, 0) === inner.length - 1) return isBareVerdictCall(inner.slice(1, -1));
    }
    const named = /^!\s*([A-Za-z_$][\w$]*)$/.exec(cond);
    if (!named) return false;
    const x = named[1].replace(/\$/g, '\\$');
    const decls = [...code.slice(0, f.ifAt).matchAll(new RegExp(`\\b(const|let|var)\\s+${x}\\s*=`, 'g'))];
    const d = decls.pop();
    if (!d || d[1] !== 'const') return false;
    const b = blockAround(code, f.ifAt), bd = blockAround(code, d.index);
    if (!b || !bd || b[0] !== bd[0]) return false;
    const from = d.index + d[0].length;
    const semi = (() => { for (let k = from, depth = 0; k < f.ifAt; k++) {
        const c = code[k];
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        else if (c === ';' && depth === 0) return k;
    } return -1; })();
    return semi > 0 && isBareVerdictCall(code.slice(from, semi));
}

// 'ok', or why not: 'none' (no negated verdict), 'condition', 'no-exit',
// 'after-fetch'. The most specific reason seen wins.
function guardVerdict(code, opts = {}) {
    let best = 'none';
    const rank = { none: 0, condition: 1, 'no-exit': 2, 'after-fetch': 3 };
    const note = (r) => { if (rank[r] > rank[best]) best = r; };
    for (const at of verdictTests(code)) {
        const f = enclosingIf(code, at);
        if (!f || !exactCondition(code, f, opts)) { note('condition'); continue; }
        if (!consequentExits(code, f.consStart, f.consEnd)) { note('no-exit'); continue; }
        if (runsBeforeFetch(code, f)) return 'ok';
        note('after-fetch');
    }
    return best;
}

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
        if (list) {
            const window = lines.slice(Math.max(0, i - 12), i + 3).join('\n');
            out.push({
                file, line: i + 1, kind: 'sports-list',
                ok: window.includes(FREE_MARK),
                why: `a /v4/sports call must carry an ${FREE_MARK} note saying why it is not charged`,
            });
            return;
        }
        out.push(judgeBilled(file, lines, i, 'billed'));
    });
    return out;
}

// One billed call at line i (0-based), judged over its enclosing function.
function judgeBilled(file, lines, i, kind) {
        const from = functionStart(lines, i);
        // CODE LINES ONLY, as for the billed URL above. A guard named in a
        // whole-line comment is not a guard: src/ambient-do.js's live poll
        // carries `// consumeOddsCredit() — same KV key scheme`, and with its
        // real guard call deleted that comment alone credited the site and the
        // gate printed PASS (docs/CC-CMD-2026-10-18-odds-gate-reads-wrapper-bodies.md,
        // finding 4). Whole lines only: a string-blind trailing-comment stripper
        // cut a guard call after a " //" inside a string, a false red.
        const body = blankCommentsAndStrings(lines.slice(from, functionEnd(lines, from)).join('\n'));
        const verdict = MONTHLY_GUARDS.some(g => body.includes(g)) ? guardVerdict(body) : 'none';
        const guarded = verdict === 'ok';
        const derived = body.includes('oddsCreditCost(');
        return {
            file, line: i + 1, kind,
            ok: guarded && derived,
            why: verdict === 'condition' ? 'the negated verdict is not the whole `if` condition — a conjunct or disjunct beside it (`X && !(await G(...))`, `!(await G(...) || X)`), or a verdict held in a `let` or a const whose initializer is more than the call, lets the guard go unevaluated or its refusal be overruled'
               : verdict === 'after-fetch' ? 'the monthly guard does not run before the vendor call — a fetch-like call (fetch, relayFetch, oddsFetchWithFallback) comes before it, sits outside the block that holds it, or is missing — so a refusal arrives after the credits are spent'
               : !guarded ? 'no monthly guard whose verdict stops the call (`if (!(await consumeOddsCredit(...))) return`, or _consumeAmbientOddsCredit) in the enclosing function — a guard named only in a comment or string, or called with its verdict ignored, does not count'
               : !derived ? 'guarded, but the cost is hardcoded — must be oddsCreditCost(url) so it cannot drift from the URL'
               : '',
        };
}

// BILLED CALLS BUILT BY A HELPER (docs/CC-CMD-2026-10-19-odds-guard-condition-and-exit.md,
// task 3; decided: widen the scan, not narrow the claim). BILLED above sees a
// literal vendor host or ${ODDS_BASE} only, so a call built with oddsUrl() or
// oddsFetchWithFallback() was invisible: the review's N1, an unguarded
// event-odds route, passed all 25 deploy-path odds steps with "10 found, 10
// accounted". So did a real site: oddsProviderQuota's sports-list call, which
// carried no ODDS-FREE note because nothing could see it (TASK 0, 2026-10-19).
//
// Each call of either helper, outside its own definition, is now a site:
//   - inside the /odds/* proxy block: judged by proxyGuarded(), as before;
//   - every path it builds is the literal '/v4/sports': the free list, which
//     must carry an ODDS-FREE note like any other sports-list call;
//   - anything else: billed, judged exactly like a BILLED site.
// An oddsUrl() nested in an oddsFetchWithFallback() call is part of that call.
// A line BILLED or SPORTS_LIST already matched is left to that scan.
// STILL NOT SEEN, and printed with the result: a vendor URL built by any other
// function, or passed in from elsewhere.
const HELPER_CALL = /\b(?:oddsUrl|oddsFetchWithFallback)\s*\(/g;
const FREE_HELPER_PATH = /^oddsUrl\s*\(\s*['"]\/v4\/sports['"]\s*,/;

function helperScan(file, src) {
    const code = blankCommentsAndStrings(src);
    const lines = src.split('\n');
    const head = src.indexOf("if (pathname.startsWith('/odds')) {");
    const pOpen = head < 0 ? -1 : code.indexOf('{', head);
    const pClose = pOpen < 0 ? -1 : closeOf(code, pOpen);
    const out = [];
    let inside = -1;
    for (const m of code.matchAll(HELPER_CALL)) {
        if (m.index < inside) continue;
        if (/\bfunction\s*$/.test(code.slice(Math.max(0, m.index - 20), m.index))) continue;
        const open = m.index + m[0].length - 1;
        const close = closeOf(code, open);
        inside = close;
        const i = code.slice(0, m.index).split('\n').length - 1;
        const span = src.slice(m.index, close + 1);
        if (span.split('\n').some((L) => BILLED.test(L) || SPORTS_LIST.test(L))) continue;
        if (pOpen >= 0 && m.index > pOpen && m.index < pClose) {
            out.push({ file, line: i + 1, kind: 'helper:proxy', ok: proxyGuarded(src),
                       why: 'the /odds/* proxy is not guarded — see its own line below' });
            continue;
        }
        const built = [...code.slice(m.index, close + 1).matchAll(/\boddsUrl\s*\(/g)].map((u) => src.slice(m.index + u.index, close + 1));
        if (built.length && built.every((b) => FREE_HELPER_PATH.test(b))) {
            const window = lines.slice(Math.max(0, i - 12), i + 3).join('\n');
            out.push({ file, line: i + 1, kind: 'helper:sports-list', ok: window.includes(FREE_MARK),
                       why: `a /v4/sports call must carry an ${FREE_MARK} note saying why it is not charged` });
            continue;
        }
        out.push(judgeBilled(file, lines, i, 'helper'));
    }
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
  const r = await fetch(u);
}`, false],
        ['guarded but hardcoded cost is caught', `
async function f(env) {
  if (!(await consumeOddsCredit(env, 3))) return;
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const r = await fetch(u);
}`, false],
        ['guarded and derived passes', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  if (!(await consumeOddsCredit(env, oddsCreditCost(u)))) return;
  const r = await fetch(u);
}`, true],
        ['a guard in a DIFFERENT function does not count', `
async function a(env) {
  if (!(await consumeOddsCredit(env, oddsCreditCost(x)))) return;
}
async function b(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const r = await fetch(u);
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
        ['a guard inside a /* */ block is not a guard', `
async function f(env) {
  /* if (!(await consumeOddsCredit(env, oddsCreditCost(u)))) return; */
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const r = await fetch(u);
}`, false],
        ['a guard in a trailing comment is not a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`; // if (!(await consumeOddsCredit(env, oddsCreditCost(u)))) return;
  const r = await fetch(u);
}`, false],
        ['a guard in a string literal is not a guard', `
async function f(env) {
  const note = "if (!(await consumeOddsCredit(env, oddsCreditCost(u)))) return;";
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const r = await fetch(u);
}`, false],
        ['a guard called with its verdict ignored is not a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  await consumeOddsCredit(env, oddsCreditCost(u), 'f');
  const r = await fetch(u);
}`, false],
        ['a guard whose verdict is named, then tested, IS a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const ok = await consumeOddsCredit(env, oddsCreditCost(u), 'f');
  if (!ok) return;
  const r = await fetch(u);
}`, true],
        ['a guard whose refusal only logs is not a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) { console.warn('over budget'); }
  const r = await fetch(u);
}`, false],
        ['a named verdict whose refusal only logs is not a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const ok = await consumeOddsCredit(env, oddsCreditCost(u), 'f');
  if (!ok) console.warn('over budget');
  const r = await fetch(u);
}`, false],
        ['a refusal whose return is itself conditional is not a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) { console.warn('over'); if (strict) return; }
  const r = await fetch(u);
}`, false],
        ['a refusal that logs, then returns, IS a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) {
    console.warn('[f] declined — skipping');
    return;
  }
  const r = await fetch(u);
}`, true],
        // Corrected 2026-10-19: this fixture was written as an equivalent and
        // encoded the hole (condition-and-exit task 1). A conjunct in front of
        // the verdict can skip it, whatever the consequent ends in.
        ['a verdict behind a conjunct is not a guard, even ending in a throw', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  if (billable(u) && !(await consumeOddsCredit(
        env, oddsCreditCost(u), 'f'))) throw new Error('declined');
  const r = await fetch(u);
}`, false],
        ['a verdict wrapped across lines, ending in a throw, IS a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  if (!(await consumeOddsCredit(
        env, oddsCreditCost(u), 'f'))) throw new Error('declined');
  const r = await fetch(u);
}`, true],
        // REGEX LITERALS ARE READ AS REGEXES (condition-and-exit task 4), by
        // scripts/lib/blank-comments.mjs. Each of these was misread before.
        ['a guard commented out between two regex literals holding a backtick is not a guard (X1)', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const a = /\`/g;
  // if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) return;
  const b = /\`/g;
  const r = await fetch(u);
}`, false],
        ['a regex holding // does not hide the fetch after it', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const r0 = /^https:\\/\\//.test(u) ? await fetch(u) : null;
  if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) return;
  const r = await fetch(u);
}`, false],
        ['a / inside a regex class does not end the regex', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  if (!/^[/\\w-]+$/.test(p)) return;
  if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) return;
  const r = await fetch(u);
}`, true],
        ['a regex after return is a regex', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const t = (() => { return /\`/; })();
  // if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) return;
  const t2 = (() => { return /\`/; })();
  const r = await fetch(u);
}`, false],
        ['a division is not a regex, so it hides no fetch', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const per = total / count; const r0 = await fetch(u); // charged below
  if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) return;
  const r = await fetch(u);
}`, false],
        ['a regex holding a quote above a guard does not break it', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const q = s.replace(/'/g, '');
  if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) return;
  const r = await fetch(u);
}`, true],
        // BILLED CALLS BUILT BY A HELPER (condition-and-exit task 3).
        ['an unguarded oddsUrl call is caught (N1)', `
async function f(env) {
  const u = oddsUrl(\`/v4/sports/\${k}/events/\${id}/odds\`, '?markets=h2h', key);
  const r = await relayFetch(u, {}, 60, 'odds', ctx);
}`, false],
        ['an unguarded oddsFetchWithFallback call is caught (N2)', `
async function f(env) {
  const { resp } = await oddsFetchWithFallback(env, k => oddsUrl(\`/v4/sports/\${s}/odds\`, '', k), {}, 'f');
}`, false],
        ['a guarded, derived oddsUrl call passes', `
async function f(env) {
  const u = oddsUrl(\`/v4/sports/\${k}/odds\`, '?markets=h2h', key);
  if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) return;
  const r = await relayFetch(u, {}, 60, 'odds', ctx);
}`, true],
        ['a sports-list helper call without ODDS-FREE is caught', `
async function f(env) {
  const { resp } = await oddsFetchWithFallback(env, k => oddsUrl('/v4/sports', '', k), {}, 'f');
}`, false],
        ['a sports-list helper call with ODDS-FREE passes', `
async function f(env) {
  // ODDS-FREE: the sports list is not billed. Disproof: x-requests-last != 0.
  const { resp } = await oddsFetchWithFallback(env, k => oddsUrl('/v4/sports', '', k), {}, 'f');
}`, true],
        ['a helper call building the list AND a billed path is not free', `
async function f(env) {
  // ODDS-FREE: the sports list is not billed. Disproof: x-requests-last != 0.
  const { resp } = await oddsFetchWithFallback(env, k => all ? oddsUrl('/v4/sports', '', k) : oddsUrl(\`/v4/sports/\${s}/odds\`, '', k), {}, 'f');
}`, false],
        ['a helper\'s own definition is not a call', `
function oddsUrl(cleanPath, search, envKey) {
    return \`\${ODDS_BASE}\${cleanPath}\`;
}`, null],
        // THE REFUSAL MUST NOT REACH THE VENDOR (condition-and-exit task 2),
        // held by the ordering rule rather than a rule of its own.
        ['a refusal that returns a fetch is not a guard (P4)', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) return relayFetch(u, {}, 60, 'odds', ctx);
  const r = await fetch(u);
}`, false],
        ['a throw into a catch that only logs is not a guard (E7)', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  try {
    if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) throw new Error('declined');
  } catch (e) { console.warn(e.message); }
  const r = await fetch(u);
}`, false],
        ['a throw inside the try that holds the fetch IS a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  try {
    if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) throw new Error('declined');
    const r = await fetch(u);
  } catch (e) { console.warn(e.message); }
}`, true],
        // THE VERDICT IS THE WHOLE CONDITION (condition-and-exit task 1).
        ['an env flag in front of the verdict is not a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  if (env.FLAG && !(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) return;
  const r = await fetch(u);
}`, false],
        ['a negated oddsBillablePath in front of the verdict is not a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  if (!oddsBillablePath(p) && !(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) return;
  const r = await fetch(u);
}`, false],
        ['oddsBillablePath in front of the verdict, outside the proxy, is not a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  if (oddsBillablePath(cleanPath) && !(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) return;
  const r = await fetch(u);
}`, false],
        ['a flag or-ed inside the negation is not a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f') || env.FLAG)) return;
  const r = await fetch(u);
}`, false],
        ['a let verdict overwritten before its test is not a guard (R1)', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  let ok = await consumeOddsCredit(env, oddsCreditCost(u), 'f');
  if (env.FLAG) ok = true;
  if (!ok) return;
  const r = await fetch(u);
}`, false],
        ['a const verdict or-ed with a flag at its declaration is not a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const ok = await consumeOddsCredit(env, oddsCreditCost(u), 'f') || env.FLAG;
  if (!ok) return;
  const r = await fetch(u);
}`, false],
        ['a verdict declared in a closed sibling block is not the one tested', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const ok = true;
  { const ok = await consumeOddsCredit(env, oddsCreditCost(u), 'f'); }
  if (!ok) return;
  const r = await fetch(u);
}`, false],
        ['a nearer const of the same name is not the verdict', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const ok = await consumeOddsCredit(env, oddsCreditCost(u), 'f');
  {
    const ok = true;
    if (!ok) return;
    const r = await fetch(u);
  }
}`, false],
        ['a " //" inside a string does not hide the guard after it', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const note = "proxy //odds"; if (!(await consumeOddsCredit(env, oddsCreditCost(u), "s"))) return;
  const r = await fetch(u);
}`, true],
        ['a guard named only in a comment line is not a guard (finding 4)', `
async function f(env) {
  // Mirrors consumeOddsCredit() and oddsCreditCost( -- same KV key scheme.
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const r = await fetch(u);
}`, false],
        // THE GUARD RUNS BEFORE THE VENDOR CALL (docs/CC-CMD-2026-10-19-odds-guard-before-fetch.md).
        ['a guard after the fetch is not a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const r = await fetch(u);
  if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) return;
}`, false],
        ['a fetch started before the guard, awaited after it, is not guarded', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const p = fetch(u);
  if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) return;
  const r = await p;
}`, false],
        ['a guard in a branch the fetch sits outside of is not a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  if (cheap) { if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) return; }
  const r = await fetch(u);
}`, false],
        ['a named verdict tested only after the fetch is not a guard', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  const ok = await consumeOddsCredit(env, oddsCreditCost(u), 'f');
  const r = await fetch(u);
  if (!ok) return;
}`, false],
        ['a guarded site with no fetch-like call cannot be ordered, and is red', `
async function f(env) {
  const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
  if (!(await consumeOddsCredit(env, oddsCreditCost(u), 'f'))) return;
  return u;
}`, false],
        ['a guard before its fetch inside a per-sport callback IS a guard (the live poll shape)', `
class D {
    async m(env) {
        await Promise.all(keys.map(async (k) => {
            const u = \`https://api.the-odds-api.com/v4/sports/\${k}/odds?markets=h2h\`;
            if (!(await _consumeAmbientOddsCredit(this.env, oddsCreditCost(u), 'm'))) return;
            try { const r = await fetch(u); } catch (_) { return; }
        }));
    }
}`, true],
    ];
    let pass = 0, fail = 0;
    for (const [name, src, expect] of cases) {
        const r = [...scan('fixture', src), ...helperScan('fixture', src)];
        const got = expect === null ? (r.length === 0 ? null : !!r.every(x => x.ok))
                                    : (r.length > 0 && r.every(x => x.ok));
        if (got === expect) { pass++; }
        else { fail++; console.error(`  SELFTEST FAIL: ${name} — expected ${expect}, got ${got} (${r.length} finding(s))`); }
    }
    // FINDING 4 ON THE LIVE SOURCE: delete the ambient live poll's one real
    // guard call, keep its comment, and the site must go red. The anchor must
    // match exactly once, or nothing was tested.
    {
        // BY SHAPE, and scoped to _fetchLiveOdds rather than to the site label:
        // the one code line in that method that calls the ambient guard. The
        // first shape match also required 'ambientFetchLiveOdds' on the same
        // line, so wrapping the call (the label on the next line) blocked the
        // deploy on correct code (final review pass, 2026-10-19). The call is
        // renamed rather than its line deleted, so a wrapped statement is
        // neutralised whatever its layout.
        const amb = readFileSync('src/ambient-do.js', 'utf8');
        const blanked = blankCommentsAndStrings(amb).split('\n');
        const rawLines = amb.split('\n');
        const from = rawLines.findIndex((L) => /^ {4}async _fetchLiveOdds\s*\(/.test(L));
        const to = from < 0 ? -1 : functionEnd(rawLines, from);
        const at = rawLines.map((L, n) => n).filter((n) => n > from && n < to && blanked[n].includes('_consumeAmbientOddsCredit('));
        if (at.length !== 1) { fail++; console.error(`  SELFTEST FAIL: the ambient live poll's guard call was found on ${at.length} code lines of _fetchLiveOdds, expected 1 — NOTHING MUTATED`); }
        else {
            const cut = rawLines.slice();
            cut[at[0]] = cut[at[0]].replace('_consumeAmbientOddsCredit(', '_GUARD_DELETED_(');
            const r = scan('src/ambient-do.js', cut.join('\n'));
            if (r.some(x => x.kind === 'billed' && !x.ok)) pass++;
            else { fail++; console.error('  SELFTEST FAIL: ambient live poll with its guard deleted still passed — a comment is crediting it'); }
        }
    }
    // EVERY LIVE GUARD SITE, ITS REFUSAL MADE TO LOG ONLY (Rule 90 against the
    // real source, not a fixture). Each negated verdict's `if` keeps its test
    // and loses its exit: the consequent becomes `{ console.warn('x'); }`. The
    // site, or the /odds/* proxy, must then go red. A site this cannot find
    // to mutate is a FAIL, never a pass.
    {
        let sites = 0, caught = 0;
        for (const f of FILES) {
            const raw = readFileSync(f, 'utf8');
            const code = blankCommentsAndStrings(raw);
            for (const at of verdictTests(code)) {
                sites++;
                const iff = enclosingIf(code, at);
                if (!iff) { console.error(`  SELFTEST FAIL: ${f} offset ${at}: a negated guard verdict outside any if — NOTHING MUTATED`); continue; }
                const mutated = raw.slice(0, iff.consStart) + "{ console.warn('x'); }" + raw.slice(iff.consEnd);
                const red = scan(f, mutated).some((x) => x.kind === 'billed' && !x.ok)
                    || (f === 'src/index.js' && !proxyGuarded(mutated));
                if (red) caught++;
                else console.error(`  SELFTEST FAIL: ${f} line ${raw.slice(0, at).split('\n').length}: its refusal made to only log, and nothing went red`);
            }
        }
        if (sites > 0 && caught === sites) pass++;
        else { fail++; console.error(`  SELFTEST FAIL: live guard sites made log-only: ${caught} of ${sites} caught`); }
        console.log(`  live guard sites made log-only: ${caught} of ${sites} caught`);
    }
    // EVERY LIVE GUARD SITE, ITS GUARD MOVED BELOW ITS FETCH (Rule 90 for the
    // ordering rule, on the real source). The whole guard `if` statement is cut
    // and pasted after the first fetch-like statement that follows it, so the
    // refusal still stops nothing that matters: the vendor has already billed.
    // The site, or the /odds/* proxy, must go red.
    {
        let sites = 0, caught = 0;
        for (const f of FILES) {
            const raw = readFileSync(f, 'utf8');
            const code = blankCommentsAndStrings(raw);
            for (const at of verdictTests(code)) {
                sites++;
                const iff = enclosingIf(code, at);
                // A fresh regex: FETCH_CALL is shared, and matchAll() starts from
                // its lastIndex, so moving that would hide calls from the scan.
                const re = new RegExp(FETCH_CALL.source, 'g');
                re.lastIndex = iff ? iff.consEnd : 0;
                const call = iff ? re.exec(code) : null;
                let end = -1;
                if (call) {
                    for (let k = call.index, depth = 0; k < code.length; k++) {
                        const c = code[k];
                        if (c === '(' || c === '[' || c === '{') depth++;
                        else if (c === ')' || c === ']' || c === '}') depth--;
                        else if (c === ';' && depth === 0) { end = k + 1; break; }
                    }
                }
                if (end < 0) { console.error(`  SELFTEST FAIL: ${f} line ${raw.slice(0, at).split('\n').length}: no fetch-like statement after its guard to move it below — NOTHING MUTATED`); continue; }
                const guardStmt = raw.slice(iff.ifAt, iff.consEnd);
                const mutated = raw.slice(0, iff.ifAt) + raw.slice(iff.consEnd, end) + '\n' + guardStmt + raw.slice(end);
                const red = scan(f, mutated).some((x) => x.kind === 'billed' && !x.ok)
                    || (f === 'src/index.js' && !proxyGuarded(mutated));
                if (red) caught++;
                else console.error(`  SELFTEST FAIL: ${f} line ${raw.slice(0, at).split('\n').length}: its guard moved below its fetch, and nothing went red`);
            }
        }
        if (sites > 0 && caught === sites) pass++;
        else { fail++; console.error(`  SELFTEST FAIL: live guard sites moved below their fetch: ${caught} of ${sites} caught`); }
        console.log(`  live guard sites moved below their fetch: ${caught} of ${sites} caught`);
    }
    // EVERY LIVE GUARD SITE, AN ENV FLAG PUT IN FRONT OF ITS VERDICT (Rule 90
    // for the exact-condition rule, on the real source): `if (env.X && !(...))`
    // skips the guard whenever the flag is unset. The site, or the proxy, must
    // go red.
    {
        let sites = 0, caught = 0;
        for (const f of FILES) {
            const raw = readFileSync(f, 'utf8');
            const code = blankCommentsAndStrings(raw);
            for (const at of verdictTests(code)) {
                sites++;
                const iff = enclosingIf(code, at);
                if (!iff) { console.error(`  SELFTEST FAIL: ${f} offset ${at}: a negated guard verdict outside any if — NOTHING MUTATED`); continue; }
                const mutated = raw.slice(0, iff.condOpen + 1) + 'env.ODDS_GUARD_BYPASS && ' + raw.slice(iff.condOpen + 1);
                const red = scan(f, mutated).some((x) => x.kind === 'billed' && !x.ok)
                    || (f === 'src/index.js' && !proxyGuarded(mutated));
                if (red) caught++;
                else console.error(`  SELFTEST FAIL: ${f} line ${raw.slice(0, at).split('\n').length}: a flag put in front of its verdict, and nothing went red`);
            }
        }
        if (sites > 0 && caught === sites) pass++;
        else { fail++; console.error(`  SELFTEST FAIL: live guard sites given a conjunct: ${caught} of ${sites} caught`); }
        console.log(`  live guard sites given a conjunct: ${caught} of ${sites} caught`);
    }
    // EVERY LIVE FREE HELPER SITE, ITS PATH MADE BILLED (Rule 90 for task 3, on
    // the real source): '/v4/sports' becomes '/v4/sports/x/odds', and with no
    // guard beside it the site must go red.
    {
        let sites = 0, caught = 0;
        for (const f of FILES) {
            const raw = readFileSync(f, 'utf8');
            for (const h of helperScan(f, raw).filter((x) => x.kind === 'helper:sports-list')) {
                sites++;
                const lines = raw.split('\n');
                const at = lines.findIndex((L, n) => n >= h.line - 1 && /oddsUrl\s*\(\s*'\/v4\/sports'/.test(L));
                if (at < 0) { console.error(`  SELFTEST FAIL: ${f}:${h.line}: no literal oddsUrl('/v4/sports' to edit — NOTHING MUTATED`); continue; }
                lines[at] = lines[at].replace(/oddsUrl\(\s*'\/v4\/sports'/, "oddsUrl('/v4/sports/x/odds'");
                if (helperScan(f, lines.join('\n')).some((x) => x.kind === 'helper' && !x.ok)) caught++;
                else console.error(`  SELFTEST FAIL: ${f}:${h.line}: its path made billed, and nothing went red`);
            }
        }
        if (sites > 0 && caught === sites) pass++;
        else { fail++; console.error(`  SELFTEST FAIL: live free helper sites made billed: ${caught} of ${sites} caught`); }
        console.log(`  live free helper sites made billed: ${caught} of ${sites} caught`);
    }
    // THE PROXY'S ONE CONJUNCT, written exactly (condition-and-exit task 1).
    {
        const P = (cond) => `
async function h(request, env, ctx) {
        if (pathname.startsWith('/odds')) {
            const cleanPath = pathname.replace(/^\\/odds/, '') || '/';
            const targetUrl = oddsUrl(cleanPath, url.search, env?.ODDS_API_KEY);
            if (${cond}) {
                return new Response('declined', { status: 429 });
            }
            const _proxyResp = await relayFetch(targetUrl, {}, 60, 'odds', ctx);
            return _proxyResp;
        }
}`;
        const G = "!(await consumeOddsCredit(env, oddsCreditCost(targetUrl), 'oddsProxyRoute'))";
        const pc = [
            ['the proxy\'s exact conjunct IS a guard', `oddsBillablePath(cleanPath) && ${G}`, true],
            ['the proxy with the conjunct negated is not a guard (P3)', `!oddsBillablePath(cleanPath) && ${G}`, false],
            ['the proxy with a second conjunct is not a guard', `env.FLAG && oddsBillablePath(cleanPath) && ${G}`, false],
            ['the proxy with || in place of && is not a guard', `oddsBillablePath(cleanPath) || ${G}`, false],
        ];
        for (const [name, cond, expect] of pc) {
            const got = proxyGuarded(P(cond));
            if (got === expect) pass++;
            else { fail++; console.error(`  SELFTEST FAIL: ${name} — expected ${expect}, got ${got}`); }
        }
    }
    // THE PROXY IS READ TO ITS CLOSING BRACE, not a 1600-character window. A
    // long comment after the block's head pushed the guard out of the window
    // and turned the deploy red on correct code (second review, 2026-10-19).
    {
        const src = readFileSync('src/index.js', 'utf8');
        const head = "if (pathname.startsWith('/odds')) {";
        const at = src.indexOf(head);
        const padded = at < 0 ? '' : `${src.slice(0, at + head.length)}\n            // ${'x'.repeat(2000)}${src.slice(at + head.length)}`;
        if (at >= 0 && proxyGuarded(padded)) pass++;
        else { fail++; console.error('  SELFTEST FAIL: a 2000-character comment after the /odds/* head hid its guard'); }
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
        // The four that were charging nothing. Every one of them sends us,eu, and
        // regions multiply -- MEASURED, not assumed: /cfl/odds-probs reported
        // X-Requests-Last 6 for 3 markets over 2 regions on 2026-09-05T01:59Z
        // (outbox/odds-cost-model-probe-2026-09-05T01-59-10.json), corroborated
        // by X-Requests-Remaining falling exactly 6 across the two calls.
        //
        // These three expectations DOUBLED when ODDS_REGIONS_MULTIPLY flipped and
        // the two above did not. That split is the check that the finding was
        // applied correctly rather than broadly: the two long-guarded sites send
        // regions=us, so their prices are untouched, which is also why nothing in
        // this repo had ever had cause to notice the factor.
        [`${B}/v4/sports/soccer_fifa_world_cup/odds?apiKey=K&markets=h2h,totals&regions=us,eu&oddsFormat=decimal`, 4, 'getWCPregameLambdas + /wc/odds-probs — 2 markets x 2 regions'],
        [`${B}/v4/sports/americanfootball_cfl/odds?apiKey=K&markets=h2h,spreads,totals&regions=us,eu&oddsFormat=decimal`, 6, '/cfl/odds-probs — 3 x 2, and 6 is the number the provider itself reported'],
        [`${B}/v4/sports/x/odds-live?apiKey=K&regions=us,eu&markets=h2h&oddsFormat=decimal`, 2, 'AmbientDO live poll — 1 market x 2 regions, was the literal 1'],
        // regions=us: unchanged by the finding, and that is the point.
        [`${B}/v4/sports/x/odds?apiKey=K&regions=us&markets=h2h,spreads,totals&oddsFormat=american`, 3, '_captureClosingOdds — 3 x 1, was the literal 1'],
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

let helperFindings = [];
for (const f of FILES) helperFindings = helperFindings.concat(helperScan(f, readFileSync(f, 'utf8')));

const bad = findings.filter(x => !x.ok);
const helperBad = helperFindings.filter(x => !x.ok);
console.log(`  call sites by vendor URL: ${findings.length} found, ${findings.length - bad.length} accounted`);
for (const x of findings) {
    console.log(`    ${x.ok ? 'ok  ' : 'FAIL'} ${x.file}:${x.line} [${x.kind}]${x.ok ? '' : ' — ' + x.why}`);
}
console.log(`  call sites built by oddsUrl/oddsFetchWithFallback: ${helperFindings.length} found, ${helperFindings.length - helperBad.length} accounted`);
for (const x of helperFindings) {
    console.log(`    ${x.ok ? 'ok  ' : 'FAIL'} ${x.file}:${x.line} [${x.kind}]${x.ok ? '' : ' — ' + x.why}`);
}
console.log('  SCOPE: not seen — a vendor URL built by any other function, or passed in from elsewhere; and a refusal or a call made through any helper other than fetch, relayFetch, oddsFetchWithFallback.');

// A ratchet on the count, so a NEW odds call site is visible even if it is
// correctly guarded. This table is how the worker spends money; it should not
// grow without someone saying so.
// 9 -> 10 on 2026-10-12: GET /debug/odds-fallback-key, the first thing that
// ever probed env.ODDS_API_KEY_FALLBACK. A /v4/sports call carrying ODDS-FREE,
// and it is the disproof for that annotation as well as its user — it returns
// the provider's x-requests-last, so a billed sports list would show up there.
const EXPECTED_SITES = 10;
if (findings.length !== EXPECTED_SITES) {
    console.error(`  FAIL: expected ${EXPECTED_SITES} odds call sites, found ${findings.length}.`);
    console.error(`  If this is a deliberate add or removal, update EXPECTED_SITES in this file in the same commit.`);
}
// The same ratchet for helper-built calls (task 3, 2026-10-19): the /odds/*
// proxy's oddsUrl, and oddsProviderQuota's sports-list oddsFetchWithFallback.
const EXPECTED_HELPER_SITES = 2;
if (helperFindings.length !== EXPECTED_HELPER_SITES) {
    console.error(`  FAIL: expected ${EXPECTED_HELPER_SITES} helper-built odds call sites, found ${helperFindings.length}.`);
    console.error(`  If this is a deliberate add or removal, update EXPECTED_HELPER_SITES in this file in the same commit.`);
}

// The tenth site, which the scan above CANNOT see and must not pretend to.
// The /odds/* proxy builds its target through oddsUrl(cleanPath, ...) -- the
// path is a variable, so no regex over this source will ever match a URL there,
// and a gate that reported "9 of 9 accounted" while the one publicly reachable
// billable route stood unguarded would be asserting something false. It gets a
// structural check instead of a pattern match.
// Since 2026-10-19 the proxy is held to the same rule as every scanned site: a
// guard whose verdict STOPS the call, over code with comments and strings
// blanked. It used to be a name match, `includes('consumeOddsCredit(')`, and
// the final review pass showed a proxy that charged and ignored the refusal
// passing all 25 deploy-path odds steps: the one public billable route,
// unmetered by its ceiling.
function proxyGuarded(src) {
    const start = src.indexOf("if (pathname.startsWith('/odds')) {");
    if (start < 0) return false;
    // The whole block, bounded by its own braces, not a 1600-character window:
    // a relayFetch further down the block must be seen to be ordered at all.
    const code = blankCommentsAndStrings(src);
    const open = code.indexOf('{', start);
    const close = closeOf(code, open);
    if (close < 0) return false;
    const body = code.slice(start, close + 1);
    return body.includes('oddsBillablePath(')
        && guardVerdict(body, { proxyConjunct: true }) === 'ok'
        && body.includes('oddsCreditCost(');
}
const proxyOk = proxyGuarded(readFileSync('src/index.js', 'utf8'));
console.log(`    ${proxyOk ? 'ok  ' : 'FAIL'} src/index.js [/odds/* proxy] — variable path, checked structurally`);
if (!proxyOk) {
    console.error('  FAIL: the /odds/* proxy forwards billable paths with our key.');
    console.error('  It must call oddsBillablePath() and charge oddsCreditCost() through consumeOddsCredit().');
}

const ok = okSelf && okCost && bad.length === 0 && findings.length === EXPECTED_SITES
    && helperBad.length === 0 && helperFindings.length === EXPECTED_HELPER_SITES && proxyOk;
console.log(ok ? 'PASS — every odds call is charged to the monthly ledger' : 'FAIL');
process.exit(ok ? 0 : 1);
