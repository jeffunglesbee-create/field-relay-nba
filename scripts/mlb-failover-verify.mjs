// CC-CMD-2026-08-08-espn-secondary-source-failover, Task 4.
//
// Proves shape parity between the ESPN-primary MLB adapter and the
// statsapi.mlb.com secondary by running BOTH real adapters, imported from
// src/index.js, over real responses from BOTH real upstreams.
//
// Importing the real functions rather than reimplementing them is the point:
// a hand-copied adapter in a test drifts from production and proves nothing.
//
// Runs on a GitHub runner because this sandbox's proxy 403s ESPN hosts
// (`curl: (56) CONNECT tunnel failed, response 403`, confirmed 2026-08-08).

import { adaptESPNMLB, adaptMlbStatsApi } from '../src/index.js';

const ESPN = 'https://site.web.api.espn.com/apis/site/v2';
const MLBAM = 'https://statsapi.mlb.com/api/v1';

// Walks a value and returns every key path, so nesting differences are caught
// too -- comparing only top-level keys would miss `home.abbr` going missing.
function keyPaths(v, prefix = '') {
  if (v === null || typeof v !== 'object') return [];
  if (Array.isArray(v)) return v.length ? keyPaths(v[0], `${prefix}[]`) : [];
  return Object.keys(v).flatMap(k => [`${prefix}${k}`, ...keyPaths(v[k], `${prefix}${k}.`)]);
}

const date = process.env.PROBE_DATE || new Date().toISOString().slice(0, 10);
const espnDate = date.replace(/-/g, '');

const fail = [];

console.log(`=== mlb-failover-verify  date=${date} ===`);

// ── Real ESPN game through the real primary adapter ───────────────────────
const espnRes = await fetch(`${ESPN}/sports/baseball/mlb/scoreboard?dates=${espnDate}`);
console.log(`ESPN HTTP ${espnRes.status}`);
const espnEvents = (await espnRes.json()).events || [];

// ── Real statsapi game through the real secondary adapter ─────────────────
const mlbRes = await fetch(`${MLBAM}/schedule?sportId=1&date=${date}&hydrate=linescore,team,venue,broadcasts(all)`);
console.log(`statsapi HTTP ${mlbRes.status}`);
const mlbGames = (await mlbRes.json()).dates?.flatMap(d => d.games || []) || [];

console.log(`ESPN events: ${espnEvents.length}   statsapi games: ${mlbGames.length}`);

if (!espnEvents.length || !mlbGames.length) {
  // A real off-day is not a failure, but it also proves nothing -- say so
  // rather than exiting 0 and letting a green check imply verification.
  console.log('SKIP: one or both upstreams returned zero games for this date.');
  console.log('This run proves NOTHING about parity. Re-run on a date with games.');
  process.exit(0);
}

const espnGame = adaptESPNMLB(espnEvents[0]);
const mlbGame  = adaptMlbStatsApi(mlbGames[0]);

// ── 1. Key-set parity ─────────────────────────────────────────────────────
// The secondary is allowed to ADD keys (mlbGamePk). It must not be MISSING any
// key the primary emits, because a client consumer reading that key would get
// undefined during a failover -- the silent-undefined failure mode CONTRACTS.md
// exists to prevent.
const espnKeys = new Set(keyPaths(espnGame));
const mlbKeys  = new Set(keyPaths(mlbGame));
const missing  = [...espnKeys].filter(k => !mlbKeys.has(k));
const extra    = [...mlbKeys].filter(k => !espnKeys.has(k));

console.log(`\n--- 1. key parity ---`);
console.log(`   missing from secondary: ${JSON.stringify(missing)}`);
console.log(`   extra on secondary    : ${JSON.stringify(extra)}`);
// situation is null unless the game is live, on BOTH adapters, so its subkeys
// legitimately vanish for a non-live sample. Compare those only when both are live.
const realMissing = missing.filter(k => !k.startsWith('situation.') || (espnGame.situation && mlbGame.situation));
if (realMissing.length) { fail.push(`secondary missing keys: ${realMissing.join(', ')}`); }

// ── 2. streams populated ──────────────────────────────────────────────────
// This is the assumption the CC-CMD told me to verify rather than accept: it
// expected statsapi to carry NO broadcast data, which would have collided with
// STRUCTURAL 7 (games present, zero streams = hard failure). It does carry it.
const withStreams = mlbGames.map(adaptMlbStatsApi).filter(g => g.streams.length > 0);
console.log(`\n--- 2. streams ---`);
console.log(`   secondary games with >=1 TV stream: ${withStreams.length}/${mlbGames.length}`);
console.log(`   sample: ${JSON.stringify(withStreams[0]?.streams?.slice(0, 3))}`);
if (!withStreams.length) {
  fail.push('secondary produced zero streams across the whole slate — this WOULD trip STRUCTURAL 7');
}

// ── 3. value sanity on the shared fields ──────────────────────────────────
console.log(`\n--- 3. sample values ---`);
for (const [label, g] of [['espn', espnGame], ['mlbam', mlbGame]]) {
  console.log(`   ${label.padEnd(6)} ${g.away.abbr} @ ${g.home.abbr}  ${g.away.score}-${g.home.score}  ` +
              `state=${g.state} periodLabel=${g.periodLabel} venue="${g.venue}" ` +
              `innings=${g.linescores.home.length} streams=${g.streams.length}`);
}
for (const [field, v] of Object.entries({
  state: mlbGame.state, sport: mlbGame.sport, league: mlbGame.league,
})) {
  if (!v) fail.push(`secondary ${field} empty`);
}
if (!['pre', 'live', 'post'].includes(mlbGame.state)) fail.push(`secondary state not in the primary's vocabulary: ${mlbGame.state}`);
if (mlbGame.sport !== espnGame.sport)   fail.push('sport mismatch');
if (mlbGame.league !== espnGame.league) fail.push('league mismatch');

console.log('');
if (fail.length) { for (const f of fail) console.error(`FAIL: ${f}`); process.exit(1); }
console.log('PASS: secondary emits the primary\'s full key set, real values, and populated streams.');
