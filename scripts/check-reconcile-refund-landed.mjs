#!/usr/bin/env node
// A REFUND THAT LANDED IS NOT `error` BECAUSE THE KV MIRROR BEHIND IT THREW. EXECUTED against real SQLite.
//
// docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md, item 3.
//
// odds_reconcile_state.credits_kept is "the estimate that was NOT handed back, so it is directly comparable to
// odds_budget_site.used" (the comment above the table's DDL in src/budget-helpers.js). The comparison this file executes, per site,
// after one charge and one reconcile, is exactly that:
//
//     credits_kept (the tally)  ==  used (the ledger the guard reads)
//
// THE DEFECT (found by reading the source, then reproduced by running it, at 67b3f19, 2026-11-07): the D1 correction batch commits,
// then the KV mirror (the day and month counters, which nothing reads) throws. The throw reaches the outer catch, which sets state
// `error`, and creditsKeptBy('error') is the FULL estimate. The refund is in `used`; the tally keeps the estimate anyway. Live,
// 2026-11-07: handleCFLOddsProbs `error`/HIT rows, kept 6 each, 20 by 17:03Z, credits_kept 648 against used 528.
//
// WHAT IS CLAIMED. Where the D1 correction batch RESOLVED and the KV mirror then threw (A1 to A6, A10), the state is what the receipt
// says (`cache-hit` / `reconciled`), credits_kept equals the site, day and month ledgers, and the tally row accumulates (A7, A8).
// NOT CLAIMED: "every branch". These are PINNED as they are, so a later change to any of them is a decision and not an accident:
//   B   the correction was rejected before it committed AND the mirror threw: `error`, estimate kept, equal to the ledger (HEAD too).
//   C   the correction was rejected before it committed and the mirror is fine: the state stays `cache-hit`/`reconciled`, so credits_kept
//       reads the receipt while `used` still holds the estimate. A KNOWN GAP, the mirror image of item 3 and not part of its words
//       ("keep reporting the second as `error`" is about what is reported today). Unchanged from HEAD.
//   G2  the batch commits and THEN rejects, and the mirror throws: `error`, estimate kept, ledger corrected. A rejected batch is not read as
//       "nothing committed" (D1 can reject a write whose commit it could not confirm), so `landed` stays false: what HEAD did.
//   G1  the same ambiguous rejection with a working mirror: kept === used (HEAD's behaviour, and why a thrown batch is NOT flipped to `error`).
//   H   KNOWN, MOVED BY THE FIX (found by review): charge on day D, reconcile on D+1 (the 00:00Z straddle), batch resolves, mirror throws.
//       The correction lands on D+1's rows and leaves D's `used` at the estimate. HEAD recorded `error` (kept = used, by coincidence); the fix
//       records `cache-hit` (kept 0, used 6). The LEDGER is identical at HEAD and patched; only the tally's relation to it differs. Accepted:
//       the ledger is wrong in both, the window is seconds, and it needs a mirror failure as well. Pinned.
//   K   KNOWN, UNCHANGED (found by review): a charge that degraded open (nothing was charged) followed by a reconcile whose correction
//       works refunds a charge that was never added, so the DAY ledger drops by the estimate. Identical at HEAD. Not item 3.
//   E   no D1 store at all: the KV mirror IS the ledger, and its failure is `error` (what check-odds-reconciled.mjs pins).
// `landed` means the batch RESOLVED, not that the correction reached the day that was charged (H, K).
//
// Each case imports a fresh copy of the module (its table flag is per-isolate state), EXCEPT A6, which drives two reconciles through ONE
// instance because per-case fresh imports are what would hide state shared across calls in a real isolate.
//
// BUDGET_HELPERS_SRC points the run at another copy of src/budget-helpers.js (the mutation harness does that).
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HELPERS = process.env.BUDGET_HELPERS_SRC || 'src/budget-helpers.js';
let bad = 0, n = 0;
const ok = (label, cond, why = '') => { n++;
  if (cond) console.log(`ok    ${label}`);
  else { bad++; console.log(`FAIL  ${label}${why ? `\n        ${why}` : ''}`); } };

let caseNo = 0;
const load = () => import(`${pathToFileURL(resolve(HELPERS)).href}?case=${++caseNo}`);

