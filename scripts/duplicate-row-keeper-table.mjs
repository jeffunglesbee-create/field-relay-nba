#!/usr/bin/env node
// CC-CMD-2026-09-13-archive-duplicate-rows Task 0.
//
// Reads a committed identity-ambiguity-watch artifact and emits, per collision,
// which row is the keeper and WHY — or that there is no safe answer and a human
// must look. Read-only: it consumes a file and writes two files. It has no D1
// access and no code path that could acquire one.
//
// THE RULES ARE ORDERED AND EACH NAMES ITS EVIDENCE. A classifier that returns a
// keeper for every collision is the failure mode here — the valuable output is
// the set it REFUSES to decide, because that is the set a DELETE must not touch.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// The relay's OWN scheme classifier, imported rather than restated. It already
// encodes which shape is ours and which belongs to the external writer, and a
// second copy here would be the source-versus-copy substitution this repo's
// rules prohibit.
import { idScheme } from '../src/d1-provenance.js';

const scored = r => r.home_score != null || r.away_score != null;
const sameScore = (a, b) => a.home_score === b.home_score && a.away_score === b.away_score;

// One pair -> a verdict. Exported so checks import the real decision rather than
// restating it: the first version of check-ambiguous-team-identity.mjs
// re-implemented the join it verified, and a mutation that broke the real
// function left it green.
export function decide([a, b]) {
  // 1. Scores disagree. No rule can pick, and picking destroys a result.
  if (scored(a) && scored(b) && !sameScore(a, b))
    return { verdict: 'HUMAN', keeper: null, stale: null,
             why: `both scored and the scores DIFFER (${a.home_score}-${a.away_score} vs ${b.home_score}-${b.away_score})` };
  // 2. Exactly one carries a result. The other can never be scored now — the
  //    fixture has been played and resolution went to its sibling's id.
  if (scored(a) !== scored(b)) {
    const k = scored(a) ? a : b, s = scored(a) ? b : a;
    return { verdict: 'KEEP_SCORED', keeper: k.id, stale: s.id,
             why: `only ${k.id} carries a result (${k.home_score}-${k.away_score}); ${s.id} is unscored and cannot now be scored` };
  }
  // 3. Both scored, scores agree. The ESPN event id is the external anchor.
  if (scored(a) && scored(b)) {
    const withEspn = [a, b].filter(r => r.espn_event_id);
    if (withEspn.length === 1)
      return { verdict: 'KEEP_ESPN', keeper: withEspn[0].id,
               stale: (withEspn[0] === a ? b : a).id,
               why: `identical scores; only ${withEspn[0].id} carries espn_event_id ${withEspn[0].espn_event_id}` };
    return { verdict: 'HUMAN', keeper: null, stale: null,
             why: `both scored with identical scores and ${withEspn.length === 2 ? 'both' : 'neither'} carry an espn_event_id — nothing distinguishes them` };
  }
  // 4. Neither scored. Future fixtures, or abandoned imports.
  const withEspn = [a, b].filter(r => r.espn_event_id);
  if (withEspn.length === 1)
    return { verdict: 'KEEP_ESPN_UNSCORED', keeper: withEspn[0].id,
             stale: (withEspn[0] === a ? b : a).id,
             why: `neither scored; only ${withEspn[0].id} carries espn_event_id ${withEspn[0].espn_event_id}` };
  return { verdict: 'HUMAN', keeper: null, stale: null,
           why: `neither scored and ${withEspn.length === 2 ? 'both' : 'neither'} carry an espn_event_id — nothing distinguishes them` };
}

// FIELDS WHOSE LOSS A DELETE CANNOT BE ALLOWED TO CAUSE.
//
// MEASURED, NOT ANTICIPATED. The first run of this classifier marked 114
// collisions deletable, and 30 of those would have destroyed odds: in the
// 2026-07-22 MLS population EACH ROW HOLDS HALF THE TRUTH — one carries the
// result, the ESPN anchor and finalized_at, the other carries the opening and
// closing lines and the properly-formed team names. `Austin` vs `Austin FC`.
// Deleting either loses something real, so neither is a delete; it is a merge,
// and a merge is a different authorisation.
const LOSS_BEARING = [
  ['has_opening_odds', r => r.has_opening_odds],
  ['has_closing_odds', r => r.has_closing_odds],
  ['espn_event_id', r => r.espn_event_id != null],
  ['venue', r => r.venue != null],
  ['start_time', r => r.start_time != null],
  ['finalized_at', r => r.finalized_at != null],
];

