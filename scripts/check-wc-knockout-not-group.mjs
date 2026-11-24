#!/usr/bin/env node
// A World Cup knockout game is never filed through the GROUP path.
// docs/CC-CMD-2026-11-07-wc-results-club-contamination.md, Defect B.
//
// WHY. Production wc_results (WC2026_DB) held 10 knockout games filed as phase='group', read 2026-11-24: nine Round of 32 games
// (espn:760489, 760490, 760492 to 760497 and 760499, 2026-06-29 to 07-03) and the third-place game (espn:760516, 2026-07-18,
// France 4-6 England). recomputeGroupStandings then put each visiting team into the HOME team's group table (Egypt and Bosnia in
// group D, Norway and Paraguay in group E, ...). Two more group rows dated after 06-27 are NOT misfiles: espn:760483 and 760484
// (Jordan v Argentina, Algeria v Austria) kicked off 2026-06-28T02:00Z and are "FIFA World Cup, Group J". extractWCGroup took
// a team-name fallback whenever the round string held no `Group <A-L>` and none of its knockout guard's words
// (`round of|quarter|semi|final`), and writeWCResult took the group path before the knockout path.
//   * The third-place game is REPRODUCED on the string the relay serves today, "FIFA World Cup, 3rd-Place Match" (read
//     2026-11-24): the old guard has no word for it, extractWCPhase's `3rd\s+place` needs whitespace, so both extractors missed
//     it and the old code files it under France's group, I, which is the stored row. The string at write time is not stored.
//   * The nine Round of 32 games are INFERRED, not measured. All nine rows were created before 07bc51a8 (2026-07-03 22:41Z), which
//     moved the adapter's round from the `comp.notes[0].headline` chain (advancement text, "Egypt advance 4-2 on penalties", or
//     '') to `comp.altGameNote`; every knockout row created after it is right except the third-place game; in all ten misfiles the
//     filed group is the HOME team's group in the old table, which an unfiltered BSD lookup (until 2026-08-02) would give as well. Two Round of 32 rows created before that commit are right (espn:760486, 760487), and what
//     wrote them is not identified.
// The fix removes the inference: a game is a group game only when its own round string says `Group <A-L>`, and a round that
// names a knockout phase is read as a knockout game. A round that names neither is not written (absent, and silent), instead of
// a row under a group chosen from the home team's name. BSD's group_name no longer replaces a round that names a knockout phase.
//
// WHAT THIS RUNS. The REAL worker (src/index.js default export) on GET /v2/games against a stubbed ESPN (and BSD, for the cases
// that name it), one request per case, with a stub WC2026_DB that records every statement and its binds. src/index.js imports
// @cloudflare/puppeteer, which this repo's CI does not install, so a resolve hook stubs that one package (the hook
// scripts/check-wc-tables-world-cup-only.mjs uses).
//
//   knockout     the six real round strings the relay serves for the 2026 knockout (read 2026-11-24): each must write exactly one
//                knockout row with every column right (the id too), its score UPDATE, INSERT OR IGNORE only, no group row and no group-standings rewrite; each also live, where it
//                reads no group table and is stamped with no advancement probability. The teams are the real finalists, whose old
//                fallback group differs from their opponent's.
//   unmarked     rounds that name neither a group nor a knockout phase: '' , the advancement headline the adapter used to read, and
//                the api-sports matchday format the fallback was written for. NOTHING is touched: no statement of any kind.
//   precedence   a round that names BOTH a group and a knockout phase is a knockout game. A design choice: no real string names both.
//   bsd          BSD's group_name does not turn a knockout game into a group row; it still names a game whose ESPN round says nothing.
//   sweep        the dead-hours brief sweep (handleJournalismCycle, driven through the real `scheduled` handler at 05:00 UTC with stub
//                KV and D1) re-writes a group row lacking a brief under THAT ROW'S group, taken from the row and not from the team
//                names: the rows of group C and L hold names no table has.
//   controls     all twelve group letters through "FIFA World Cup, Group X", and the bare "Group A": each writes a group row under THAT
//                letter and rewrites that group; a live group game still reads its group. Without them "writes nothing" would also
//                describe a harness that never reached the writer.
//
// Coverage is printed with the result (Rule 91). NOT checked: the rows already in production (a separate cleanup, needs the owner),
// BracketDO and the brief queue (the stub records D1 only), the real D1 schema and constraints (the stub never runs SQL), the adapter's
// other round sources (`ev.season.slug`, `comp.type.text`), and what BSD served during the tournament (its group_name is null on every
// knockout event read on 2026-11-24, 9 of 32).
//
//   node scripts/check-wc-knockout-not-group.mjs            # self-test
//   node scripts/check-wc-knockout-not-group.mjs --mutate   # Rule 90

