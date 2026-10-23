// THE GUARD'S VETO MUST BE VISIBLE FROM OUTSIDE THE WORKER.
//
// `used === ceiling` says the budget is exhausted. It does NOT say a fetch was
// ever refused, and those are different facts: a day that lands exactly on the
// cap at 23:58 turned nothing away, while 2026-09-19 sat at 3800 from before
// 19:39 until at least 22:32 and refused everything for hours
// (outbox/odds-site-drift-series.json, 29 samples).
//
// The charge (chargeOdds; checkAndIncrementDailyOdds until 2026-10-18) writes
// `odds:daily:<date>:warned` ONLY when the DAY vetoes. That key was a boolean
// nothing outside the worker could read. It now carries the moment of the first
// veto, and /budget/odds reports it.
//
// This checks the SOURCE for the shape — the writer stores a timestamp, the
// reader distinguishes the three states, the field is on the response — and
// then RUNS chargeOdds and peekDailyOdds for the lifetime, which no source
// read can settle (below, "THE STAMP OUTLIVES ITS READERS").
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SRC = process.env.BUDGET_HELPERS_SRC || 'src/budget-helpers.js';
const whole = readFileSync(SRC, 'utf8');

// SCOPED TO THE DAILY GUARD'S BODY, and that is not tidiness.
//
// On 2026-09-23 chargeMonthlyOdds was added to this same file with its own
// once-per-period `warnedKey` block — same get/if(!already)/put shape, same
// ISO timestamp. Every regex below then matched the MONTHLY block, so mutating
// the DAILY one back to a boolean left the check green. C1 and C2 went from
// CAUGHT to NOT CAUGHT in one commit, and the check reported 7/7 while proving
// nothing about the code it names.
//
// The reader must be aimed at the function it is about. Slicing the body is the
// same technique declaredTables uses in check-odds-budget-schema.mjs.
//
// AND SINCE 2026-10-18, AT THE DAY'S VETO BLOCK, NOT THE FUNCTION. The day and
// the month are one batch in chargeOdds, so the month's hard-limit block — the
// same get / if (!already) / put(warnedKey, ISO timestamp) shape — lives in the
// same function. A function-wide slice would let that block satisfy C1 and C2
// again, which is the 2026-09-23 defect in a new place. The slice is the day's
// veto block: from its warned key to its `return false;`.
const _i = whole.indexOf('async function chargeOdds');
const _j = whole.indexOf('\n}\n', _i);
if (_i < 0 || _j < 0) {
  console.log('FAIL  chargeOdds was not found in the source — nothing below ran.');
  process.exit(1);
}
const fn = whole.slice(_i, _j);
const _bi = fn.indexOf('const warnedKey = `${key}:warned`;');
const _bj = fn.indexOf('return false;', _bi);
if (_bi < 0 || _bj < 0) {
  console.log('FAIL  the day veto block (const warnedKey = `${key}:warned`; ... return false;) was not found — nothing below ran.');
  process.exit(1);
}
const src = fn.slice(_bi, _bj);
// The reader half lives in peekDailyOdds, not in the guard, so it gets its own
// slice rather than being checked against the whole file.
const _pi = whole.indexOf('async function peekDailyOdds');
const _pj = whole.indexOf('\n}\n', _pi);
const reader = (_pi < 0 || _pj < 0) ? '' : whole.slice(_pi, _pj);

let bad = 0, n = 0;
const ok = (label, cond, why) => { n++;
  if (cond) console.log(`ok    ${label}`);
  else { bad++; console.log(`FAIL  ${label}\n        ${why}`); } };