/** node:sqlite behind the subset of the D1 surface budget-helpers uses. The knobs are read at CALL time, so one world can misbehave
 *  differently on its first and second reconcile. correction = 'before': the batch carrying the correction's fixDay statement rejects before
 *  anything in it runs (an overload); 'after': it runs, COMMITS, and then rejects (the response was lost). failTally: the tally upsert rejects. */
function fakeD1(db, mod, knobs) {
  const stmt = (sql, args = []) => ({
    sql, args, bind: (...a) => stmt(sql, a),
    run: async () => {
      if (knobs.failTally && sql === mod.ODDS_BUDGET_SQL.reconcileTally) throw new Error('D1 tally write refused');
      const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } };
    },
    all: async () => ({ results: db.prepare(sql).all(...args), success: true }),
    first: async () => db.prepare(sql).get(...args) ?? null,
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => {
      const isCorrection = knobs.correction && stmts.some((s) => s.sql === mod.ODDS_BUDGET_SQL.fixDay);
      if (isCorrection && knobs.correction === 'before') throw new Error('D1 overloaded');
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => ({ results: db.prepare(s.sql).all(...s.args), success: true }));
        db.exec('COMMIT');
        if (isCorrection && knobs.correction === 'after') throw new Error('D1_ERROR: Network connection lost');
        return out;
      } catch (e) { try { db.exec('ROLLBACK'); } catch { /* already committed */ } throw e; }
    },
  };
}

/** KV whose mirror misbehaves per knobs.mirror: 'get' / 'put' fail reads / writes of the day and month COUNTERS; 'all' fails EVERY key, as an
 *  outage does (so _bumpSite's own swallow is exercised too). Other keys work. */
function fakeKV(knobs) {
  const m = new Map();
  const counter = (k) => /^odds:(daily|credits):/.test(k);
  return {
    get: async (k) => {
      if ((knobs.mirror === 'get' && counter(k)) || knobs.mirror === 'all') throw new Error('KV GET failed: 429 Too Many Requests');
      return m.has(k) ? m.get(k) : null;
    },
    put: async (k, v) => {
      if ((knobs.mirror === 'put' && counter(k)) || knobs.mirror === 'all') throw new Error('KV PUT failed: 429 Too Many Requests');
      m.set(k, String(v));
    },
  };
}

const SITE = 'handleCFLOddsProbs';
const EST = 6;
const NOTE = 'KV mirror failed after the D1 correction landed';
const resp = (h) => ({ headers: { get: (k) => h[k] ?? null } });
const hdr = ({ hit, receipt }) => (hit ? { 'cf-cache-status': 'HIT', 'x-requests-last': '6' } : { 'x-requests-last': String(receipt) });

async function world({ withD1 = true } = {}) {
  const mod = await load();
  const db = new DatabaseSync(':memory:');
  const knobs = { mirror: null, correction: null, failTally: false };
  const env = { FIELD_JOURNALISM: fakeKV(knobs) };
  if (withD1) env.ARCHIVE_DB = fakeD1(db, mod, knobs);
  return { mod, db, env, knobs };
}
const val = (w, q, ...a) => { try { return w.db.prepare(q).get(...a)?.v ?? null; } catch { return null; } };
const ledger = (w) => ({
  used: val(w, 'SELECT SUM(used) v FROM odds_budget_site WHERE site = ?', SITE),
  day: val(w, 'SELECT SUM(used) v FROM odds_budget'),
  month: val(w, 'SELECT SUM(used) v FROM odds_budget_month'),
  kept: val(w, 'SELECT SUM(credits_kept) v FROM odds_reconcile_state WHERE site = ?', SITE),
  calls: val(w, 'SELECT SUM(n) v FROM odds_reconcile_state WHERE site = ?', SITE),
  stateRow: val(w, 'SELECT MIN(state) v FROM odds_reconcile_state WHERE site = ?', SITE),
  cacheRow: val(w, 'SELECT MIN(cache) v FROM odds_reconcile_state WHERE site = ?', SITE),
  dayRow: val(w, 'SELECT MIN(day) v FROM odds_reconcile_state WHERE site = ?', SITE),
  rows: val(w, 'SELECT COUNT(*) v FROM odds_reconcile_state WHERE site = ?', SITE),
});
async function reconcile(w, h) {
  const warn = console.warn; console.warn = () => {};
  try { return await w.mod.reconcileOddsCredit(w.env, EST, resp(hdr(h)), SITE); } finally { console.warn = warn; }
}