import { register } from 'node:module';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

register('data:text/javascript,' + encodeURIComponent(
  "export async function resolve(s, c, next) { if (s === '@cloudflare/puppeteer') return { url: 'data:text/javascript,export default {}', shortCircuit: true }; return next(s, c); }"));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(HERE, '../src/index.js');
const INDEX_MODULE = process.env.INDEX_MODULE || INDEX;
// A past date, so it is never the runner's today.
const DATE = '2025-11-07';
const RealDate = Date;
const RealFetch = globalThis.fetch;

let seq = 780000;
// `round` goes where the adapter reads it first (comp.altGameNote); `headline` goes where it read it before 07bc51a8
// (comp.notes[0].headline), for the cases that need a round with no altGameNote.
const ev = (round, home, away, state = 'final', headline = null) => {
  const fin = state === 'final';
  return { id: String(seq++), date: `${DATE}T19:00Z`,
    competitions: [{ date: `${DATE}T19:00Z`, ...(round ? { altGameNote: round } : {}), ...(headline ? { notes: [{ headline }] } : {}),
      status: { type: fin ? { completed: true, state: 'post', name: 'STATUS_FULL_TIME' } : { completed: false, state: 'in', name: 'STATUS_FIRST_HALF' },
        clock: fin ? 5400 : 1800, displayClock: fin ? "90'" : "30'" },
      competitors: [
        { homeAway: 'home', score: '2', team: { id: `h${seq}`, displayName: home, abbreviation: home.slice(0, 3).toUpperCase() } },
        { homeAway: 'away', score: '1', team: { id: `a${seq}`, displayName: away, abbreviation: away.slice(0, 3).toUpperCase() } },
      ] }] };
};

// ESPN always answers the World Cup board; BSD answers only when a case names it (`bsd` = [{home, away, group_name}]).
function stubUpstreams(events, bsd) {
  globalThis.fetch = async (input) => {
    const url = String(input?.url ?? input);
    if (url.includes('/soccer/fifa.world/scoreboard?dates=')) return Response.json({ events });
    if (bsd && url.includes('sports.bzzoiro.com/api/v2/events/live/')) return Response.json({ events: [] });
    if (bsd && url.includes('sports.bzzoiro.com/api/v2/events/?')) return Response.json({ results: bsd.map(b => ({ id: 1, home_team: b.home, away_team: b.away, group_name: b.group_name, weather: null })) });
    return new Response('{}', { status: 404 });
  };
}

// Four teams for the group a live control reads, so computeAdvancementProb has standings to work from.
const GROUP_ROWS = ['Netherlands', 'Japan', 'Sweden', 'Tunisia'].map((team, i) => ({ group_id: 'F', team, played: 2, won: 1 - (i > 1 ? 1 : 0), drawn: 0, lost: 1, gf: 3 - i, ga: 2, gd: 1 - i, points: 3 - i }));

/** A stub WC2026_DB: records every prepared statement and every OTHER member the worker reaches for (exec, batch, ...). */
function stubDb(stmts, other, rowsFor = () => []) {
  const mk = (sql) => {
    const rec = { sql, binds: null };
    stmts.push(rec);
    const s = { run: async () => ({ meta: { changes: 1 } }), first: async () => null, all: async () => ({ results: rowsFor(sql) }), bind: (...a) => { rec.binds = a; return s; } };
    return s;
  };
  return new Proxy({ prepare: mk }, { get(t, k) { if (k in t) return t[k]; other.push(String(k)); return undefined; } });
}

