#!/usr/bin/env node
// The NBA board on /v2/games is ESPN's, and a failed read is not an empty slate.
// docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md, TASK 1 and done condition 3.
//
// WHY. The board came from cdn.nba.com, which answers the Worker 403 in season
// while it serves a GitHub runner 200 with the same headers (runner probe
// 2026-10-24, outbox/nba-cdn-egress-probe-20261024T112626Z.log). The old branch
// turned ANY non-OK answer into a 200 `{games: [], source: 'nba-cdn-empty'}`,
// so a refusal read as a day with no games: AmbientDO saw no NBA kickoff and
// bought no NBA closing line, ever (0 closing_odds_capture rows for NBA).
//
// This runs the REAL worker (src/index.js default export) on GET /v2/games
// against a stubbed ESPN. src/index.js imports @cloudflare/puppeteer, which
// this repo's CI does not install, so a resolve hook stubs that one package.
//
// Coverage, printed with the result (Rule 91): sport=nba on the ESPN branch,
// breaks read by ESPN's type.state, WNBA's final word as the control for NBA's,
// and the WC writer's sport guard with EPL and wc26 as its controls. Not
// checked: the /nba/* passthrough and its readers, which do not read
// /v2/games; the status NAME live ESPN uses for an NBA break (the mapping
// keys on type.state 'in', so the name does not decide it).
//
//   node scripts/check-v2-games-nba-board.mjs            # self-test
//   node scripts/check-v2-games-nba-board.mjs --mutate   # Rule 90

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
// A past date, so it is never the runner's today: a branch that ignores ?date
// and asks for today is then seen (N0 asserts it).
const DATE = '2025-11-07';

// ESPN scoreboard events, the fields adaptESPNBasketball and adaptESPNWCSoccer
// read. Real ids and names from the 2026-10-24 slate.
const bball = (id, name, state, home, away, extra = {}) => ({
  id, date: `${DATE}T23:00Z`,
  competitions: [{ status: { period: extra.period ?? 0, displayClock: extra.clock ?? '0.0', type: { name, state } },
    competitors: [
      { homeAway: 'home', score: String(extra.hs ?? 0), team: { displayName: home, abbreviation: home.slice(0, 3).toUpperCase() } },
      { homeAway: 'away', score: String(extra.as ?? 0), team: { displayName: away, abbreviation: away.slice(0, 3).toUpperCase() } },
    ] }],
});
const NBA_EVENTS = [
  bball('401909853', 'STATUS_SCHEDULED', 'pre', 'Charlotte Hornets', 'Washington Wizards'),
  bball('401909854', 'STATUS_IN_PROGRESS', 'in', 'Boston Celtics', 'New York Knicks', { period: 2, clock: '4:12', hs: 51, as: 48 }),
  bball('401909855', 'STATUS_FINAL', 'post', 'Indiana Pacers', 'Dallas Mavericks', { period: 4, hs: 112, as: 104 }),
  bball('401909856', 'STATUS_HALFTIME', 'in', 'Orlando Magic', 'Minnesota Timberwolves', { period: 2, hs: 55, as: 52 }),
  bball('401909857', 'STATUS_END_PERIOD', 'in', 'Chicago Bulls', 'Washington Wizards', { period: 3, hs: 80, as: 77 }),
  bball('401909858', 'STATUS_POSTPONED', 'post', 'Toronto Raptors', 'Brooklyn Nets'),
];
const WNBA_EVENTS = [bball('401857070', 'STATUS_FINAL', 'post', 'Las Vegas Aces', 'Seattle Storm', { period: 4, hs: 88, as: 80 })];
const EPL_EVENTS = [{ id: '740001', date: `${DATE}T15:00Z`,
  competitions: [{ status: { type: { completed: true, state: 'post', name: 'STATUS_FULL_TIME' }, displayClock: "90'" },
    competitors: [
      { homeAway: 'home', score: '2', team: { displayName: 'Arsenal', abbreviation: 'ARS' } },
      { homeAway: 'away', score: '1', team: { displayName: 'Chelsea', abbreviation: 'CHE' } },
    ] }] }];
// A World Cup group match: the one league writeWCResult serves.
const WC_EVENTS = [{ id: '760001', date: `${DATE}T19:00Z`,
  competitions: [{ altGameNote: 'Group A', status: { type: { completed: true, state: 'post', name: 'STATUS_FULL_TIME' }, displayClock: "90'" },
    competitors: [
      { homeAway: 'home', score: '2', team: { displayName: 'Mexico', abbreviation: 'MEX' } },
      { homeAway: 'away', score: '0', team: { displayName: 'South Africa', abbreviation: 'RSA' } },
    ] }] }];

