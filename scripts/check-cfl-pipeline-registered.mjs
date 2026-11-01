// THE CFL ODDS CALL MUST RUN AS ONE PROMISE THAT IS REGISTERED WITH ctx.waitUntil BEFORE ITS FIRST AWAIT, AND THE REFUND MUST BE AWAITED BEFORE THE TALLY RETURNS.
//
// docs/CC-CMD-2026-10-13-vendor-residual-window.md, Task 3. Measured 2026-11-01 (Task 2b, run 41313403502): a client that abandons /cfl/odds-probs stops the awaited chain
// (charge, vendor fetch, reconcile, tally) before the tally, and can leave the 6-credit charge standing: 0 of 5 aborted calls tallied against 5 of 5 that were not.
// Over 11 windows that is the gap between what the ledger holds for handleCFLOddsProbs and what its reconcile says it kept, which sums to 1,962 against a ledger
// over-record of 2,076. The fix is that the whole call is one promise, registered with waitUntil in the handler's synchronous segment, and also returned.
//
// THIS RUNS THE REAL SOURCE. It slices handleCFLOddsProbs and cflOddsProbsPipeline out of src/index.js (or $RELAY_SRC) and reconcileOddsCredit out of src/budget-helpers.js
// (or $RELAY_BUDGET_SRC), which the mutation harness points at mutated COPIES, evaluates them against stubs that record every step, and asserts:
//   - waitUntil is called exactly once, in the SYNCHRONOUS segment of the call (before the handler's promise is returned, so before any await a disconnect could cut), in EVERY
//     scenario that gets as far as the handler, error paths included; and the call is charged exactly once in every scenario that reaches the charge;
//   - the registered promise IS the whole call: awaiting only it is enough to see the charge, the fetch and the reconcile finished, in that order;
//   - the response is unchanged: a real slate goes in and its probabilities, spread and total come out; `reconciled` is the very object the reconcile returned (a nonce, not
//     a constant); the same env object reaches the charge and the reconcile; the five outcomes keep their status and body, and a declined charge makes no fetch and no reconcile;
//   - the vendor URL, its markets and regions, and its cache options (ttl 120, cacheEverything) are unchanged, and the charge and the reconcile are priced from the same URL;
//   - the real reconcileOddsCredit AWAITS its tally write before it returns (the step Task 2b lost), and does so after the refund;
//   - a charge that throws still rejects to the caller, a missing ctx throws before anything is charged, and a scenario that crashes is a finding, not a stack trace;
//   - there is exactly one definition of each function, exactly one caller of the pipeline, one call site of the handler, the route passes the ctx it was given, and ctx is not
//     reassigned between the fetch handler's entry and the route.
//
// WHAT IT DOES NOT SHOW. That Cloudflare's edge leaves a registered promise running after a client disconnects, and for how long (waitUntil work is cancelled 30 s after the
// disconnect; the vendor fetch has no timeout of its own, so a vendor that hangs past that still strands the charge). A node process has no edge, and the local workerd run
// (scripts/cfl-abort-local-workerd.mjs) was recorded as an invalid instrument. That is shown only by a repeat of Task 2b (scripts/cfl-abort-experiment.mjs, owner approval).
// This proves the code is shaped so that it CAN survive a disconnect; the repeat proves that it does. The stubs also stand in for the real consumeOddsCredit (async D1, degrades
// open on error), the real fetch and the real cost model.
import { readFileSync } from 'node:fs';
import { blankCommentsAndStrings } from './lib/blank-comments.mjs';

const SRC = process.env.RELAY_SRC || 'src/index.js';
const BUDGET = process.env.RELAY_BUDGET_SRC || 'src/budget-helpers.js';
const tick = () => new Promise((r) => setTimeout(r, 3));
/** The runtime handles a promise it is given through waitUntil; mark it handled so a rejection is an assertion for the check to read, not a crash. */
const handled = (p) => { p.then(() => 0, () => 0); return p; };
const show = (v) => String(JSON.stringify(v)).slice(0, 90);

/** One function's source, from `async function NAME(` (optionally `export `) to the first top-level `\n}\n`; null if absent. When `code` (the same text with comments and strings
 *  blanked, same length) is given, the head and the end are FOUND in it, so a copy of the function inside a comment or a string is not the function, and the text returned is the
 *  original at those offsets. */
export function sliceFn(whole, name, exported = false, isAsync = true, code = null) {
  const hay = code || whole;
  if (code && code.length !== whole.length) throw new Error('the comment blanker changed the length of the source');
  const head = `${exported ? 'export ' : ''}${isAsync ? 'async ' : ''}function ${name}(`;
  const i = hay.indexOf(head);
  if (i < 0) return null;
  const j = hay.indexOf('\n}\n', i);
  return j < 0 ? null : whole.slice(i, j + 3);
}
/** The blanker walks 14,000 lines; every scenario loads the source again, so it is blanked once per distinct text. */
const BLANKED = new Map();
const blankOf = (src) => { let b = BLANKED.get(src); if (b === undefined) { b = blankCommentsAndStrings(src); BLANKED.set(src, b); } return b; };
const count = (whole, needle) => whole.split(needle).length - 1;

