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
  /catch \(_\) \{ ceilingHit = null; stampsUnreadable\.push\('ceiling_reached_at'\); \}/.test(reader),
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
// keys as Cloudflare does: expirationTtl is seconds from the write and at least
// 60; expiration is absolute epoch seconds at least 60 ahead. Any other option,
// or a value the runtime refuses, throws, so the replay cannot be satisfied by
// an expiry that Cloudflare would treat differently.
const RealDate = Date;
let clock = 0;
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(clock); }
  static now() { return clock; }
}
function ttlKV() {
  const m = new Map();
  const kv = {
    failGet: null,   // a regex: reads of matching keys throw, as a KV 429 does
    get: async (k) => {
      if (kv.failGet && kv.failGet.test(k)) throw new Error('KV GET failed: 429 Too Many Requests');
      const e = m.get(k); return e && clock < e.exp ? e.v : null;
    },
    put: async (k, v, o = {}) => {
      const unknown = Object.keys(o).filter((x) => !['expirationTtl', 'expiration', 'metadata'].includes(x));
      if (unknown.length) throw new Error(`KV put: unknown option ${unknown.join(', ')}`);
      if (o.expirationTtl !== undefined && !(o.expirationTtl >= 60)) throw new Error(`KV put: expirationTtl ${o.expirationTtl} is below 60`);
      if (o.expiration !== undefined && !(o.expiration * 1000 >= clock + 60000)) throw new Error('KV put: expiration is less than 60 s ahead');
      const exp = o.expirationTtl !== undefined ? clock + o.expirationTtl * 1000
        : o.expiration !== undefined ? o.expiration * 1000 : Infinity;
      m.set(k, { v: String(v), exp });
    },
  };
  return kv;
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
// A veto at `at` (and a second at `again`, if given), read back for `day` at
// `readAt`, with stamp reads failing when `failGet` is set. `kind` 'day' fills
// the day; 'month' fills the month and leaves the day room; 'site' fills one
// capped site (SITE) to its cap and leaves the day and the month room.
const SITE = 'ambientCaptureClosingOdds';
async function replay({ kind, at, again = null, readAt, day, failGet = null, legacySite = null }) {
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
    const who = kind === 'site' ? SITE : 'probe';
    if (kind === 'day') db.prepare('INSERT INTO odds_budget VALUES (?, ?)').run(at.slice(0, 10), 1e9);
    else if (kind === 'site') db.prepare('INSERT INTO odds_budget_site VALUES (?, ?, ?)').run(at.slice(0, 10), SITE, mod.siteCeilingFor(SITE, at.slice(0, 10)));
    else db.prepare('INSERT INTO odds_budget_month VALUES (?, ?)').run(at.slice(0, 7), mod.ODDS_HARD_LIMIT);
    let refused = (await mod.chargeOdds(env, 3, who)) === false;
    if (again) { clock = RealDate.parse(again); refused = refused && (await mod.chargeOdds(env, 3, who)) === false; }
    // A site stamp in the legacy shape (a bare '1', no hour), as a boolean-era
    // writer left it: reached, hour unknown.
    if (legacySite) await env.FIELD_JOURNALISM.put(`odds:daily:${at.slice(0, 10)}:warned:site:${legacySite}`, '1', { expirationTtl: 3 * 86400 });
    clock = RealDate.parse(readAt);
    env.FIELD_JOURNALISM.failGet = failGet;
    const got = await mod.peekDailyOdds(env, day);
    return { refused, ceiling: got?.ceiling_reached_at, month: got?.month_limit_reached_at, hasMonth: !!got && 'month_limit_reached_at' in got,
             unreadable: got ? got.stamps_unreadable : undefined,
             siteAt: got?.site_ceiling_reached_at, siteCaps: got?.site_ceilings, siteUnread: got?.site_stamps_unreadable };
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
    r.refused && r.month === at && r.ceiling === null && r.unreadable === null,
    `refused ${r.refused}, month_limit_reached_at ${JSON.stringify(r.month)}, ceiling_reached_at ${JSON.stringify(r.ceiling)}, stamps_unreadable ${JSON.stringify(r.unreadable)}`);
  const nov = await replay({ kind: 'month', at, readAt: '2026-11-01T15:36:00Z', day: '2026-11-01' });
  ok("...and is not reported for the next month's days",
    nov.hasMonth && nov.month === null,
    `month_limit_reached_at ${JSON.stringify(nov.month)} for 2026-11-01: the reader is not keyed by the day's month`);
}
{
  // THE MONTH STAMP OUTLIVES ITS READERS TOO. The oldest stamp a reader can
  // still need: written at the first instant of a month, read for that month's
  // last day at the last instant the route serves it. That takes about 33 days.
  const at = '2026-10-01T00:00:00.001Z';
  const r = await replay({ kind: 'month', at, readAt: '2026-11-02T23:59:59.999Z', day: '2026-10-31' });
  ok(`a month veto at ${at} is still reported for 10-31 at its last served instant`,
    r.refused && r.month === at,
    `refused ${r.refused}, month_limit_reached_at ${JSON.stringify(r.month)}: the month stamp expired before its last reader`);
}
{
  // FIRST, NOT LATEST. Both stamps are written once, at the first refusal, and a
  // later refusal must not move them: the watch judges the month by the date of
  // the first, so a stamp rewritten on every refusal makes a month that was
  // already refusing read as one that started after the closed day.
  const d = await replay({ kind: 'day', at: '2026-10-21T08:00:00.000Z', again: '2026-10-21T20:00:00.000Z',
    readAt: '2026-10-22T15:36:00Z', day: '2026-10-21' });
  ok('two day vetoes: ceiling_reached_at is the first',
    d.refused && d.ceiling === '2026-10-21T08:00:00.000Z',
    `refused ${d.refused}, ceiling_reached_at ${JSON.stringify(d.ceiling)}`);
  const m = await replay({ kind: 'month', at: '2026-10-31T08:00:00.000Z', again: '2026-10-31T22:00:00.000Z',
    readAt: '2026-11-01T15:36:00Z', day: '2026-10-31' });
  ok('two month vetoes: month_limit_reached_at is the first',
    m.refused && m.month === '2026-10-31T08:00:00.000Z',
    `refused ${m.refused}, month_limit_reached_at ${JSON.stringify(m.month)}`);
}
{
  // A FAILED READ INVENTS NOTHING, AND SAYS SO. The stamp exists and the read
  // of a stamp throws: the field is null, never `true` (which the watch counts
  // as a refusal with no hour), and stamps_unreadable names it, so the null is
  // not read as "no refusal" (Rule 99). Each stamp alone, then both.
  for (const [kind, failGet, names] of [['day', /:warned$/, ['ceiling_reached_at']],
                                        ['month', /:warned:limit$/, ['month_limit_reached_at']],
                                        ['month', /:warned/, ['ceiling_reached_at', 'month_limit_reached_at', 'site_ceiling_reached_at']]]) {
    const r = await replay({ kind, at: '2026-10-31T22:00:00.000Z', readAt: '2026-11-01T15:36:00Z', day: '2026-10-31', failGet });
    ok(`a ${kind} veto, reads of ${failGet} throw: both stamps null, ${names.join(' and ')} named unreadable`,
      r.refused && r.ceiling === null && r.month === null && JSON.stringify(r.unreadable) === JSON.stringify(names),
      `ceiling_reached_at ${JSON.stringify(r.ceiling)}, month_limit_reached_at ${JSON.stringify(r.month)}, stamps_unreadable ${JSON.stringify(r.unreadable)}`);
  }
  // ...AND A FAILED READ OF ONE STAMP LEAVES THE OTHER ALONE. The stamp that
  // was read and shows a refusal is still served, beside the name of the one
  // that could not be read.
  for (const [kind, failGet, field, other] of [['day', /:warned:limit$/, 'ceiling', 'month_limit_reached_at'],
                                               ['month', /:warned$/, 'month', 'ceiling_reached_at']]) {
    const at = '2026-10-31T22:00:00.000Z';
    const r = await replay({ kind, at, readAt: '2026-11-01T15:36:00Z', day: '2026-10-31', failGet });
    ok(`a ${kind} veto read, the ${other} read throws: the ${kind} stamp is still served`,
      r.refused && r[field] === at && JSON.stringify(r.unreadable) === JSON.stringify([other]),
      `ceiling_reached_at ${JSON.stringify(r.ceiling)}, month_limit_reached_at ${JSON.stringify(r.month)}, stamps_unreadable ${JSON.stringify(r.unreadable)}`);
  }
}