// mode: 'ok' serves the events; 'empty' serves none; '403' refuses; 'throw' fails the fetch.
function stubUpstreams(mode, seen) {
  globalThis.fetch = async (input) => {
    const url = String(input?.url ?? input);
    seen.push(url);
    if (url.includes('/scoreboard?dates=')) {
      if (mode === 'throw') throw new Error('network down');
      if (mode === '403') return new Response('Access Denied', { status: 403 });
      if (mode === 'empty') return Response.json({ events: [] });
      if (url.includes('/basketball/nba/')) return Response.json({ events: NBA_EVENTS });
      if (url.includes('/basketball/wnba/')) return Response.json({ events: WNBA_EVENTS });
      if (url.includes('/soccer/eng.1/')) return Response.json({ events: EPL_EVENTS });
      if (url.includes('/soccer/fifa.world/')) return Response.json({ events: WC_EVENTS });
    }
    return new Response('{}', { status: 404 });
  };
}

async function selfTest() {
  let failed = 0;
  const eq = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  };

  const seen = [];
  stubUpstreams('ok', seen);
  const worker = (await import(pathToFileURL(INDEX_MODULE).href)).default;
  const get = async (sport, mode) => {
    seen.length = 0;
    stubUpstreams(mode, seen);
    const waits = [];
    let wcInserts = 0;
    const stmt = { run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) };
    const env = { WC2026_DB: { prepare: (sql) => {
      if (/INSERT[\s\S]*wc_results/.test(sql)) wcInserts++;
      return { ...stmt, bind: () => stmt };
    } } };
    const ctx = { waitUntil: p => waits.push(p), passThroughOnException() {} };
    const r = await worker.fetch(new Request(`http://relay.test/v2/games?sport=${sport}&date=${DATE}`), env, ctx);
    await Promise.allSettled(waits);
    let body = null;
    try { body = await r.json(); } catch (_) { /* not JSON */ }
    return { status: r.status, body, urls: [...seen], waits: waits.length, wcInserts };
  };

  // N1-N3: the board serves the day's games from ESPN, in the shape AmbientDO's
  // closing capture reads (league must equal the archive's sport, espnEventId
  // must equal its espn_event_id).
  eq("N0 the fixture date is not the runner's today", DATE === new Date().toISOString().slice(0, 10), false);
  const ok = await get('nba', 'ok');
  const g = (id) => (ok.body?.games ?? []).find(x => x.espnEventId === id) ?? null;
  eq('N1 a served day answers 200 with every game', [ok.status, ok.body?.count], [200, 6]);
  eq('N1 a scheduled game has the fields the closing capture reads',
    g('401909853') && { id: g('401909853').id, sport: g('401909853').sport, league: g('401909853').league,
      state: g('401909853').state, start: g('401909853').start, home: g('401909853').home.name },
    { id: 'espn:401909853', sport: 'nba', league: 'NBA', state: 'pre', start: `${DATE}T23:00Z`, home: 'Charlotte Hornets' });
  eq('N1 a game in progress is live', g('401909854')?.state, 'live');
  eq('N1 a halftime and an end of quarter are live, not pre',
    [[g('401909856')?.state, g('401909856')?.periodLabel], [g('401909857')?.state, g('401909857')?.periodLabel]], [['live', 'Q2'], ['live', 'Q3']]);
  eq('N1 a postponed game is neither final nor live', g('401909858')?.state, 'pre');
  eq("N1 an NBA final carries 'final', the word the client reads", [g('401909855')?.state, g('401909855')?.periodLabel], ['final', 'F']);
  eq('N2 the requested date is the one asked of ESPN',
    ok.urls.filter(u => u.includes('/scoreboard?dates=')).map(u => u.replace(/^https:\/\/[^/]+/, '')),
    [`/apis/site/v2/sports/basketball/nba/scoreboard?dates=${DATE.replace(/-/g, '')}`]);
  eq('N3 nothing is asked of cdn.nba.com', ok.urls.filter(u => u.includes('cdn.nba.com')), []);

  // N4-N6: done condition 3. A refusal and a failed fetch are errors, and only
  // an answered empty day is an empty slate.
  const refused = await get('nba', '403');
  eq('N4 an ESPN refusal is a 502 with the upstream status, not an empty slate',
    [refused.status, refused.body?.error, 'games' in (refused.body ?? {})], [502, 'ESPN upstream 403', false]);
  const empty = await get('nba', 'empty');
  eq('N5 an answered day with no games is a 200 empty slate', [empty.status, empty.body?.count, empty.body?.games], [200, 0, []]);
  const thrown = await get('nba', 'throw');
  eq('N6 a failed fetch is a 500, not an empty slate', [thrown.status, 'games' in (thrown.body ?? {})], [500, false]);

  // N7: the final word is NBA's alone; WNBA keeps 'post'.
  const wnba = await get('wnba', 'ok');
  eq("N7 a WNBA final still carries 'post'", (wnba.body?.games ?? []).map(x => x.state), ['post']);

  // N8: the WC writer is the branch's only waitUntil. An NBA final must not
  // reach it; an EPL final and a World Cup final still do, which shows the NBA
  // zero is not the harness failing to reach the writer, and the World Cup row
  // shows the guard keeps the one league the writer exists for.
  eq('N8 an NBA final is not handed to the WC writer', [ok.waits, ok.wcInserts], [0, 0]);
  const epl = await get('epl', 'ok');
  eq('N8 control: an EPL final is', [(epl.body?.games ?? []).map(x => x.state), epl.waits], [['final'], 1]);
  const wc = await get('wc26', 'ok');
  eq('N8 control: a World Cup group final is, and writes its result',
    [(wc.body?.games ?? []).map(x => x.state), wc.waits, wc.wcInserts > 0], [['final'], 1, true]);

  console.log(`\nchecked sport=nba on the ESPN branch (served, empty, refused, thrown; breaks and a postponement), WNBA's final word, and the WC writer guard with EPL and wc26 as controls`);
  console.log(failed ? `SELF-TEST FAILED: ${failed}` : 'self-test passed');
  return failed;
}

