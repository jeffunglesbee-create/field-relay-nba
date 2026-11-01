#!/usr/bin/env node
// STAGED, owner-approval-gated. The one production experiment that separates the two live explanations of docs/CC-CMD-2026-10-13-vendor-residual-window.md P5
// (handleCFLOddsProbs holds charges its reconcile says it refunded):
//   - a client that disconnects mid-request stops the handler before the refund and the tally (the continuation is cancelled), or
//   - the refund fails for another reason (a D1 error under load) and aborts have nothing to do with it.
// It cannot run in a sandbox (the relay host is blocked) or without credits being possible: GET /cfl/odds-probs charges 6 credits BEFORE the vendor fetch and keeps them
// on a cache miss. So it runs only on a GitHub Actions runner (.github/workflows/cfl-abort-experiment.yml) and only with the approval text below in APPROVAL.
//
// COST, bounded and printed: at most TWO cold-cache calls (the warm-up and, if the cache is not warm yet, its confirmation) = at most 12 credits at the vendor, and the
// aborted calls are made ONLY after a normal call has shown cf-cache-status HIT, so they reach the cache, not the vendor. If the cache is not HIT after the confirmation
// the script STOPS and reports inconclusive. It can also leave up to ABORTS x 6 credits of over-record in the relay's own ledger for the day (a lost refund is exactly what is
// being tested); the artifact states the number so the vendor watch's residual for that window can be corrected by hand.
//
// Usage (runner): APPROVAL='<the text below>' RELAY_BASE=... node scripts/cfl-abort-experiment.mjs        |        node scripts/cfl-abort-experiment.mjs --self-test
import { writeFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
export const SITE = 'handleCFLOddsProbs';
export const CALL = 6;
export const APPROVAL_TEXT = 'APPROVED: up to 12 Odds API credits for the CFL abort experiment';
// The first run (2026-11-01) aborted at 3, 10, 25, 50 and 100 ms. Some of those can have been abandoned before the request reached the Worker, and a call that never arrived leaves no
// charge and no tally, which reads exactly like a call that was cut. So the schedule is CALIBRATED: fractions of the MEDIAN latency of three confirmed cache-HIT calls (the cold call
// is a different, slower path and is not used), with a floor. The fractions stop at 0.6 on purpose: an abort that lands after the response is a call that was not cut, and the
// latency of one call varies, so a schedule that reaches 0.95 of a sample loses its late aborts whenever the call is a little faster than the sample (measured by the 2026-11-01
// review: with 20% jitter a schedule to 0.95 left some abort ineffective in 23 runs of 40, and the verdict then discarded the aborts that DID take effect). `abortMs` in the options
// still overrides it (the self-test does).
export const ABORT_FRACTIONS = [0.2, 0.3, 0.4, 0.5, 0.6];
export const ABORT_FLOOR_MS = 40;
export const LATENCY_SAMPLES = 3;
/** 'abort-loses-nothing' needs at least this many calls the client really cut. Fewer and the experiment never tested the thing; a LOSS is conclusive with any. */
export const MIN_EFFECTIVE = 3;
export const schedule = (latencyMs) => ABORT_FRACTIONS.map((f) => Math.max(ABORT_FLOOR_MS, Math.round(f * latencyMs)));
export const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The CFL line of one /budget/odds body. Throws on any shape drift: an absent block must never read as zero. */
export function cflLedger(body) {
  const d = body && body.daily;
  if (!d || typeof d !== 'object') throw new Error('/budget/odds has no daily block');
  if (!d.by_site || typeof d.by_site !== 'object') throw new Error('daily.by_site is missing');
  if (!Array.isArray(d.reconcile)) throw new Error('daily.reconcile is not an array');
  const by = d.by_site[SITE];
  if (typeof by !== 'number') throw new Error(`daily.by_site.${SITE} is ${JSON.stringify(by)}, not a number`);
  const rows = d.reconcile.filter((r) => r.site === SITE);
  // A row with no numeric value where a sum needs one throws: absence is not zero, and a ledger that lost a field must not read as a quiet one.
  const sum = (f) => rows.reduce((t, r) => { const v = f(r); if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`daily.reconcile has a ${SITE} row with a non-numeric n or credits_kept: ${JSON.stringify(r).slice(0, 100)}`); return t + v; }, 0);
  return { date: d.date, by_site: by, kept: sum((r) => r.credits_kept), n: sum((r) => r.n), hit: sum((r) => (r.cache === 'HIT' ? r.n : 0)) };
}
const diff = (a, b) => ({ by_site: b.by_site - a.by_site, kept: b.kept - a.kept, n: b.n - a.n, hit: b.hit - a.hit });