const SLATE = [{
  home_team: 'Toronto Argonauts', away_team: 'Montreal Alouettes', commence_time: '2026-11-07T20:00:00Z',
  bookmakers: [{ markets: [
    { key: 'h2h', outcomes: [{ name: 'Toronto Argonauts', price: 1.5 }, { name: 'Montreal Alouettes', price: 3 }] },
    { key: 'spreads', outcomes: [{ name: 'Toronto Argonauts', price: 1.9, point: -3.5 }] },
    { key: 'totals', outcomes: [{ name: 'Over', price: 1.9, point: 45.5 }] },
  ] }],
}];
const EXPECT_PROB = { home_team: 'Toronto Argonauts', away_team: 'Montreal Alouettes', commence: '2026-11-07T20:00:00Z', pHome: 0.6667, pAway: 0.3333, spread: -3.5, total: 45.5, bookmakers: 1 };

/** Load the real handler against recording stubs. Returns { handler, events, refs }. Throws if the source cannot be loaded. */
export function load(whole, flags = {}) {
  const blanked = blankOf(whole);
  const wrapper = sliceFn(whole, 'handleCFLOddsProbs', false, true, blanked);
  const pipeline = sliceFn(whole, 'cflOddsProbsPipeline', false, true, blanked);
  if (!wrapper) throw new Error('handleCFLOddsProbs was not found in the source');
  // No pipeline function is the pre-fix shape (the handler IS the call). It loads, and the findings below say what is wrong with it.
  const events = [];
  const refs = { charge: [], reconcile: [], nonce: 0, lastNonce: null, urls: [], fetchOpts: [], units: [], fetchResp: [], reconcileResp: [] };
  const ev = (e) => events.push(e);
  const cost = flags.cost === undefined ? 6 : flags.cost;
  const deps = {
    CORS: { 'Access-Control-Allow-Origin': '*' },
    Response,
    _oddsPrimaryKey: (env) => (env.noKey ? null : 'KEY'),
    // Priced by a function of the URL (and of flags.cost, so a literal 6 in the handler is not the same as asking the cost model), so a charge and a reconcile built from
    // DIFFERENT urls, or from a constant, would disagree.
    oddsCreditCost: (url) => { refs.urls.push(url); return /markets=h2h,spreads,totals&regions=us,eu/.test(url) ? cost : 1; },
    consumeOddsCredit: async (env, units, site) => {
      refs.charge.push(env); refs.units.push(units);
      ev(`charge:start:${site}:${units}`); await tick();
      if (env.chargeThrows) throw new Error('D1 exploded');
      ev('charge:done'); return !env.declined;
    },
    fetch: async (url, opts) => {
      refs.urls.push(url); refs.fetchOpts.push(opts);
      ev('fetch:start'); await tick();
      if (flags.fetchThrows) throw new Error('vendor down');
      ev('fetch:done');
      const status = flags.vendorStatus || 200;
      const resp = { ok: status >= 200 && status < 300, status, headers: new Map([['cf-cache-status', 'HIT'], ['x-requests-remaining', '399994'], ['x-requests-last', '6']]), json: async () => flags.games || [] };
      refs.fetchResp.push(resp);
      return resp;
    },
    reconcileOddsCredit: async (env, est, resp, site) => {
      refs.reconcile.push(env); refs.units.push(est); refs.reconcileResp.push(resp);
      ev(`reconcile:start:${site}`); await tick(); await tick();
      if (flags.hold) await flags.hold.promise; // lets a probe keep the call in flight for as long as it likes
      ev('reconcile:done');
      refs.lastNonce = ++refs.nonce;
      return { site, estimated: est, actual: 0, delta: -est, state: 'cache-hit', nonce: refs.lastNonce };
    },
  };
  const factory = new Function('deps', `const { CORS, Response, _oddsPrimaryKey, oddsCreditCost, consumeOddsCredit, fetch, reconcileOddsCredit } = deps;\n${wrapper}\n${pipeline || ''}\nreturn handleCFLOddsProbs;`);
  return { handler: factory(deps), events, refs };
}

