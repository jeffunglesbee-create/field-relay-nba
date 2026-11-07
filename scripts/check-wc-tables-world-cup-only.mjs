#!/usr/bin/env node
// The World Cup tables hold the World Cup, and only the World Cup.
// docs/CC-CMD-2026-11-07-wc-results-club-contamination.md.
//
// WHY. writeWCResult ran for EVERY soccer game that reached `final` on /v2/games, and the live loop read the World Cup
// group table for every live soccer game; the only gate excluded baseball, football, basketball and Australian football.
// Measured 2026-11-07 on production D1 (WC2026_DB): wc_results held 58 phase='third' rows dated 2026-08-11..09-16 (UEFA
// "Third Qualifying Round" ties, one Carabao Cup tie) and three 'final' rows dated May (club cup finals). The EFL Trophy's
// round string is "EFL Trophy, Group Southern Group F" and extractWCGroup takes the first `Group <A-L>` it finds, so on this
// worker with a stubbed ESPN an EFL Trophy final is filed as World Cup Group F (and rewrites that group's standings) and a
// LIVE EFL Trophy game reads World Cup Group F's standings and is stamped with an advancement probability from them. No club
// row is in production's wc_group (every team there is a World Cup team, read 2026-11-07): that path was open and
// unobserved. A different defect, NOT fixed here, put World Cup teams into other groups' standings (see the CC-CMD).
//
// WHAT THIS RUNS. The REAL worker (src/index.js default export) on GET /v2/games against a stubbed ESPN, one request per
// case, with a stub WC2026_DB that records every statement. src/index.js imports @cloudflare/puppeteer, which this repo's
// CI does not install, so a resolve hook stubs that one package (the same hook scripts/check-v2-games-nba-board.mjs uses).
//
//   club cases   every soccer key V2_LEAGUES routes to ESPN (read from the source, not listed here, so a new competition is
//                covered the day it is registered), each at five rounds: "Cup, Final" (the knockout path, phase final),
//                "Third Qualifying Round" (phase third), "Quarterfinals", "Semifinals" and "Group Southern Group F" (the
//                GROUP path); and the real strings committed in the repo. A club final must write NOTHING to wc_results
//                and must not rewrite wc_group; a LIVE club game must not read wc_group.
//   controls     wc26 at every round the writer exists for: each must still write its result; a live wc26 game must still
//                read its group. Without them "writes nothing" would also describe a harness that never reached the writer.
//
// Coverage is printed with the result (Rule 91). NOT checked: the D1 rows already in production (a separate cleanup, needs
// the owner), the BracketDO and brief-queue side effects of the group path (the stub records D1 only), and any sport the
// ESPN branch does not serve.
//
//   node scripts/check-wc-tables-world-cup-only.mjs            # self-test
//   node scripts/check-wc-tables-world-cup-only.mjs --mutate   # Rule 90

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

// The keys V2_LEAGUES routes to ESPN's soccer scoreboard, evaluated from the source: { key, slug }. The selector is the runtime
// shape (an espnLeague slug, no espnSport and no espnSource, which route to the other sports' adapters), not the sport label, so a
// soccer-adapter key filed under another label is still exercised.
function soccerKeys() {
  const src = readFileSync(INDEX, 'utf8');
  const i = src.indexOf('const V2_LEAGUES = {');
  const j = src.indexOf('\n};', i);
  if (i < 0 || j < 0) throw new Error('V2_LEAGUES not found in src/index.js');
  const v2 = new Function(`${src.slice(i, j + 3)}\nreturn V2_LEAGUES;`)();
  return Object.entries(v2).filter(([, c]) => typeof c.espnLeague === 'string' && !c.espnSport && !c.espnSource).map(([key, c]) => ({ key, slug: c.espnLeague }));
}

let seq = 770000;
const ev = (round, home, away, state = 'final') => {
  const fin = state === 'final';
  return { id: String(seq++), date: `${DATE}T19:00Z`,
    competitions: [{ ...(round ? { altGameNote: round } : {}),
      status: { type: fin ? { completed: true, state: 'post', name: 'STATUS_FULL_TIME' } : { completed: false, state: 'in', name: 'STATUS_FIRST_HALF' },
        clock: fin ? 5400 : 1800, displayClock: fin ? "90'" : "30'" },
      competitors: [
        { homeAway: 'home', score: '2', team: { id: `h${seq}`, displayName: home, abbreviation: home.slice(0, 3).toUpperCase() } },
        { homeAway: 'away', score: '1', team: { id: `a${seq}`, displayName: away, abbreviation: away.slice(0, 3).toUpperCase() } },
      ] }] };
};

// The stub answers only the league slug that was asked for (`/soccer/<slug>/scoreboard`), so a key whose slug is wrong gets a 404 and
// its game never reaches 'final': the 'reached final' assertion then fails instead of passing on a request that never arrived.
function stubUpstreams(events, slug) {
  globalThis.fetch = async (input) => {
    const url = String(input?.url ?? input);
    if (url.includes(`/soccer/${slug}/scoreboard?dates=`)) return Response.json({ events });
    return new Response('{}', { status: 404 });
  };
}

