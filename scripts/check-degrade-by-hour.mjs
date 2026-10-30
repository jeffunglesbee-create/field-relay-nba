#!/usr/bin/env node
// The degrade counter carries an hour, so a cause can be attributed
// (docs/CC-CMD-2026-10-12-degrade-reasons-by-hour.md, Task 1).
//
// WHAT IS RUN. The real chargeOdds, imported from src/budget-helpers.js, against a D1 made of node:sqlite whose
// batch THROWS on the charge statement, which is how a D1 overload reaches the degrade catch. A fake KV records
// every get and put. The clock is pinned per call, so the UTC hour is a known input rather than whatever time CI
// happens to run. bumpHour is also run directly at its edges.
//
// WHAT THE CC-CMD GOT STALE (it is dated 2026-10-12; this was re-verified against main on 2026-10-30):
//   - "the pairing watch ... treats its absence as not-reported for that field only". The watch has since gained
//     a block-level verdict that FAILS the run on not-reported/unreadable/unattributed. by_hour is therefore a
//     separate, informational verdict in the watch (scripts/watch-odds-pairing-rate.mjs byHourVerdict) and never
//     the reason a run goes red.
//   - Task 2 names `gh api .../actions/runs`; that CLI is not available in the sessions that read this.
// It still holds that the field rides the write the counter already makes. This asserts it: ONE put per degrade.
//
// COVERAGE (Rule 91): printed at the end with the assertion count. This does NOT read the live counter; `daily.degraded_open.by_hour` on
// /budget/odds for a closed day with events is where the field is actually read.
//
// BUDGET_HELPERS_SRC / WATCH_SRC point the check at copies; scripts/mutate-degrade-by-hour.mjs uses them.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HELPERS = process.env.BUDGET_HELPERS_SRC || 'src/budget-helpers.js';
const WATCH = process.env.WATCH_SRC || 'scripts/watch-odds-pairing-rate.mjs';
const src = readFileSync(HELPERS, 'utf8');