/** What the aborted phase says. `k` aborted calls, `effective` of them really abandoned by the client; `abortDelta` is the ledger delta over that phase alone.
 *  A call the client did NOT cut completes like any normal call, and the control phase shows a normal call loses nothing, so every lost refund or tally has to come from a cut call:
 *  more lost than were cut means something else wrote to the ledger. A loss is conclusive with any cut call; "loses nothing" needs MIN_EFFECTIVE of them. */
export function verdictOf({ k, effective, abortDelta, controlDelta, quiet }) {
  if (!quiet) return { verdict: 'inconclusive:ledger-not-quiet', why: 'the ledger moved before the experiment started (real traffic), so its deltas cannot be attributed' };
  if (controlDelta.by_site !== 0 || controlDelta.kept !== 0) return { verdict: 'inconclusive:control-moved', why: 'normal cache-hit calls changed by_site or kept, so something else wrote to the ledger in the window' };
  const lostRefunds = abortDelta.by_site / CALL;
  const missingTallies = k - abortDelta.hit;
  if (!Number.isInteger(lostRefunds) || lostRefunds < 0 || abortDelta.kept !== 0 || missingTallies < 0) return { verdict: 'inconclusive:unexpected-delta', why: `by_site moved ${abortDelta.by_site}, kept ${abortDelta.kept}, tallies ${abortDelta.hit} of ${k}: not a whole number of lost ${CALL}-credit refunds with a tally each` };
  if (lostRefunds > effective || missingTallies > effective) return { verdict: 'inconclusive:unexpected-delta', why: `${lostRefunds} refunds and ${missingTallies} tallies were lost but only ${effective} of ${k} calls were cut: something else wrote to the ledger` };
  if (lostRefunds === 0 && missingTallies === 0) {
    if (effective < MIN_EFFECTIVE) return { verdict: 'inconclusive:abort-not-effective', why: `only ${effective} of ${k} aborted calls were cut before their response (at least ${MIN_EFFECTIVE} are needed to say a cut loses nothing)` };
    return { verdict: 'abort-loses-nothing', why: `${effective} of ${k} aborted cache-hit calls were cut, and every refund and every tally landed` };
  }
  if (lostRefunds > 0 && missingTallies > 0) return { verdict: 'abort-loses-refund-and-tally', why: `${lostRefunds} of ${effective} cut calls kept their ${CALL}-credit charge and ${missingTallies} left no tally: the continuation did not run` };
  if (lostRefunds > 0) return { verdict: 'abort-loses-refund-keeps-tally', why: `${lostRefunds} of ${effective} cut calls kept their charge although the tally says it was refunded` };
  return { verdict: 'inconclusive:tally-only', why: `${missingTallies} tallies missing but no charge kept: a call that never reached the Worker, or a tally lost on its own` };
}

async function getJson(fetchImpl, pathAndQuery) {
  const res = await fetchImpl(RELAY + pathAndQuery, { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'field-cfl-abort-experiment/1' } });
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch (_) { /* text */ }
  return { status: res.status, body, text: text.slice(0, 500), headers: res.headers };
}
async function abortedCall(fetchImpl, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { await fetchImpl(`${RELAY}/cfl/odds-probs`, { redirect: 'manual', signal: ac.signal, headers: { 'User-Agent': 'field-cfl-abort-experiment/1' } }).then((r) => r.text()); return { aborted: false }; }
  catch (e) { return { aborted: e && (e.name === 'AbortError' || /abort/i.test(String(e.message || e))) }; }
  finally { clearTimeout(t); }
}