/** One /v2/games request against the real worker. Returns what the WC2026_DB stub saw. */
// Four teams for the group the live World Cup control reads, so computeAdvancementProb has standings to work from.
const GROUP_F = ['Netherlands', 'Japan', 'Sweden', 'Tunisia'].map((team, i) => ({ group_id: 'F', team, played: 2, won: 1 - (i > 1 ? 1 : 0), drawn: 0, lost: 1, gf: 3 - i, ga: 2, gd: 1 - i, points: 3 - i }));
async function request(worker, sport, events, slug) {
  stubUpstreams(events, slug);
  const stmts = [];
  const mk = (sql) => {
    const rec = { sql, binds: null };
    stmts.push(rec);
    const rows = /FROM wc_group WHERE group_id/.test(sql) ? GROUP_F : [];
    const s = { run: async () => ({ meta: { changes: 1 } }), first: async () => null, all: async () => ({ results: rows }), bind: (...a) => { rec.binds = a; return s; } };
    return s;
  };
  const env = { WC2026_DB: { prepare: mk } };
  const waits = [];
  const ctx = { waitUntil: p => waits.push(p), passThroughOnException() {} };
  const r = await worker.fetch(new Request(`http://relay.test/v2/games?sport=${sport}&date=${DATE}`), env, ctx);
  await Promise.allSettled(waits);
  let body = null;
  try { body = await r.json(); } catch (_) { /* not JSON: body stays null and is read below as "no games array", never as an empty slate */ }
  // A body with no games array is `null`, not an empty list: absence is its own value, and the callers below read it as "not final".
  const games = Array.isArray(body?.games) ? body.games : null;
  return {
    status: r.status, states: games ? games.map(g => g.state) : null,
    // A statement that INSERTS INTO wc_results. Not /INSERT[\s\S]*wc_results/: recomputeGroupStandings' `INSERT INTO wc_group ... SELECT ...
    // FROM wc_results` matched that, so dropping the writer's own INSERT left this count unchanged (found by review, mutation w1).
    inserts: stmts.filter(s => /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+wc_results/i.test(s.sql)).length,
    advancementStamped: games ? games.filter(g => g.advancementProb).length : null,
    groupRewrites: stmts.filter(s => /DELETE FROM wc_group/.test(s.sql)).length,
    groupReads: stmts.filter(s => /FROM wc_group WHERE group_id/.test(s.sql)).length,
  };
}

const CLUB_ROUNDS = ['Cup, Final', 'Third Qualifying Round', 'Quarterfinals', 'Semifinals', 'Group Southern Group F'];
// The real strings committed in the repo: the EFL Trophy's group round (outbox/cc-session-2026-08-08-followup-closeout.md) and
// the FA Cup's (the 2026-11-06 /v2/games?sport=facup answer, outbox/cc-session-2026-11-07-lineup-join-and-fa-cup.md).
const REAL_CLUB = [['efltrophy', 'EFL Trophy, Group Southern Group F'], ['facup', 'English FA Cup, First Round'], ['facup', 'English FA Cup, Final'], ['facup', 'English FA Cup, Third Round']];
const WC_ROUNDS = ['Group A', 'Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Final'];