/** What the stub saw, in the words the cases assert on. */
function classify(stmts, other) {
  const inserts = stmts.filter(s => /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+wc_results/i.test(s.sql));
  return {
    statements: stmts.length, other: [...other],
    // Every wc_results INSERT must be INSERT OR IGNORE (the writer is idempotent; OR REPLACE would overwrite a corrected row).
    orIgnoreOnly: inserts.every(s => /INSERT\s+OR\s+IGNORE\s+INTO\s+wc_results/i.test(s.sql)),
    // The group path's INSERT carries the literal 'group'; the knockout path binds its phase. binds: group (id, group, home, away,
    // hs, as, date), knockout (id, PHASE, home, away, hs, as, phase, date).
    groupInserts: inserts.filter(s => /'group'/.test(s.sql)).map(s => s.binds ?? null),
    knockoutRows: inserts.filter(s => !/'group'/.test(s.sql)).map(s => s.binds ?? null),
    // The authoritative-score UPDATE both paths run (hs, as, id).
    updates: stmts.filter(s => /UPDATE\s+wc_results\s+SET\s+home_score/i.test(s.sql)).map(s => s.binds ?? null),
    groupRewrites: stmts.filter(s => /DELETE FROM wc_group/.test(s.sql)).map(s => s.binds?.[0] ?? null),
    groupReads: stmts.filter(s => /FROM wc_group WHERE group_id/.test(s.sql)).length,
  };
}
const groupLetters = (c) => c.groupInserts.map(b => b?.[1] ?? null);

// Every case's anomalies: a D1 member other than prepare, or a writer promise that REJECTED. The worker wraps its writers in
// Promise.allSettled, which never rejects, so a throw inside writeWCResult is invisible unless allSettled is watched: it is patched
// for the length of a request and the rejection reasons are kept.
const anomalies = [];
let caseNo = 0;
async function watched(label, fn) {
  const orig = Promise.allSettled;
  const rejections = [];
  Promise.allSettled = async function (ps) { const res = await orig.call(Promise, ps); for (const r of res) if (r.status === 'rejected') rejections.push(String(r.reason && r.reason.message || r.reason)); return res; };
  try { const out = await fn(); if (out.other?.length) anomalies.push(`${label}: db.${out.other.join(', db.')}`); for (const m of rejections) anomalies.push(`${label}: rejected: ${m}`); return out; }
  finally { Promise.allSettled = orig; }
}

/** One /v2/games?sport=wc26 request against the real worker. */
async function request(worker, events, bsd = null) {
  const label = `case ${++caseNo} (${events.map(e => e.competitions?.[0]?.altGameNote || e.competitions?.[0]?.notes?.[0]?.headline || '(no round)').join(' / ')})`;
  return watched(label, async () => {
    stubUpstreams(events, bsd);
    const stmts = [], other = [];
    const env = { WC2026_DB: stubDb(stmts, other, (sql) => (/FROM wc_group WHERE group_id/.test(sql) ? GROUP_ROWS : [])), ...(bsd ? { BSD_API_TOKEN: 'stub' } : {}) };
    const waits = [];
    const ctx = { waitUntil: p => waits.push(p), passThroughOnException() {} };
    const r = await worker.fetch(new Request(`http://relay.test/v2/games?sport=wc26&date=${DATE}`), env, ctx);
    await Promise.allSettled(waits);
    let body = null;
    try { body = await r.json(); } catch (_) { /* not JSON: body stays null and the callers read it as "no games array", never as an empty slate */ }
    const games = Array.isArray(body?.games) ? body.games : null;
    return { ...classify(stmts, other), status: r.status, states: games ? games.map(g => g.state) : null, ids: games ? games.map(g => g.id) : null,
      advancementStamped: games ? games.filter(g => g.advancementProb).length : null };
  });
}

