#!/usr/bin/env node
// Which leagues the BSD club-league endgame capture reaches, and what it costs per match (CC-CMD-2026-08-08-efl-carabao-cup-coverage.md, "Addendum 2026-11-26: capture the
// Carabao Cup"; CC-CMD-2026-08-02-gate-bsd-club-league-capture.md for the cadence). The REAL functions are cut out of src/index.js (V2_LEAGUES, the league-id map, captureWithRetry,
// _bsdCaptureStatsWithAvgPositions, runBSDClubLeagueEndgameCapture) and run against a stub: a scripted /events/live/ answer, a recording R2 and a recording fetch. Nothing is
// reimplemented here, so a change to the function is a change to what this reads.
//
//   node scripts/check-bsd-club-capture-leagues.mjs [--source src/index.js] [--fail-fast]
// mutate-bsd-club-capture-leagues.mjs aims --source at broken copies and requires this check to go red.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const FAIL_FAST = argv.includes('--fail-fast');
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const SOURCE = path.resolve(flag('--source', 'src/index.js'));
const src = fs.readFileSync(SOURCE, 'utf8');

let n = 0, bad = 0;
const stable = (v) => JSON.stringify(v);
const eq = (label, got, want) => {
  n++;
  if (stable(got) !== stable(want)) { bad++; console.log(`FAIL  ${label}\n        got  ${stable(got)}\n        want ${stable(want)}`); if (FAIL_FAST) { console.log(`${bad} of ${n} FAILED`); process.exit(1); } }
};

// ---- cut the real code out of the worker
function grab(startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  if (i < 0) { console.log(`FAIL  marker not found in ${SOURCE}: ${startMarker}`); process.exit(1); }
  if (src.indexOf(startMarker, i + 1) >= 0) { console.log(`FAIL  marker found twice in ${SOURCE}: ${startMarker}`); process.exit(1); }
  const j = src.indexOf(endMarker, i);
  if (j < 0) { console.log(`FAIL  end marker not found after: ${startMarker}`); process.exit(1); }
  return src.slice(i, j + endMarker.length);
}
const code = [
  grab('const V2_LEAGUES = {', '\n};'),
  grab('async function captureWithRetry(', '\n}\n'),
  grab('async function _bsdCaptureStatsWithAvgPositions(', '\n}\n'),
  grab('const BSD_LEAGUE_ID_TO_SLUG = (() => {', '\n})();'),
  grab('async function runBSDClubLeagueEndgameCapture(env) {', '\n}\n'),
].join('\n');
const build = new Function('fetch', 'console', `${code}\nreturn { V2_LEAGUES, BSD_LEAGUE_ID_TO_SLUG, run: runBSDClubLeagueEndgameCapture };`);
const quiet = { log() {}, error() {}, warn() {} };

// ---- the registry: which BSD league ids are captured, and under which R2 directory name
const probe = build(() => { throw new Error('not called'); }, quiet);
const MAP = { 1: 'epl', 3: 'laliga', 4: 'seriea', 5: 'bundesliga', 6: 'ligue1', 7: 'ucl', 8: 'europa', 12: 'eflchamp', 18: 'mls', 40: 'eflcup' };
eq('the league-id map: every captured BSD league and its R2 directory (the first-listed slug wins a shared id)', probe.BSD_LEAGUE_ID_TO_SLUG, MAP);
eq('the Carabao Cup is slug eflcup, ESPN eng.league_cup, BSD league 40', [probe.V2_LEAGUES.eflcup.espnLeague, probe.V2_LEAGUES.eflcup.bsdLeagueId, probe.BSD_LEAGUE_ID_TO_SLUG[40]], ['eng.league_cup', 40, 'eflcup']);
eq('no other slug carries league 40, and the Trophy still has no BSD league', [Object.entries(probe.V2_LEAGUES).filter(([, c]) => c.bsdLeagueId === 40).map(([k]) => k), probe.V2_LEAGUES.efltrophy.bsdLeagueId], [['eflcup'], null]);
eq('the cups and lower leagues that have no BSD league id stay uncaptured (FA Cup, League One, League Two, EFL Trophy)', ['facup', 'eflone', 'efltwo', 'efltrophy'].map((s) => probe.V2_LEAGUES[s].bsdLeagueId), [null, null, null, null]);

