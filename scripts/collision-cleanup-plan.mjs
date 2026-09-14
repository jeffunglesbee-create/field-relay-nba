// The plan half of the collision cleanup: pure, offline, testable.
//
// SEPARATE FROM THE EXECUTOR ON PURPOSE. Everything that decides WHAT to touch
// lives here and can be exercised with fixtures; the executor only issues what
// this returns. A destructive script whose target set is computed inline cannot
// be tested before it runs, and this one gets exactly one chance to be right.
import { classify, LOSS_BEARING } from './duplicate-row-keeper-table.mjs';

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
export function buildPlan(collisions, { mergesAllowed = true } = {}) {
  const rows = classify(collisions);
  const merges = [], deletes = [], skipped = [];

  for (const r of rows) {
    if (r.verdict === 'HUMAN') { skipped.push({ ...r, reason: 'no safe answer' }); continue; }
    if (r.blocked_by_briefs > 0) { skipped.push({ ...r, reason: `brief references the stale row (${r.blocked_by_briefs})` }); continue; }
    if (r.population === 'two-real-games') { skipped.push({ ...r, reason: 'two real games, not a duplicate' }); continue; }

    const keeper = r.rows.find(g => g.id === r.keeper);
    const stale = r.rows.find(g => g.id === r.stale);
    if (!keeper || !stale) { skipped.push({ ...r, reason: 'keeper or stale row missing from the pair' }); continue; }

    if (r.merge_required.length && !mergesAllowed) {
      // OWNER DECISION 2026-09-13: "82 only". The merge pairs keep the
      // FIFA-prefixed row and delete the better-named one — `Austin` survives,
      // `Austin FC` does not — so they wait for a name-aware pass. Refused
      // here rather than filtered by the caller, so the DELETE list this plan
      // returns can never contain one.
      skipped.push({ ...r, reason: 'merge pair held back (owner: 82 only)' });
      continue;
    }
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

// ── SYMMETRIC MERGE ────────────────────────────────────────────────────────
//
// The other way to end a disagreement.
//
// Every resolution in this file until now picked a winner and deleted the loser,
// and picking a winner is what made B hard: each row holds half the truth, so
// whichever side loses takes something real with it — the odds, or the properly
// formed team names.
//
// A collision is harmful because the two rows DISAGREE: the join can attach a
// line to one and not its twin. Deleting is one way to end that. Filling both
// is the other, and it is not lossy in either direction.
//
// NO DELETES. This function cannot produce one — it returns updates only.
//
// ODDS ONLY, AND THE NARROWING IS THE WHOLE POINT.
//
// LOSS_BEARING answers "what disappears if this row is deleted". Nothing is
// deleted here, so nothing disappears, and that is the wrong question. The
// question a fill has to answer is narrower: WHAT MUST THE TWO ROWS AGREE ON.
//
// MEASURED 2026-09-14, from the first dry run against the live archive. The
// full LOSS_BEARING set produced 64 updates across the 32 pairs, and the second
// direction wrote `espn_event_id` into the twin. src/index.js holds NINETEEN
// `WHERE espn_event_id = ? LIMIT 1` lookups that are deterministic today
// because exactly one row carries each id; the two rows disagree on team names
// (`Austin` against `Austin FC`), so filling that column would have made all
// nineteen return whichever row SQLite reached first. A fill that creates a new
// ambiguity has not ended one.
//
// The hazard this exists to remove is the odds join attaching one game's line
// to its twin. Two rows carrying the SAME line cannot produce a false fact
// whichever one the join picks. start_time, venue, finalized_at and
// espn_event_id disagreeing is untidy; it is not a false fact, and none of them
// is what the join reads.
export const FILL_FIELDS = ['has_opening_odds', 'has_closing_odds'];

// THE DIGEST IS THE VALUE; THE BOOLEAN IS A PROJECTION OF IT.
//
// MEASURED 2026-09-14, ONE MINUTE AFTER THE FIRST APPLY. This function filled
// 32 pairs, re-derived itself against a fresh census, found nothing left, and
// reported success. The watch then read TWO pairs still disagreeing.
//
// Both were pairs whose rows carried IDENTICAL opening lines and two DIFFERENT
// closing lines. `has_closing_odds` is true on both sides, so the gap test saw
// nothing to fill and skipped them as "already agree" — and the done condition,
// being this same function run again, agreed with itself.
//
// A check that re-derives its subject verifies the copy. So agreement is now
// decided on the digest the census serves, which is the same evidence the watch
// condition uses.
const DIGEST_OF = { has_opening_odds: 'opening_odds_digest',
                    has_closing_odds: 'closing_odds_digest' };

export function buildSymmetricPlan(collisions) {
  const merges = [], skipped = [], conflicts = [];
  const fields = LOSS_BEARING.filter(([f]) => FILL_FIELDS.includes(f));
  // TOTAL DRIFT THROWS; PARTIAL DRIFT IS THE CHECK'S JOB. A rename in
  // LOSS_BEARING that matched nothing would leave `fields` empty and the plan
  // would report all 32 pairs as already agreeing — a silent no-op that looks
  // exactly like success. That refusal cannot be reached from a fixture, so it
  // throws here; a rename that breaks only ONE name is caught by the check's
  // `every fill field is a real LOSS_BEARING field` assertion, which runs
  // against the real import before this plan is allowed to run at all.
  if (!fields.length)
    throw new Error('FILL_FIELDS matched no LOSS_BEARING field; refusing to plan a no-op');
  for (const c of classify(collisions)) {
    if (c.population === 'two-real-games') {
      skipped.push({ ...c, reason: 'two real games, not a duplicate' });
      continue;
    }
    const raw = collisions.find(x => x.pair_key === c.pair_key && x.date === c.date);
    const [ra, rb] = raw.games;

    // A ROW WITH NO DIGEST FIELD AT ALL IS NOT A ROW THAT AGREES (Rule 99). An
    // older census, or a failed detail read, serves the booleans without them;
    // reading that absence as "both null, therefore equal" would close every
    // pair on data nobody read.
    const missing = fields.filter(([f]) =>
      !(DIGEST_OF[f] in ra) || !(DIGEST_OF[f] in rb)).map(([f]) => DIGEST_OF[f]);
    if (missing.length) {
      skipped.push({ ...c, reason: `census served no ${missing.join(', ')}; cannot compare values` });
      continue;
    }

    const aToB = [], bToA = [], clash = [];
    for (const [f] of fields) {
      const col = FIELD_COLUMN[f], dig = DIGEST_OF[f];
      const da = ra[dig] ?? null, db = rb[dig] ?? null;
      if (!col) { clash.push(`unmapped field ${f}`); continue; }
      if (da === db) continue;              // both absent, or the same line
      if (da && !db) { aToB.push(col); continue; }
      if (db && !da) { bToA.push(col); continue; }
      // BOTH ROWS CARRY A LINE AND THE LINES DIFFER. No fill can resolve this:
      // COALESCE writes only into a NULL, and overwriting either side would
      // destroy a real price. Escalated, never silently skipped.
      clash.push(col);
    }
    if (clash.length) {
      conflicts.push({ ...c, columns: clash, ids: [ra.id, rb.id],
                       reason: `both rows carry DIFFERENT ${clash.join(', ')} — no fill can resolve this` });
      continue;
    }
    if (!aToB.length && !bToA.length) {
      skipped.push({ ...c, reason: 'rows already agree on odds' });
      continue;
    }
    if (aToB.length) merges.push({ table: c.table, date: c.date, sport: c.sport,
                                   keeper: rb.id, stale: ra.id, columns: aToB, direction: 'a->b' });
    if (bToA.length) merges.push({ table: c.table, date: c.date, sport: c.sport,
                                   keeper: ra.id, stale: rb.id, columns: bToA, direction: 'b->a' });
  }
  return { merges, skipped, conflicts, deletes: [],
           counts: { merges: merges.length, skipped: skipped.length,
                     conflicts: conflicts.length, deletes: 0 } };
}

// ── RELABEL ────────────────────────────────────────────────────────────────
//
// OWNER DECISION 2026-09-14: "Relabel", chosen from clear-both / relabel /
// leave-and-stop-asking-them-to-agree.
//
// The conflicting pairs hold two prices that are both real and both captured
// after kickoff. Clearing them destroys real observations; leaving them leaves
// two wrong values in a column consumers read as the close. Relabelling keeps
// the observation and corrects the claim.
//
// ONLY CONFLICTS, AND ONLY THE CLASHING COLUMN. A pair that merely has a gap is
// the fill's job and is not touched here; a column that agrees is not a
// mislabelled price and is left alone.
export function buildRelabelPlan(collisions) {
  const { conflicts } = buildSymmetricPlan(collisions);
  const moves = [], skipped = [];
  for (const k of conflicts) {
    // The plan names COLUMNS. `unmapped field X` is pushed into the same list
    // by buildSymmetricPlan when FIELD_COLUMN has no entry, and moving a column
    // called "unmapped field has_foo" would be a SQL error at best.
    const cols = k.columns.filter(c => c === 'opening_odds' || c === 'closing_odds');
    if (cols.length !== k.columns.length) {
      skipped.push({ ...k, reason: `conflict names something that is not an odds column: ${k.columns.join(', ')}` });
      continue;
    }
    // BOTH ROWS, NOT ONE. The pair conflicts because each holds a price; both
    // were captured after kickoff, so both labels are wrong. Relabelling one
    // would leave the other standing as the answer — which is the choosing this
    // decision exists to avoid.
    for (const id of k.ids)
      for (const col of cols)
        moves.push({ table: k.table, date: k.date, sport: k.sport, id, column: col });
  }
  return { moves, skipped, deletes: [],
           counts: { moves: moves.length, skipped: skipped.length, deletes: 0 } };
}

/**
 * MOVE, NEVER COPY. One statement, so a row can never hold the same blob in
 * both columns — which would read as "there is a closing line AND it is in-play"
 * and satisfy every consumer of either.
 *
 * GUARDED ON BOTH ENDS. Re-running must not move a NULL over a value already
 * relabelled: the source must still be present and the destination still empty.
 */
export function relabelSql({ table, id, column }) {
  return {
    sql: `UPDATE ${table} SET inplay_odds = ${column}, ${column} = NULL
           WHERE id = ? AND ${column} IS NOT NULL AND inplay_odds IS NULL`,
    params: [id],
  };
}

/** Proves the move landed: the source empty, the destination full. */
export function relabelVerifySql({ table, id, column }) {
  return { sql: `SELECT ${column} AS src, inplay_odds AS dst FROM ${table} WHERE id = ?`, params: [id] };
}