// [name, [[from, to], ...]]. Every anchor must occur exactly once, or the
// mutation is not run and the gate fails (Rule 90's corollary).
const MUTATIONS = [
  ['NBA goes back to a source the Worker cannot read', [[
    "'nba':          { sport: 'nba', espnLeague: 'nba', espnSport: 'basketball', season: '2025-2026' },",
    "'nba':          { sport: 'nba', nbaSource: 'cdn', season: '2025-2026' },"]]],
  ["NBA's final reads 'post'", [[
    "stt === 'STATUS_FINAL'                              ? (sportKey === 'nba' ? 'final' : 'post')",
    "stt === 'STATUS_FINAL'                              ? 'post'"]]],
  ["every basketball final reads 'final'", [[
    "stt === 'STATUS_FINAL'                              ? (sportKey === 'nba' ? 'final' : 'post')",
    "stt === 'STATUS_FINAL'                              ? 'final'"]]],
  ['an ESPN refusal becomes an empty slate again', [[
    "JSON.stringify({ error: `ESPN upstream ${espnResp.status}`, sport, date }),\n                        { status: 502,",
    "JSON.stringify({ sport, date, games: [], count: 0 }),\n                        { status: 200,"]]],
  ['the requested date is ignored', [[
    "const espnDate = date.replace(/-/g, '');\n        const _espnSportPath",
    "const espnDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');\n        const _espnSportPath"]]],
  ['the WC writer takes every final again', [[
    "if (env.WC2026_DB && !V2_NON_SOCCER_WP_SPORTS.includes(cfg.espnSport)) {",
    "if (env.WC2026_DB) {"]]],
  ['the WC writer keys on cfg.sport and drops the World Cup', [[
    "if (env.WC2026_DB && !V2_NON_SOCCER_WP_SPORTS.includes(cfg.espnSport)) {",
    "if (env.WC2026_DB && cfg.sport === 'soccer') {"]]],
  ['a break reads as pre again', [[
    "stt === 'STATUS_IN_PROGRESS' || st.type?.state === 'in' ? 'live'",
    "stt === 'STATUS_IN_PROGRESS' ? 'live'"]]],
  ['a postponed game reads as final', [[
    "stt === 'STATUS_FINAL'                              ? (sportKey === 'nba' ? 'final' : 'post')",
    "stt === 'STATUS_FINAL' || st.type?.state === 'post' ? (sportKey === 'nba' ? 'final' : 'post')"]]],
  ['the WC writer takes no final', [[
    "if (env.WC2026_DB && !V2_NON_SOCCER_WP_SPORTS.includes(cfg.espnSport)) {",
    "if (env.WC2026_DB && false) {"]]],
];

function mutate() {
  const base = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' });
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
    const mutant = path.join(path.dirname(INDEX), `.mutant-${process.pid}-nba-board-index.js`);
    writeFileSync(mutant, text, 'latin1');
    try {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', env: { ...process.env, INDEX_MODULE: mutant } });
      const fails = (r.stdout.match(/^  FAIL (.*)$/gm) || []).map(l => l.slice(7));
      if (r.status !== 0 && /SELF-TEST FAILED/.test(r.stdout) && fails.length) {
        console.log(`  CAUGHT     ${name}\n               by: ${fails.join(' | ')}`);
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
