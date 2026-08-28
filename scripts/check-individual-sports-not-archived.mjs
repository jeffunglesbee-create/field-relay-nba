#!/usr/bin/env node
// An individual-competitor event must never reach the archive catch-up write.
//
// WHY THIS EXISTS (field-laboratory docs/CC-CMD-2026-08-25-golf-sport-label.md)
//
// `handleJournalismCycle`'s LEAGUES table drives an ESPN scoreboard walk. Every
// entry but one is a team sport, and the per-event handling derives the two
// sides with:
//
//     const home = teams.find(t => t.homeAway === 'home') || teams[0];
//     const away = teams.find(t => t.homeAway === 'away') || teams[1];
//
// The fallback exists for neutral-site fixtures where ESPN omits `homeAway`. It
// cannot tell a neutral site from a leaderboard, so on a golf event it returns
// the first two PLAYERS. `home.team?.shortDisplayName` is then '' (a golf
// competitor carries `athlete`, not `team`), and the catch-up wrote:
//
//     sport='PGA Tour'  home=null  away=null  home_score=-6  away_score=-6
//     id='PGA Tour_2026-08-20_src401811963'  espn_event_id='401811963'
//
// -- the top two players of the BMW Championship's first round, stripped of
// their names and presented as a tie between two sides that do not exist. The
// same event is ALREADY archived correctly by the golf-aware [GOLF-BRIEF] path
// as sport='golf' with espn_event_id='golf_401811963'. Two rows, one event,
// one of them a category error: PGA Tour is a LEAGUE within golf, alongside the
// Korn Ferry, Champions, LPGA and DP World tours.
//
// Static, no network. Six assertions, all enumerated rather than sampled.

import { readFileSync } from 'node:fs';

const SRC = 'src/index.js';
const SELF_TEST = process.argv.includes('--self-test');

// ESPN top-level `sport` values whose competitors are TEAMS. Every LEAGUES
// entry must use one of these or carry `individual:true`.
//
// This is an allowlist, not a blocklist, deliberately. A blocklist of known
// individual sports would silently pass the first unfamiliar one; this makes an
// unrecognised sport an explicit decision at the moment it is added, which is
// the only moment anyone knows the answer.
const TEAM_SPORTS = new Set(['soccer', 'basketball', 'hockey', 'baseball', 'football']);

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`      → ${detail}`); failed++; }
};

/** Parses the cron LEAGUES table out of a source string. */
export function parseLeagues(src) {
  const m = src.match(/const LEAGUES = \[(.*?)\n {2}\];/s);
  if (!m) return null;
  return [...m[1].matchAll(
    /\{sport:\s*'([^']+)',\s*league:\s*'([^']+)',\s*label:\s*'([^']+)'([^}]*)\}/g,
  )].map(x => ({
    sport: x[1], league: x[2], label: x[3],
    individual: /\bindividual\s*:\s*true\b/.test(x[4]),
  }));
}

/** Does the catch-up loop refuse a flagged entry, and can it see the flag? */
export function gateState(src) {
  return {
    // The gate itself.
    gated: /if \(gm\.individual\) continue;/.test(src),
    // Without this the flag never reaches `gm`, and the gate above is dead
    // code that always reads undefined -- passing every event through.
    carried: /gameMeta\.push\(\{[^}]*\bindividual,/s.test(src),
    // And without this, `individual` is never destructured from the table row,
    // so the value pushed is always undefined. Three links, all required.
    destructured: /for \(const \{sport,league,label,individual\} of LEAGUES\)/.test(src),
  };
}

if (SELF_TEST) {
  const good = readFileSync(SRC, 'utf8');
  const g = gateState(good);
  check('the real source has all three links',
    g.gated && g.carried && g.destructured, JSON.stringify(g));

  // Each link removed on its own must be detected. A check that only notices
  // all three missing at once would pass the half-applied fix, which is the
  // realistic way this breaks.
  check('removing the gate is detected',
    !gateState(good.replace('if (gm.individual) continue;', '')).gated, 'still reported gated');
  // Deletes the `individual,` line from the push, which is the exact shape of
  // a half-applied fix: flag on the table, gate in the loop, nothing carrying
  // the value between them. The first version of this mutation inserted a
  // character AFTER `sport,` and left `individual,` in place, so it reported
  // PASS while proving nothing -- caught by this self-test failing.
  check('removing the carry is detected',
    !gateState(good.replace(/\n\s*individual,\n/, '\n')).carried,
    'still reported carried');
  check('removing the destructure is detected',
    !gateState(good.replace('{sport,league,label,individual}', '{sport,league,label}')).destructured,
    'still reported destructured');

  // And the table parser must notice a flag going missing -- the shape of the
  // pre-fix source, which is what this whole check exists to refuse.
  const unflagged = good.replace(", individual:true}", "}");
  const rows = parseLeagues(unflagged);
  check('an unflagged individual-sport row is detected',
    rows !== null && rows.some(r => !TEAM_SPORTS.has(r.sport) && !r.individual),
    'the pre-fix table parsed as compliant');

  process.exit(failed === 0 ? 0 : 1);
}

const src = readFileSync(SRC, 'utf8');
const rows = parseLeagues(src);

check('the LEAGUES table parses', Array.isArray(rows) && rows.length > 0,
  rows === null ? 'const LEAGUES = [...] not found' : '0 rows parsed');
if (!rows || !rows.length) process.exit(1);

// Enumerated, not sampled: an entry silently dropped from the table would
// otherwise pass every assertion below by not being there.
// 21 -> 22 on 2026-08-27: CFB seeded (c52f496,
// CC-CMD-2026-08-21-archive-seed-coverage's `cfb` UNDECIDED entry, decided).
// It is a team sport and carries no `individual` flag, so the two assertions
// this file actually exists for are unchanged -- the ratchet fired on the count
// alone, which is the point of a ratchet.
const EXPECTED = 22;
check(`the table still has ${EXPECTED} entries`,
  rows.length === EXPECTED,
  `${rows.length} entries — if this is a deliberate add or removal, update EXPECTED in the same commit`);

const unknownSport = rows.filter(r => !TEAM_SPORTS.has(r.sport) && !r.individual);
check('every entry is a known team sport or is flagged individual',
  unknownSport.length === 0,
  unknownSport.map(r => `${r.label} (sport='${r.sport}')`).join('; ') +
  ' — add it to TEAM_SPORTS if its ESPN competitors are two sides, or mark it individual:true');

const flagged = rows.filter(r => r.individual);
check('the flagged entries are exactly the non-team ones',
  flagged.every(r => !TEAM_SPORTS.has(r.sport)),
  flagged.filter(r => TEAM_SPORTS.has(r.sport)).map(r => r.label).join('; ') +
  ' — a team sport marked individual would drop real games from the archive');

const g = gateState(src);
check('the catch-up refuses a flagged event', g.gated,
  'the `if (gm.individual) continue;` gate is gone — golf rows will be archived again');
check('the flag reaches the catch-up', g.carried && g.destructured,
  `carried=${g.carried} destructured=${g.destructured} — the gate reads undefined without both, and passes everything`);

console.log(`\n${rows.length} LEAGUES entries, ${flagged.length} individual-competitor: ` +
  (flagged.map(r => r.label).join(', ') || 'none'));
process.exit(failed === 0 ? 0 : 1);