// ── THE SITE CAPS' STAMPS (Task 3 of docs/CC-CMD-2026-09-16-odds-spend-attribution.md) ──
// A site cap refuses calls too, and no caller reads a refusal, so the stamp is
// the only place it shows. Same three states, same lifetime, same first-not-
// latest, same named-when-unreadable as the day's and the month's.
ok('the reader serves each site\'s cap and its stamps',
  /site_ceilings: siteCeilings,/.test(reader) && /site_ceiling_reached_at: siteHit,/.test(reader),
  'a value only the worker knows is not an artifact (Rule 90)');
ok('the reader asks for the cap of the date asked about, so a siteExtra grant day is reported as granted',
  /siteCeilingFor\(s, date\)/.test(reader),
  'the standing cap on a grant day is a budget readout that disagrees with the budget (no siteExtra grant exists yet, so no replay can see this: a source read is all there is)');
ok('a failed site-stamp read is named, and leaves that site null',
  /siteHit\[s\] = null; siteUnreadable\.push\(s\);\s*\n\s*if \(!stampsUnreadable\.includes\('site_ceiling_reached_at'\)\) stampsUnreadable\.push\('site_ceiling_reached_at'\);/.test(reader),
  'an unreadable KV must not report a refusal that never happened, nor hide one that did');
{
  const at = '2026-10-21T00:00:00.001Z';
  const r = await replay({ kind: 'site', at, readAt: '2026-10-23T23:59:59.999Z', day: '2026-10-21' });
  ok(`a site cap that refused at ${at} is still reported at the last instant the route serves the day`,
    r.refused && r.siteAt?.[SITE] === at,
    `refused ${r.refused}, site_ceiling_reached_at ${JSON.stringify(r.siteAt)}: the stamp expired before its reader, so a day that refused a consumer reads as one that did not`);
  ok('...and it is filed under its own site only: the other capped sites are null',
    r.siteAt && Object.entries(r.siteAt).every(([k, v]) => k === SITE || v === null),
    JSON.stringify(r.siteAt));
  ok("...and it is NOT filed as the day's or the month's refusal",
    r.ceiling === null && r.month === null && r.unreadable === null,
    `ceiling_reached_at ${JSON.stringify(r.ceiling)}, month_limit_reached_at ${JSON.stringify(r.month)}, stamps_unreadable ${JSON.stringify(r.unreadable)}`);
  ok('...the caps are served with it: the four capped sites at their numbers, every other site null',
    r.siteCaps && r.siteCaps.ambientCaptureClosingOdds === 400 && r.siteCaps.fetchSportOddsLive === 2000
      && r.siteCaps.fetchSportOddsHistorical === 1800 && r.siteCaps.getWCPregameLambdas === 300
      && Object.entries(r.siteCaps).every(([k, v]) => v === null || ['ambientCaptureClosingOdds', 'fetchSportOddsLive', 'fetchSportOddsHistorical', 'getWCPregameLambdas'].includes(k))
      && Object.keys(r.siteCaps).length > 4,
    JSON.stringify(r.siteCaps));
  ok('...and the stamps list exactly the capped sites',
    r.siteAt && JSON.stringify(Object.keys(r.siteAt).sort()) === JSON.stringify(['ambientCaptureClosingOdds', 'fetchSportOddsHistorical', 'fetchSportOddsLive', 'getWCPregameLambdas']),
    JSON.stringify(r.siteAt));
  const other = await replay({ kind: 'site', at, readAt: '2026-10-22T15:00:00Z', day: '2026-10-20' });
  ok("...and a stamp is not reported for another date",
    other.refused && other.siteAt?.[SITE] === null,
    `site_ceiling_reached_at for 2026-10-20: ${JSON.stringify(other.siteAt)}`);
}
{
  const m = await replay({ kind: 'site', at: '2026-10-21T08:00:00.000Z', again: '2026-10-21T20:00:00.000Z',
    readAt: '2026-10-22T15:36:00Z', day: '2026-10-21' });
  ok('two site vetoes: the stamp is the first',
    m.refused && m.siteAt?.[SITE] === '2026-10-21T08:00:00.000Z',
    `refused ${m.refused}, site_ceiling_reached_at ${JSON.stringify(m.siteAt)}`);
}
{
  // THE THIRD STATE, EXECUTED. A stamp with no hour reads as `true` (reached, hour
  // unknown), never as the raw value and never as null: collapsing it either way
  // loses a refusal or invents an hour for it. Only the day's stamp had this case.
  const r = await replay({ kind: 'day', at: '2026-10-21T08:00:00.000Z', readAt: '2026-10-22T15:36:00Z', day: '2026-10-21',
    legacySite: 'fetchSportOddsLive' });
  ok("a site stamp written as a bare '1' reads as true, and the other sites stay null",
    r.siteAt?.fetchSportOddsLive === true && r.siteAt?.ambientCaptureClosingOdds === null,
    `site_ceiling_reached_at ${JSON.stringify(r.siteAt)}`);
}
{
  const at = '2026-10-21T08:00:00.000Z';
  const r = await replay({ kind: 'site', at, readAt: '2026-10-22T15:36:00Z', day: '2026-10-21', failGet: /:warned:site:/ });
  ok('a site veto, reads of its stamp throw: every site null, site_ceiling_reached_at named unreadable and nothing else',
    r.refused && !!r.siteAt && Object.values(r.siteAt).every((v) => v === null) && JSON.stringify(r.unreadable) === JSON.stringify(['site_ceiling_reached_at']),
    `site_ceiling_reached_at ${JSON.stringify(r.siteAt)}, stamps_unreadable ${JSON.stringify(r.unreadable)}`);
  ok('...and the sites whose read failed are named, so a null says WHICH is unknown',
    JSON.stringify([...(r.siteUnread || [])].sort()) === JSON.stringify(['ambientCaptureClosingOdds', 'fetchSportOddsHistorical', 'fetchSportOddsLive', 'getWCPregameLambdas']),
    `site_stamps_unreadable ${JSON.stringify(r.siteUnread)}`);
  const fine = await replay({ kind: 'site', at, readAt: '2026-10-22T15:36:00Z', day: '2026-10-21' });
  ok('...and is null when every read worked', fine.siteUnread === null, `site_stamps_unreadable ${JSON.stringify(fine.siteUnread)}`);
  const d = await replay({ kind: 'day', at, readAt: '2026-10-22T15:36:00Z', day: '2026-10-21', failGet: /:warned:site:/ });
  ok("...and the day's stamp, read beside it, is still served",
    d.refused && d.ceiling === at && JSON.stringify(d.unreadable) === JSON.stringify(['site_ceiling_reached_at']),
    `ceiling_reached_at ${JSON.stringify(d.ceiling)}, stamps_unreadable ${JSON.stringify(d.unreadable)}`);
}

console.log(`\n${n - bad} of ${n} passed.`);
console.log(`COVERAGE: source text in ${SRC} for the stamp's shape, and an executed`);
console.log(`replay of chargeOdds and peekDailyOdds: ${READS.length} day stamps read at real watch read`);
console.log('times or the last served instant; month vetoes across a month boundary and at');
console.log('the oldest stamp a reader needs; first-not-latest for both; a failed read. It');
console.log('cannot say whether a veto has actually occurred;');
console.log('that is what the live /budget/odds reading is for.');
process.exit(bad ? 1 : 0);