// ---- the function, run for real against a scripted feed
const NOW = Date.now();
const iso = (minAgo) => new Date(NOW - minAgo * 60000).toISOString();
const ev = (id, league, status, minute, kickMinAgo = 100) => ({ id, league_id: league, status, current_minute: minute, home_team: `H${id}`, away_team: `A${id}`, event_date: iso(kickMinAgo) });
async function drive(events, { liveStatus = 200 } = {}) {
  const calls = [], puts = [];
  const fetchStub = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/api/v2/events/live/')) return { ok: liveStatus === 200, status: liveStatus, json: async () => ({ count: events.length, events }) };   // a non-200 still carries the events: only the guard keeps them out
    const body = new TextEncoder().encode(JSON.stringify({ url: String(url), average_positions: {} }));
    return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  };
  const env = { BSD_API_TOKEN: 'test-token', FIELD_DATA: { put: async (key, _buf, opts) => { puts.push({ key, type: opts?.customMetadata?.type, league: opts?.customMetadata?.league_id }); } } };
  const { run } = build(fetchStub, quiet);
  await run(env);
  return { calls, puts, keys: puts.map((p) => p.key).sort() };
}
const bsdCalls = (r, id) => r.calls.filter((c) => c.includes(`/events/${id}/`));

const live = await drive([
  ev(9001, 40, '2nd_half', 85),                  // a Carabao Cup match at 85': captured
  ev(9002, 40, 'finished', 90),                  // finished: never captured
  ev(9003, 999, '2nd_half', 85),                 // a league nobody asked for: never captured, never a garbage key
  ev(9004, 40, '1st_half', 30),                  // too early: not yet
  ev(9005, 40, 'notstarted', 0, 100),            // BSD has not updated the status, kickoff was 100 minutes ago: the fallback window
  ev(9006, 40, 'notstarted', 0, 10),             // not started and not in the window
  ev(9007, 18, '2nd_half', 88),                  // MLS: unchanged, under its own directory
  ev(9008, 40, 'notstarted', 0, 200),            // not started 200 minutes after kickoff: the fallback window is over
]);
eq('the live feed is read once, for every league at once', live.calls.filter((c) => c.endsWith('/api/v2/events/live/')).length, 1);
eq('R2 keys: eflcup for the two Carabao Cup matches in the window, mls for the MLS one, nothing for finished, untracked, early or not-yet-started',
  live.keys, ['bsd/eflcup/9001/incidents.json', 'bsd/eflcup/9001/momentum.json', 'bsd/eflcup/9001/stats.json', 'bsd/eflcup/9005/incidents.json', 'bsd/eflcup/9005/momentum.json', 'bsd/eflcup/9005/stats.json', 'bsd/mls/9007/incidents.json', 'bsd/mls/9007/momentum.json', 'bsd/mls/9007/stats.json']);
eq('COST, Rule 78: exactly three BSD requests per captured match per tick (momentum, incidents, stats), none for a match not captured', [bsdCalls(live, 9001).length, bsdCalls(live, 9005).length, [9002, 9003, 9004, 9006, 9008].reduce((t, id) => t + bsdCalls(live, id).length, 0)], [3, 3, 0]);
eq('the three requests are the three endpoints', bsdCalls(live, 9001).map((c) => c.split('/events/9001/')[1]).sort(), ['incidents/', 'momentum/', 'stats/']);
eq('each object carries its league id and kind in its metadata', live.puts.filter((p) => p.key.startsWith('bsd/eflcup/9001/')).map((p) => [p.type, p.league]).sort(), [['incidents', '40'], ['momentum', '40'], ['stats', '40']]);
eq('one tick in a night with four Carabao Cup matches in the window costs 12 BSD requests plus the one live read', (await drive([40, 40, 40, 40].map((l, i) => ev(9100 + i, l, '2nd_half', 95)))).calls.length, 13);
eq('a live feed that does not answer 200 captures nothing and spends nothing more', await drive([ev(9001, 40, '2nd_half', 85)], { liveStatus: 503 }).then((r) => [r.puts.length, r.calls.length]), [0, 1]);
eq('no token, no R2: the function returns before any request', await (async () => { const calls = []; const { run } = build(async (u) => { calls.push(u); return { ok: false }; }, quiet); await run({}); return calls.length; })(), 0);

console.log(`\ncoverage: the real capture function run over 8 scripted live events and 2 more scenarios; ${probe.BSD_LEAGUE_ID_TO_SLUG ? Object.keys(probe.BSD_LEAGUE_ID_TO_SLUG).length : 0} league ids mapped`);
console.log(bad === 0 ? `ok ${n} assertions` : `${bad} of ${n} FAILED`);
process.exit(bad === 0 ? 0 : 1);