/** A ctx whose waitUntil behaves like workerd's: it must be called AS A METHOD of the very ctx it came from (unbound, destructured or on a spread copy it throws). */
function strictCtx(onRegister) {
  const ctx = {
    waitUntil: function (p) {
      if (this !== ctx) throw new TypeError('Illegal invocation: function called with incorrect `this` reference');
      onRegister(p);
    },
  };
  return ctx;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 'resolved' | 'rejected' | 'pending' (after ms): never waits forever on a promise that never settles. */
const settledState = (p, ms = 2) => Promise.race([Promise.resolve(p).then(() => 'resolved', () => 'rejected'), sleep(ms).then(() => 'pending')]);

/** Call the handler the way the runtime does, recording WHEN waitUntil was called. */
export async function drive(whole, envFlags = {}, ctxMode = 'ok') {
  const { handler, events, refs } = load(whole, envFlags);
  const env = { ...envFlags };
  const registered = [];
  let phase = 'sync';
  const snapshots = [];
  const ctx = ctxMode === 'ok' ? strictCtx((p) => { handled(p); registered.push({ p, phase }); snapshots.push(events.slice()); }) : ctxMode === 'none' ? undefined : {};
  let returned, threw = null;
  try { returned = handler(env, ctx); } catch (e) { threw = e; }
  phase = 'after-return'; // anything registered after this ran past an await
  const out = { events, registered, snapshots, threw, refs, env };
  if (returned) {
    out.returned = returned;
    handled(returned);
    const st = await settledState(returned, 500);
    if (st === 'pending') out.hung = true;
    else {
      try { out.value = await returned; } catch (e) { out.rejected = e; }
      if (out.value) { out.status = out.value.status; out.headers = out.value.headers; try { out.body = JSON.parse(await out.value.clone().text()); } catch (_) { out.body = null; } }
    }
  }
  return out;
}

/** Hold the reconcile open and watch the registered promise from outside: it must stay pending exactly as long as the call is in flight, and settle right after the call does.
 *  A registered promise that is a timer, a decoy or a different branch cannot do both. The caller's own promise is dropped, as the edge drops it after a disconnect. */
export async function identityProbe(whole) {
  let release; const hold = { promise: new Promise((r) => { release = r; }) };
  const { handler, events } = load(whole, { hold, games: SLATE });
  const reg = [];
  const ctx = strictCtx((p) => reg.push(handled(p)));
  handled(handler({}, ctx));
  await sleep(25); // the charge, the fetch and the first half of the reconcile are done; the reconcile is held
  const heldEvents = events.slice();
  const whileHeld = reg.length ? await settledState(reg[0], 4) : 'none';
  release();
  await sleep(18);
  const afterRelease = reg.length ? await settledState(reg[0], 4) : 'none';
  return { whileHeld, afterRelease, heldEvents, events: events.slice(), registrations: reg.length };
}

/** The REAL reconcileOddsCredit, wrapper and refund, against a fake D1 and KV whose every operation takes time. Each operation logs when it COMPLETES, and 'returned' is logged
 *  when the call returns, so anything the call did not await completes after 'returned' (or never in order). The clock is pinned, so the day and month keys are known. */
export const REFUND_ORDER = 'ensure > batch:start > batch:done > kv:site > kv:daily > kv:month > ensure > tally:start > tally:done > returned';
export async function refundScenario(budgetSrc, { cache = 'HIT', last = '6' } = {}) {
  const bb = blankOf(budgetSrc);
  const parts = [
    sliceFn(budgetSrc, 'reconcileOddsCredit', true, true, bb), sliceFn(budgetSrc, '_reconcileOddsCredit', false, true, bb), sliceFn(budgetSrc, '_bumpSite', false, true, bb),
    sliceFn(budgetSrc, '_siteKey', false, false, bb), sliceFn(budgetSrc, 'creditsKeptBy', true, false, bb),
  ];
  const names = ['reconcileOddsCredit', '_reconcileOddsCredit', '_bumpSite', '_siteKey', 'creditsKeptBy'];
  const missing = names.filter((_, i) => !parts[i]);
  if (missing.length) throw new Error(`${missing.join(', ')} not found in the budget source`);
  const PIN = Date.parse('2026-11-07T15:00:00Z');
  class PinnedDate extends Date { constructor(...a) { if (a.length === 0) super(PIN); else super(...a); } static now() { return PIN; } }
  const log = [], batchCalls = [], tallyCalls = [], overlaps = [];
  const kv = new Map([['odds:daily:2026-11-07', '100'], ['odds:credits:2026-11', '1000'], ['odds:site:handleCFLOddsProbs:2026-11-07', '50']]);
  const kvName = (k) => (k.startsWith('odds:site:') ? 'site' : k.startsWith('odds:daily:') ? 'daily' : 'month');
  const SQL = { fixDay: 'FIXDAY', fixSite: 'FIXSITE', fixMonth: 'FIXMONTH', reconcileTally: 'TALLY' };
  // Every operation takes time, and the steps are documented to run one after another: an operation that STARTS while another is still in flight was not awaited, whatever
  // the durations happen to be.
  const inflight = new Set();
  const op = async (name, ticks, fn) => {
    if (inflight.size) overlaps.push(`${name} started while ${[...inflight].join(', ')} was in flight`);
    inflight.add(name);
    for (let n = 0; n < ticks; n++) await tick();
    const v = fn();
    inflight.delete(name);
    return v;
  };
  const stmt = (sql) => { const s = { sql, args: null, bind: (...a) => { s.args = a; return s; }, run: () => (sql === 'TALLY' ? op('tally', 2, () => { log.push('tally:start'); tallyCalls.push(s.args); log.push('tally:done'); }) : Promise.resolve()) }; return s; };
  const env = {
    FIELD_JOURNALISM: {
      get: (k) => op('kv.get', 1, () => (kv.has(k) ? kv.get(k) : null)),
      put: (k, v) => op(`kv.put:${kvName(k)}`, 2, () => { kv.set(k, v); log.push(`kv:${kvName(k)}`); }),
    },
    ARCHIVE_DB: {
      prepare: (sql) => stmt(sql),
      batch: (stmts) => op('batch', 2, () => { log.push('batch:start'); for (const x of stmts) batchCalls.push([x.sql, ...(x.args || [])]); log.push('batch:done'); }),
    },
  };
  const deps = { Date: PinnedDate, ODDS_BUDGET_SQL: SQL, ensureOddsBudgetTables: () => op('ensure', 1, () => { log.push('ensure'); return true; }), console };
  const body = parts.map((p) => p.replace('export async function', 'async function').replace('export function', 'function')).join('\n');
  const factory = new Function('deps', `const { Date, ODDS_BUDGET_SQL, ensureOddsBudgetTables, console } = deps;\n${body}\nreturn reconcileOddsCredit;`);
  const resp = { headers: { get: (h) => (h === 'cf-cache-status' ? cache : h === 'x-requests-last' ? last : null) } };
  const out = await factory(deps)(env, 6, resp, 'handleCFLOddsProbs');
  log.push('returned');
  await sleep(40); // anything the call did not await finishes now, after 'returned'
  return { log, out, batchCalls, tallyCalls, overlaps, kv: Object.fromEntries(kv) };
}

/** Every finding, as an array so an empty one is the pass; `stats` carries the denominators. */
export async function findings(whole, budgetSrc, stats = { assertions: 0, scenarios: 0, static: 0 }) {
  stats.static = stats.static || 0;
  const out = [];
  const chk = (cond, msg) => { stats.assertions++; if (!cond) out.push(msg); };
  const st = (cond, msg) => { stats.static++; chk(cond, msg); };
  try { load(whole); } catch (e) { return [`could not load the handler: ${e.message}`]; }
  const safe = async (label, fn) => { stats.scenarios++; try { return await fn(); } catch (e) { out.push(`scenario "${label}" crashed instead of answering: ${e && e.message}`); return null; } };
  // A rejection nobody handled (a dangling derived promise, say) is a finding, not a stack trace that kills the run.
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(String(e && e.message || e).slice(0, 80));
  process.on('unhandledRejection', onUnhandled);
  try {
    // Source STATIC checks read the source with comments and quoted strings blanked, so a comment that names a function is not a definition or a caller and a string label is not a
    // reference. Offsets line up with the original (the blanker keeps the length), which is how the route is tied to its path string.
    const code = blankOf(whole);
    st(code.length === whole.length, 'the comment blanker changed the length of the source, so the route can no longer be tied to its path');
    const calls = (name) => count(code, `${name}(`);
    const bare = (name) => (code.match(new RegExp(`(?<![\\w$.])${name}(?![\\w$(])`, 'g')) || []).length;
    st(count(code, 'async function handleCFLOddsProbs(') === 1, `expected exactly one definition of handleCFLOddsProbs, found ${count(code, 'async function handleCFLOddsProbs(')} (a copy outside a comment is read as the definition)`);
    st(count(code, 'async function cflOddsProbsPipeline(') === 1, `expected exactly one definition of cflOddsProbsPipeline, found ${count(code, 'async function cflOddsProbsPipeline(')}`);
    st(calls('handleCFLOddsProbs') === 2, `expected the definition and exactly one call site of handleCFLOddsProbs(, found ${calls('handleCFLOddsProbs')} occurrences in code`);
    st(calls('cflOddsProbsPipeline') === 2, `expected the definition and exactly one caller of cflOddsProbsPipeline(, found ${calls('cflOddsProbsPipeline')} occurrences in code: a second caller skips the registration`);
    st(bare('handleCFLOddsProbs') === 0 && bare('cflOddsProbsPipeline') === 0, `a bare reference to handleCFLOddsProbs or cflOddsProbsPipeline (an alias, .call, .apply, .bind or a reference passed on) can start the call without the registration: ${bare('handleCFLOddsProbs')} and ${bare('cflOddsProbsPipeline')} found`);
    const routeAt = code.search(/return (?:await )?handleCFLOddsProbs\(env, ctx\);/);
    st(routeAt >= 0 && /pathname === '\/cfl\/odds-probs'\)\s*\{?\s*$/.test(whole.slice(Math.max(0, routeAt - 80), routeAt)), "the /cfl/odds-probs route does not call handleCFLOddsProbs(env, ctx): without ctx the call cannot be registered");
    // ctx must still be the runtime's by the time the route is reached: from the runtime, into _fetch, to the route.
    st(count(code, 'await this._fetch(request, _env, ctx);') === 1, 'the runtime hop into _fetch no longer passes the ctx it was given (expected exactly one `await this._fetch(request, _env, ctx);`)');
    const entryAt = routeAt < 0 ? -1 : code.lastIndexOf('async _fetch(request, env, ctx)', routeAt);
    st(entryAt >= 0, 'could not find _fetch(request, env, ctx) before the route');
    if (entryAt >= 0) {
      const seg = code.slice(entryAt, routeAt);
      const assign = (seg.match(/(^|[^.\w$])ctx\s*(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])?=(?![=>])/g) || []).length;
      const destructure = (seg.match(/[{[][^{}[\]]*\bctx\b[^{}[\]]*[}\]]\s*=(?![=>])/g) || []).length;
      st(assign + destructure === 0, `ctx is assigned ${assign + destructure} time(s) between the fetch handler's entry and the route: the handler would get a ctx that is not the runtime's`);
    }
    // The vendor call is unchanged: URL, markets, regions, cache options, and one price for charge and reconcile.
    const pipe = sliceFn(code, 'cflOddsProbsPipeline') || '';
    st(count(pipe, 'const _cflUrl = `') === 1 && pipe.includes('/v4/sports/americanfootball_cfl/odds?apiKey=${key}&markets=h2h,spreads,totals&regions=us,eu&oddsFormat=decimal`;'), 'the vendor URL (sport, markets h2h,spreads,totals, regions us,eu) changed or is not built exactly once');
    st(/cf: \{ cacheTtl: 120, cacheEverything: true \}/.test(pipe), 'the vendor fetch no longer carries cf: { cacheTtl: 120, cacheEverything: true }');

    // Happy path: a cache HIT with a real slate.
    const h = await safe('hit with a slate', () => drive(whole, { games: SLATE }));
    if (h) {
      chk(!h.threw, `the handler threw on a normal call: ${h.threw && h.threw.message}`);
      if (!h.threw) {
        chk(!h.hung, 'the handler never settled on a normal call');
        chk(h.registered.length === 1, `ctx.waitUntil was called ${h.registered.length} times, expected exactly 1`);
        if (h.registered.length === 1) {
          chk(h.registered[0].phase === 'sync', 'ctx.waitUntil was called AFTER the handler returned its promise, so after an await: registration must come before any yield');
          chk(!h.snapshots[0].some((e) => e.endsWith(':done')), `a step had already finished when waitUntil was called (${h.snapshots[0].join(', ')}): the call yielded before it was registered`);
        }
        chk(h.events.join(' > ') === 'charge:start:handleCFLOddsProbs:6 > charge:done > fetch:start > fetch:done > reconcile:start:handleCFLOddsProbs > reconcile:done', `the steps ran as [${h.events.join(' > ')}], expected charge, fetch, reconcile once each, in that order, under the label handleCFLOddsProbs`);
        chk(!h.rejected, `the handler rejected on a normal call: ${h.rejected && h.rejected.message}`);
        chk(h.status === 200 && h.body && h.body.ok === true, `a normal call answered ${h.status} ${show(h.body)}, expected 200 {ok:true}${h.body && /is not defined/.test(String(h.body.error)) ? ' (the check loads only handleCFLOddsProbs and cflOddsProbsPipeline out of the source: a helper moved out of them has to be added to load())' : ''}`);
        if (h.body && h.body.ok === true) {
          chk(Object.keys(h.body).sort().join(',') === 'cached,charged,cost,ok,probs,reconciled,remaining,ts', `the 200 body keys are [${Object.keys(h.body).sort().join(',')}], expected cached,charged,cost,ok,probs,reconciled,remaining,ts`);
          chk(JSON.stringify(h.body.probs) === JSON.stringify([EXPECT_PROB]), `the slate came out as ${show(h.body.probs)}, expected ${show([EXPECT_PROB])}`);
          chk(h.body.reconciled && h.body.reconciled.nonce === h.refs.lastNonce && h.body.reconciled.state === 'cache-hit' && h.body.reconciled.delta === -6, `reconciled is ${show(h.body.reconciled)}, expected the very object the reconcile returned (nonce ${h.refs.lastNonce}), not a copy or a placeholder`);
          chk(h.body.charged === 6 && h.body.cost === '6' && h.body.cached === 'HIT' && h.body.remaining === '399994', `charged/cost/cached/remaining read ${h.body.charged}/${h.body.cost}/${h.body.cached}/${h.body.remaining}, expected 6/'6'/'HIT'/'399994'`);
          const hd = (n) => h.headers && h.headers.get(n);
          chk(hd('Access-Control-Allow-Origin') === '*' && hd('Content-Type') === 'application/json' && hd('Cache-Control') === 'max-age=120', `the 200 headers read CORS ${hd('Access-Control-Allow-Origin')}, Content-Type ${hd('Content-Type')}, Cache-Control ${hd('Cache-Control')}, expected * / application/json / max-age=120`);
        }
        chk(h.refs.charge.length === 1 && h.refs.charge[0] === h.env && h.refs.reconcile.length === 1 && h.refs.reconcile[0] === h.env, 'the charge and the reconcile did not each receive, once, the very env the handler was given');
        chk(h.refs.units.length === 2 && h.refs.units[0] === 6 && h.refs.units[1] === 6, `the charge and the reconcile were priced ${show(h.refs.units)}, expected 6 and 6 from the same vendor URL`);
        chk(h.refs.fetchResp.length === 1 && h.refs.reconcileResp.length === 1 && h.refs.reconcileResp[0] === h.refs.fetchResp[0], 'the reconcile was not handed the very response the vendor fetch returned: it reads that response\'s cache and billing headers to decide the refund, and without it the charge stands');
        chk(h.refs.fetchOpts.length === 1 && h.refs.fetchOpts[0] && h.refs.fetchOpts[0].cf && h.refs.fetchOpts[0].cf.cacheTtl === 120 && h.refs.fetchOpts[0].cf.cacheEverything === true, 'the vendor fetch did not receive cf { cacheTtl: 120, cacheEverything: true }');
      }
    }

    // The registered promise IS the whole call. The reconcile is held open: the registered promise must stay pending for as long as the call is in flight, and settle right
    // after the call does. A timer, a decoy or a different branch cannot do both.
    const idn = await safe('registered promise identity', () => identityProbe(whole));
    if (idn) {
      chk(idn.registrations === 1, `the identity probe saw ${idn.registrations} registrations, expected 1`);
      chk(idn.heldEvents.some((e) => e.startsWith('reconcile:start')) && !idn.heldEvents.includes('reconcile:done'), `the identity probe did not hold the call in the reconcile (${idn.heldEvents.join(' > ')}), so its reading means nothing`);
      chk(idn.whileHeld === 'pending', `the registered promise was ${idn.whileHeld} while the reconcile was still in flight: it is not the whole call`);
      chk(idn.afterRelease === 'resolved', `the registered promise was ${idn.afterRelease} right after the call finished: it is a timer or a different branch, not the whole call`);
    }

    // Priced by the cost model, not by a literal: with the model at 7 both the charge and the reconcile say 7.
    const p7 = await safe('priced by the cost model', () => drive(whole, { games: SLATE, cost: 7 }));
    if (p7) {
      chk(p7.refs.units.length === 2 && p7.refs.units[0] === 7 && p7.refs.units[1] === 7 && p7.body && p7.body.charged === 7, `with the cost model at 7 the charge, the reconcile and the body were priced ${show(p7.refs.units)} / ${p7.body && p7.body.charged}, expected 7, 7 and 7: the handler is not asking the cost model`);
    }

    // The refused charge makes no fetch and no reconcile; the call is still registered once and charged once.
    const d = await safe('declined charge', () => drive(whole, { declined: true }));
    if (d) {
      chk(d.status === 503 && d.body && d.body.guarded === true && d.body.error === 'odds credit guard declined this call', `a declined charge answered ${d.status} ${show(d.body)}, expected 503 {guarded:true}`);
      chk(!d.events.some((e) => e.startsWith('fetch') || e.startsWith('reconcile')), `a declined charge still reached the vendor or the reconcile (${d.events.join(', ')})`);
      chk(d.registered.length === 1 && d.registered[0].phase === 'sync' && d.refs.charge.length === 1, `a declined call registered ${d.registered.length} times and charged ${d.refs.charge.length} times, expected 1 and 1, registered in the synchronous segment`);
      chk(d.headers && d.headers.get('Access-Control-Allow-Origin') === '*' && d.headers.get('Content-Type') === 'application/json', 'a declined charge answered without the CORS or Content-Type headers');
    }

    // No key: nothing is charged.
    const k = await safe('no key', () => drive(whole, { noKey: true }));
    if (k) {
      chk(k.status === 503 && k.body && k.body.error === 'ODDS_API_KEY not configured', `a missing key answered ${k.status} ${show(k.body)}, expected 503 ODDS_API_KEY not configured`);
      chk(k.events.length === 0 && k.refs.charge.length === 0, `a missing key still ran steps (${k.events.join(', ')})`);
      chk(k.registered.length === 1 && k.registered[0].phase === 'sync', `a missing key registered ${k.registered.length} times, expected 1, in the synchronous segment`);
    }

    // The vendor answers non-OK: 502, and the reconcile still ran (it holds the refund and the tally).
    const v = await safe('vendor 500', () => drive(whole, { vendorStatus: 500 }));
    if (v) {
      chk(v.status === 502 && v.body && v.body.error === 'Odds API 500', `a vendor 500 answered ${v.status} ${show(v.body)}, expected 502 'Odds API 500'`);
      chk(v.events.includes('reconcile:done'), 'a vendor 500 skipped the reconcile');
      chk(v.registered.length === 1 && v.refs.charge.length === 1, `a vendor 500 registered ${v.registered.length} times and charged ${v.refs.charge.length} times, expected 1 and 1`);
    }

    // The fetch throws: 500 with the message, as before.
    const f = await safe('fetch throws', () => drive(whole, { fetchThrows: true }));
    if (f) {
      chk(f.status === 500 && f.body && f.body.error === 'vendor down', `a throwing fetch answered ${f.status} ${show(f.body)}, expected 500 'vendor down'`);
      chk(f.registered.length === 1 && f.refs.charge.length === 1, `a throwing fetch registered ${f.registered.length} times and charged ${f.refs.charge.length} times, expected 1 and 1`);
    }

    // A charge that throws still rejects to the caller; the call is registered once and charged ONCE (no second try).
    const c = await safe('charge throws', () => drive(whole, { chargeThrows: true }));
    if (c) {
      chk(c.rejected && c.rejected.message === 'D1 exploded', `a throwing charge did not reach the caller as a rejection (got ${c.rejected ? c.rejected.message : show(c.body)})`);
      chk(c.registered.length === 1 && c.registered[0].phase === 'sync', `a throwing charge registered ${c.registered.length} times, expected 1, in the synchronous segment`);
      chk(c.refs.charge.length === 1, `a throwing charge was attempted ${c.refs.charge.length} times, expected 1: the call must not run again on error`);
      chk(!c.events.some((e) => e.startsWith('fetch')), 'a throwing charge still fetched');
    }

    // A missing ctx throws before anything is charged.
    for (const mode of ['none', 'nowait']) {
      const label = mode === 'none' ? 'ctx undefined' : 'ctx without waitUntil';
      const n = await safe(label, () => drive(whole, {}, mode));
      if (n) {
        const err = n.threw || n.rejected;
        chk(err && /execution context/.test(err.message), `${label} did not throw the execution-context error (got ${err ? err.message : 'no error'})`);
        chk(n.events.length === 0 && n.refs.charge.length === 0, `${label} still ran steps before failing (${n.events.join(', ')})`);
      }
    }

    // The real reconcile, refund and tally: everything it does completes before it returns, in the order it is documented to run, with the values it is documented to write.
    // Three cases, because a cache HIT keeps 0 credits and so cannot show a wrong `kept` bind: a HIT, a billed MISS that refunds part, a billed MISS that refunds nothing.
    const ID = 'handleCFLOddsProbs', D = '2026-11-07', M = '2026-11';
    const fix = (n) => [['FIXDAY', n, D], ['FIXSITE', D, ID, n, n], ['FIXMONTH', n, M]];
    const CASES = [
      { label: 'a cache HIT refunds the whole charge', args: { cache: 'HIT', last: '6' }, order: REFUND_ORDER, batch: fix(-6), tally: [[D, ID, 'cache-hit', 'HIT', 0, 0]], kv: ['94', '994', '44'], out: ['cache-hit', -6, 0] },
      { label: 'a billed MISS of 4 refunds 2', args: { cache: 'MISS', last: '4' }, order: REFUND_ORDER, batch: fix(-2), tally: [[D, ID, 'reconciled', 'MISS', 4, 4]], kv: ['98', '998', '48'], out: ['reconciled', -2, 4] },
      { label: 'a billed MISS of 6 refunds nothing', args: { cache: 'MISS', last: '6' }, order: 'ensure > tally:start > tally:done > returned', batch: [], tally: [[D, ID, 'reconciled', 'MISS', 6, 6]], kv: ['100', '1000', '50'], out: ['reconciled', 0, 6] },
    ];
    for (const k of CASES) {
      const r = await safe(`real refund and tally: ${k.label}`, () => refundScenario(budgetSrc, k.args));
      if (!r) continue;
      const late = r.log.slice(r.log.indexOf('returned') + 1);
      chk(late.length === 0, `reconcileOddsCredit (${k.label}) returned before these finished: ${late.join(', ')} (the step Task 2b lost: work that is not awaited is not kept alive by waitUntil)`);
      chk(r.overlaps.length === 0, `reconcile steps (${k.label}) overlapped: ${r.overlaps.join('; ')} (a step that starts before the one before it finished was not awaited)`);
      chk(r.log.join(' > ') === k.order, `reconcile steps (${k.label}) ran as [${r.log.join(' > ')}], expected [${k.order}] (the table check, the refund batch, the three KV ledgers, the table check, the tally; if this was reordered on purpose, update the expected order)`);
      chk(JSON.stringify(r.batchCalls) === JSON.stringify(k.batch), `the refund batch (${k.label}) carried ${show(r.batchCalls)}, expected ${show(k.batch)}`);
      chk(JSON.stringify(r.tallyCalls) === JSON.stringify(k.tally), `the tally write (${k.label}) bound ${show(r.tallyCalls)}, expected ${show(k.tally)}`);
      chk(r.kv['odds:daily:2026-11-07'] === k.kv[0] && r.kv['odds:credits:2026-11'] === k.kv[1] && r.kv['odds:site:handleCFLOddsProbs:2026-11-07'] === k.kv[2], `the KV ledgers (${k.label}) read ${show(r.kv)}, expected the day ${k.kv[0]}, the month ${k.kv[1]} and the site ${k.kv[2]}`);
      chk(r.out && r.out.state === k.out[0] && r.out.delta === k.out[1] && r.out.actual === k.out[2] && r.out.site === ID, `reconcileOddsCredit (${k.label}) returned ${show(r.out)}, expected state ${k.out[0]}, delta ${k.out[1]}, actual ${k.out[2]} for ${ID}`);
    }
  } finally {
    await sleep(15);
    process.off('unhandledRejection', onUnhandled);
  }
  chk(unhandled.length === 0, `${unhandled.length} promise rejection(s) nobody handled (${unhandled.join('; ')}): a dangling branch of the call fails where nothing can see it`);
  return out;
}

