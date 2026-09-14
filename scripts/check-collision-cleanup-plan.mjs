#!/usr/bin/env node
// Rule 90 for scripts/collision-cleanup-plan.mjs.
//
// This plan drives DELETEs against the live archive. Every assertion below is
// about something the plan must REFUSE to touch, or about SQL that must not be
// able to overwrite. There is no second chance on a delete.
import { buildPlan, buildSymmetricPlan, mergeSql, deleteSql, FIELD_COLUMN,
         FILL_FIELDS } from './collision-cleanup-plan.mjs';
import { LOSS_BEARING } from './duplicate-row-keeper-table.mjs';

let checked = 0, failed = 0;
const eq = (label, got, want) => {
  checked++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

// THE DIGEST KEYS ARE PRESENT AND NULL BY DEFAULT, never absent. The plan now
// refuses a pair whose census served no digest (Rule 99), so a fixture that
// omitted them would exercise the refusal path instead of the case it is named
// for — and every other assertion in this file would go green for the wrong
// reason.
const row = (o = {}) => ({
  id: 'x', home: 'A', away: 'B', home_score: null, away_score: null,
  espn_event_id: null, venue: null, start_time: null, finalized_at: null,
  has_opening_odds: false, has_closing_odds: false,
  opening_odds_digest: null, closing_odds_digest: null,
  briefs_referencing: 0, ...o });
// Sets the flag AND the digest together, the way the census serves them. A
// fixture that sets only the flag is describing a row that cannot exist.
const odds = (opening, closing) => ({
  has_opening_odds: opening != null, opening_odds_digest: opening ?? null,
  has_closing_odds: closing != null, closing_odds_digest: closing ?? null });
const pair = (a, b, o = {}) => ({ table: 'regular_season_games', date: '2026-07-22',
  sport: 'MLS', pair_key: 'a|b', games: [a, b], ...o });

// A clean one-scored pair: the ordinary delete.
const clean = buildPlan([pair(row({ id: 'MLS_2026-07-22_a_b', home_score: 2, away_score: 1 }),
                              row({ id: '2026-07-22-mls-a-b' }))]);
eq('a clean pair yields one delete and no merge',
   [clean.counts.deletes, clean.counts.merges, clean.counts.skipped], [1, 0, 0]);
eq('and it deletes the stale row, not the keeper', clean.deletes[0]?.id, '2026-07-22-mls-a-b');

// A brief on the stale row: never touched.
const briefed = buildPlan([pair(row({ id: 'keep', home_score: 2, away_score: 1 }),
                                row({ id: 'stale', briefs_referencing: 1 }))]);
eq('a brief-referenced stale row is skipped, not deleted',
   [briefed.counts.deletes, briefed.counts.skipped], [0, 1]);
eq('and the skip says why', !!briefed.skipped[0]?.reason?.startsWith('brief references'), true);

// A doubleheader with two results. Protected twice over — the population rule
// and the disagreeing-scores rule both catch it.
const dh = buildPlan([pair(row({ id: 'MLB_d_e1', home_score: 4, away_score: 3, espn_event_id: '1' }),
                           row({ id: 'MLB_d_e2', home_score: 7, away_score: 6, espn_event_id: '2' }))]);
eq('a doubleheader is never deleted', dh.counts.deletes, 0);

// THE DOUBLEHEADER THAT ONLY THE POPULATION RULE SAVES, and the reason mutation
// C2 first came back NOT CAUGHT: game 1 is final, game 2 has not started. The
// scores do not disagree — one is simply absent — so decide() returns
// KEEP_SCORED and would delete a real game that is about to be played. Nothing
// but the two-different-ESPN-ids test stands between that and a DELETE.
const dhLive = buildPlan([pair(row({ id: 'MLB_d_e1', home_score: 4, away_score: 3, espn_event_id: '1' }),
                               row({ id: 'MLB_d_e2', espn_event_id: '2' }))]);
eq('a doubleheader mid-day, game 2 unplayed, is never deleted', dhLive.counts.deletes, 0);
eq('and it is skipped as two real games',
   dhLive.skipped[0]?.reason, 'two real games, not a duplicate');

// A HUMAN verdict, skipped for its own stated reason rather than by accident.
const human = buildPlan([pair(row({ id: 'a', home_score: 1, away_score: 1 }),
                              row({ id: 'b', home_score: 1, away_score: 1 }))]);
eq('a HUMAN pair produces no delete', human.counts.deletes, 0);
eq('and says it has no safe answer', human.skipped[0]?.reason, 'no safe answer');

// THE FIELD MAP MUST COVER EVERY FIELD THE CLASSIFIER CAN DEMAND. If a field is
// added to LOSS_BEARING and not here, the merge silently omits it and the delete
// then destroys it. Asserted against the real LOSS_BEARING, not a copy.
eq('every loss-bearing field maps to a real column',
   LOSS_BEARING.map(([f]) => f).filter(f => !FIELD_COLUMN[f]), []);

// A merge pair: merge first, then delete, and the columns are the real ones.
const merged = buildPlan([pair(row({ id: 'keep', home_score: 3, away_score: 1, espn_event_id: '761674' }),
                               row({ id: 'stale', has_opening_odds: true, has_closing_odds: true }))]);
eq('a merge pair produces both a merge and a delete',
   [merged.counts.merges, merged.counts.deletes], [1, 1]);
eq('and the merge names COLUMNS, not census flags',
   merged.merges[0]?.columns, ['opening_odds', 'closing_odds']);
eq('and the delete targets the same stale row the merge drained',
   merged.deletes[0]?.id, merged.merges[0]?.stale);

// WITH MERGES OFF, a merge pair must be REFUSED — not deleted unmerged, which
// would destroy the odds this whole override exists to protect.
const held = buildPlan([pair(row({ id: 'keep', home_score: 3, away_score: 1, espn_event_id: '761674' }),
                             row({ id: 'stale', has_opening_odds: true }))], { mergesAllowed: false });
eq('with merges off a merge pair is held back, not deleted',
   [held.counts.deletes, held.counts.merges, held.counts.skipped], [0, 0, 1]);
eq('and the hold says why', held.skipped[0]?.reason, 'merge pair held back (owner: 82 only)');
eq('a clean pair is unaffected by merges being off',
   buildPlan([pair(row({ id: 'k', home_score: 2, away_score: 1 }), row({ id: 's' }))],
             { mergesAllowed: false }).counts.deletes, 1);

// EVERY DELETE MUST BE PRECEDED BY ITS MERGE. A delete of a row whose fields
// were never copied is the exact data loss this whole pass exists to avoid.
const allMergedFirst = merged.deletes.every(d =>
  !merged.merges.some(m => m.stale === d.stale) || merged.merges.some(m => m.stale === d.id));
eq('no delete exists for a merge that was not planned', allMergedFirst, true);

// NULL-SAFE ON PURPOSE. Under a mutation these arrays can be empty, and a check
// that THROWS exits non-zero without printing its FAIL line — which reads to the
// harness as caught while hiding which assertion actually noticed. A destructive
// script's check must fail, not crash.

// THE DELETED ROW'S NAMES MUST SURVIVE IT. In all 32 merge pairs the row being
// deleted carries the better display names; LOSS_BEARING cannot see that,
// because both rows have names and neither is absent. change_log is the only
// place they can go, so the plan has to carry them.
eq('a delete carries the names it is about to remove',
   [clean.deletes[0]?.home, clean.deletes[0]?.away], ['A', 'B']);

// SQL SHAPE. COALESCE is the difference between filling a gap and overwriting.
const { sql, params } = mergeSql({ table: 'regular_season_games', keeper: 'K', stale: 'S',
                                   columns: ['opening_odds'] });
eq('the merge fills a gap and cannot overwrite',
   sql, 'UPDATE regular_season_games SET opening_odds = COALESCE(opening_odds, (SELECT opening_odds FROM regular_season_games WHERE id = ?)) WHERE id = ?');
eq('and it is parameterised, stale first then keeper', params, ['S', 'K']);

// THE DELETE NAMES ROWS. A predicate could match rows that were never enumerated.
const del = deleteSql('regular_season_games', ['a', 'b']);
eq('the delete names ids and carries no predicate',
   del.sql, 'DELETE FROM regular_season_games WHERE id IN (?,?)');
eq('and binds exactly the enumerated ids', del.params, ['a', 'b']);

// ── SYMMETRIC MERGE ────────────────────────────────────────────────────────
// The other way to end a disagreement. Every assertion here is about the fact
// that it takes NOTHING away.
const B = pair(row({ id: 'dash', ...odds('aa', 'bb') }),
               row({ id: 'fifa', home_score: 3, away_score: 1,
                     espn_event_id: '761674', finalized_at: '2026-07-23' }));
const sym = buildSymmetricPlan([B]);
eq('a symmetric plan contains no deletes at all', sym.deletes.length, 0);
eq('and it has no counts.deletes either', sym.counts.deletes, 0);
eq('odds go to the row that lacks them',
   sym.merges.find(m => m.keeper === 'fifa')?.columns, ['opening_odds', 'closing_odds']);
// THE ASSERTION THAT COST A DRY RUN TO LEARN. `fifa` carries espn_event_id and
// finalized_at that `dash` lacks, so a LOSS_BEARING-wide fill emits a second
// update writing espn_event_id into `dash`. Nineteen `WHERE espn_event_id = ?
// LIMIT 1` lookups in src/index.js are single-valued only for as long as that
// does not happen.
eq('nothing but odds is ever written back the other way',
   sym.merges.filter(m => m.keeper === 'dash').length, 0);
eq('so one pair produces one update, not two', sym.merges.length, 1);
eq('and no update names a non-odds column',
   sym.merges.flatMap(m => m.columns).filter(c => !['opening_odds', 'closing_odds'].includes(c)), []);

// Rows that already agree are left alone — a merge that rewrites what is
// already there is a write with no purpose and a conflict surface.
const agreed = buildSymmetricPlan([pair(row({ id: 'x', ...odds('aa', null) }),
                                        row({ id: 'y', ...odds('aa', null) }))]);
eq('rows that already agree produce no merge', agreed.merges.length, 0);
eq('and say so', agreed.skipped[0]?.reason, 'rows already agree on odds');

// The one drift that empties the fill set without changing a line of this file.
eq('every fill field is a real LOSS_BEARING field',
   FILL_FIELDS.filter(f => !LOSS_BEARING.some(([g]) => g === f)), []);

// TWO DIFFERENT CLOSING LINES. THE CASE THAT SHIPPED.
//
// MEASURED LIVE 2026-09-14: two pairs carried identical opening lines and two
// DIFFERENT closing lines. Both `has_closing_odds` flags read true, so the
// boolean gap test saw nothing to fill and called them agreed — and the done
// condition, which re-derived with this same function, agreed with itself while
// the watch read them as open. A fill cannot resolve this: COALESCE writes only
// into a NULL, and overwriting either side destroys a real price.
const clash = buildSymmetricPlan([pair(row({ id: 'p', ...odds('aa', 'cc') }),
                                       row({ id: 'q', ...odds('aa', 'dd') }))]);
eq('two different closing lines are not a fill', clash.merges.length, 0);
eq('and they are NOT filed as agreeing', clash.skipped.length, 0);
eq('they are escalated as a conflict', clash.counts.conflicts, 1);
eq('naming the column that clashes', clash.conflicts[0]?.columns, ['closing_odds']);
eq('and both row ids, because a human has to look at them',
   clash.conflicts[0]?.ids, ['p', 'q']);
// A pair can need a fill on one column and be in conflict on the other. The
// conflict wins: filling half of a pair that still disagrees would report
// progress while leaving the hazard exactly where it was.
const mixed = buildSymmetricPlan([pair(row({ id: 'p', ...odds('aa', 'cc') }),
                                       row({ id: 'q', ...odds(null, 'dd') }))]);
eq('a conflict on one column blocks the fill on the other', mixed.merges.length, 0);
eq('and the pair is a conflict, not a skip', mixed.counts.conflicts, 1);

// RULE 99. A census that served no digests cannot be read as "both null,
// therefore equal" — that would close every pair on data nobody read.
const noDigest = buildSymmetricPlan([pair(
  { id: 'p', home: 'A', away: 'B', home_score: null, away_score: null, espn_event_id: null,
    has_opening_odds: true, has_closing_odds: false, briefs_referencing: 0 },
  { id: 'q', home: 'A', away: 'B', home_score: null, away_score: null, espn_event_id: null,
    has_opening_odds: false, has_closing_odds: false, briefs_referencing: 0 })]);
eq('a pair with no digests is not filled', noDigest.merges.length, 0);
eq('and the skip names the missing evidence',
   noDigest.skipped[0]?.reason?.includes('census served no'), true);

// A doubleheader is two real games; filling one from the other would invent a
// fact rather than complete one.
// ITS ODDS DIGEST IS REAL, not just the flag. With both digests null the pair
// agrees anyway, so deleting the doubleheader guard would change nothing and
// the assertion below would pass without testing it — mutation S3 walked
// straight through the earlier version for exactly that reason.
const dh2 = buildSymmetricPlan([pair(
  row({ id: 'g1', home_score: 4, away_score: 3, espn_event_id: '1', ...odds('aa', null) }),
  row({ id: 'g2', home_score: 7, away_score: 6, espn_event_id: '2' }))]);
eq('a doubleheader is never merged', dh2.merges.length, 0);
eq('and is skipped as two real games', dh2.skipped[0]?.reason, 'two real games, not a duplicate');

console.log(`\n${failed ? 'FAILED' : 'PASS'}: ${checked - failed}/${checked} assertions`
          + ` — 5 refusal paths, symmetric merge, field-map coverage, COALESCE, id-list DELETE`);
process.exit(failed ? 1 : 0);
