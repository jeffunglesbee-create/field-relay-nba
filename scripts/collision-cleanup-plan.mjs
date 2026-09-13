// The plan half of the collision cleanup: pure, offline, testable.
//
// SEPARATE FROM THE EXECUTOR ON PURPOSE. Everything that decides WHAT to touch
// lives here and can be exercised with fixtures; the executor only issues what
// this returns. A destructive script whose target set is computed inline cannot
// be tested before it runs, and this one gets exactly one chance to be right.
import { classify } from './duplicate-row-keeper-table.mjs';

// The census reports odds as booleans. These are the real columns behind them,
// and the merge copies COLUMNS, not flags.
export const FIELD_COLUMN = {
  has_opening_odds: 'opening_odds',
  has_closing_odds: 'closing_odds',
  espn_event_id: 'espn_event_id',
  venue: 'venue',
  start_time: 'start_time',
  finalized_at: 'finalized_at',
};

/**
 * -> { merges, deletes, skipped, counts }
 *
 * `deletes` is an EXPLICIT ID LIST, never a predicate. The 2026-08-09 cleanup
 * shared one predicate between its SELECT and its DELETE so the two could not
 * drift, which was right when the set was defined by a predicate. Here the set
 * is defined by a classifier, so the only way the DELETE can match the
 * enumeration is to name the rows.
 */
export function buildPlan(collisions) {
  const rows = classify(collisions);
  const merges = [], deletes = [], skipped = [];

  for (const r of rows) {
    if (r.verdict === 'HUMAN') { skipped.push({ ...r, reason: 'no safe answer' }); continue; }
    if (r.blocked_by_briefs > 0) { skipped.push({ ...r, reason: `brief references the stale row (${r.blocked_by_briefs})` }); continue; }
    if (r.population === 'two-real-games') { skipped.push({ ...r, reason: 'two real games, not a duplicate' }); continue; }

    const keeper = r.rows.find(g => g.id === r.keeper);
    const stale = r.rows.find(g => g.id === r.stale);
    if (!keeper || !stale) { skipped.push({ ...r, reason: 'keeper or stale row missing from the pair' }); continue; }

    if (r.merge_required.length) {
      const columns = r.merge_required.map(f => FIELD_COLUMN[f]).filter(Boolean);
      // An unmapped field would silently drop from the merge and the delete
      // would then destroy it. Refuse the whole pair instead.
      if (columns.length !== r.merge_required.length) {
        skipped.push({ ...r, reason: `unmapped merge field in ${r.merge_required.join(',')}` });
        continue;
      }
      merges.push({ table: r.table, keeper: r.keeper, stale: r.stale, columns, date: r.date, sport: r.sport });
    }
    // home/away travel with the delete so change_log can preserve them.
    // MEASURED REASON: in all 32 merge pairs the row being deleted carries the
    // BETTER display names — `Austin FC` and `Seattle Sounders FC` against the
    // keeper's `Austin` and `Seattle`. That is not a loss LOSS_BEARING can see,
    // because both values are present; it is a quality difference, and the
    // delete makes it unrecoverable unless the old values are written down.
    deletes.push({ table: r.table, id: r.stale, keeper: r.keeper, date: r.date, sport: r.sport,
                   home: stale.home, away: stale.away });
  }

  return {
    merges, deletes, skipped,
    counts: {
      collisions: rows.length,
      merges: merges.length,
      deletes: deletes.length,
      skipped: skipped.length,
    },
  };
}

/**
 * COALESCE, so the keeper's own value always wins. The merge fills gaps; it
 * never overwrites. A merge that could overwrite would make the delete
 * irreversible in a second way.
 */
export function mergeSql({ table, keeper, stale, columns }) {
  const sets = columns.map(c =>
    `${c} = COALESCE(${c}, (SELECT ${c} FROM ${table} WHERE id = ?))`).join(', ');
  return {
    sql: `UPDATE ${table} SET ${sets} WHERE id = ?`,
    params: [...columns.map(() => stale), keeper],
  };
}

/** Verifies the merge landed before the stale row is allowed to be deleted. */
export function mergeVerifySql({ table, keeper, columns }) {
  return {
    sql: `SELECT ${columns.join(', ')} FROM ${table} WHERE id = ?`,
    params: [keeper],
  };
}

export function deleteSql(table, ids) {
  return {
    sql: `DELETE FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')})`,
    params: ids,
  };
}