// The dead-hours cron tick (the every-15-minutes cron, at 05:00 UTC) against stub KV and D1, with `rows` as the wc_results group rows lacking a brief
// and `tried` as the wc26_sweep:tried markers already in KV.
async function sweep(worker, rows, tried = []) {
  const label = `sweep ${++caseNo}`;
  return watched(label, async () => {
    const FIXED = RealDate.parse('2026-11-24T05:00:00Z');
    const kv = new Map(tried.map(k => [k, '1']));
    const KV = { get: async k => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); }, delete: async k => kv.delete(k), list: async () => ({ keys: [], list_complete: true }) };
    const stmts = [], other = [];
    const empty = () => { const s = { run: async () => ({ meta: { changes: 0 } }), first: async () => null, all: async () => ({ results: [] }), bind: () => s }; return s; };
    const env = { FIELD_JOURNALISM: KV, WC2026_DB: stubDb(stmts, other, (sql) => (/FROM wc_results WHERE phase = 'group' AND game_id LIKE/.test(sql) ? rows : [])), ARCHIVE_DB: { prepare: empty, batch: async () => [] } };
    const waits = [];
    const ctx = { waitUntil: p => waits.push(p), passThroughOnException() {} };
    const log = console.log, err = console.error;
    const writerErrors = [];
    try {
      globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } };
      globalThis.fetch = async () => new Response('{}', { status: 404 });
      console.log = () => {}; console.error = (...a) => { const m = a.join(' '); if (/WC26-SWEEP|writeWCResult/.test(m)) writerErrors.push(m.slice(0, 120)); };
      await worker.scheduled({ cron: '*/15 * * * *', scheduledTime: FIXED }, env, ctx);
      await Promise.allSettled(waits);
    } finally { console.log = log; console.error = err; globalThis.Date = RealDate; globalThis.fetch = RealFetch; }
    const c = classify(stmts, other);
    for (const m of writerErrors) anomalies.push(`${label}: ${m}`);
    return { ...c, groupInserts: [...c.groupInserts].sort((x, y) => String(x[1]).localeCompare(String(y[1]))), groupRewrites: [...c.groupRewrites].sort(), tried: [...kv.keys()].filter(k => k.startsWith('wc26_sweep:tried:')).sort() };
  });
}

// [round string, home, away, expected [phase, group_id]]. The strings are what the relay serves for the finished 2026 tournament,
// read 2026-11-24 through /v2/games?sport=wc26&date=<day>: 06-29, 07-05, 07-10, 07-14, 07-18, 07-19. The teams are those games'
// own, and none of them shares a group with its opponent.
const KNOCKOUT = [
  ['FIFA World Cup, Round of 32', 'Germany', 'Paraguay', ['r32', 'R32']],
  ['FIFA World Cup, Round of 16', 'Brazil', 'Norway', ['r16', 'R16']],
  ['FIFA World Cup, Quarterfinals', 'Spain', 'Belgium', ['qf', 'QF']],
  ['FIFA World Cup, Semifinals', 'France', 'Spain', ['sf', 'SF']],
  ['FIFA World Cup, 3rd-Place Match', 'France', 'England', ['third', 'THIRD']],
  ['FIFA World Cup, Final', 'Spain', 'Argentina', ['final', 'FINAL']],
];
// Rounds that name neither: the adapter's pre-07bc51a8 source (advancement text; ''), and the matchday format the fallback was written for.
const UNMARKED = [['', 'Germany', 'Paraguay', null], ['', 'France', 'England', null], [null, 'Ivory Coast', 'Norway', 'Egypt advance 4-2 on penalties'], ['Group Stage - 1', 'Mexico', 'South Africa', null]];
const LETTERS = [...'ABCDEFGHIJKL'];

const GID = (e) => `espn:${e.id}`;

