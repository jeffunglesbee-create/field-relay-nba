#!/usr/bin/env node
// Rule 90 for scripts/duplicate-row-keeper-table.mjs.
//
// Imports the REAL decide() and classify(). The fixtures are one per branch plus
// the two cases that must NOT produce a keeper, because a classifier that always
// answers is worse than one that admits it cannot: the answer feeds a DELETE.
import { decide, classify, population } from './duplicate-row-keeper-table.mjs';

let checked = 0, failed = 0;
const eq = (label, got, want) => {
  checked++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

const row = (o = {}) => ({
  id: 'x', home: 'A', away: 'B', home_score: null, away_score: null,
  espn_event_id: null, series_key: null, finalized_at: null,
  has_opening_odds: false, has_closing_odds: false, briefs_referencing: 0, ...o });

// 1. one scored, one not — the 2026-08 migration shape
eq('one scored sibling wins',
   decide([row({ id: 'keyid', home_score: 2, away_score: 1 }), row({ id: 'nameid' })]).verdict,
   'KEEP_SCORED');
eq('and the unscored one is named stale',
   decide([row({ id: 'keyid', home_score: 2, away_score: 1 }), row({ id: 'nameid' })]).stale,
   'nameid');
// ORDER MUST NOT MATTER. A rule that only works when the keeper is first would
// pass every fixture written in one order and mis-delete in production.
eq('order does not decide it',
   decide([row({ id: 'nameid' }), row({ id: 'keyid', home_score: 2, away_score: 1 })]).keeper,
   'keyid');
// A 0-0 draw is SCORED. `home_score: 0` is falsy and this is the classic way a
// real result gets treated as absent.
eq('a 0-0 result is a result, not an absence',
   decide([row({ id: 'drawn', home_score: 0, away_score: 0 }), row({ id: 'empty' })]).keeper,
   'drawn');

// 2. scores disagree — deleting either destroys a result
eq('disagreeing scores are never auto-resolved',
   decide([row({ id: 'a', home_score: 2, away_score: 1 }), row({ id: 'b', home_score: 3, away_score: 1 })]).verdict,
   'HUMAN');
eq('and no stale row is nominated',
   decide([row({ id: 'a', home_score: 2, away_score: 1 }), row({ id: 'b', home_score: 3, away_score: 1 })]).stale,
   null);

// 3. both scored, identical, one ESPN anchor
eq('identical scores fall back to the ESPN anchor',
   decide([row({ id: 'a', home_score: 1, away_score: 1, espn_event_id: '401' }),
           row({ id: 'b', home_score: 1, away_score: 1 })]).keeper, 'a');
eq('two ESPN anchors distinguish nothing',
   decide([row({ id: 'a', home_score: 1, away_score: 1, espn_event_id: '401' }),
           row({ id: 'b', home_score: 1, away_score: 1, espn_event_id: '402' })]).verdict, 'HUMAN');
eq('no ESPN anchor distinguishes nothing',
   decide([row({ id: 'a', home_score: 1, away_score: 1 }),
           row({ id: 'b', home_score: 1, away_score: 1 })]).verdict, 'HUMAN');

// 4. neither scored
eq('unscored pair with one anchor',
   decide([row({ id: 'a', espn_event_id: '401' }), row({ id: 'b' })]).verdict, 'KEEP_ESPN_UNSCORED');
eq('unscored pair with no anchor needs a human',
   decide([row({ id: 'a' }), row({ id: 'b' })]).verdict, 'HUMAN');

// 5. JOIN SAFETY OVERRIDES A CLEAR VERDICT. This is the assertion that stops a
//    correct-looking DELETE from orphaning a brief.
const blockedCase = classify([{ table: 'regular_season_games', date: '2026-01-01', sport: 'MLS',
  pair_key: 'a|b',
  games: [row({ id: 'keyid', home_score: 2, away_score: 1 }), row({ id: 'nameid', briefs_referencing: 3 })] }])[0];
eq('a brief-referenced stale row is still identified', blockedCase.stale, 'nameid');
eq('but it is not deletable', blockedCase.deletable, false);
eq('and the block is reported with its count', blockedCase.blocked_by_briefs, 3);

const cleanCase = classify([{ table: 'regular_season_games', date: '2026-01-01', sport: 'MLS',
  pair_key: 'a|b',
  games: [row({ id: 'keyid', home_score: 2, away_score: 1 }), row({ id: 'nameid' })] }])[0];
eq('an unreferenced stale row is deletable', cleanCase.deletable, true);

// 6. DATA LOSS OVERRIDES A CLEAR VERDICT TOO, and this set is measured, not
//    imagined: on the first real run, 30 of 114 "deletable" collisions would
//    have destroyed odds, because in the 2026-07-22 MLS population each row
//    holds half the truth — one the result and the ESPN anchor, the other the
//    opening and closing lines.
const halfTruth = classify([{ table: 'regular_season_games', date: '2026-07-22', sport: 'MLS',
  pair_key: 'a|b',
  games: [row({ id: 'scored', home_score: 3, away_score: 1, espn_event_id: '761674', finalized_at: '2026-07-23' }),
          row({ id: 'priced', has_opening_odds: true, has_closing_odds: true })] }])[0];
eq('the scored row is still the keeper', halfTruth.keeper, 'scored');
eq('but a stale row holding odds is NOT deletable', halfTruth.deletable, false);
eq('and the fields that would be lost are named',
   halfTruth.merge_required, ['has_opening_odds', 'has_closing_odds']);

// The mirror: loss only counts in one direction. A keeper holding MORE than the
// stale row is the ordinary case and must stay deletable, or the override
// swallows every collision and the classifier decides nothing.
const keeperRicher = classify([{ table: 'regular_season_games', date: '2026-07-22', sport: 'MLS',
  pair_key: 'a|b',
  games: [row({ id: 'scored', home_score: 3, away_score: 1, has_opening_odds: true }),
          row({ id: 'bare' })] }])[0];
eq('a keeper richer than the stale row stays deletable', keeperRicher.deletable, true);
eq('and nothing is listed as needing a merge', keeperRicher.merge_required, []);

const bothPriced = classify([{ table: 'regular_season_games', date: '2026-07-22', sport: 'MLS',
  pair_key: 'a|b',
  games: [row({ id: 'scored', home_score: 3, away_score: 1, has_opening_odds: true }),
          row({ id: 'alsopriced', has_opening_odds: true })] }])[0];
eq('odds on both sides lose nothing', bothPriced.deletable, true);

// A HUMAN verdict must never be deletable, whatever the brief count says.
const humanCase = classify([{ table: 'postseason_games', date: '2026-01-01', sport: 'MLS',
  pair_key: 'a|b',
  games: [row({ id: 'a', home_score: 2, away_score: 1 }), row({ id: 'b', home_score: 3, away_score: 1 })] }])[0];
eq('a HUMAN verdict is never deletable', humanCase.deletable, false);

// 7. THE THREE POPULATIONS. The doubleheader case is the one that matters: two
//    real games sharing a team pair and a date. A dedupe on (sport, date, home,
//    away) would merge them, and the 2026-08-08 session scored exactly that
//    option as viable having found no doubleheaders in its window.
eq('a dash-scheme sibling means the external writer',
   population([row({ id: '2026-08-30-mls-stl-dal' }), row({ id: 'MLS_2026-08-30_stlouis_dallas' })]),
   'external-vs-ours');
eq('two different ESPN ids are two real games, not a duplicate',
   population([row({ id: 'MLB_2026-09-04_e401816801', espn_event_id: '401816801' }),
               row({ id: 'MLB_2026-09-04_e401877193', espn_event_id: '401877193' })]),
   'two-real-games');
eq('the same ESPN id on both sides is one game stored twice',
   population([row({ id: 'MLB_2026-09-04_e401816801', espn_event_id: '401816801' }),
               row({ id: 'MLB_2026-09-04_angels_yankees', espn_event_id: '401816801' })]),
   'ours-vs-ours');
eq('dash outranks the doubleheader test',
   population([row({ id: '2026-09-04-mlb-cle-det', espn_event_id: '401816801' }),
               row({ id: 'MLB_2026-09-04_e401877193', espn_event_id: '401877193' })]),
   'external-vs-ours');

console.log(`\n${failed ? 'FAILED' : 'PASS'}: ${checked - failed}/${checked} assertions`
          + ` — 4 decision branches, 2 override paths, 3 populations, order-independence`);
process.exit(failed ? 1 : 0);