// BOTH OVERRIDES ARE APPLIED HERE, NOT IN decide(), because they override a
// verdict rather than participating in it. The stale row stays correctly
// identified; what changes is whether deleting it is safe.
//
//   join safety  — a row a brief points at cannot be deleted, however clearly
//                  it is the stale one. briefs.game_id joins games.id in
//                  src/analytics-engine.js and the 2026-08-09 cleanup gated its
//                  DELETE on exactly this.
//   data loss    — a row holding a field the keeper lacks is a merge, not a
//                  delete. See LOSS_BEARING.
// THE THREE POPULATIONS, and they are not one problem.
//
//   external-vs-ours  one row is dash-scheme, which src/d1-provenance.js
//                     establishes no path in this repository can write.
//                     Converging id schemes is not available for these — we do
//                     not control the other writer.
//   ours-vs-ours      both rows are ours: the residue of our own id migrations.
//   two-real-games    both carry a DIFFERENT espn_event_id. Not duplicates at
//                     all — a doubleheader is two real games, and a dedupe on
//                     (sport, date, home, away) would merge them.
//
// Computed in classify() rather than at print time so it is reachable by the
// check. A classification that only exists inside a CLI body is untestable.
export function population(rows) {
  const [x, y] = rows;
  if (idScheme(x.id) === 'dash' || idScheme(y.id) === 'dash') return 'external-vs-ours';
  if (x.espn_event_id && y.espn_event_id && x.espn_event_id !== y.espn_event_id)
    return 'two-real-games';
  return 'ours-vs-ours';
}

export function classify(collisions) {
  return collisions.map(c => {
    const [a, b] = c.games;
    const dec = decide([a, b]);
    const staleRow = dec.stale ? [a, b].find(r => r.id === dec.stale) : null;
    const keepRow = dec.keeper ? [a, b].find(r => r.id === dec.keeper) : null;
    const blocked = !!(staleRow && staleRow.briefs_referencing > 0);
    const mergeRequired = (staleRow && keepRow)
      ? LOSS_BEARING.filter(([, has]) => has(staleRow) && !has(keepRow)).map(([f]) => f)
      : [];
    return {
      table: c.table, date: c.date, sport: c.sport, pair_key: c.pair_key,
      population: population([a, b]),
      ...dec,
      deletable: !!(dec.stale && !blocked && mergeRequired.length === 0),
      merge_required: mergeRequired,
      blocked_by_briefs: blocked ? staleRow.briefs_referencing : 0,
      rows: [a, b].map(r => ({
        id: r.id, home: r.home, away: r.away, league: r.league ?? null,
        id_scheme: idScheme(r.id),
        score: r.home_score == null && r.away_score == null ? null : `${r.home_score}-${r.away_score}`,
        espn_event_id: r.espn_event_id ?? null,
        series_key: r.series_key ?? null,
        finalized_at: r.finalized_at ?? null,
        odds: `${r.has_opening_odds ? 'O' : '-'}${r.has_closing_odds ? 'C' : '-'}`,
        briefs_referencing: r.briefs_referencing,
      })),
    };
  });
}

const POPULATION = {
  'external-vs-ours': 'one row is dash-scheme — no path in this repo can write it',
  'ours-vs-ours': 'both ours; the residue of an id-scheme migration',
  'two-real-games': 'different ESPN event ids — a doubleheader, not a duplicate',
};

const MEANING = {
  KEEP_SCORED: 'one row carries the result, the other is permanently unscored',
  KEEP_ESPN: 'identical scores, one row carries the external ESPN anchor',
  KEEP_ESPN_UNSCORED: 'neither played yet, one row carries the ESPN anchor',
  HUMAN: 'nothing in the data distinguishes them, or the scores disagree',
};