/** The whole experiment over an injected fetch and sleep, so the self-test runs it against a fake relay. Returns the artifact. */
export async function run(fetchImpl, { abortMs = null, settleMs = 3000, quietMs = 8000, lateMs = 20000, day } = {}) {
  const d = day || new Date().toISOString().slice(0, 10);
  const ledger = async () => { const r = await getJson(fetchImpl, `/budget/odds?date=${d}`); if (r.status !== 200) throw new Error(`/budget/odds answered ${r.status}`); return cflLedger(r.body); };
  const art = { day: d, site: SITE, approval: APPROVAL_TEXT, max_vendor_credits: 2 * CALL, calls: [], ledgers: {} };
  const stop = (why) => { art.verdict = `inconclusive:${why}`; art.why = why; return art; };

  art.ledgers.before_a = await ledger(); await sleep(quietMs); art.ledgers.before_b = await ledger();
  const quiet = JSON.stringify(art.ledgers.before_a) === JSON.stringify(art.ledgers.before_b);

  const tWarm = Date.now();
  const warm = await getJson(fetchImpl, '/cfl/odds-probs');
  art.warm_ms = Date.now() - tWarm;
  art.calls.push({ step: 'warm-up', status: warm.status, cached: warm.body && warm.body.cached, state: warm.body && warm.body.reconciled && warm.body.reconciled.state });
  if (warm.status !== 200 || !warm.body || warm.body.ok !== true) return stop('warm-up-failed');
  // The confirming call and two more, all of which must be HITs: the aborted calls are made on the cache these show to be warm, and their median is the latency the schedule is cut from.
  const samples = [];
  for (let i = 0; i < LATENCY_SAMPLES; i++) {
    const t0 = Date.now();
    const c = await getJson(fetchImpl, '/cfl/odds-probs');
    samples.push(Date.now() - t0);
    art.calls.push({ step: i === 0 ? 'confirm' : 'latency-sample', status: c.status, cached: c.body && c.body.cached, state: c.body && c.body.reconciled && c.body.reconciled.state });
    if (c.status !== 200 || !c.body || c.body.cached !== 'HIT') return stop('cache-not-warm');
  }
  art.latency_samples_ms = samples;
  art.latency_ms = median(samples);

  abortMs = abortMs || schedule(art.latency_ms);
  art.abort_schedule_ms = abortMs;
  await sleep(settleMs); art.ledgers.start = await ledger();
  let effective = 0;
  for (const ms of abortMs) { const r = await abortedCall(fetchImpl, ms); art.calls.push({ step: 'aborted', abort_after_ms: ms, abort_took_effect: r.aborted }); if (r.aborted) effective++; await sleep(settleMs); }
  art.ledgers.after_aborts = await ledger();
  for (let i = 0; i < abortMs.length; i++) { const c = await getJson(fetchImpl, '/cfl/odds-probs'); art.calls.push({ step: 'control', status: c.status, cached: c.body && c.body.cached, state: c.body && c.body.reconciled && c.body.reconciled.state }); await sleep(settleMs); }
  art.ledgers.after_controls = await ledger(); await sleep(lateMs); art.ledgers.late = await ledger();

  const abortDelta = diff(art.ledgers.start, art.ledgers.after_aborts);
  const controlDelta = diff(art.ledgers.after_aborts, art.ledgers.after_controls);
  art.deltas = { aborted_phase: abortDelta, control_phase: controlDelta, late_after_controls: diff(art.ledgers.after_controls, art.ledgers.late) };
  art.aborted_calls = abortMs.length; art.aborted_effective = effective;
  art.ledger_overrecord_left_credits = abortDelta.by_site > 0 ? abortDelta.by_site : 0;
  Object.assign(art, verdictOf({ k: abortMs.length, effective, abortDelta, controlDelta, quiet }));
  return art;
}

