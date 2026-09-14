#!/usr/bin/env node
// Rule 90 harness for scripts/check-collision-cleanup-plan.mjs.
// Every mutation is a way this plan could delete something it should not.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SRC = 'scripts/collision-cleanup-plan.mjs';
const CHECK = 'scripts/check-collision-cleanup-plan.mjs';
const BAK = `${SRC}.mutbak`;

const MUTATIONS = [
  { name: 'C1  brief-referenced rows stop being skipped',
    anchor: "    if (r.blocked_by_briefs > 0) { skipped.push({ ...r, reason: `brief references the stale row (${r.blocked_by_briefs})` }); continue; }",
    replace: '    if (false) { }',
    expect: 'a brief-referenced stale row is skipped, not deleted' },

  { name: 'C2  doubleheaders stop being skipped',
    anchor: "    if (r.population === 'two-real-games') { skipped.push({ ...r, reason: 'two real games, not a duplicate' }); continue; }",
    replace: '    if (false) { }',
    expect: 'a doubleheader mid-day, game 2 unplayed, is never deleted' },

  { name: 'C3  HUMAN verdicts stop being skipped',
    anchor: "    if (r.verdict === 'HUMAN') { skipped.push({ ...r, reason: 'no safe answer' }); continue; }",
    replace: '    if (false) { }',
    expect: 'and says it has no safe answer' },

  { name: 'C4  the merge overwrites instead of filling a gap',
    anchor: '    `${c} = COALESCE(${c}, (SELECT ${c} FROM ${table} WHERE id = ?))`).join(\', \');',
    replace: '    `${c} = (SELECT ${c} FROM ${table} WHERE id = ?)`).join(\', \');',
    expect: 'the merge fills a gap and cannot overwrite' },

  { name: 'C5  the delete targets the keeper instead of the stale row',
    anchor: '    deletes.push({ table: r.table, id: r.stale, keeper: r.keeper, date: r.date, sport: r.sport,',
    replace: '    deletes.push({ table: r.table, id: r.keeper, keeper: r.keeper, date: r.date, sport: r.sport,',
    expect: 'it deletes the stale row, not the keeper' },

  // The guard exists for future drift, so the mutation is the drift itself:
  // remove a mapping and the coverage assertion must go red. A contrived
  // fixture could not reach the guard, because today every LOSS_BEARING field
  // is mapped — which is exactly what the assertion pins.
  { name: 'C6  a loss-bearing field loses its column mapping',
    anchor: "  has_closing_odds: 'closing_odds',",
    replace: '',
    expect: 'every loss-bearing field maps to a real column' },

  { name: 'C8  the delete stops carrying the names it removes',
    anchor: "                   home: stale.home, away: stale.away });",
    replace: '                   });',
    expect: 'a delete carries the names it is about to remove' },

  // The one that matters for "82 only": a merge pair that slips through with
  // merges off is deleted WITHOUT its odds being copied anywhere.
  { name: 'C9  merges-off stops holding merge pairs back',
    anchor: "    if (r.merge_required.length && !mergesAllowed) {",
    replace: '    if (false) {',
    expect: 'with merges off a merge pair is held back, not deleted' },

  // The whole point of the symmetric form is that nothing is taken away. A plan
  // that grew a delete would be the old approach wearing the new name.
  { name: 'S1  the symmetric plan starts emitting deletes',
    anchor: "  return { merges, skipped, conflicts, deletes: [],",
    replace: "  return { merges, skipped, conflicts, deletes: merges.map(m => ({ table: m.table, id: m.stale })),",
    expect: 'a symmetric plan contains no deletes at all' },

  // THE MUTATION IS THE VERSION THAT SHIPPED FOR ONE DRY RUN — widening the fill
  // back to every LOSS_BEARING field, which wrote espn_event_id into the twin
  // and would have left nineteen `WHERE espn_event_id = ? LIMIT 1` lookups
  // without one answer.
  //
  // IT CANNOT REACH THAT ANY MORE, AND THE MUTATION IS HOW I KNOW. DIGEST_OF is
  // a second, independent guard: the four non-odds fields have no digest, so
  // the widened plan is refused for lack of evidence rather than writing
  // anything. The red line is the refusal, not an unwanted update — which is a
  // better failure than the one this mutation was written for.
  { name: 'S2  the fill widens past every loss-bearing field',
    anchor: "  const fields = LOSS_BEARING.filter(([f]) => FILL_FIELDS.includes(f));",
    replace: "  const fields = LOSS_BEARING;",
    expect: 'odds go to the row that lacks them' },

  // THE DEFECT THAT SHIPPED, REINSTATED. Comparing the boolean instead of the
  // digest is exactly what let two pairs with different closing lines be filed
  // as agreeing, and let the done condition agree with itself.
  { name: 'S7  agreement goes back to comparing the booleans',
    anchor: "      const da = ra[dig] ?? null, db = rb[dig] ?? null;",
    replace: "      const da = ra[f] ? 'y' : null, db = rb[f] ? 'y' : null;",
    expect: 'they are escalated as a conflict' },

  // A conflict quietly filed as a skip is a hazard reported as housekeeping.
  { name: 'S8  a value clash is downgraded to an ordinary skip',
    anchor: "      clash.push(col);",
    replace: "      continue;",
    expect: 'they are escalated as a conflict' },

  // Filling one column of a pair that still clashes on the other reports
  // progress while the hazard stays exactly where it was.
  { name: 'S9  a conflict stops blocking the fill on the other column',
    anchor: "    if (clash.length) {\n      conflicts.push({ ...c, columns: clash, ids: [ra.id, rb.id],",
    replace: "    if (false) {\n      conflicts.push({ ...c, columns: clash, ids: [ra.id, rb.id],",
    expect: 'a conflict on one column blocks the fill on the other' },

  // RULE 99. Absent digests read as two nulls, two nulls compare equal, and
  // every pair closes on evidence the census never served.
  { name: 'S10 a census with no digests reads as agreement',
    anchor: "    if (missing.length) {\n      skipped.push({ ...c, reason: `census served no ${missing.join(', ')}; cannot compare values` });\n      continue;\n    }",
    replace: "    if (false) { }",
    expect: 'and the skip names the missing evidence' },

  // Half the fill set is still a fill set: no throw, no error, and every pair
  // with only a closing line reported as already agreeing.
  { name: 'S5  the fill set loses closing odds',
    anchor: "export const FILL_FIELDS = ['has_opening_odds', 'has_closing_odds'];",
    replace: "export const FILL_FIELDS = ['has_opening_odds'];",
    expect: 'odds go to the row that lacks them' },

  // A name LOSS_BEARING does not have. One survivor means no throw, so the
  // check is the only thing standing between this and a silent half-fill.
  { name: 'S6  a fill field is misspelled',
    anchor: "export const FILL_FIELDS = ['has_opening_odds', 'has_closing_odds'];\n\n// THE DIGEST IS THE VALUE",
    replace: "export const FILL_FIELDS = ['has_opening_odds', 'has_clsoing_odds'];\n\n// THE DIGEST IS THE VALUE",
    expect: 'every fill field is a real LOSS_BEARING field' },

  // Two real games are not two halves of one. Filling one from the other would
  // invent a fact instead of completing one.
  { name: 'S3  doubleheaders get merged into each other',
    anchor: "    if (c.population === 'two-real-games') {\n      skipped.push({ ...c, reason: 'two real games, not a duplicate' });\n      continue;\n    }",
    replace: "    if (false) { }",
    expect: 'a doubleheader is never merged' },

  // DEFENCE IN DEPTH, AND THE MUTATION PROVED IT. Removing this skip does NOT
  // cause a write — the two empty-gap guards below stop it independently, so
  // the merge count stays 0 and that assertion passes. What is lost is the
  // REASON, and a dry run whose skipped list says nothing is a dry run a human
  // cannot audit. So S4 is pinned on the explanation, not the count.
  { name: 'S4  rows that already agree stop saying why they were skipped',
    anchor: "    if (!aToB.length && !bToA.length) {",
    replace: "    if (false) {",
    expect: 'and say so' },

  // Relabelling one row of the pair leaves the other standing as the answer —
  // which is the choosing this decision exists to avoid.
  { name: 'R1  only one row of the conflicting pair is relabelled',
    anchor: "    for (const id of k.ids)",
    replace: "    for (const id of k.ids.slice(0, 1))",
    expect: 'a conflicting pair relabels both rows' },

  // A gap is the fill's job. Relabelling it moves a real closing line out of
  // the column it belongs in.
  { name: 'R2  fillable gaps get relabelled too',
    anchor: "  const { conflicts } = buildSymmetricPlan(collisions);",
    replace: "  const { conflicts, merges } = buildSymmetricPlan(collisions); conflicts.push(...merges.map(m => ({ ...m, ids: [m.keeper, m.stale] })));",
    expect: 'a fillable gap is not relabelled' },

  // A copy leaves the blob in BOTH columns, which reads as "there is a closing
  // line AND it is in-play" and satisfies every consumer of either.
  { name: 'R3  the relabel copies instead of moving',
    anchor: "    sql: `UPDATE ${table} SET inplay_odds = ${column}, ${column} = NULL",
    replace: "    sql: `UPDATE ${table} SET inplay_odds = ${column}",
    expect: 'the relabel moves in one statement and clears the source' },

  // Without the destination guard, a re-run moves a NULL over a value that was
  // already relabelled and the observation is gone.
  { name: 'R4  the relabel loses its re-run guard',
    anchor: "           WHERE id = ? AND ${column} IS NOT NULL AND inplay_odds IS NULL`,",
    replace: "           WHERE id = ?`,",
    expect: 'the relabel moves in one statement and clears the source' },

  // An agreeing column is not a mislabelled price.
  { name: 'R5  every odds column moves, not just the clashing one',
    anchor: "    const cols = k.columns.filter(c => c === 'opening_odds' || c === 'closing_odds');",
    replace: "    const cols = ['opening_odds', 'closing_odds'];",
    expect: 'only the clashing column moves, not the agreeing one' },

  { name: 'C7  the DELETE becomes a predicate instead of an id list',
    anchor: '    sql: `DELETE FROM ${table} WHERE id IN (${ids.map(() => \'?\').join(\',\')})`,',
    replace: '    sql: `DELETE FROM ${table} WHERE 1=1`,',
    expect: 'the delete names ids and carries no predicate' },
];

let bad = 0;
for (const m of MUTATIONS) {
  const before = readFileSync(SRC, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) {
    bad++;
    console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s), expected 1. NOTHING WAS MUTATED.`);
    continue;
  }
  const after = before.replace(m.anchor, m.replace);
  if (after === before) { bad++; console.error(`  NO EFFECT  ${m.name}`); continue; }
  copyFileSync(SRC, BAK);
  writeFileSync(SRC, after);
  let out = '', code = 0;
  try { out = execFileSync('node', [CHECK], { encoding: 'utf8' }); }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  finally { copyFileSync(BAK, SRC); unlinkSync(BAK); }
  const red = out.split('\n').filter(l => l.startsWith('FAIL'));
  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}`); }
  else if (!red.some(l => l.includes(m.expect))) {
    bad++;
    console.error(`  WRONG REASON  ${m.name}\n          no FAIL line mentioned "${m.expect}".\n${red.join('\n')}`);
  } else console.log(`  caught  ${m.name}\n          by "${m.expect}" (${red.length} red)`);
}

execFileSync('node', ['--check', SRC]);
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}; ${SRC} restored and parsing`);
process.exit(bad ? 1 : 0);