async function selfTest() {
  let failed = 0;
  const eq = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  };
  const worker = (await import(pathToFileURL(INDEX_MODULE).href)).default;
  const keys = soccerKeys().filter(k => k.key !== 'wc26');
  eq('the soccer keys were read from V2_LEAGUES (not an empty list)', keys.length >= 18 && keys.some(k => k.key === 'facup') && keys.some(k => k.key === 'efltrophy'), true);

  // Club finals: nothing reaches the World Cup tables.
  const written = [], notFinal = [];
  let clubCases = 0;
  const run = async (key, slug, round) => {
    clubCases++;
    const r = await request(worker, key, [ev(round, `Home ${key}`, `Away ${key}`)], slug);
    if (String(r.states) !== 'final') notFinal.push(`${key}:${round}`);
    if (r.inserts || r.groupRewrites) written.push(`${key}:${round} (${r.inserts} insert, ${r.groupRewrites} group rewrite)`);
  };
  for (const { key, slug } of keys) for (const round of CLUB_ROUNDS) await run(key, slug, round);
  for (const [key, round] of REAL_CLUB) await run(key, keys.find(k => k.key === key)?.slug, round);
  eq(`every club game reached 'final' on the board (the harness is exercising the writer's branch), ${clubCases} cases`, notFinal, []);
  eq('no club final is written to wc_results or rewrites wc_group', written, []);

  // A LIVE club game touches nothing of the World Cup's: no group read, no advancement stamp, no result written (a live loop that wrote
  // results, or stamped an advancement probability from the World Cup's standings, would be invisible to a final-only case).
  const liveTouched = [];
  let liveCases = 0;
  for (const key of ['efltrophy', 'facup', 'ucl']) {
    const slug = keys.find(k => k.key === key)?.slug;
    for (const round of [...CLUB_ROUNDS, 'English FA Cup, First Round', 'Group F']) {
      liveCases++;
      const r = await request(worker, key, [ev(round, 'Barnet', 'Arsenal U21', 'live')], slug);
      if (r.groupReads || r.inserts || r.groupRewrites || r.advancementStamped) liveTouched.push(`${key}:${round} (reads ${r.groupReads}, inserts ${r.inserts}, stamped ${r.advancementStamped})`);
    }
  }
  eq(`a live club game reads no World Cup group, stamps no advancement probability and writes no result (${liveCases} cases)`, liveTouched, []);

  // Controls: the World Cup itself is untouched.
  const missing = [];
  for (const round of WC_ROUNDS) {
    const r = await request(worker, 'wc26', [ev(round, 'Mexico', 'South Africa')], 'fifa.world');
    if (String(r.states) !== 'final' || r.inserts < 1) missing.push(round);
  }
  eq(`control: every World Cup round still INSERTS its result into wc_results (${WC_ROUNDS.length} rounds)`, missing, []);
  const wcLive = await request(worker, 'wc26', [ev('Group F', 'Netherlands', 'Japan', 'live')], 'fifa.world');
  eq('control: a live World Cup game still reads its group and is stamped with an advancement probability', [wcLive.groupReads > 0, wcLive.advancementStamped], [true, 1]);
  eq('control: a live World Cup game writes no result (only a final does)', wcLive.inserts, 0);
  const wcGroup = await request(worker, 'wc26', [ev('Group A', 'Mexico', 'South Africa')], 'fifa.world');
  eq('control: a World Cup group final still rewrites its group standings', wcGroup.groupRewrites > 0, true);

  console.log(`\nCOVERAGE: ${clubCases} club final cases (${keys.length} soccer keys read from V2_LEAGUES x ${CLUB_ROUNDS.length} rounds, plus ${REAL_CLUB.length} real strings), ${liveCases} live club cases, ${WC_ROUNDS.length + 3} World Cup control requests (six rounds as finals, a live game, a group final). D1 statements only: the BracketDO and brief-queue effects of the group path, and the rows already in production, are not checked.`);
  console.log(failed ? `SELF-TEST FAILED: ${failed}` : 'self-test passed');
  return failed;
}

// [name, [[from, to], ...]]. Every anchor must occur exactly once, or the mutation is not run and the gate fails
// (Rule 90's corollary: NOT CAUGHT with nothing applied is worse than no test).
const FINALS_GATE = "if (env.WC2026_DB && cfg.espnLeague === 'fifa.world') {\n            const finals = games.filter(g => g.state === 'final');";
const LIVE_GATE = "if (env.WC2026_DB && cfg.espnLeague === 'fifa.world') {\n                const gLetter = extractWCGroup(";
const MUTATIONS = [
  ['the writer takes every final again', [[FINALS_GATE, "if (env.WC2026_DB) {\n            const finals = games.filter(g => g.state === 'final');"]]],
  ['the writer takes no final', [[FINALS_GATE, "if (env.WC2026_DB && false) {\n            const finals = games.filter(g => g.state === 'final');"]]],
  ['the writer keys on cfg.sport and drops the World Cup', [[FINALS_GATE, "if (env.WC2026_DB && cfg.sport === 'soccer') {\n            const finals = games.filter(g => g.state === 'final');"]]],
  ['the writer gate is inverted', [[FINALS_GATE, "if (env.WC2026_DB && cfg.espnLeague !== 'fifa.world') {\n            const finals = games.filter(g => g.state === 'final');"]]],
  ['the writer gate names the wrong slug', [[FINALS_GATE, "if (env.WC2026_DB && cfg.espnLeague === 'fifa.worldq') {\n            const finals = games.filter(g => g.state === 'final');"]]],
  ['the old gate comes back (only non-soccer sports excluded)', [[FINALS_GATE, "if (env.WC2026_DB && !V2_NON_SOCCER_WP_SPORTS.includes(cfg.espnSport)) {\n            const finals = games.filter(g => g.state === 'final');"]]],
  ['the live loop reads the group table for every live soccer game again', [[LIVE_GATE, "if (env.WC2026_DB) {\n                const gLetter = extractWCGroup("]]],
  ['the live loop never reads the group table', [[LIVE_GATE, "if (env.WC2026_DB && false) {\n                const gLetter = extractWCGroup("]]],
  ['a live World Cup game is never stamped with an advancement probability', [["if (standings?.length) {", "if (false) {"]]],
  ['every game, live ones included, is handed to the writer', [["const finals = games.filter(g => g.state === 'final');", "const finals = games;"]]],
  ['the group-path result INSERT is dropped from writeWCResult', [["    await db.prepare(`\n      INSERT OR IGNORE INTO wc_results\n        (game_id, group_id, home, away, home_score, away_score, phase, match_date)\n      VALUES (?, ?, ?, ?, ?, ?, 'group', ?)\n    `).bind(game.id, groupId,", "    await db.prepare(`\n      UPDATE wc_results SET home = home WHERE game_id = ? AND ? AND ? AND ? AND ? AND ? AND ? AND ?\n    `).bind(game.id, groupId,"]]],
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
    const mutant = path.join(path.dirname(INDEX), `.mutant-${process.pid}-wc-tables-index.js`);
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