export function coverage(stats) {
  return `COVERAGE: ${stats.assertions} assertions (${stats.static} static reads of the comment-blanked source, ${stats.assertions - stats.static} executed) over ${stats.scenarios} scenarios: hit with a real slate, registered-promise identity (reconcile held open), priced by the cost model, declined, no key, vendor 500, fetch throws, charge throws, ctx undefined, ctx without waitUntil, and the real reconcileOddsCredit with its refund and tally (a cache HIT, a billed MISS that refunds part, a billed MISS that refunds nothing) against a fake D1 and KV with a pinned clock. The ctx stub throws on an unbound or copied waitUntil, as workerd does. NOT covered: that the edge keeps a registered promise running after a disconnect, or for how long (30 s, and the vendor fetch has no timeout): only the repeat of Task 2b shows it; the real consumeOddsCredit and fetch are stubbed and the cost model is a function of the URL; the slate is one game, and a refund batch or KV write that throws is not driven here; a branch gated on a flag none of the eight flag sets sets is not executed; the guard is locked to a thrown error whose text contains "execution context"; the order of the refund steps is locked to REFUND_ORDER.`;
}

if (process.argv.includes('--self-test')) {
  // The self-test is the mutation harness's baseline plus the contract on hand-built shapes that must fail.
  let bad = 0, total = 0;
  const one = (label, got, want) => { total++; const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
  const whole = readFileSync(SRC, 'utf8');
  const budget = readFileSync(BUDGET, 'utf8');
  one('the real source has no findings', await findings(whole, budget), []);
  const LATE = whole.replace('    const work = cflOddsProbsPipeline(env);\n    ctx.waitUntil(work);\n    return work;', '    await Promise.resolve();\n    const work = cflOddsProbsPipeline(env);\n    ctx.waitUntil(work);\n    return work;');
  one('a handler that awaits before registering is refused (the fixture really differs from the source)', [LATE !== whole, (await findings(LATE, budget)).some((f) => f.includes('AFTER the handler returned'))], [true, true]);
  const UNBOUND = whole.replace('    const work = cflOddsProbsPipeline(env);\n    ctx.waitUntil(work);', '    const { waitUntil } = ctx;\n    const work = cflOddsProbsPipeline(env);\n    waitUntil(work);');
  one('an unbound waitUntil is refused as workerd refuses it (the fixture really differs from the source)', [UNBOUND !== whole, (await findings(UNBOUND, budget)).some((f) => f.includes('Illegal invocation'))], [true, true]);
  one('a source without the functions is refused rather than passed', (await findings('const x = 1;\n', budget))[0].startsWith('could not load the handler'), true);
  const CRASH = whole.replace('    return work;\n}\nasync function cflOddsProbsPipeline', '    return notDefinedAnywhere;\n}\nasync function cflOddsProbsPipeline');
  one('a handler that crashes is a finding with a reason, not a stack trace', [CRASH !== whole, (await findings(CRASH, budget)).length > 0], [true, true]);
  const stats = { assertions: 0, scenarios: 0, static: 0 };
  await findings(whole, budget, stats);
  one('the denominators are counted: more than 50 assertions, over 13 scenarios', [stats.assertions > 50, stats.scenarios], [true, 13]);
  console.log(bad ? `\n${bad} FAILED` : `\nself-test: ${total}/${total}`);
  console.log(coverage(stats));
  process.exit(bad ? 1 : 0);
}

const whole = readFileSync(SRC, 'utf8');
const budget = readFileSync(BUDGET, 'utf8');
const stats = { assertions: 0, scenarios: 0, static: 0 };
const f = await findings(whole, budget, stats);
if (f.length) { for (const m of f) console.log(`FAIL  ${m}`); console.log(`\n${f.length} finding(s) in ${stats.assertions} assertions over ${stats.scenarios} scenarios.\n${coverage(stats)}`); process.exit(1); }
console.log(`PASS  handleCFLOddsProbs registers its whole call with ctx.waitUntil in the synchronous segment, builds the response from it, keeps its five outcomes, and reconcileOddsCredit awaits its refund and its tally: ${stats.assertions} assertions (${stats.static} static, ${stats.assertions - stats.static} executed) over ${stats.scenarios} scenarios (${SRC}, ${BUDGET})`);
console.log(coverage(stats));