function main() {
  const src = process.argv[2];
  if (!src) { console.error('usage: duplicate-row-keeper-table.mjs <watch-artifact.json>'); process.exit(2); }
  const d = JSON.parse(readFileSync(src, 'utf8'));

  // A failed detail read leaves every briefs_referencing null, and a deletion
  // decision made from null join-safety data is exactly the mistake that field
  // exists to prevent. Refuse rather than decide.
  if (d.same_slate_pair_detail_error) {
    console.error(`REFUSING: artifact reports same_slate_pair_detail_error = ${d.same_slate_pair_detail_error}`);
    process.exit(1);
  }
  const collisions = d.same_slate_pair_colliding || [];
  if (!collisions.length) { console.log('no collisions in artifact; nothing to decide'); process.exit(0); }

  const rows = classify(collisions);
  const byVerdict = {};
  for (const r of rows) byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
  const byPopulation = {};
  for (const r of rows) byPopulation[r.population] = (byPopulation[r.population] || 0) + 1;

  const deletable = rows.filter(r => r.deletable);
  const blocked = rows.filter(r => r.blocked_by_briefs > 0);
  const merge = rows.filter(r => r.merge_required.length);
  const human = rows.filter(r => r.verdict === 'HUMAN');
  const coverage = d.coverage || d.archive_coverage || '(coverage absent from artifact)';

  const stamp = (d.checked_at || new Date().toISOString()).replace(/[:.]/g, '-');
  const jsonPath = `outbox/duplicate-row-keeper-table-${stamp}.json`;
  writeFileSync(jsonPath, JSON.stringify({
    source_artifact: src, archive_coverage: coverage,
    collisions: rows.length, by_verdict: byVerdict, by_population: byPopulation,
    deletable: deletable.length, blocked_by_briefs: blocked.length,
    needs_merge: merge.length, needs_human: human.length,
    rows_referenced_by_a_brief: rows.reduce((n, r) =>
      n + r.rows.filter(g => g.briefs_referencing > 0).length, 0),
    decisions: rows,
  }, null, 2));

  const md = ['# Duplicate-row keeper table', '',
    `Source: \`${src}\` · archive coverage: \`${coverage}\``,
    'Generated by `scripts/duplicate-row-keeper-table.mjs`. Read-only — it decides, it does not delete.',
    '',
    `**${rows.length} collisions.** ${deletable.length} have a stale row safe to delete, `
    + `${merge.length} need a merge first because the stale row holds a field the keeper lacks, `
    + `${blocked.length} are blocked by a brief reference, ${human.length} have no safe answer.`,
    '', '| population | n | what it is |', '|---|---:|---|',
    ...Object.entries(byPopulation).sort((x, y) => y[1] - x[1]).map(([k, v]) =>
      `| \`${k}\` | ${v} | ${POPULATION[k]} |`),
    '', '| verdict | n | meaning |', '|---|---:|---|'];
  for (const [k, v] of Object.entries(byVerdict).sort((x, y) => y[1] - x[1]))
    md.push(`| \`${k}\` | ${v} | ${MEANING[k] || ''} |`);
  md.push('', '## Every collision', '',
          '| table | date | sport | keeper | stale | verdict | why |', '|---|---|---|---|---|---|---|');
  for (const r of rows)
    md.push(`| ${r.table.replace('_games', '')} | ${r.date} | ${r.sport} | `
          + `${r.keeper ? '`' + r.keeper + '`' : '—'} | ${r.stale ? '`' + r.stale + '`' : '—'} | `
          + `${r.verdict}${r.blocked_by_briefs ? ' (BRIEF-BLOCKED)' : ''}`
          + `${r.merge_required.length ? ' (MERGE: ' + r.merge_required.join(', ') + ')' : ''} | ${r.why} |`);
  const mdPath = `outbox/duplicate-row-keeper-table-${stamp}.md`;
  writeFileSync(mdPath, md.join('\n') + '\n');

  // Rule 91: the denominator in the printed result, not only in the file.
  console.log(`${rows.length} collisions decided over ${coverage}`);
  for (const [k, v] of Object.entries(byVerdict).sort((x, y) => y[1] - x[1]))
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log('  ----');
  for (const [k, v] of Object.entries(byPopulation).sort((x, y) => y[1] - x[1]))
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log('  ----');
  console.log(`  ${String(deletable.length).padStart(4)}  stale row safe to delete`);
  console.log(`  ${String(merge.length).padStart(4)}  merge first — stale row holds a field the keeper lacks`);
  // BOTH NUMBERS, ALWAYS. `blocked` counts only collisions where a NOMINATED
  // stale row is brief-referenced, so it reads 0 whenever the verdicts are
  // HUMAN — and a reader takes 0 to mean "no briefs are involved", which is the
  // opposite of true when the escalated set is the one full of them.
  const referencedRows = rows.reduce((n, r) =>
    n + r.rows.filter(g => g.briefs_referencing > 0).length, 0);
  console.log(`  ${String(blocked.length).padStart(4)}  blocked by a brief reference (nominated stale rows only)`);
  console.log(`  ${String(referencedRows).padStart(4)}  rows referenced by a brief, across every verdict`);
  console.log(`  ${String(human.length).padStart(4)}  need a human`);
  console.log(`\nwrote ${mdPath}\nwrote ${jsonPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