async function selfTest() {
  let failed = 0;
  const eq = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  };
  const worker = (await import(pathToFileURL(INDEX_MODULE).href)).default;
  const quiet = (r) => ({ statements: r.statements, other: r.other });

  // Knockout: one knockout row with every column right (the id too), the score UPDATE, no group row, no group rewrite, INSERT OR IGNORE only.
  const reached = [];
  for (const [round, home, away, want] of KNOCKOUT) {
    const e = ev(round, home, away);
    const r = await request(worker, [e]);
    if (String(r.states) !== 'final') reached.push(round);
    eq(`knockout "${round}" ${home} v ${away}: one ${want[0]} row with its full bind list (id too), its score UPDATE, INSERT OR IGNORE only, no group row, no group rewrite`,
      [r.knockoutRows, r.updates, r.orIgnoreOnly, r.groupInserts, r.groupRewrites],
      [[[GID(e), want[1], home, away, 2, 1, want[0], DATE]], [[2, 1, GID(e)]], true, [], []]);
  }
  eq(`every knockout case reached 'final' on the board (the harness is exercising the writer), ${KNOCKOUT.length} cases`, reached, []);

  // Unmarked: nothing is touched, whatever the team names say.
  for (const [round, home, away, headline] of UNMARKED) {
    const r = await request(worker, [ev(round, home, away, 'final', headline)]);
    eq(`unmarked round ${JSON.stringify(round ?? headline)} ${home} v ${away}: reached final, no statement of any kind`, [String(r.states), quiet(r)], ['final', { statements: 0, other: [] }]);
  }

  // The extractor's edges: a word that merely starts with a group letter is no group; the contract is case-insensitive; "3rd Place" with a plain space is still third.
  const edge = await request(worker, [ev('FIFA World Cup, Group Eliminated', 'Germany', 'Paraguay')]);
  eq('edge: "Group Eliminated" is no group (the letter needs a word boundary), nothing is touched', quiet(edge), { statements: 0, other: [] });
  const lower = await request(worker, [ev('group a', 'Mexico', 'South Africa')]);
  eq('edge: "group a" is group A (the match is case-insensitive)', [groupLetters(lower), lower.groupRewrites], [['A'], ['A']]);
  const third = await request(worker, [ev('FIFA World Cup, 3rd Place Match', 'France', 'England')]);
  eq('edge: "3rd Place Match" (a space, not a hyphen) is still the third-place game', [third.knockoutRows.map(b => [b[1], b[6]]), third.groupInserts], [[['THIRD', 'third']], []]);

  // Precedence: a round naming both a group and a phase is a knockout game, for every phase.
  const precedence = [];
  for (const [round, home, away, want] of KNOCKOUT) {
    const r = await request(worker, [ev(`${round}, Group E`, home, away)]);
    precedence.push([want[0], r.knockoutRows.map(b => b[6]), r.groupInserts.length, r.groupRewrites.length]);
  }
  eq('precedence: a round naming a phase AND a group is a knockout game, for all six phases', precedence, KNOCKOUT.map(k => [k[3][0], [k[3][0]], 0, 0]));

  // BSD: group_name never turns a knockout game into a group row, and still names a game whose ESPN round says nothing.
  for (const [round, home, away, want] of [KNOCKOUT[0], KNOCKOUT[4]]) {
    const r = await request(worker, [ev(round, home, away)], [{ home, away, group_name: 'Group E' }]);
    eq(`bsd: "${round}" with BSD group_name "Group E" is still a ${want[0]} game`, [r.knockoutRows.map(b => [b[1], b[6]]), r.groupInserts, r.groupRewrites], [[[want[1], want[0]]], [], []]);
  }
  const bsdOpener = await request(worker, [ev('', 'Mexico', 'South Africa')], [{ home: 'Mexico', away: 'South Africa', group_name: 'Group A' }]);
  eq('control, bsd: a game whose ESPN round says nothing takes the group BSD names (the 06-11 opener)', [groupLetters(bsdOpener), bsdOpener.groupRewrites, bsdOpener.knockoutRows], [['A'], ['A'], []]);
  const bsdNull = await request(worker, [ev(...KNOCKOUT[0].slice(0, 3))], [{ home: 'Germany', away: 'Paraguay', group_name: null }]);
  eq('control, bsd: a knockout game with a null BSD group_name is written as before', [bsdNull.knockoutRows.map(b => [b[1], b[6]]), bsdNull.groupInserts], [[['R32', 'r32']], []]);

  // Live: a live knockout game touches nothing of the group tables, and is live.
  for (const [round, home, away] of KNOCKOUT) {
    const r = await request(worker, [ev(round, home, away, 'live')]);
    eq(`live "${round}": on the board as live, no group read, no advancement stamp, no statement that writes`, [String(r.states), r.groupReads, r.advancementStamped, r.knockoutRows, r.groupInserts], ['live', 0, 0, [], []]);
  }

  // Sweep: the group comes from the row. Germany v Paraguay is a real pair of the home team's group; the rows of C and L hold names no table has.
  const row = (n, g, h, a, hs, as_, d) => ({ game_id: `espn:76000${n}`, group_id: g, home: h, away: a, home_score: hs, away_score: as_, match_date: d, bsd_event_id: null });
  const rows = [row(1, 'E', 'Germany', 'Paraguay', 1, 1, '2026-06-20'), row(2, 'C', 'Narnia', 'Atlantis', 2, 0, '2026-06-21'), row(3, 'L', 'Ruritania', 'Genovia', 0, 0, '2026-06-22')];
  const sw = await sweep(worker, rows);
  eq('sweep: each group row lacking a brief is re-written whole under its own group (E, and C and L for names no table has), with its score UPDATE, and its group rewritten',
    [sw.groupInserts, sw.updates.map(u => u[2]).sort(), sw.groupRewrites, sw.knockoutRows.length, sw.orIgnoreOnly],
    [[['espn:760002', 'C', 'Narnia', 'Atlantis', 2, 0, '2026-06-21'], ['espn:760001', 'E', 'Germany', 'Paraguay', 1, 1, '2026-06-20'], ['espn:760003', 'L', 'Ruritania', 'Genovia', 0, 0, '2026-06-22']], ['espn:760001', 'espn:760002', 'espn:760003'], ['C', 'E', 'L'], 0, true]);
  eq('sweep: every swept game is marked tried', sw.tried, ['wc26_sweep:tried:espn:760001', 'wc26_sweep:tried:espn:760002', 'wc26_sweep:tried:espn:760003']);
  const swTried = await sweep(worker, [row(4, 'D', 'Narnia', 'Atlantis', 1, 0, '2026-06-19'), row(1, 'E', 'Germany', 'Paraguay', 1, 1, '2026-06-20')], ['wc26_sweep:tried:espn:760004']);
  eq('sweep: a game already marked tried is not written again', [swTried.groupInserts.map(b => b[0]), swTried.groupRewrites], [['espn:760001'], ['E']]);

  // Controls: the group path is intact, for every letter and for both real forms, with every column and the score UPDATE.
  for (const L of LETTERS) {
    const e = ev(`FIFA World Cup, Group ${L}`, 'Mexico', 'South Africa');
    const r = await request(worker, [e]);
    eq(`control: "FIFA World Cup, Group ${L}" writes its group row whole under ${L}, with its score UPDATE, and rewrites group ${L}`, [r.groupInserts, r.updates, r.groupRewrites, r.knockoutRows, r.orIgnoreOnly], [[[GID(e), L, 'Mexico', 'South Africa', 2, 1, DATE]], [[2, 1, GID(e)]], [L], [], true]);
  }
  const eb = ev('Group A', 'Mexico', 'South Africa');
  const bare = await request(worker, [eb]);
  eq('control: the bare "Group A" writes its group row whole under A and rewrites group A', [bare.groupInserts, bare.updates, bare.groupRewrites, bare.knockoutRows], [[[GID(eb), 'A', 'Mexico', 'South Africa', 2, 1, DATE]], [[2, 1, GID(eb)]], ['A'], []]);
  const live = await request(worker, [ev('Group F', 'Netherlands', 'Japan', 'live')]);
  eq('control: a live group game still reads its group and is stamped with an advancement probability', [live.groupReads > 0, live.advancementStamped], [true, 1]);

  eq('no case reached for a D1 member other than prepare, and no writer promise was rejected (every request and sweep above)', anomalies, []);

  console.log(`\nCOVERAGE: ${caseNo} requests against the real worker (${path.relative(HERE, INDEX_MODULE) || INDEX_MODULE}): ${KNOCKOUT.length} real knockout strings as finals and ${KNOCKOUT.length} live, ${UNMARKED.length} unmarked rounds, 3 extractor edges, ${KNOCKOUT.length} precedence cases, 4 BSD cases, 3 sweep runs (the real scheduled handler; one with a tried marker), ${LETTERS.length} group letters + the bare form + 1 live as controls. ` +
    'Every request also asserts no D1 member beyond prepare and no rejected writer. NOT checked: production rows, BracketDO and the brief queue, the real D1 schema (the stub never runs SQL), the adapter\'s other round sources, and what BSD served during the tournament.');
  console.log(failed ? `SELF-TEST FAILED: ${failed}` : 'self-test passed');
  return failed;
}