ok('the veto writes a timestamp, not a boolean',
  /put\(warnedKey, new Date\(\)\.toISOString\(\)/.test(src),
  "the key still stores '1', so the hour a day started refusing requests is unrecoverable");

ok('it is still written only once per day',
  /const already = await env\.FIELD_JOURNALISM\.get\(warnedKey\);\s*\n\s*if \(!already\) \{/.test(src),
  'writing it on every veto would put a KV round trip on a hot path for hours');

ok('the reader reads the veto key, not the counter',
  /get\(`odds:daily:\$\{date\}:warned`\)/.test(reader),
  'inferring a veto from used === ceiling cannot tell an exhausted budget from one that turned requests away');

// THREE STATES. A timestamp, `true` (reached, hour unknown — a key written
// before this field existed), and null. Collapsing the middle one into either
// neighbour is the absence collapse: it would either lose a real veto or
// invent an hour for it.
ok('a timestamp is kept as the timestamp',
  /ceilingHit = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}T\/\.test\(raw\) \? raw : true/.test(reader),
  'the three states are not separated, so a legacy key and a dated one read alike');

ok('an absent key is null, never false',
  /let ceilingHit = null;/.test(reader) && !/ceilingHit = false/.test(reader),
  'false reads as "checked, no veto"; null is the only honest value for a read that found nothing');

ok('a failed read does not invent a veto',
  /catch \(_\) \{ ceilingHit = null; \}/.test(reader),
  'an unreadable KV must not report a ceiling that was never hit');

// THE SCOPE ITSELF IS ASSERTED. Without this, a future edit that widens either
// slice back to the whole file would silently restore the defect above — the
// check would pass by finding a DIFFERENT function's warn block.
ok('the guard slice does not contain the monthly guard',
  !/odds-month-guard/.test(src) && !/odds-credits/.test(src.replace(/odds:credits/g, 'odds-credits')),
  "the slice has widened past the day's veto block, so these regexes can be satisfied by the month veto block instead");

ok('the reader slice is peekDailyOdds, not the whole file',
  reader.length > 0 && reader.length < whole.length / 2 && !/odds-month-guard/.test(reader),
  'a reader assertion satisfied from outside peekDailyOdds proves nothing about what /budget/odds returns');

ok('the field is on the /budget/odds response',
  /ceiling_reached_at: ceilingHit,/.test(reader),
  'a value only the worker knows is not an artifact (Rule 90)');

// ── THE STAMP OUTLIVES ITS READERS, EXECUTED ────────────────────────────────
// Until 2026-10-23 the day stamp was written with expirationTtl 86400. The
// pairing watch reads the CLOSED day the next afternoon, so a ceiling reached
// in the morning had no stamp by the time anyone looked: the watch read "no
// refusal" for ceiling days (docs/CC-CMD-2026-10-23-odds-ceiling-
// prerequisites.md, fix 3). And the monthly limit was judged from the route's
// monthly block, which is the CURRENT month, so a veto on the 31st vanished on
// the 1st. This runs the real chargeOdds to stamp a veto at an instant and the
// real peekDailyOdds to read it later, on node:sqlite and a KV that expires
// keys as Cloudflare does (expirationTtl is seconds from the write).
const RealDate = Date;
let clock = 0;
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(clock); }
  static now() { return clock; }
}
function ttlKV() {
  const m = new Map();
  return {
    get: async (k) => { const e = m.get(k); return e && clock < e.exp ? e.v : null; },
    put: async (k, v, o = {}) => { m.set(k, { v: String(v), exp: o.expirationTtl ? clock + o.expirationTtl * 1000 : Infinity }); },
  };
}
function sqliteD1(db) {
  const stmt = (sql, args = []) => ({ sql, args, bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => { db.prepare(sql).run(...args); return { success: true }; } });
  return { prepare: (sql) => stmt(sql), batch: async (list) => {
    db.exec('BEGIN');
    try { const out = list.map((x) => ({ results: db.prepare(x.sql).all(...x.args), success: true })); db.exec('COMMIT'); return out; }
    catch (e) { db.exec('ROLLBACK'); throw e; } } };
}
let caseNo = 0;
// One veto at `at`, read back for `day` at `readAt`. `kind` 'day' fills the
// day; 'month' fills the month and leaves the day room.
async function replay({ kind, at, readAt, day }) {
  const mod = await import(`${pathToFileURL(resolve(SRC)).href}?case=${++caseNo}`);
  const db = new DatabaseSync(':memory:');
  const env = { FIELD_JOURNALISM: ttlKV(), ARCHIVE_DB: sqliteD1(db) };
  const warn = console.warn; console.warn = () => {};
  globalThis.Date = PinnedDate;
  try {
    clock = RealDate.parse(at);
    db.exec(`CREATE TABLE odds_budget (day TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE odds_budget_site (day TEXT NOT NULL, site TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site));
      CREATE TABLE odds_budget_month (month TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE odds_reconcile_state (day TEXT NOT NULL, site TEXT NOT NULL, state TEXT NOT NULL, cache TEXT NOT NULL,
        n INTEGER NOT NULL DEFAULT 0, credits_kept INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site, state, cache));`);
    if (kind === 'day') db.prepare('INSERT INTO odds_budget VALUES (?, ?)').run(at.slice(0, 10), 1e9);
    else db.prepare('INSERT INTO odds_budget_month VALUES (?, ?)').run(at.slice(0, 7), mod.ODDS_HARD_LIMIT);
    const refused = (await mod.chargeOdds(env, 3, 'probe')) === false;
    clock = RealDate.parse(readAt);
    const got = await mod.peekDailyOdds(env, day);
    return { refused, ceiling: got?.ceiling_reached_at, month: got?.month_limit_reached_at, hasMonth: !!got && 'month_limit_reached_at' in got };
  } finally { globalThis.Date = RealDate; console.warn = warn; }
}
// The four recorded ceiling days, each read at the minute the scheduled pairing
// watch actually read it (run start, from the Actions API). The stamp is put at
// the first instant of the day, the earliest a stamp can be: the true veto
// times are gone with the keys.
const READS = [['2026-10-07', '2026-10-08T17:40:55Z'], ['2026-10-10', '2026-10-11T16:29:13Z'],
               ['2026-10-11', '2026-10-12T20:04:56Z'], ['2026-10-12', '2026-10-13T17:53:43Z'],
               // the last instant /budget/odds?date= serves a day (SITE_TTL_DAYS 2)
               ['2026-10-21', '2026-10-23T23:59:59.999Z']];