/** One charge of EST at SITE, one reconcile, then read what the invariant is about. `before` is `used` after the charge and BEFORE the reconcile,
 *  so a charge that degraded open (and charged nothing) cannot pass as a precondition. */
async function run({ receipt, hit = false, mirror = null, correction = null, failTally = false, withD1 = true }) {
  const w = await world({ withD1 });
  const charged = await w.mod.chargeOdds(w.env, EST, SITE);
  const before = val(w, 'SELECT SUM(used) v FROM odds_budget_site WHERE site = ?', SITE);
  Object.assign(w.knobs, { mirror, correction, failTally });
  const out = await reconcile(w, { hit, receipt });
  return { charged, before, out, ...ledger(w) };
}
const show = (c) => `state ${c.out.state}, tally state ${c.stateRow}, kept ${c.kept}, used ${c.used}, day ${c.day}, month ${c.month}, before ${c.before}`;
const pre = (id, c) => ok(`${id} precondition: the ledger holds the estimate (${EST}) before reconcile`, c.charged === true && c.before === EST, show(c));
const same = (id, c) => ok(`${id} ...the persisted tally row carries the state the call returned`, c.stateRow === c.out.state && c.rows === 1, show(c));
const allLedgers = (id, c, want) => ok(`${id} ...the site, day and month ledgers all hold ${want}, and the tally keeps ${want}`,
  c.used === want && c.day === want && c.month === want && c.kept === want, show(c));