let bad = 0, n = 0;
const eq = (label, got, want) => { n++;
  if (JSON.stringify(got) === JSON.stringify(want)) console.log(`ok    ${label}`);
  else { bad++; console.log(`FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); } };
const ok = (label, cond, why = '') => { n++;
  if (cond) console.log(`ok    ${label}`);
  else { bad++; console.log(`FAIL  ${label}${why ? '\n        ' + why : ''}`); } };

// ── the clock, pinned per call ──────────────────────────────────────────────
const RealDate = Date;
function pinClock(iso) {
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(iso); else super(...a); }
    static now() { return new RealDate(iso).getTime(); }
  };
}
const unpin = () => { globalThis.Date = RealDate; };

// ── a D1 whose charge batch throws, and a KV that records ───────────────────
const D1_OVERLOAD = 'D1_ERROR: D1 DB is overloaded. Requests queued for too long.';
function fakeD1(db, throwOnCharge) {
  const stmt = (sql, args = []) => ({ sql, args, bind: (...a) => stmt(sql, a) });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => {
      if (throwOnCharge && stmts.length >= 9) throw new Error(throwOnCharge);   // the nine-statement charge batch
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => ({ results: db.prepare(s.sql).all(...s.args), success: true }));
        db.exec('COMMIT'); return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
function fakeKV(seed = {}, { failPut = false, failGet = false } = {}) {
  const m = new Map(Object.entries(seed)), puts = [], gets = [];
  return {
    get: async (k) => { gets.push(k); if (failGet && /odds:degraded/.test(k)) throw new Error('KV GET failed'); return m.has(k) ? m.get(k) : null; },
    put: async (k, v) => { if (failPut && /odds:degraded/.test(k)) throw new Error('KV PUT failed: 429'); m.set(k, String(v)); puts.push(k); },
    puts, gets, m,
  };
}
let caseNo = 0;
const load = () => import(`${pathToFileURL(resolve(HELPERS)).href}?case=${++caseNo}`);

const DEG = /^odds:degraded:\d{4}-\d{2}-\d{2}$/;
async function run(mod, kv, db, at, reason = D1_OVERLOAD, units = 1) {
  pinClock(at);
  const warn = console.warn; console.warn = () => {};
  try { return await mod.chargeOdds({ FIELD_JOURNALISM: kv, ARCHIVE_DB: fakeD1(db, reason) }, units, 'probe'); }
  finally { console.warn = warn; unpin(); }
}
const rec = (kv, day) => { const raw = kv.m.get(`odds:degraded:${day}`); return raw ? JSON.parse(raw) : null; };
const sumHours = (r) => Object.values(r.by_hour || {}).reduce((a, h) => a + (h.events || 0), 0);

const mod0 = await load();

// ── bumpHour, run directly ──────────────────────────────────────────────────
{
  const { bumpHour } = mod0;
  ok('bumpHour is exported', typeof bumpHour === 'function', 'the hour map cannot be tested without it');
  if (typeof bumpHour === 'function') {
    eq('bumpHour: the first event files under its hour, counting an overload',
      bumpHour(undefined, '14', `charge: ${D1_OVERLOAD}`), { '14': { events: 1, overload: 1 } });
    eq('bumpHour: a non-overload reason is an event and not an overload',
      bumpHour({}, '09', 'charge: KV boom'), { '09': { events: 1, overload: 0 } });
    const prev = { '14': { events: 1, overload: 1 } };
    const next = bumpHour(prev, '14', `charge: ${D1_OVERLOAD}`);
    eq('bumpHour: a repeat in the same hour accumulates', next['14'], { events: 2, overload: 2 });
    eq('bumpHour: the input is not mutated (a new object is returned)', prev, { '14': { events: 1, overload: 1 } });
    let h = {};
    for (const bad of ['24', '7', 'ab', '', undefined, null, '99', '-1', '1 ']) h = bumpHour(h, bad, 'x');
    eq('bumpHour: a malformed hour is ignored, not filed as a new key', h, {});
    h = {};
    for (let i = 0; i < 24; i++) h = bumpHour(h, String(i).padStart(2, '0'), 'x');
    // Sorted, because enumeration order is NOT hour order: '10'..'23' are integer-like keys and come out before
    // '00'..'09'. Any reader that prints the map must sort it for the same reason.
    const ks = Object.keys(h).sort();
    eq('bumpHour: at most 24 keys, all 24 valid hours accepted', [ks.length, ks[0], ks[23]], [24, '00', '23']);
    eq('bumpHour: enumeration order is not hour order (a reader must sort)', Object.keys(h).slice(0, 2), ['10', '11']);
    eq('bumpHour: a non-object previous value is ignored', bumpHour([1, 2], '05', 'x'), { '05': { events: 1, overload: 0 } });
    eq('bumpHour: the FULL reason is tested, so a mark past the 120-char key cut still counts',
      bumpHour({}, '03', 'z'.repeat(150) + D1_OVERLOAD)['03'].overload, 1);
  }
}

// ── the real write path ─────────────────────────────────────────────────────
{
  const mod = await load();
  const db = new DatabaseSync(':memory:');
  const kv = fakeKV();
  const r1 = await run(mod, kv, db, '2026-10-30T14:05:00.000Z');
  eq('a D1 overload degrades OPEN: chargeOdds returns true', r1, true);
  eq('ONE put per degrade: the field rides the write that already existed', kv.puts, ['odds:degraded:2026-10-30']);
  eq('...and one read of the degrade key', kv.gets.filter((k) => DEG.test(k)).length, 1);
  const a = rec(kv, '2026-10-30');
  eq('the event is filed under its UTC hour, with the overload counted', a && a.by_hour, { '14': { events: 1, overload: 1 } });
  eq('last and the hour come from the same instant', a && a.last, '2026-10-30T14:05:00.000Z');

  await run(mod, kv, db, '2026-10-30T14:59:59.999Z');
  await run(mod, kv, db, '2026-10-30T09:00:00.000Z', 'KV boom: not a database overload');
  const b = rec(kv, '2026-10-30');
  eq('a second event in the same hour accumulates; a different hour adds a key; a non-overload is not an overload',
    b && b.by_hour, { '09': { events: 1, overload: 0 }, '14': { events: 2, overload: 2 } });
  eq('the hour map covers every event when the record began with it', [b.events, sumHours(b)], [3, 3]);
  const reasonOverloads = Object.entries(b.reasons).filter(([k]) => k.includes('D1 DB is overloaded')).reduce((s, [, v]) => s + v, 0);
  eq('overloads by hour agree with overloads by reason', Object.values(b.by_hour || {}).reduce((s, h) => s + h.overload, 0), reasonOverloads);
}

// ── a record that began before this field existed ───────────────────────────
{
  const mod = await load();
  const db = new DatabaseSync(':memory:');
  const old = { events: 5, credits: 30, reasons: { [`charge: ${D1_OVERLOAD}`]: 5 }, last: '2026-10-30T10:00:00.000Z' };
  const kv = fakeKV({ 'odds:degraded:2026-10-30': JSON.stringify(old) });
  await run(mod, kv, db, '2026-10-30T15:30:00.000Z');
  const r = rec(kv, '2026-10-30');
  eq('a record with no by_hour gets one, covering only the new event', r && r.by_hour, { '15': { events: 1, overload: 1 } });
  ok('...and the map does NOT claim to cover the events before it (a reader compares the two)',
    r && sumHours(r) === 1 && r.events === 6, `events ${r && r.events}, covered ${r && sumHours(r)}`);
}

// ── the day boundary, through the real write path ──────────────────────────
{
  const mod = await load();
  const db = new DatabaseSync(':memory:');
  const kv = fakeKV();
  await run(mod, kv, db, '2026-10-30T23:59:59.999Z');
  await run(mod, kv, db, '2026-10-31T00:00:00.000Z');
  eq('23:59:59.999 files under its own day and hour 23; 00:00:00.000 under the next day and hour 00',
    [rec(kv, '2026-10-30') && rec(kv, '2026-10-30').by_hour, rec(kv, '2026-10-31') && rec(kv, '2026-10-31').by_hour],
    [{ '23': { events: 1, overload: 1 } }, { '00': { events: 1, overload: 1 } }]);
}

// ── best effort: the counter must never break the call ─────────────────────
{
  for (const mode of [{ failPut: true }, { failGet: true }]) {
    const mod = await load();
    const db = new DatabaseSync(':memory:');
    const kv = fakeKV({}, mode);
    let r, threw = null;
    try { r = await run(mod, kv, db, '2026-10-30T12:00:00.000Z'); } catch (e) { threw = e.message; }
    eq(`KV ${Object.keys(mode)[0]} failing: the call still degrades open and does not throw`, [threw, r], [null, true]);
  }
}

// ── source assertions: things a pinned clock cannot show ───────────────────
{
  const i = src.indexOf('async function _countDegradeOpen(');
  const j = src.indexOf('\n}\n', i);
  const body = i >= 0 && j > i ? src.slice(i, j) : '';
  ok('_countDegradeOpen takes ONE instant (a second new Date() can split the key and the hour at midnight)',
    body && (body.match(/new Date\(/g) || []).length === 1, `found ${(body.match(/new Date\(/g) || []).length}`);
  ok('...and the day key is derived from that instant, not from a second clock read',
    /_degradeKey\(at\.slice\(0, 10\)\)/.test(body), 'the key would be read from a different instant than the hour');
  ok('by_hour is written into the degrade counter value',
    /by_hour: byHour,/.test(body), 'the map is built and then dropped');
}

// ── the watch and the writer agree on the mark ──────────────────────────────
{
  const w = readFileSync(WATCH, 'utf8');
  const m = /export const D1_OVERLOAD_MARK\s*=\s*'([^']+)'/.exec(w);
  eq('the pairing watch matches overloads on the same string the writer counts', m && m[1], mod0.D1_OVERLOAD_MARK);
}

console.log(`\n${n - bad}/${n} assertions pass`);
console.log(`COVERAGE: ${n} assertions — the real chargeOdds on a node:sqlite D1 whose charge batch throws, a recording KV, a pinned clock;`);
console.log('bumpHour at its edges; three source assertions; the watch/writer mark equality. It does NOT read the live counter.');
process.exit(bad ? 1 : 0);
