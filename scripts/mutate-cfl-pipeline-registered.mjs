#!/usr/bin/env node
// Rule 90 for scripts/check-cfl-pipeline-registered.mjs: each mutation breaks one clause of the fix, or puts the original defect back, in a COPY of src/index.js or
// src/budget-helpers.js (the sources are never touched), and the check must go red BECAUSE OF THE CLAUSE THE MUTATION BREAKS: each mutation names the text its FAIL line has to
// contain, and a FAIL line that does not contain it (a crash, or another clause happening to trip) is not CAUGHT. Each edit asserts its anchor is unique before it is applied.
// A1 is the original code: the check has to be red on the defect it was written for. A mutation whose expected clause is null is a BENIGN edit (a comment, a sanctioned change):
// the check has to stay GREEN on it, because a lock that refuses correct code is a defect too.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const INDEX = 'src/index.js';
const BUDGET = 'src/budget-helpers.js';
const CHECK = 'scripts/check-cfl-pipeline-registered.mjs';
const sources = { [INDEX]: readFileSync(INDEX, 'utf8'), [BUDGET]: readFileSync(BUDGET, 'utf8') };
const WRAP_HEAD = "async function handleCFLOddsProbs(env, ctx) {\n    if (!ctx || typeof ctx.waitUntil !== 'function') throw new TypeError('handleCFLOddsProbs needs the execution context (ctx.waitUntil)');\n    const work = cflOddsProbsPipeline(env);\n    ctx.waitUntil(work);\n    return work;\n}\nasync function cflOddsProbsPipeline(env) {";
const RECON = "        const _cflRec = await reconcileOddsCredit(env, oddsCreditCost(_cflUrl), resp, 'handleCFLOddsProbs');\n        if (!resp.ok) {\n            return new Response(JSON.stringify({ ok: false, probs: [], error: `Odds API ${resp.status}` }),\n                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });\n        }\n";
const RECON_AFTER = "        if (!resp.ok) {\n            return new Response(JSON.stringify({ ok: false, probs: [], error: `Odds API ${resp.status}` }),\n                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });\n        }\n        const _cflRec = await reconcileOddsCredit(env, oddsCreditCost(_cflUrl), resp, 'handleCFLOddsProbs');\n";
const tmp = mkdtempSync(path.join(tmpdir(), 'cfl-mut-'));
const run = (idx, bud) => spawnSync('node', [CHECK], { encoding: 'utf8', timeout: 60000, env: { ...process.env, RELAY_SRC: idx, RELAY_BUDGET_SRC: bud } });

const base = run(INDEX, BUDGET);
if (base.status !== 0) { console.log(`FAIL — ${CHECK} is already red on the real sources:\n${base.stdout}`); process.exit(1); }
console.log(`baseline: ${CHECK} passes on the real sources\n`);

