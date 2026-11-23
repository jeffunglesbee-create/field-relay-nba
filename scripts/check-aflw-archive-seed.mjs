#!/usr/bin/env node
// The AFLW archive step: an AFLW match gets a row in the archive, and the step can never break the journalism cycle.
// docs/CC-CMD-2026-11-22-aflw-live-source.md, Task 3.
//
// WHY. The laboratory's cards come only from /context/date, which reads only the archive. The cron's LEAGUES table is an ESPN
// scoreboard walk and ESPN serves no AFLW, so without this step /v2/games?sport=aflw (Task 2) has no card to join. seedAflwArchive
// reads the day's matches from aflapi and POSTs them to the relay's own /archive/game, the route the ESPN catch-up already uses.
// What can go wrong, and each is held below:
//   - a duplicate or a re-write every tick (one D1 read decides; a settled match costs no write),
//   - a failed D1 read read as "no row" (it must skip: a duplicate is worse than a late row),
//   - a bare numeric source_id (the route keys its id on one as an ESPN event id; an aflapi id is not one),
//   - a pre-game row that carries scores, or a final that carries none,
//   - an aflapi refusal, a thrown fetch or a failing route breaking the cycle that called it (Rule 5: it never throws),
//   - the step not being called, or called outside a try/catch.
//
// It drives the REAL exported seedAflwArchive from src/index.js against a stubbed aflapi, a stubbed D1 and a stubbed fetch, with
// the real bodies of outbox/aflapi-aflw-fixtures-20261123.json (DERIVED items are a real item with one field changed, as in
// scripts/check-v2-games-aflw.mjs). Case R then sends the body it produced to the REAL /archive/game route of the same worker
// against a stub D1 and reads the id and the columns the route would write.
//
// Coverage, printed with the result (Rule 91): the case ids in CASES, counted from the cases that ran. Not checked: a real D1 (the
// stub records binds; it does not enforce the schema), the cycle itself (case W reads the source for the call site and its try/catch,
// it does not run handleJournalismCycle), what /context/date returns for the row (a deployed read, Task 3's done condition D2b).
//
//   node scripts/check-aflw-archive-seed.mjs            # self-test
//   node scripts/check-aflw-archive-seed.mjs --mutate   # Rule 90

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
const FIXTURES = JSON.parse(readFileSync(path.resolve(HERE, '../outbox/aflapi-aflw-fixtures-20261123.json'), 'utf8'));

const [M8988, M8884] = FIXTURES.matches.matches;
const M9081 = FIXTURES.scheduled;
const withFields = (m, f) => ({ ...m, ...f });
const M_SAME_DAY_EARLY = withFields(M9081, { id: 9082, utcStartTime: '2026-11-27T06:00:00.000+0000' });   // DERIVED
const M_LIVE = withFields(M9081, { id: 9100, status: 'LIVE', utcStartTime: '2026-11-26T07:00:00.000+0000' }); // DERIVED, not an aflapi spelling anyone has read
const ALL = [M8988, M8884, M9081, M_SAME_DAY_EARLY, M_LIVE];

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';

// aflapiMode: 'ok' | '403' | 'throw'.  archiveMode: 'ok' | '500' | 'throw'.
function stubFetch(log, aflapiMode = 'ok', archiveMode = 'ok') {
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input);
    if (url.startsWith('https://aflapi.afl.com.au/')) {
      if (aflapiMode === 'throw') throw new Error('network down');
      if (aflapiMode === '403') return new Response('Access Denied', { status: 403 });
      if (url.includes('/compseasons')) return Response.json(FIXTURES.compseasons);
      if (url.includes('/afl/v2/matches')) return Response.json({ meta: { code: 200, pagination: { page: 0, numPages: 1, pageSize: 200, numEntries: ALL.length } }, matches: ALL });
    }
    if (url === `${RELAY}/archive/game`) {
      log.push({ url, method: init?.method, headers: init?.headers, body: JSON.parse(init?.body ?? '{}') });
      if (archiveMode === 'throw') throw new Error('route unreachable');
      if (archiveMode === '500') return new Response('{"ok":false}', { status: 500 });
      return Response.json({ ok: true });
    }
    return new Response('{}', { status: 404 });
  };
}
// rows: Map espn_event_id -> { home_score }.  mode 'ok' | 'dbfail'.
const envStub = (rows = new Map(), mode = 'ok') => ({
  ARCHIVE_DB: { prepare: () => ({ bind: id => ({ first: async () => { if (mode === 'dbfail') throw new Error('D1 down'); return rows.has(id) ? rows.get(id) : null; } }) }) },
});