for (const [day, readAt] of READS) {
  const at = `${day}T00:00:00.001Z`;
  const r = await replay({ kind: 'day', at, readAt, day });
  ok(`a ceiling reached at ${at} is still reported when read at ${readAt}`,
    r.refused && r.ceiling === at,
    `refused ${r.refused}, ceiling_reached_at ${JSON.stringify(r.ceiling)}: the stamp expired before its reader, so a day that refused calls reads as one that did not`);
}
{
  const at = '2026-10-31T22:00:00.000Z';
  const r = await replay({ kind: 'month', at, readAt: '2026-11-01T15:36:00Z', day: '2026-10-31' });
  ok('a month veto on the 31st is reported for that day when read on the 1st',
    r.refused && r.month === at && r.ceiling === null,
    `refused ${r.refused}, month_limit_reached_at ${JSON.stringify(r.month)}, ceiling_reached_at ${JSON.stringify(r.ceiling)}`);
  const nov = await replay({ kind: 'month', at, readAt: '2026-11-01T15:36:00Z', day: '2026-11-01' });
  ok("...and is not reported for the next month's days",
    nov.hasMonth && nov.month === null,
    `month_limit_reached_at ${JSON.stringify(nov.month)} for 2026-11-01: the reader is not keyed by the day's month`);
}

console.log(`\n${n - bad} of ${n} passed.`);
console.log(`COVERAGE: source text in ${SRC} for the stamp's shape, and an executed`);
console.log(`replay of chargeOdds and peekDailyOdds for its lifetime: ${READS.length} day stamps read at`);
console.log('real watch read times or the last served instant, and one month veto read');
console.log('across a month boundary. It cannot say whether a veto has actually occurred;');
console.log('that is what the live /budget/odds reading is for.');
process.exit(bad ? 1 : 0);