// [name, file, edits [[anchor, replacement]], regex the attributed FAIL line must match, why]
const M = [
  ['A1 the ORIGINAL defect: no ctx, no waitUntil, the awaited chain as it was', INDEX, [[WRAP_HEAD, 'async function handleCFLOddsProbs(env) {'], ['return handleCFLOddsProbs(env, ctx);', 'return handleCFLOddsProbs(env);']], /ctx\.waitUntil was called 0 times|does not call handleCFLOddsProbs\(env, ctx\)/, 'a client that abandons the request stops the chain before its tally'],
  ['A2 the registration is removed', INDEX, [['    ctx.waitUntil(work);\n    return work;', '    return work;']], /ctx\.waitUntil was called 0 times/, 'nothing keeps the call alive'],
  ['A3 the call yields to the event loop before it registers', INDEX, [['    const work = cflOddsProbsPipeline(env);\n    ctx.waitUntil(work);', '    await new Promise((r) => setTimeout(r, 0));\n    const work = cflOddsProbsPipeline(env);\n    ctx.waitUntil(work);']], /AFTER the handler returned/, 'a disconnect is an I/O event, so it can land in that turn'],
  ['A4 only a stub promise is registered', INDEX, [['    ctx.waitUntil(work);\n    return work;', '    ctx.waitUntil(Promise.resolve());\n    return work;']], /was resolved while the reconcile was still in flight/, 'the registered promise is not the call'],
  ['A5 the call is started twice: once registered, once returned', INDEX, [['    ctx.waitUntil(work);\n    return work;', '    ctx.waitUntil(work);\n    return cflOddsProbsPipeline(env);']], /the steps ran as \[charge:start[^\]]*charge:start/, 'every request charges twice'],
  ['A6 reconciled carries a placeholder', INDEX, [['            reconciled: _cflRec,', "            reconciled: 'deferred',"]], /reconciled is/, 'the response loses the real reconcile state'],
  ['A6b reconciled is a hard-coded copy of the right shape', INDEX, [['            reconciled: _cflRec,', "            reconciled: { state: 'cache-hit', delta: -6 },"]], /reconciled is/, 'passes a check that compares to a constant'],
  ['A7 a charge failure is swallowed', INDEX, [['    ctx.waitUntil(work);\n    return work;', '    ctx.waitUntil(work);\n    return work.catch(() => null);']], /did not reach the caller as a rejection/, 'a failing charge answers nothing instead of an error'],
  ['A7b a failing charge is retried by running the whole call again', INDEX, [['    ctx.waitUntil(work);\n    return work;', '    ctx.waitUntil(work);\n    return work.catch(() => cflOddsProbsPipeline(env));']], /was attempted 2 times/, 'a second charge on an error path'],
  ['A8 the ctx guard is removed', INDEX, [["    if (!ctx || typeof ctx.waitUntil !== 'function') throw new TypeError('handleCFLOddsProbs needs the execution context (ctx.waitUntil)');\n", '']], /still ran steps before failing/, 'a missing ctx charges first and fails after'],
  ['A9 the route does not pass ctx', INDEX, [['return handleCFLOddsProbs(env, ctx);', 'return handleCFLOddsProbs(env);']], /does not call handleCFLOddsProbs\(env, ctx\)/, 'the guard throws on every request'],
  ['A10 a declined charge still goes on', INDEX, [["if (!(await consumeOddsCredit(env, oddsCreditCost(_cflUrl), 'handleCFLOddsProbs'))) {", 'if (false) {']], /a declined charge still reached the vendor/, 'the credit guard is bypassed'],
  ['A11 the reconcile is not awaited', INDEX, [["const _cflRec = await reconcileOddsCredit(env, oddsCreditCost(_cflUrl), resp, 'handleCFLOddsProbs');", "const _cflRec = reconcileOddsCredit(env, oddsCreditCost(_cflUrl), resp, 'handleCFLOddsProbs');"]], /was resolved while the reconcile was still in flight/, 'the registered promise settles before the refund and tally'],
  ['A12 the charge label is changed', INDEX, [["if (!(await consumeOddsCredit(env, oddsCreditCost(_cflUrl), 'handleCFLOddsProbs'))) {", "if (!(await consumeOddsCredit(env, oddsCreditCost(_cflUrl), 'cfl'))) {"]], /the steps ran as \[charge:start:cfl:6/, 'the ledger rows, six scripts and the per-site caps key on the label'],
  ['A13 waitUntil is registered twice (a style lock: harmless to survival, but the one-registration contract stays checkable)', INDEX, [['    ctx.waitUntil(work);\n    return work;', '    ctx.waitUntil(work);\n    ctx.waitUntil(work);\n    return work;']], /ctx\.waitUntil was called 2 times/, 'two registrations of one call'],
  ['A14 a non-OK vendor answer skips the reconcile (it moves after the early return)', INDEX, [[RECON, RECON_AFTER]], /a vendor 500 skipped the reconcile/, 'a vendor 5xx keeps its charge with no refund'],
  ['A15 the real reconcile no longer awaits its tally write', BUDGET, [['            await env.ARCHIVE_DB.prepare(ODDS_BUDGET_SQL.reconcileTally)', '            env.ARCHIVE_DB.prepare(ODDS_BUDGET_SQL.reconcileTally)']], /returned before these finished: .*tally:done/, 'the step Task 2b lost is not awaited'],
  ['A16 BENIGN: a copy of the pipeline inside a comment is not a second definition', INDEX, [['async function cflOddsProbsPipeline(env) {', '// async function cflOddsProbsPipeline(env) { return null; }\nasync function cflOddsProbsPipeline(env) {']], null, 'a comment is not code, so it is neither counted nor sliced'],
  ['A16b a second REAL definition of the pipeline above the real one', INDEX, [['async function cflOddsProbsPipeline(env) {', 'async function cflOddsProbsPipeline(env) { return null; }\nasync function cflOddsProbsPipeline(env) {']], /exactly one definition of cflOddsProbsPipeline/, 'the check would read the decoy and pass'],
  ['A17 registration is skipped when the charge is going to throw', INDEX, [['    ctx.waitUntil(work);\n    return work;', '    if (!env.chargeThrows) ctx.waitUntil(work);\n    return work;']], /a throwing charge registered 0 times/, 'registration on the happy path only'],
  ['A18 the probability maths changes', INDEX, [['const pH = (h2h.home / h2h.n) / vigSum;', 'const pH = (h2h.home / h2h.n) / (vigSum * 2);']], /the slate came out as/, 'the response changes while the check watches only the wrapper'],
  ['A19 the pipeline is given a copy of env', INDEX, [['    const work = cflOddsProbsPipeline(env);', '    const work = cflOddsProbsPipeline({ ...env });']], /very env the handler was given/, 'the bindings are dropped on the way in'],
  ['A20 a second caller of the pipeline skips the registration', INDEX, [["        if (pathname === '/cfl/odds-probs') return handleCFLOddsProbs(env, ctx);", "        if (pathname === '/cfl/odds-probs') return handleCFLOddsProbs(env, ctx);\n        if (pathname === '/cfl/odds-probs-raw') return cflOddsProbsPipeline(env);"]], /exactly one caller of cflOddsProbsPipeline/, 'a route that spends credits and can be cut'],
  ['A21 the vendor cache options change', INDEX, [['{ cf: { cacheTtl: 120, cacheEverything: true } }', '{ cf: { cacheTtl: 0, cacheEverything: false } }']], /cacheTtl: 120, cacheEverything: true/, 'every page load becomes a vendor call'],
  ['A22 a fourth market is added to the vendor URL', INDEX, [['markets=h2h,spreads,totals&regions=us,eu&oddsFormat=decimal`;', 'markets=h2h,spreads,totals,btts&regions=us,eu&oddsFormat=decimal`;']], /the vendor URL/, 'the cost per call changes'],
  ['A23 ctx is reassigned before the route', INDEX, [['        // /cfl/* — CFL odds from The Odds API + CFL internal API (echo.pims.cfl.ca)\n', '        // /cfl/* — CFL odds from The Odds API + CFL internal API (echo.pims.cfl.ca)\n        ctx = { waitUntil() {} };\n']], /ctx is assigned/, 'the route hands the handler a ctx that is not the runtime\'s'],
  ['C1 ctx.waitUntil is called unbound (workerd throws Illegal invocation AFTER the call has started and been charged)', INDEX, [['    const work = cflOddsProbsPipeline(env);\n    ctx.waitUntil(work);', '    const { waitUntil } = ctx;\n    const work = cflOddsProbsPipeline(env);\n    waitUntil(work);']], /the handler rejected on a normal call: Illegal invocation/, 'a charged call that is never registered and answers 500'],
  ['C2 the reconcile is handed null instead of the vendor response', INDEX, [["await reconcileOddsCredit(env, oddsCreditCost(_cflUrl), resp, 'handleCFLOddsProbs')", "await reconcileOddsCredit(env, oddsCreditCost(_cflUrl), null, 'handleCFLOddsProbs')"]], /not handed the very response/, 'the real reconcile returns no-response and the charge stands'],
  ['C3 a literal 6 replaces the cost model in the charge, the reconcile and the body', INDEX, [["consumeOddsCredit(env, oddsCreditCost(_cflUrl), 'handleCFLOddsProbs')", "consumeOddsCredit(env, 6, 'handleCFLOddsProbs')"], ["await reconcileOddsCredit(env, oddsCreditCost(_cflUrl), resp,", "await reconcileOddsCredit(env, 6, resp,"], ['            charged: oddsCreditCost(_cflUrl),', '            charged: 6,']], /the handler is not asking the cost model/, 'the next price change is charged at the old price'],
  ['C4 the runtime hop into _fetch drops ctx', INDEX, [['const resp = await this._fetch(request, _env, ctx);', 'const resp = await this._fetch(request, _env);']], /the runtime hop into _fetch/, 'every /cfl/odds-probs call throws the guard'],
  ['C4b the runtime hop passes a spread copy of ctx', INDEX, [['const resp = await this._fetch(request, _env, ctx);', 'const resp = await this._fetch(request, _env, { ...ctx });']], /the runtime hop into _fetch/, 'a copy has no working waitUntil in workerd'],
  ['C5 ctx is reassigned with ||= before the route', INDEX, [['        // /cfl/* — CFL odds from The Odds API + CFL internal API (echo.pims.cfl.ca)\n', '        // /cfl/* — CFL odds from The Odds API + CFL internal API (echo.pims.cfl.ca)\n        ctx ||= { waitUntil() {} };\n']], /ctx is assigned/, 'a compound assignment is an assignment'],
  ['C5b ctx is reassigned by destructuring before the route', INDEX, [['        // /cfl/* — CFL odds from The Odds API + CFL internal API (echo.pims.cfl.ca)\n', '        // /cfl/* — CFL odds from The Odds API + CFL internal API (echo.pims.cfl.ca)\n        ({ ctx } = { ctx: { waitUntil() {} } });\n']], /ctx is assigned/, 'a destructuring assignment is an assignment'],
  ['C6 BENIGN: an arrow function with a parameter named ctx before the route', INDEX, [['        // /cfl/* — CFL odds from The Odds API + CFL internal API (echo.pims.cfl.ca)\n', '        // /cfl/* — CFL odds from The Odds API + CFL internal API (echo.pims.cfl.ca)\n        const _noop = [1].map(ctx => ctx);\n']], null, 'a parameter is not an assignment to the handler ctx'],
  ['C7 the registered promise is a timer, not the call', INDEX, [['    ctx.waitUntil(work);\n    return work;', '    ctx.waitUntil(new Promise((r) => setTimeout(r, 60)));\n    return work;']], /pending right after the call finished/, 'protection that ends at its timer, not at the call'],
  ['C8 the registered promise rejects after the call finishes', INDEX, [['    ctx.waitUntil(work);\n    return work;', "    ctx.waitUntil(work.then(() => { throw new Error('late'); }));\n    return work;"]], /was rejected right after the call finished/, 'a failure the runtime logs against the request'],
  ['C9 a second path reaches the pipeline through .call behind a flag', INDEX, [['    const work = cflOddsProbsPipeline(env);', '    if (env.CFL_DIRECT) return cflOddsProbsPipeline.call(null, env);\n    const work = cflOddsProbsPipeline(env);']], /a bare reference to handleCFLOddsProbs or cflOddsProbsPipeline/, 'a path no scenario drives'],
  ['C10 the 200 loses its CORS header', INDEX, [["}), { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=120' } });", "}), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=120' } });"]], /the 200 headers read CORS/, 'the browser client cannot read the response'],
  ['C10b the 200 loses its Cache-Control header', INDEX, [["}), { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=120' } });", "}), { headers: { ...CORS, 'Content-Type': 'application/json' } });"]], /the 200 headers read CORS/, 'every poll reaches the Worker'],
  ['C11 BENIGN: a comment that names the handler with parentheses', INDEX, [['async function handleCFLOddsProbs(env, ctx) {', '// handleCFLOddsProbs(env, ctx) is the registered wrapper; cflOddsProbsPipeline(env) is the call.\nasync function handleCFLOddsProbs(env, ctx) {']], null, 'prose in a comment is not a caller'],
  ['C12 BENIGN: the route written with braces and await', INDEX, [["if (pathname === '/cfl/odds-probs') return handleCFLOddsProbs(env, ctx);", "if (pathname === '/cfl/odds-probs') { return await handleCFLOddsProbs(env, ctx); }"]], null, 'the same call in another shape'],
  ['C13 BENIGN: the vendor fetch gets a timeout signal (the open bound the docs name)', INDEX, [['{ cf: { cacheTtl: 120, cacheEverything: true } }', '{ cf: { cacheTtl: 120, cacheEverything: true }, signal: AbortSignal.timeout(20000) }']], null, 'the sanctioned next change must not turn the gate red'],
  ['C14 a dangling branch of the call rejects where nothing handles it', INDEX, [['    ctx.waitUntil(work);\n    return work;', "    ctx.waitUntil(work);\n    work.then(() => { throw new Error('dangling'); });\n    return work;"]], /promise rejection\(s\) nobody handled/, 'an error the runtime reports against nothing'],
  ['B1 the wrapper does not await the refund', BUDGET, [['    const out = await _reconcileOddsCredit(env, estimated, resp, site);', '    const out = _reconcileOddsCredit(env, estimated, resp, site);']], /the tally write .* bound|reconcile steps .* ran as/, 'the tally runs before, and without, the refund'],
  ['B2 the refund D1 batch is not awaited', BUDGET, [['                await db.batch([', '                db.batch([']], /overlapped: kv\.get started while batch was in flight/, 'a refund that finishes after the call returned'],
  ['B3 the site counter write is not awaited', BUDGET, [['        await _bumpSite(env, site, out.delta);', '        _bumpSite(env, site, out.delta);']], /overlapped: kv\.get started while kv\.get/, 'a site correction that finishes after the call returned'],
  ['B4 the day and month KV write is not awaited', BUDGET, [['            await env.FIELD_JOURNALISM.put(key, String(next), { expirationTtl: 60 * 86400 });', '            env.FIELD_JOURNALISM.put(key, String(next), { expirationTtl: 60 * 86400 });']], /returned before these finished: .*kv:|reconcile steps .* ran as/, 'a ledger correction that finishes after the call returned'],
  ['B5 the table check before the tally is not awaited', BUDGET, [['        if (env && env.ARCHIVE_DB && await ensureOddsBudgetTables(env)) {', '        if (env && env.ARCHIVE_DB && ensureOddsBudgetTables(env)) {']], /overlapped: tally started while ensure was in flight/, 'the tally can run before its tables exist'],
  ['B6 the table check before the refund is not awaited', BUDGET, [['            if (await ensureOddsBudgetTables(env)) {\n                const db = env.ARCHIVE_DB;', '            if (ensureOddsBudgetTables(env)) {\n                const db = env.ARCHIVE_DB;']], /overlapped: batch started while ensure was in flight/, 'the refund can run before its tables exist'],
  ['B7 the tally stores 0 kept for every state', BUDGET, [['String(cache), kept, kept)', 'String(cache), 0, 0)']], /the tally write .* bound/, 'the ledger keeps what it believes it kept, and that is the measurement'],
  ['B8 the tally stores a constant state', BUDGET, [["site || '(unnamed)', out.state,", "site || '(unnamed)', 'x',"]], /the tally write .* bound/, 'the tally cannot tell a refund from a keep'],
  ['B9 the month refund carries 0', BUDGET, [["db.prepare(ODDS_BUDGET_SQL.fixMonth).bind(out.delta, month.slice('odds:credits:'.length)),", "db.prepare(ODDS_BUDGET_SQL.fixMonth).bind(0, month.slice('odds:credits:'.length)),"]], /the refund batch .* carried/, 'the month ledger keeps every refunded charge'],
];
let caught = 0, ran = 0;
for (const [name, file, edits, expect, why] of M) {
  let src = sources[file], ok = true;
  for (const [a, b] of edits) {
    const n = src.split(a).length - 1;
    if (n !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${n} times, expected 1 — NOTHING MUTATED.\n            ${a.slice(0, 90).replace(/\n/g, '\\n')}`); ok = false; break; }
    if (a === b) continue;
    src = src.replace(a, () => b);
  }
  if (!ok) continue;
  if (src === sources[file]) { console.log(`FAIL       ${name}\n            the edits changed nothing — NOTHING MUTATED.`); continue; }
  ran++;
  const f = path.join(tmp, 'mutated.js'); writeFileSync(f, src);
  const r = file === INDEX ? run(f, BUDGET) : run(INDEX, f);
  const fails = String(r.stdout ?? '').split('\n').filter((l) => l.startsWith('FAIL'));
  if (expect === null) {
    // A benign edit: the check must stay green on it.
    const green = r.status === 0 && fails.length === 0;
    console.log(`${green ? 'GREEN     ' : 'REFUSED   '} ${name}\n            (${why})${green ? '' : `\n            first FAIL was: ${(fails[0] || String(r.stderr || r.stdout).split('\n')[0]).slice(0, 150)}`}`);
    if (green) caught++;
    continue;
  }
  const named = fails.find((l) => expect.test(l));
  const red = r.status !== 0 && fails.length > 0 && !!named;
  console.log(`${red ? 'CAUGHT    ' : r.status !== 0 && fails.length ? 'WRONG-FAIL' : r.status !== 0 ? 'BROKE     ' : 'NOT CAUGHT'} ${name}\n            (${why})${red ? `\n            <- ${named.slice(0, 150)}` : fails.length ? `\n            first FAIL was: ${fails[0].slice(0, 150)}` : ''}`);
  if (red) caught++;
}
rmSync(tmp, { recursive: true, force: true });
const benign = M.filter((m) => m[3] === null).length;
console.log(`\n${caught} of ${M.length} correct (${M.length - benign} mutations caught by the clause they break, ${benign} benign edits left green; ${ran} applied).`);
process.exit(caught === M.length ? 0 : 1);