// ── A1. THE LIVE CASE. A cache hit (CFL's HIT rows), refund lands, the mirror's read throws. ─────────────────────────────
{
  const c = await run({ hit: true, mirror: 'get' });
  pre('A1', c);
  ok('A1 HIT, refund landed, mirror throws: the state is `cache-hit`, not `error`', c.out.state === 'cache-hit', show(c));
  allLedgers('A1', c, 0);
  same('A1', c);
  ok('A1 ...the failed mirror stays visible in `note`, as a fixed string with no KV error text', c.out.note === NOTE, `note ${JSON.stringify(c.out.note)}`);
  ok('A1 ...the persisted cell is today, cache HIT, one call', c.cacheRow === 'HIT' && c.calls === 1 && c.dayRow === new Date().toISOString().slice(0, 10), `cache ${c.cacheRow}, calls ${c.calls}, day ${c.dayRow}`);
}
// ── A2. A receipt smaller than the estimate. ────────────────────────────────────────────────────────────────────────────
{
  const c = await run({ receipt: 2, mirror: 'get' });
  pre('A2', c);
  ok('A2 receipt 2 against estimate 6, refund landed, mirror throws: the state is `reconciled`', c.out.state === 'reconciled', show(c));
  allLedgers('A2', c, 2);
  same('A2', c);
  ok('A2 ...with the same note', c.out.note === NOTE, `note ${JSON.stringify(c.out.note)}`);
}
// ── A3. A receipt LARGER than the estimate: the defect existed in this direction too (kept UNDERSTATES). ─────────────────
{
  const c = await run({ receipt: 10, mirror: 'get' });
  pre('A3', c);
  ok('A3 receipt 10 against estimate 6, correction landed, mirror throws: `reconciled`, with the note', c.out.state === 'reconciled' && c.out.note === NOTE, show(c));
  allLedgers('A3', c, 10);
}
// ── A4. The mirror's WRITE throws, not its read (the cause of the live throw is unread: it could be either). ─────────────
{
  const c = await run({ hit: true, mirror: 'put' });
  pre('A4', c);
  ok('A4 HIT, refund landed, the mirror WRITE throws: `cache-hit`, with the note (the fault fired)', c.out.state === 'cache-hit' && c.out.note === NOTE, show(c));
  allLedgers('A4', c, 0);
  same('A4', c);
}
// ── A5. A KV OUTAGE: every key throws, so _bumpSite's own swallow is exercised as well as the mirror. ──────────────────
{
  const c = await run({ hit: true, mirror: 'all' });
  pre('A5', c);
  ok('A5 every KV key throws after a landed refund: `cache-hit`, with the note, and reconcile did not throw', c.out.state === 'cache-hit' && c.out.note === NOTE, show(c));
  allLedgers('A5', c, 0);
}
// ── A6. TWO reconciles through ONE module instance: state kept across calls would show here and nowhere else. ───────────
{
  const w = await world();
  await w.mod.chargeOdds(w.env, EST, SITE); await w.mod.chargeOdds(w.env, EST, SITE);
  w.knobs.mirror = 'get';
  const first = await reconcile(w, { hit: true });                  // the batch resolves, the mirror throws: landed
  w.knobs.correction = 'before';
  const second = await reconcile(w, { hit: true });                 // the batch is rejected, the mirror throws: NOT landed
  ok('A6 one instance, call 1 (batch resolved, mirror threw): `cache-hit`', first.state === 'cache-hit', `state ${first.state}`);
  ok('A6 ...call 2 (batch rejected, mirror threw): `error`, with nothing carried over from call 1', second.state === 'error' && /KV GET failed/.test(String(second.note)), `state ${second.state}, note ${JSON.stringify(second.note)}`);
}
// ── A7/A8. The tally ACCUMULATES (the live shape: 20 rows of one cell), and the persisted cell is the one the experiment reads. ──
{
  const w = await world();
  w.knobs.mirror = 'get';
  for (let i = 0; i < 3; i++) { await w.mod.chargeOdds(w.env, EST, SITE); await reconcile(w, { receipt: 2 }); }
  const l = ledger(w);
  ok('A7 three charge-and-reconcile pairs, receipt 2, the mirror throwing each time: one cell, three calls, kept 6, used 6',
    l.rows === 1 && l.calls === 3 && l.kept === 6 && l.used === 6 && l.stateRow === 'reconciled', `rows ${l.rows}, calls ${l.calls}, kept ${l.kept}, used ${l.used}, state ${l.stateRow}`);
}
// ── A10. A FAILED TALLY WRITE must not fail the fetch: reconcile returns, it does not throw. ─────────────────────────────
{
  const w = await world();
  await w.mod.chargeOdds(w.env, EST, SITE);
  Object.assign(w.knobs, { mirror: 'get', failTally: true });
  let out = null, threw = null;
  try { out = await reconcile(w, { hit: true }); } catch (e) { threw = e; }
  ok('A10 the tally write rejects after a landed refund and a failed mirror: reconcile RETURNS `cache-hit`, it does not throw', threw === null && out && out.state === 'cache-hit', `threw ${threw && threw.message}, state ${out && out.state}`);
}
// ── B. CONTROL (unchanged). The correction was rejected before it committed AND the mirror threw. ──────────────────────────
{
  const c = await run({ hit: true, mirror: 'get', correction: 'before' });
  pre('B ', c);
  ok('B  correction rejected before commit AND mirror throws: the ledger still holds the estimate', c.used === EST, show(c));
  ok('B  ...the state is `error`, and the tally keeps the estimate, equal to the ledger', c.out.state === 'error' && c.kept === c.used, show(c));
  same('B ', c);
  ok('B  ...with the mirror\'s own error as the note (the outer catch, as before)', /KV GET failed/.test(String(c.out.note)), `note ${JSON.stringify(c.out.note)}`);
}
// ── C. KNOWN GAP, UNCHANGED. The correction was rejected before it committed and the mirror is fine. ────────────────────
{
  const c = await run({ hit: true, correction: 'before' });
  pre('C ', c);
  ok('C  KNOWN GAP (the mirror image of item 3, not fixed here): the state stays `cache-hit` while `used` still holds the estimate',
    c.out.state === 'cache-hit' && c.used === EST, show(c));
}
// ── G1/G2. The batch COMMITS and then rejects (a lost response): not read as "nothing committed". ──────────────────────────
{
  const g1 = await run({ hit: true, correction: 'after' });
  pre('G1', g1);
  ok('G1 batch commits then rejects, mirror ok: the ledger holds 0 and the tally keeps 0 (a thrown batch is NOT flipped to `error`)',
    g1.used === 0 && g1.out.state === 'cache-hit' && g1.kept === g1.used, show(g1));
  const g2 = await run({ hit: true, mirror: 'get', correction: 'after' });
  ok('G2 KNOWN, UNCHANGED: batch commits then rejects AND the mirror throws: `error`, the estimate kept, the ledger corrected',
    g2.out.state === 'error' && g2.used === 0 && g2.kept === EST, show(g2));
}
// ── H. KNOWN, MOVED BY THE FIX. The 00:00Z straddle: charge on day D, reconcile on D+1, batch resolves, mirror throws. ─────
{
  const RealDate = Date; let now = null;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0 && now !== null) super(now); else super(...a); }
    static now() { return now !== null ? now : RealDate.now(); }
  }
  globalThis.Date = FakeDate;
  try {
    now = RealDate.parse('2026-11-08T23:59:30Z');
    const w = await world();
    await w.mod.chargeOdds(w.env, EST, SITE);
    now = RealDate.parse('2026-11-09T00:00:30Z');
    w.knobs.mirror = 'get';
    const out = await reconcile(w, { hit: true });
    const l = ledger(w);
    ok('H  KNOWN, moved by the fix: across 00:00Z the correction lands on D+1 and D keeps the estimate, so `cache-hit` with kept 0 against used 6 (HEAD: `error`, kept 6)',
      out.state === 'cache-hit' && l.used === EST && l.kept === 0, `state ${out.state}, kept ${l.kept}, used ${l.used}`);
  } finally { globalThis.Date = RealDate; }
}
// ── K. KNOWN, UNCHANGED. A charge that degraded open, then a reconcile whose correction works. ────────────────────────────
{
  const w = await world();
  await w.mod.chargeOdds(w.env, 100, 'other');                                         // a real charge elsewhere: the day holds 100
  const warn = console.warn; console.warn = () => {};
  try { await w.mod.chargeOdds({ FIELD_JOURNALISM: w.env.FIELD_JOURNALISM }, EST, SITE); } finally { console.warn = warn; }   // no D1: degrades open, charges NOTHING
  const out = await reconcile(w, { hit: true });
  ok('K  KNOWN, UNCHANGED (identical at HEAD): the degraded-open charge never landed, yet its refund takes the DAY ledger from 100 to 94', val(w, 'SELECT SUM(used) v FROM odds_budget') === 94 && out.state === 'cache-hit',
    `day ${val(w, 'SELECT SUM(used) v FROM odds_budget')}, state ${out.state}`);
}
// ── D. CONTROL. Everything works. ───────────────────────────────────────────────────────────────────────────────────────
{
  const c = await run({ hit: true });
  ok('D  all well, HIT: `cache-hit`, the ledger holds 0 and the tally keeps 0, no note', c.out.state === 'cache-hit' && c.used === 0 && c.kept === 0 && c.out.note === undefined, show(c));
  const r = await run({ receipt: 2 });
  ok('D  all well, receipt 2: `reconciled`, ledger 2, tally 2', r.out.state === 'reconciled' && r.used === 2 && r.kept === 2, show(r));
  const z = await run({ receipt: EST });
  ok('D  a receipt equal to the estimate: no correction, `reconciled`, ledger 6, tally 6', z.out.state === 'reconciled' && z.used === EST && z.kept === EST, show(z));
}
// ── E. CONTROL. No D1 store at all (the legacy KV-only mode check-odds-reconciled.mjs exercises). ──────────────────────
{
  const c = await run({ hit: true, mirror: 'get', withD1: false });
  ok('E  no D1 and the KV mirror throws: `error`, nothing landed (what check-odds-reconciled.mjs pins)', c.out.state === 'error', show(c));
  const d = await run({ hit: true, withD1: false });
  ok('E  no D1 and the KV mirror works: `cache-hit`', d.out.state === 'cache-hit', show(d));
}

console.log(`\n${n - bad} of ${n} passed.`);
console.log(bad === 0 ? 'PASS — a landed refund is never `error`, and the cases the fix leaves alone are pinned' : `FAIL — ${bad}`);
process.exit(bad === 0 ? 0 : 1);