const CASES = ['N', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'R', 'W'];
const seenCases = new Set();
async function selfTest() {
  let failed = 0, assertions = 0;
  const eq = (name, got, want) => {
    assertions++; seenCases.add(name.split(' ')[0]);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  };
  const silenced = async fn => { const e = console.error, l = console.log; console.error = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; } };

  const mod = await import(pathToFileURL(INDEX_MODULE).href);
  const seed = mod.seedAflwArchive;
  const run = async (dates, { rows, dbMode, aflapiMode, archiveMode } = {}) => {
    const log = []; stubFetch(log, aflapiMode, archiveMode);
    let result, threw = null;
    try { result = await silenced(() => seed(envStub(rows, dbMode), dates)); } catch (e) { threw = e.message; }
    return { result, threw, posts: log };
  };
  const body = (r, id) => r.posts.map(p => p.body).find(b => b.source_id === `aflapi:${id}`) ?? null;

  eq('N the exported step exists and the fixtures are what was read', [typeof seed, M9081.status, M8988.status], ['function', 'SCHEDULED', 'CONCLUDED']);

  // S1: a day with two pre games and no rows: both are seeded, with no score and a minute-precision start.
  const s1 = await run(['2026-11-27']);
  eq('S1 two pre games with no row are each POSTed to the relay own /archive/game, in start order', s1.posts.map(p => [p.method, p.url, p.body.source_id]),
    [['POST', `${RELAY}/archive/game`, 'aflapi:9082'], ['POST', `${RELAY}/archive/game`, 'aflapi:9081']]);
  eq('S1 the Grand Final skeleton carries teams, venue, start and no score', body(s1, 9081), {
    sport: 'AFLW', league: 'AFLW', date: '2026-11-27', home: 'North Melbourne', away: 'Melbourne', home_score: null, away_score: null,
    venue: 'IKON Park', start_time: '2026-11-27T08:45Z', source_id: 'aflapi:9081', went_to_ot: null });
  eq('S1 the summary counts what it did', s1.result, { dates: 1, games: 2, seeded: 2, finalised: 0, settled: 0, errors: 0 });
  eq('S1 the POST says it is JSON', s1.posts[0]?.headers, { 'Content-Type': 'application/json' });

  // S2: both rows exist (skeletons): nothing is written.
  const s2 = await run(['2026-11-27'], { rows: new Map([['aflapi:9081', { home_score: null }], ['aflapi:9082', { home_score: null }]]) });
  eq('S2 a pre game whose row exists is not written again', [s2.posts.length, s2.result], [0, { dates: 1, games: 2, seeded: 0, finalised: 0, settled: 2, errors: 0 }]);

  // S3-S5: a CONCLUDED match.
  const s3 = await run(['2026-08-09']);
  eq('S3 a finished match with no row is written with its points and its own date', body(s3, 8988), {
    sport: 'AFLW', league: 'AFLW', date: '2026-08-09', home: 'St Kilda', away: 'Carlton', home_score: 40, away_score: 66,
    venue: 'Marvel Stadium', start_time: '2026-08-09T06:35Z', source_id: 'aflapi:8988', went_to_ot: null });
  const s4 = await run(['2026-08-09'], { rows: new Map([['aflapi:8988', { home_score: null }]]) });
  eq('S4 a finished match whose row is a skeleton gets its points', [s4.posts.length, body(s4, 8988)?.home_score, body(s4, 8988)?.away_score, s4.result.finalised], [1, 40, 66, 1]);
  const s5 = await run(['2026-08-09'], { rows: new Map([['aflapi:8988', { home_score: 40 }]]) });
  eq('S5 a finished match whose row already has a score is not written again', [s5.posts.length, s5.result.settled], [0, 1]);

  // S6: an aflapi refusal, a thrown fetch: nothing written, nothing thrown, counted.
  const s6a = await run(['2026-11-27', '2026-08-09'], { aflapiMode: '403' });
  eq('S6 an aflapi 403 writes nothing, does not throw, and is counted once per date', [s6a.threw, s6a.posts.length, s6a.result?.errors], [null, 0, 2]);
  const s6b = await run(['2026-11-27'], { aflapiMode: 'throw' });
  eq('S6 a thrown aflapi fetch writes nothing and does not throw', [s6b.threw, s6b.posts.length, s6b.result?.errors], [null, 0, 1]);

  // S7: a status nobody has read fails that date's board, named, and the next date still runs.
  const s7 = await run(['2026-11-26', '2026-11-27']);
  eq('S7 an unmapped status fails its own date only: no write for it, the next date is written',
    [s7.threw, s7.result?.errors, s7.posts.map(p => p.body.date)], [null, 1, ['2026-11-27', '2026-11-27']]);

  // S8: a failed D1 read skips the game; it is not read as "no row".
  const s8 = await run(['2026-11-27'], { dbMode: 'dbfail' });
  eq('S8 a failed D1 read skips the game: no duplicate write, no throw, counted', [s8.threw, s8.posts.length, s8.result?.errors], [null, 0, 2]);

  // S9: the route failing or unreachable: counted, not thrown, not claimed as written.
  const s9a = await run(['2026-11-27'], { archiveMode: '500' });
  eq('S9 a /archive/game 500 is counted as an error, not as a seeded row, and does not throw', [s9a.threw, s9a.result?.seeded, s9a.result?.errors], [null, 0, 2]);
  const s9b = await run(['2026-11-27'], { archiveMode: 'throw' });
  eq('S9 an unreachable /archive/game does not throw', [s9b.threw, s9b.result?.seeded, s9b.result?.errors], [null, 0, 2]);

  // S10: each date is written under its own date.
  const s10 = await run(['2026-08-09', '2026-08-13']);
  eq('S10 two dates in one call are each written under their own date', s10.posts.map(p => [p.body.source_id, p.body.date]), [['aflapi:8988', '2026-08-09'], ['aflapi:8884', '2026-08-13']]);

  // S11: the source id is never a bare number.
  eq('S11 every source_id is aflapi:<id>, never a bare numeric the route would key as an ESPN event id',
    [...s1.posts, ...s3.posts, ...s10.posts].every(p => /^aflapi:\d+$/.test(p.body.source_id) && !/^\d+$/.test(p.body.source_id)), true);

  // R: the body this step produces, sent to the REAL /archive/game route: the id and the columns the route writes.
  {
    const binds = [];
    const dbStmt = { run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) };
    const env = { ARCHIVE_DB: { prepare: sql => ({ ...dbStmt, bind: (...a) => { binds.push({ sql, a }); return dbStmt; } }) } };
    const waits = []; const ctx = { waitUntil: p => waits.push(p), passThroughOnException() {} };
    const worker = mod.default;
    const resp = await silenced(() => worker.fetch(new Request(`${RELAY}/archive/game`, { method: 'POST', body: JSON.stringify(body(s1, 9081)) }), env, ctx));
    await Promise.allSettled(waits);
    const ins = binds.find(b => /INSERT INTO regular_season_games/.test(b.sql));
    eq('R the real route accepts the body and writes one regular_season_games row', [resp.status, !!ins], [200, true]);
    eq('R the id is AFLW_<date>_<home>_<away> (the name scheme: the source id is not an ESPN event id), the sport and league are AFLW, the id column holds aflapi:9081, the start is kept',
      ins && { id: ins.a[0], sport: ins.a[1], league: ins.a[2], date: ins.a[3], home: ins.a[4], away: ins.a[5], hs: ins.a[6], as: ins.a[7], venue: ins.a[8], source: ins.a[12], start: ins.a[14] },
      { id: 'AFLW_2026-11-27_northmelbourne_melbourne', sport: 'AFLW', league: 'AFLW', date: '2026-11-27', home: 'North Melbourne', away: 'Melbourne', hs: null, as: null, venue: 'IKON Park', source: 'aflapi:9081', start: '2026-11-27T08:45Z' });
  }

  // W: the step is wired into the journalism cycle, once, inside a try/catch.
  {
    const src = readFileSync(INDEX_MODULE, 'latin1');
    const calls = [...src.matchAll(/await seedAflwArchive\(env, aflwDays\)/g)];
    const at = calls.length === 1 ? calls[0].index : -1;
    const before = at >= 0 ? src.slice(Math.max(0, at - 400), at) : '';
    const after = at >= 0 ? src.slice(at, at + 600) : '';
    eq('W the cycle calls seedAflwArchive exactly once, inside a try with a catch that logs, for today and the next three ET days',
      [calls.length, /try \{\s*const aflwDays = \[0, 1, 2, 3\]\.map\(n => new Date\(Date\.parse\(`\$\{dateKey\}T12:00:00Z`\) \+ n \* 86400000\)/.test(before), /catch \(e\) \{ console\.error\("\[AFLW-ARCHIVE\] step failed:"/.test(after)], [1, true, true]);
  }

  const missing = CASES.filter(c => !seenCases.has(c));
  if (missing.length) { failed++; console.log(`  FAIL coverage: case ${missing.join(', ')} did not run`); }
  console.log(`\nchecked ${CASES.length - missing.length} of ${CASES.length} cases (${assertions} assertions) of the AFLW archive step: a skeleton, a settled skeleton, a final, a finished skeleton, a settled final, an aflapi refusal, an unmapped status, a failed D1 read, a failing route, dates, the source id, the real route, the cycle wiring. Not checked: a real D1, the cycle itself, /context/date.`);
  console.log(failed ? `SELF-TEST FAILED: ${failed}` : 'self-test passed');
  return failed;
}

// [name, [[from, to], ...]]. Every anchor must occur exactly once, or the mutation is not run and the gate
// fails (Rule 90's corollary: a mutation that applied nothing is worse than no test).
const MUTATIONS = [
  ['a pre game is written every tick', [["if (g.state === 'pre' && hasRow) { out.settled++; continue; }", "if (false) { out.settled++; continue; }"]]],
  ['a scored final is written every tick', [["if (g.state === 'final' && scored) { out.settled++; continue; }", "if (false) { out.settled++; continue; }"]]],
  ['a pre game carries a zero score', [["home_score: g.state === 'final' ? g.home.score : null,", "home_score: g.state === 'final' ? g.home.score : 0,"]]],
  ['a final carries no score', [["away_score: g.state === 'final' ? g.away.score : null,", "away_score: null,"]]],
  ['the source id is a bare number', [["const sourceId = `aflapi:${g.aflapiMatchId}`;", "const sourceId = String(g.aflapiMatchId);"]]],
  ['a failed D1 read is read as no row', [["dedup read failed, skipping this game to avoid a duplicate write:`, e.message); continue; }", "dedup read failed, skipping this game to avoid a duplicate write:`, e.message); existing = null; }"]]],
  ['an aflapi refusal throws out of the step', [["board not read, nothing written:`, e.message); continue; }", "board not read, nothing written:`, e.message); throw e; }"]]],
  ['every match is written under the first date', [["sport: 'AFLW', league: 'AFLW', date,", "sport: 'AFLW', league: 'AFLW', date: dates[0],"]]],
  ['the label is the men\'s', [["sport: 'AFLW', league: 'AFLW', date,", "sport: 'AFL', league: 'AFL', date,"]]],
  ['the start keeps its seconds', [["start_time: g.start.replace(/:\\d{2}\\.\\d{3}Z$/, 'Z'),", "start_time: g.start,"]]],
  ['a failing route is counted as seeded', [["if (!r.ok) { out.errors++; console.error(`[AFLW-ARCHIVE] ${sourceId}: /archive/game answered ${r.status}, will retry next cycle`); continue; }", ""]]],
  ['home and away are swapped', [["home: g.home.name, away: g.away.name,", "home: g.away.name, away: g.home.name,"]]],
  ['an unreachable route throws out of the step', [["archive write failed, will retry next cycle:`, e.message); }", "archive write failed, will retry next cycle:`, e.message); throw e; }"]]],
  ['the cycle no longer calls the step', [["const aflw = await seedAflwArchive(env, aflwDays);", "const aflw = { seeded: 0, finalised: 0, errors: 0 };"]]],
  ['the cycle seeds only today', [["await seedAflwArchive(env, aflwDays)", "await seedAflwArchive(env, [dateKey])"]]],
  ['the cycle looks ahead only one day', [["const aflwDays = [0, 1, 2, 3].map(", "const aflwDays = [0, 1].map("]]],
];

function mutate() {
  const base = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' });
  if (base.status !== 0) { console.log('BASELINE RED: mutations not run.\n' + base.stdout + base.stderr); return 1; }
  let bad = 0;
  const original = readFileSync(INDEX, 'latin1');
  for (const [name, edits] of MUTATIONS) {
    let text = original, why = null;
    for (const [from, to] of edits) {
      const at = text.indexOf(from);
      if (at < 0 || text.indexOf(from, at + 1) >= 0) { why = at < 0 ? 'missing' : 'not unique'; break; }
      text = text.slice(0, at) + to + text.slice(at + from.length);
    }
    if (why) { console.log(`  ANCHOR     ${name} (${why}): not run`); bad++; continue; }
    if (text === original) { console.log(`  ANCHOR     ${name} (applied nothing): not run`); bad++; continue; }
    const mutant = path.join(path.dirname(INDEX), `.mutant-${process.pid}-aflw-archive-index.js`);
    writeFileSync(mutant, text, 'latin1');
    try {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', env: { ...process.env, INDEX_MODULE: mutant } });
      const fails = (r.stdout.match(/^  FAIL (\S+)/gm) || []).map(l => l.slice(7));
      if (r.status !== 0 && /SELF-TEST FAILED/.test(r.stdout) && fails.length) {
        console.log(`  CAUGHT     ${name}\n               by: ${[...new Set(fails)].join(' ')}`);
      } else if (r.status === 0) {
        console.log(`  NOT CAUGHT ${name}`); bad++;
      } else {
        console.log(`  HARNESS ERROR ${name} (exit ${r.status}, no failing assertion)\n${(r.stderr || '').slice(0, 400)}`); bad++;
      }
    } finally { unlinkSync(mutant); }
  }
  console.log(`\nmutations: ${MUTATIONS.length - bad} of ${MUTATIONS.length} caught (exit 0 when all are caught, 1 otherwise)`);
  return bad ? 1 : 0;
}

if (process.argv.includes('--mutate')) process.exit(mutate());
else process.exit(await selfTest() ? 1 : 0);