// [name, [[from, to], ...]]. Every anchor must occur exactly once, or the mutation is not run and the gate fails
// (Rule 90's corollary: NOT CAUGHT with nothing applied is worse than no test).
const GROUP_RE = "const m = (round || '').match(/Group\\s+([A-L])\\b/i);";
const GROUP_FN = "    if (extractWCPhase(round)) return null;\n    " + GROUP_RE + "\n    return m ? m[1].toUpperCase() : null;\n}";
const BSD_LINE = "if (_hit.group_name && !extractWCPhase(_g.round)) _g.round = _hit.group_name;";
const KO_UPDATE = "        await db.prepare(\n            'UPDATE wc_results SET home_score = ?, away_score = ? WHERE game_id = ?'\n        ).bind(homeScore, awayScore, game.id).run();\n        return;";
const KO_INSERT = "          INSERT OR IGNORE INTO wc_results\n            (game_id, group_id, home, away, home_score, away_score, phase, match_date)\n          VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
const GR_BIND = "    `).bind(game.id, groupId, homeName, awayName,\n            homeScore, awayScore, matchDate).run();";
const GR_UPDATE = "    // always runs at game-final to write the authoritative final score.\n    await db.prepare(\n        'UPDATE wc_results SET home_score = ?, away_score = ? WHERE game_id = ?'\n    ).bind(homeScore, awayScore, game.id).run();\n";
const SWEEP_TEAMS = "home: { name: g.home, score: g.home_score },\n                away: { name: g.away, score: g.away_score },";
const MUTATIONS = [
  ['an unmarked round gets a group again (the old fallback)', [[GROUP_FN, GROUP_FN.replace("m[1].toUpperCase() : null", "m[1].toUpperCase() : 'E'")]]],
  ['a round naming a knockout phase can be a group game again', [[GROUP_FN, "    " + GROUP_RE + "\n    return m ? m[1].toUpperCase() : null;\n}"]]],
  ['no round has a group', [[GROUP_FN, "    return null;\n}"]]],
  ['the group letters stop at K', [[GROUP_RE, GROUP_RE.replace("[A-L]", "[A-K]")]]],
  ['the group match is case-sensitive', [[GROUP_RE, GROUP_RE.replace("\\b/i)", "\\b/)")]]],
  ['the group letter needs no word boundary', [[GROUP_RE, GROUP_RE.replace("\\b/i)", "/i)")]]],
  ['a group string is read as a phase', [["    if (/round\\s+of\\s+32|r32/.test(r))", "    if (/round\\s+of\\s+32|r32|group\\s+b/.test(r))"]]],
  ['the third-place string is missed again (the hyphen)', [["if (/third|3rd[\\s-]+place/.test(r))", "if (/third|3rd\\s+place/.test(r))"]]],
  ['the third-place string needs a hyphen', [["if (/third|3rd[\\s-]+place/.test(r))", "if (/third|3rd-place/.test(r))"]]],
  ['the final is no longer a phase', [["if (/final/.test(r) && !/semi|quarter|third|3rd/.test(r))", "if (/finalXX/.test(r) && !/semi|quarter|third|3rd/.test(r))"]]],
  ['the knockout row is written with the wrong phase', [["phaseUpper, homeName, awayName,", "'X', homeName, awayName,"]]],
  ['the knockout row swaps home and away', [["phaseUpper, homeName, awayName,", "phaseUpper, awayName, homeName,"]]],
  ['the knockout row is written under another game id', [[".bind(game.id, phaseUpper, homeName, awayName,", ".bind(game.id + ':x', phaseUpper, homeName, awayName,"]]],
  ['the knockout INSERT replaces an existing row', [[KO_INSERT, KO_INSERT.replace("INSERT OR IGNORE", "INSERT OR REPLACE")]]],
  ['the knockout path drops its score UPDATE', [[KO_UPDATE, "        return;"]]],
  ['the knockout path throws after its writes', [[KO_UPDATE, KO_UPDATE.replace("return;", "throw new Error('after the writes');")]]],
  ['the group INSERT swaps home and away', [[GR_BIND, GR_BIND.replace("homeName, awayName,", "awayName, homeName,")]]],
  ['the group path drops its score UPDATE', [[GR_UPDATE, ""]]],
  ['the group path writes through db.exec', [["    await recomputeGroupStandings(db, groupId);\n\n    // Notify BracketDO", "    await db.exec('x');\n    await recomputeGroupStandings(db, groupId);\n\n    // Notify BracketDO"]]],
  ['BSD group_name replaces a knockout round again', [[BSD_LINE, "if (_hit.group_name) _g.round = _hit.group_name;"]]],
  ['BSD group_name is never read', [[BSD_LINE, "if (false) _g.round = _hit.group_name;"]]],
  ['the BSD guard tests the wrong variable', [[BSD_LINE, "if (_hit.group_name && !extractWCPhase(_hit.group_name)) _g.round = _hit.group_name;"]]],
  ['the sweep hands the writer no round', [["round: `Group ${g.group_id}`,", "round: '',"]]],
  ['the sweep names the wrong group', [["round: `Group ${g.group_id}`,", "round: 'Group A',"]]],
  ['the sweep drops the rows of the last groups', [["round: `Group ${g.group_id}`,", "round: g.group_id > 'H' ? '' : `Group ${g.group_id}`,"]]],
  ['the sweep swaps the teams of the synthetic game', [[SWEEP_TEAMS, "home: { name: g.away, score: g.home_score },\n                away: { name: g.home, score: g.away_score },"]]],
  ['the sweep ignores its tried marker', [["if (tried) { skipped++; continue; }", "if (false) { skipped++; continue; }"]]],
];

