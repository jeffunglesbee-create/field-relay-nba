#!/usr/bin/env node
// Phase 3 (truth_is) writes a headline that names a winner: "X beat Y 3-2 as a +300 underdog",
// "X shut out Y 3-0". A drawn game has no winner.
//
// Until 2026-10-30 detectAnomalies took `winner = home_score > away_score ? home : away`, which
// gives every tie to the AWAY side. So a draw was reported as a win for the visitors:
//   2026-10-25  "Troyes beat Toulouse 0-0 as a +450 underdog"   (and a 0-0 counted as a shutout)
//   2026-10-28  "Cincinnati beat Miami 2-2 as a +360 underdog"
//   2026-10-23  "Málaga beat Alavés 1-1 as a +500 underdog"
// Replayed over the 22 context snapshots 2026-10-08..29, 5 days led with a draw described as a win
// and 4 more counted draws among their "N unusual finishes". The Morning Report prints this headline
// as written since src/morning-report.js (Phase 5 no longer lets the model reword it), so the false
// sentence would have been the first of the report.
//
// This pins the fix on the real function with the real rows: a tie is not a finding, whatever the
// sport, the score, the price or the recap text; a decisive game is untouched (a home winner and an
// away winner, both underdogs); and the count in "N unusual finishes" counts decisive games only.
// docs/CC-CMD-2026-10-30-morning-report-degraded-reason.md
//
// Rule 90: mutation-tested by scripts/mutate-truth-is-ties.mjs.
import { readFileSync } from 'node:fs';
import { detectAnomalies } from '../src/analytics-engine.js';

process.on('uncaughtException', (e) => { console.log(`FAIL  the check crashed — ${e.message}`); process.exit(1); });

let fails = 0, n = 0;
const ok = (f, why) => {
  n++;
  let pass = false;
  try { pass = (typeof f === 'function' ? f() : f) === true; }
  catch (e) { console.log(`FAIL  ${why} — threw ${e.message}`); fails++; return; }
  if (!pass) { fails++; console.log(`FAIL  ${why}`); }
};

const FX = JSON.parse(readFileSync(new URL('./fixtures/truth-is-ties-2026-10.json', import.meta.url), 'utf8'));
const [TROYES, CINCI, MALAGA] = FX.ties;
const { home_winner: GENOA, away_winner: BUCS } = FX.decisive;

// ── a drawn game is not a finding ───────────────────────────────────────────
ok(() => TROYES.home_score === 0 && TROYES.away_score === 0 && CINCI.home_score === 2 && CINCI.away_score === 2
    && MALAGA.home_score === 1 && MALAGA.away_score === 1,
  'the fixture rows are the three real draws (0-0, 2-2, 1-1)');
ok(() => detectAnomalies([CINCI]) === null,
  'a drawn game is not a finding: Cincinnati 2-2 Miami, the visitors at +360 (was "Cincinnati beat Miami 2-2")');
ok(() => detectAnomalies([MALAGA]) === null,
  'a drawn game is not a finding: Málaga 1-1 Alavés, the visitors at +500 (was "Málaga beat Alavés 1-1")');
ok(() => detectAnomalies([TROYES]) === null,
  'a goalless draw is not a shutout and not an upset: Troyes 0-0 Toulouse, the visitors at +450');
ok(() => detectAnomalies([{ id: 'z', sport: 'NHL', home: 'Aa', away: 'Bb', home_score: 0, away_score: 0, note: null }]) === null,
  'a goalless draw with no odds is not a shutout');
ok(() => detectAnomalies([FX.ties[0], FX.ties[1], FX.ties[2]]) === null,
  'a night of only draws has no finding (Phase 3 then writes its quiet-night line)');

// ── a decisive game is untouched ────────────────────────────────────────────
ok(() => (f => f && f.type === 'upset' && f.game_id === GENOA.id
    && f.headline === 'Genoa beat Fiorentina 2-1 as a +215 underdog.')(detectAnomalies([GENOA])),
  'a decisive upset is untouched: a home winner (Genoa over Fiorentina, +215)');
ok(() => (f => f && f.type === 'upset' && f.game_id === BUCS.id
    && f.headline === 'Buccaneers beat Cowboys 24-16 as a +400 underdog.')(detectAnomalies([BUCS])),
  'a decisive upset is untouched: an away winner (Buccaneers over Cowboys, +400)');
ok(() => (f => f && f.type === 'upset' && f.game_id === GENOA.id)(detectAnomalies([TROYES, CINCI, GENOA, MALAGA])),
  'a draw beside a decisive upset does not take the headline from it');

// ── "N unusual finishes" counts decisive games only ─────────────────────────
const SO = (id, h, a) => ({ id, sport: 'NHL', home: h, away: a, home_score: 3, away_score: 0, note: null });
ok(() => detectAnomalies([SO('s1', 'Aa', 'Bb'), SO('s2', 'Cc', 'Dd'), SO('s3', 'Ee', 'Ff')]).headline
    === '3 unusual finishes — led by Aa shut out Bb 3-0.',
  'three shutouts are three unusual finishes (the baseline for the next one)');
ok(() => detectAnomalies([SO('s1', 'Aa', 'Bb'), TROYES, SO('s2', 'Cc', 'Dd'), CINCI, MALAGA, SO('s3', 'Ee', 'Ff')]).headline
    === '3 unusual finishes — led by Aa shut out Bb 3-0.',
  'draws are not counted among the unusual finishes (was 7)');

// ── a property over random slates ───────────────────────────────────────────
// mulberry32: a seeded generator, so a failure is a seed and not a flake.
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SPORTS = ['NBA', 'NHL', 'MLB', 'Ligue 1', 'MLS', 'La Liga', 'EPL', 'NFL'];
const NOTES = [null, null, 'walk-off', 'hat trick', 'shutout', 'no-hitter', 'perfect game', 'final'];
let leaks = 0, slates = 0;
for (let seed = 1; seed <= 400; seed++) {
  const r = rng(seed), pick = (a) => a[Math.floor(r() * a.length)];
  const games = [], tied = new Set();
  const count = 1 + Math.floor(r() * 8);
  for (let i = 0; i < count; i++) {
    const tie = r() < 0.5;
    const lo = Math.floor(r() * 7);
    const hi = tie ? lo : lo + 1 + Math.floor(r() * 5);   // never equal to lo unless it is a tie
    const homeWins = r() < 0.5;
    const hs = homeWins ? hi : lo, as = homeWins ? lo : hi;
    const price = () => (r() < 0.5 ? -1 : 1) * (100 + Math.floor(r() * 800));
    games.push({
      id: `g${seed}_${i}`, sport: pick(SPORTS), home: `H${i}`, away: `A${i}`,
      home_score: hs, away_score: as, note: pick(NOTES),
      closing_odds: JSON.stringify({ moneyline: { home: price(), away: price(), draw: 300 } }),
    });
    if (hs === as) tied.add(`g${seed}_${i}`);
  }
  slates++;
  const f = detectAnomalies(games);
  if (f && (tied.has(f.game_id) || /\b(\d+)-\1\b/.test(f.headline))) leaks++;
}
ok(() => slates === 400 && leaks === 0,
  'over 400 random slates no finding is a tied game and no headline reports equal scores');

console.log(`${n - fails}/${n} assertions pass`);
process.exit(fails ? 1 : 0);