if (process.argv.includes('--self-test')) {
  let bad = 0, total = 0;
  const one = (label, got, want) => { total++; const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
  const body = (by, rows) => ({ daily: { date: '2026-11-02', by_site: { [SITE]: by }, reconcile: rows } });
  one('cflLedger sums this site only', cflLedger(body(30, [{ site: SITE, cache: 'HIT', n: 4, credits_kept: 0 }, { site: SITE, cache: 'MISS', n: 1, credits_kept: 6 }, { site: 'x', cache: 'HIT', n: 99, credits_kept: 99 }])), { date: '2026-11-02', by_site: 30, kept: 6, n: 5, hit: 4 });
  for (const [label, b, msg] of [['no daily block', {}, /no daily block/], ['no by_site', { daily: { reconcile: [] } }, /by_site is missing/], ['reconcile not an array', { daily: { by_site: { [SITE]: 1 }, reconcile: null } }, /reconcile is not an array/], ['CFL absent from by_site', { daily: { by_site: {}, reconcile: [] } }, /not a number/], ['a CFL row with no n', { daily: { by_site: { [SITE]: 6 }, reconcile: [{ site: SITE, cache: 'HIT', credits_kept: 0 }] } }, /non-numeric n or credits_kept/], ['a CFL row with a null credits_kept', { daily: { by_site: { [SITE]: 6 }, reconcile: [{ site: SITE, cache: 'HIT', n: 2, credits_kept: null }] } }, /non-numeric n or credits_kept/]]) {
    let got = null; try { cflLedger(b); } catch (e) { got = String(e.message); }
    one(`cflLedger throws on ${label}, saying why (absence is not zero)`, got !== null && msg.test(got), true);
  }
  const Z = { by_site: 0, kept: 0, n: 0, hit: 0 };
  const V = (o) => verdictOf({ k: 5, effective: 5, abortDelta: { ...Z, hit: 5 }, controlDelta: Z, quiet: true, ...o }).verdict;
  one('nothing lost: abort-loses-nothing', V({}), 'abort-loses-nothing');
  one('2 refunds kept, 2 tallies missing', V({ abortDelta: { ...Z, by_site: 12, hit: 3 } }), 'abort-loses-refund-and-tally');
  one('2 refunds kept, every tally present', V({ abortDelta: { ...Z, by_site: 12, hit: 5 } }), 'abort-loses-refund-keeps-tally');
  one('the abort schedule is the fractions of the measured latency, floored, and never reaches the response', [schedule(1000), schedule(100), schedule(0), schedule(1000).every((x) => x <= 600)], [[200, 300, 400, 500, 600], [40, 40, 40, 50, 60], [40, 40, 40, 40, 40], true]);
  one('the median of three is the middle one, whatever order they arrive in', [median([300, 120, 130]), median([120, 130, 300]), median([5, 5, 900])], [130, 130, 5]);
  one('a not-quiet ledger is inconclusive before anything else', V({ quiet: false, abortDelta: { ...Z, by_site: 12, hit: 3 } }), 'inconclusive:ledger-not-quiet');
  one('fewer cut calls than the minimum, nothing lost: inconclusive, not "loses nothing"', V({ effective: MIN_EFFECTIVE - 1 }), 'inconclusive:abort-not-effective');
  one('exactly the minimum cut, nothing lost: abort-loses-nothing', V({ effective: MIN_EFFECTIVE }), 'abort-loses-nothing');
  one('a loss is conclusive with ONE cut call (the calls that completed tallied, the cut one did not)', V({ effective: 1, abortDelta: { ...Z, by_site: 6, hit: 4 } }), 'abort-loses-refund-and-tally');
  one('more refunds lost than calls cut is inconclusive: something else wrote', V({ effective: 1, abortDelta: { ...Z, by_site: 12, hit: 3 } }), 'inconclusive:unexpected-delta');
  one('more tallies than calls is inconclusive', V({ abortDelta: { ...Z, hit: 6 } }), 'inconclusive:unexpected-delta');
  one('a moving control phase is inconclusive', V({ controlDelta: { ...Z, by_site: 6 } }), 'inconclusive:control-moved');
  one('by_site not a whole number of refunds is inconclusive', V({ abortDelta: { ...Z, by_site: 7, hit: 5 } }), 'inconclusive:unexpected-delta');
  one('a negative by_site delta is inconclusive, not "nothing lost"', V({ abortDelta: { ...Z, by_site: -6, hit: 5 } }), 'inconclusive:unexpected-delta');
  one('kept moving in the aborted phase is inconclusive', V({ abortDelta: { ...Z, kept: 6, hit: 5 } }), 'inconclusive:unexpected-delta');

  // The whole run against a fake relay that keeps a ledger and can lose the continuation of an aborted request.
  function fakeRelay(mode, opts = {}) {
    const st = { by: 24, kept: 6, n: 8, hit: 5, requests: [], warm: opts.warm !== false, hitsServed: 0 };
    const srv = http.createServer(async (req, res) => {
      st.requests.push(req.url);
      if (req.url.startsWith('/budget/odds')) {
        if (opts.noise) { st.by += 0; st.n += 1; st.hit += 1; }
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ daily: { date: '2026-11-02', by_site: { [SITE]: st.by }, reconcile: [{ site: SITE, cache: 'HIT', n: st.hit, credits_kept: 0 }, { site: SITE, cache: 'MISS', n: st.n - st.hit, credits_kept: st.kept }] } }));
      }
      let closed = false; req.on('close', () => { if (!res.writableEnded) closed = true; });
      st.by += CALL;                                              // the charge, before the fetch
      const hit = st.warm; st.warm = true;                        // the first call is a MISS, then the cache is warm
      const hitIndex = hit ? st.hitsServed++ : -1;
      await sleep(hit ? ((opts.hitLatencies && opts.hitLatencies[Math.min(hitIndex, opts.hitLatencies.length - 1)]) || opts.latency || 40) : (opts.missLatency || opts.latency || 40));  // the reconcile's latency: a cold call and the first warm one can be slower
      if (hit) {
        if (!(closed && mode !== 'healthy')) st.by -= CALL;       // the refund
        if (!(closed && mode === 'lossy-both')) { st.n += 1; st.hit += 1; }  // the tally
      } else { st.kept += CALL; st.n += 1; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, probs: [], cached: hit ? 'HIT' : 'MISS', reconciled: { state: hit ? 'cache-hit' : 'reconciled' } }));
    });
    return { st, srv };
  }
  const fastOpts = { settleMs: 100, quietMs: 30, lateMs: 60, abortMs: [5, 10, 15], day: '2026-11-02' };
  async function against(mode, opts = {}, runOpts = {}) {
    const { st, srv } = fakeRelay(mode, opts);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const f = (u, o) => fetch(u.replace(RELAY, base), o);
    try { const art = await run(f, { ...fastOpts, ...runOpts }); return { art, st }; } finally { srv.close(); }
  }
  const h = await against('healthy');
  one('healthy relay: abort-loses-nothing, and every abort took effect', [h.art.verdict, h.art.aborted_effective, h.art.ledger_overrecord_left_credits], ['abort-loses-nothing', 3, 0]);
  const cal = await against('healthy', { latency: 120 }, { abortMs: null });
  one('with no abortMs given, the schedule is calibrated to the measured latency: 5 times, none under the floor, non-decreasing, and recorded', [cal.art.abort_schedule_ms.length, cal.art.abort_schedule_ms.every((x, i, a) => x >= 40 && (i === 0 || x >= a[i - 1])), cal.art.latency_ms >= 100, JSON.stringify(cal.art.abort_schedule_ms) === JSON.stringify(schedule(cal.art.latency_ms))], [5, true, true, true]);
  // The calibration uses the median of three confirmed HITs, not the cold call and not the first warm one: a relay whose cold call takes 500 ms and whose first warm call takes 400 ms
  // answers in about 120 ms from then on. A schedule cut from either slow call lands after the response and cuts nothing.
  const slowStart = await against('healthy', { warm: false, latency: 120, missLatency: 500, hitLatencies: [400, 110, 120, 130] }, { abortMs: null });
  one('a slow cold call and a slow first warm call do not set the schedule: the median of three HITs does, and every abort is cut', [slowStart.art.verdict, slowStart.art.latency_samples_ms.length, slowStart.art.latency_ms < 200, slowStart.art.aborted_effective, slowStart.art.warm_ms >= 400], ['abort-loses-nothing', 3, true, 5, true]);
  const jit = await against('healthy', { hitLatencies: [120, 100, 140, 90, 130, 110, 125, 95, 135, 105, 120, 100, 140, 90, 130] }, { abortMs: null });
  one('a relay whose latency jitters by 20% is still cut by every abort of the calibrated schedule', [jit.art.verdict, jit.art.aborted_effective], ['abort-loses-nothing', 5]);
  const lossyCal = await against('lossy-both', { latency: 120 }, { abortMs: null });
  one('a lossy relay under the calibrated schedule is conclusive', [lossyCal.art.verdict, lossyCal.art.aborted_effective], ['abort-loses-refund-and-tally', 5]);
  const l = await against('lossy-both');
  one('lossy relay (continuation cancelled): abort-loses-refund-and-tally with the over-record stated', [l.art.verdict, l.art.ledger_overrecord_left_credits], ['abort-loses-refund-and-tally', 18]);
  const t = await against('lossy-refund');
  one('lossy relay (refund lost, tally kept): abort-loses-refund-keeps-tally', t.art.verdict, 'abort-loses-refund-keeps-tally');
  const cold = await against('healthy', { warm: false });
  one('the warm-up is a MISS, the confirmation is a HIT, and the aborted calls come after', [cold.art.calls[0].cached, cold.art.calls[1].cached, cold.art.calls.filter((c) => c.step === 'aborted').length], ['MISS', 'HIT', 3]);
  const noisy = await against('healthy', { noise: true });
  one('a ledger that moves on its own before the start is inconclusive', noisy.art.verdict, 'inconclusive:ledger-not-quiet');
  {
    const { st, srv } = fakeRelay('healthy'); st.warm = false;
    // a relay whose cache never warms: every call is a MISS
    srv.removeAllListeners('request');
    srv.on('request', (req, res) => { st.requests.push(req.url); res.setHeader('content-type', 'application/json'); if (req.url.startsWith('/budget/odds')) return res.end(JSON.stringify({ daily: { date: 'd', by_site: { [SITE]: 6 }, reconcile: [] } })); res.end(JSON.stringify({ ok: true, cached: 'MISS', reconciled: { state: 'reconciled' } })); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const art = await run((u, o) => fetch(u.replace(RELAY, base), o), fastOpts);
    srv.close();
    one('a cache that never warms stops after the confirmation: inconclusive, and exactly 2 cold calls, no aborted call', [art.verdict, st.requests.filter((u) => u === '/cfl/odds-probs').length], ['inconclusive:cache-not-warm', 2]);
  }
  {
    // a relay whose warm-up fails: stop after ONE cold call, no confirmation, no aborted call
    const reqs = [];
    const srv2 = http.createServer((req, res) => { reqs.push(req.url); res.setHeader('content-type', 'application/json'); if (req.url.startsWith('/budget/odds')) return res.end(JSON.stringify({ daily: { date: 'd', by_site: { [SITE]: 6 }, reconcile: [] } })); res.statusCode = 500; res.end('{"ok":false}'); });
    await new Promise((r) => srv2.listen(0, '127.0.0.1', r));
    const base2 = `http://127.0.0.1:${srv2.address().port}`;
    const art2 = await run((u, o) => fetch(u.replace(RELAY, base2), o), fastOpts);
    srv2.close();
    one('a failing warm-up stops the run: inconclusive, exactly 1 cold call', [art2.verdict, reqs.filter((u) => u === '/cfl/odds-probs').length], ['inconclusive:warm-up-failed', 1]);
  }
  // As a process: no approval -> exit 2 and not one request.
  const hits = [];
  const srv = http.createServer((req, res) => { hits.push(req.url); res.end('{}'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const tmp = mkdtempSync(path.join(tmpdir(), 'cfl-abort-'));
  const runIt = (env) => new Promise((resolve) => { const ch = spawn(process.execPath, [fileURLToPath(import.meta.url)], { cwd: tmp, env: { ...process.env, RELAY_BASE: `http://127.0.0.1:${srv.address().port}`, ...env } }); let o = ''; ch.stdout.on('data', (d) => { o += d; }); ch.stderr.on('data', (d) => { o += d; }); ch.on('close', (code) => resolve({ status: code, out: o })); });
  try {
    const none = await runIt({ APPROVAL: '' });
    one('no approval text: exit 2 and not one request', [none.status, hits.length], [2, 0]);
    const wrong = await runIt({ APPROVAL: 'approved' });
    one('a different approval text: exit 2 and not one request', [wrong.status, hits.length], [2, 0]);
  } finally { srv.close(); rmSync(tmp, { recursive: true, force: true }); }
  console.log(bad ? `\n${bad} FAILED` : `\nself-test: ${total}/${total}`);
  console.log('COVERAGE: the experiment logic against a FAKE relay that can lose a continuation. It says nothing about the real relay; that is what the run is for.');
  process.exit(bad ? 1 : 0);
}

// ---- main (runner) ----
if (process.env.APPROVAL !== APPROVAL_TEXT) {
  console.error(`cfl-abort-experiment: refused. This sends GET /cfl/odds-probs, which charges Odds API credits on a cache miss. Set APPROVAL to exactly:\n  ${APPROVAL_TEXT}`);
  process.exit(2);
}
const art = await run(fetch);
mkdirSync('outbox', { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const file = `outbox/cfl-abort-experiment-${stamp}.json`;
writeFileSync(file, JSON.stringify(art, null, 1) + '\n');
console.log(`verdict: ${art.verdict}\n${art.why || ''}\naborted calls ${art.aborted_calls ?? 0}, took effect ${art.aborted_effective ?? 0}, over-record left in the ledger ${art.ledger_overrecord_left_credits ?? 0} credits\nwrote ${file}`);
process.exit(art.verdict.startsWith('inconclusive') ? 1 : 0);