function mutate() {
  const base = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 180000 });
  if (base.status !== 0) { console.log('BASELINE RED: mutations not run.\n' + base.stdout + base.stderr); return 1; }
  let bad = 0;
  for (const [name, edits] of MUTATIONS) {
    let text = readFileSync(INDEX, 'latin1'), why = null;
    for (const [from, to] of edits) {
      const at = text.indexOf(from);
      if (at < 0 || text.indexOf(from, at + 1) >= 0) { why = at < 0 ? 'missing' : 'not unique'; break; }
      text = text.slice(0, at) + to + text.slice(at + from.length);
    }
    if (why) { console.log(`  ANCHOR     ${name} (${why}): not run`); bad++; continue; }
    const mutant = path.join(path.dirname(INDEX), `.mutant-${process.pid}-wc-knockout-index.js`);
    writeFileSync(mutant, text, 'latin1');
    try {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 180000, env: { ...process.env, INDEX_MODULE: mutant } });
      const fails = (r.stdout.match(/^  FAIL (.*)$/gm) || []).map(l => l.slice(7));
      if (r.status !== 0 && /SELF-TEST FAILED/.test(r.stdout) && fails.length) {
        console.log(`  CAUGHT     ${name}\n               by: ${fails.slice(0, 3).join(' | ')}${fails.length > 3 ? ` | (+${fails.length - 3} more)` : ''}`);
      } else if (r.status === 0) {
        console.log(`  NOT CAUGHT ${name}`); bad++;
      } else {
        console.log(`  HARNESS ERROR ${name} (exit ${r.status}, no failing assertion)\n${(r.stderr || '').slice(0, 400)}`); bad++;
      }
    } finally { unlinkSync(mutant); }
  }
  console.log(`\nmutations: ${MUTATIONS.length - bad} of ${MUTATIONS.length} caught`);
  return bad ? 1 : 0;
}

if (process.argv.includes('--mutate')) process.exit(mutate());
else process.exit(await selfTest() ? 1 : 0);
