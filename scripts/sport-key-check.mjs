#!/usr/bin/env node
// Guard for normalizeSportKey (src/context-assembler.js).
//
// Why this file exists: the sport-key table is indexed by two shapes of the
// same name — spaced ('major league baseball') and collapsed
// ('majorleaguebaseball') — because D1 stores display names and ESPN slugs do
// not agree about whitespace. The lookup used to strip all whitespace before
// indexing, so EVERY multi-word key in the table was unreachable and a game
// whose sport came out of D1 as "Major League Baseball" resolved to no slug
// at all. buildESPNSummaryContext then returned '' with no error, which is
// indistinguishable from "ESPN had no leaders yet".
//
// Run against the pre-fix lookup, this file fails on exactly the multi-word
// cases (measured 2026-08-23: 2 of 13). That failure is the artifact — a
// positive-only test would have passed both before and after.
//
// Pure, no network.

import { normalizeSportKey } from '../src/context-assembler.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' \u2014 ' + detail : ''}`); }
};

console.log('normalizeSportKey');

// 12. The pairs that matter for slug lookup. WNBA-stored-as-Basketball is the
//     one that would otherwise fetch an NBA slug with a WNBA event id.
const cases = [
  [{ sport: 'Basketball', league: 'WNBA' }, 'wnba'],
  [{ sport: 'Basketball', league: "Women's National Basketball Association" }, 'wnba'],
  [{ sport: 'basketball' }, 'nba'],
  [{ sport: 'NBA', league: 'National Basketball Association' }, 'nba'],
  [{ sport: 'Major League Baseball' }, 'mlb'],
  [{ sport: 'Baseball' }, 'mlb'],
  [{ sport: 'National Football League' }, 'nfl'],
  [{ sport: 'Hockey' }, 'nhl'],
  [{ sport: 'epl' }, 'epl'],
  [{ sport: 'Premier League' }, 'epl'],
  [{ sport: 'FIFA World Cup 2026' }, 'wc26'],
  // NEGATIVE — soccer must NOT collapse to epl. eng.1 is the England slug;
  // resolving La Liga or an unlabelled soccer row to it would attach one
  // competition's events to another's game.
  [{ sport: 'soccer' }, 'soccer'],
  [{ sport: 'La Liga' }, 'laliga'],
];
for (const [game, want] of cases) {
  const got = normalizeSportKey(game);
  ok(`${game.sport}${game.league ? ' / ' + game.league : ''} -> ${want}`, got === want, `got ${got}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
