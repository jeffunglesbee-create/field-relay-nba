#!/usr/bin/env node
// Census of every stored odds pairing (docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md,
// TASK 0). Offline over a JSON export of odds_history joined to its archive row;
// 0 credits, no D1 access of its own.
//
//   node scripts/census-odds-pairs.mjs [outbox/fixture-odds-pairs-2026-10-19.json]
//
// The default file is the committed export; its `meta` holds the SELECT, the
// denominator and the aggregates it was checked against.
//
// Each row is classed by what the TEAM NAMES support, with the real matcher:
//   both    both sides match, in one direction        (stage-1 evidence)
//   one     only one side matches                     (stage-2 evidence)
//   none    neither side matches                      (no name evidence)
// and then cross-checked, never filtered, by the kickoff instant (the module's
// standing ruling: an independent check, not a key).
//
// Also reported, because the same rows show them:
//   - BACKWARDS: a swapped pairing whose game-table moneyline carries the
//     vendor's home price on the archive's home team;
//   - SHARED: one vendor event stored against two or more archive games;
//   - UNITS: an odds_history price that is already American (|x| >= 100 or < 1)
//     whose game-table value equals decimalToAmerican(x), i.e. converted twice;
//   - SYNCED: for EVERY row, whether the game row's opening moneyline is this
//     odds_history row converted by position, converted with the two teams
//     exchanged, converted twice (UNITS), or none of these (another writer
//     filled it first; the sync only fills NULL columns). An exchange on a
//     straight pairing, or a positional copy on a swapped one, is BACKWARDS
//     (TASK 0.2);
//   - REPRODUCED: each one-sided row, and each row whose kickoff gap exceeds 90
//     minutes, run through the CURRENT matchSlate on its own reduced slate (the
//     archive row and the vendor event). Run at the commit before the stage-2
//     guard and after it, this section is the before/after record (TASK 0.3).
import { readFileSync } from 'node:fs';
import { nameMatches, pairOrientation, matchSlate } from '../src/odds-name-match.js';

const file = process.argv[2] || 'outbox/fixture-odds-pairs-2026-10-19.json';
const parsed = JSON.parse(readFileSync(file, 'utf8'));
const rows = Array.isArray(parsed) ? parsed : parsed.rows;

// The sync's own conversion (.github/scripts/odds-backfill.js), copied here as
// a measurement only: the question is "what would the sync have written".
const decimalToAmerican = (d) => {
  if (d == null || !Number.isFinite(Number(d))) return null;
  const x = Number(d);
  if (x >= 2) return Math.round((x - 1) * 100);
  if (x > 1) return Math.round(-100 / (x - 1));
  return null;
};
const t = (s) => { const v = Date.parse(s || ''); return Number.isFinite(v) ? v : null; };

const out = { total: rows.length, both: 0, one: 0, none: 0, swapped: 0, unoriented: [], backwards: [], gapOver90: [], oneSided: [], noneRows: [], shared: [], units: [], noStart: 0, synced: {}, signs: [], repro: [] };
const byEvent = new Map();
for (const r of rows) {
  const g = { home: r.a_home, away: r.a_away }, p = { home_team: r.v_home, away_team: r.v_away };
  const hh = nameMatches(g.home, p.home_team), aa = nameMatches(g.away, p.away_team);
  const ah = nameMatches(g.away, p.home_team), ha = nameMatches(g.home, p.away_team);
  const cls = (hh && aa) || (ah && ha) ? 'both' : (hh || aa || ah || ha) ? 'one' : 'none';
  out[cls]++;
  const ori = pairOrientation(g, p);
  if (ori === 'swapped') out.swapped++;
  if (!ori) out.unoriented.push(`${r.id} (${r.a_away} @ ${r.a_home} | ${r.v_away} @ ${r.v_home})`);
  const gap = t(r.commence_time) != null && t(r.start_time) != null ? Math.round((t(r.commence_time) - t(r.start_time)) / 60000) : null;
  if (gap == null) out.noStart++;
  const tag = `${r.id} | ${r.sport} ${r.date} ${r.snapshot_type} | archive ${r.a_away} @ ${r.a_home} | vendor ${r.v_away} @ ${r.v_home} | gap ${gap ?? 'n/a'} min | ${cls}/${ori}`;
  if (cls === 'one') out.oneSided.push({ tag, side: hh ? 'home' : aa ? 'away' : ah ? 'away->vhome' : 'home->vaway', gap,
    other: hh ? `${r.a_away} vs ${r.v_away}` : aa ? `${r.a_home} vs ${r.v_home}` : ah ? `${r.a_home} vs ${r.v_away}` : `${r.a_away} vs ${r.v_home}` });
  if (cls === 'none') out.noneRows.push(tag);
  if (gap != null && Math.abs(gap) > 90) out.gapOver90.push(tag);
  // BACKWARDS: the game row's home moneyline equals what positional conversion
  // of the vendor HOME price gives, on a pairing the names say is swapped.
  if (ori === 'swapped' && r.opening_odds_ml_home != null) {
    const positional = decimalToAmerican(r.home_ml), byTeam = decimalToAmerican(r.away_ml);
    out.backwards.push(`${tag} | game home ${r.opening_odds_ml_home} | positional ${positional} | by team ${byTeam} | ${Number(r.opening_odds_ml_home) === positional ? 'BACKWARDS' : Number(r.opening_odds_ml_home) === byTeam ? 'correct' : 'neither (other writer?)'}`);
  }
  // UNITS: odds_history already American, game row converted again.
  for (const [side, src, game] of [['home', r.home_ml, r.opening_odds_ml_home], ['away', r.away_ml, r.opening_odds_ml_away]]) {
    const x = Number(src);
    if (src == null || game == null || !Number.isFinite(x)) continue;
    const american = x <= -100 || x >= 100;
    if (american && Number(game) === decimalToAmerican(x)) out.units.push(`${tag} | ${side} odds_history ${x} -> game ${game}`);
  }
  // SYNCED: which conversion of THIS odds_history row, if any, the game row holds.
  {
    const gh = r.opening_odds_ml_home, ga = r.opening_odds_ml_away;
    const ch = decimalToAmerican(r.home_ml), ca = decimalToAmerican(r.away_ml);
    const same = (x, y) => (x == null ? null : Number(x)) === (y == null ? null : Number(y));
    const how = gh == null && ga == null ? 'empty'
      : same(gh, ch) && same(ga, ca) ? 'positional'
      : same(gh, ca) && same(ga, ch) ? 'exchanged'
      : 'other writer';
    out.synced[how] = (out.synced[how] || 0) + 1;
    if ((ori === 'straight' && how === 'exchanged') || (ori === 'swapped' && how === 'positional'))
      out.signs.push(`${tag} | game ${gh}/${ga} | odds_history ${r.home_ml}/${r.away_ml} | ${how} on a ${ori} pairing`);
  }
  if (cls === 'one' || (gap != null && Math.abs(gap) > 90)) {
    const s = matchSlate([{ id: r.game_id, home: r.a_home, away: r.a_away }],
      [{ id: 'ev', home_team: r.v_home, away_team: r.v_away, commence_time: r.commence_time }], r.date);
    const m = s.byGameId.get(r.game_id);
    out.repro.push(`${m ? `PAIRED stage ${m.stage}${m.swapped ? ' swapped' : ''}` : `REFUSED (contradicted ${s.contradicted ?? 'n/a'}, ambiguous ${s.ambiguous}, out of window ${s.droppedOutOfWindow})`} | ${cls} | gap ${gap ?? 'n/a'} | ${r.id} | ${r.a_away} @ ${r.a_home} <- ${r.v_away} @ ${r.v_home}`);
  }
  const key = `${r.snapshot_type}|${r.v_home}|${r.v_away}|${r.commence_time}`;
  byEvent.set(key, [...(byEvent.get(key) || []), `${r.game_id} (${r.a_away} @ ${r.a_home})`]);
}
for (const [k, ids] of byEvent) if (ids.length > 1) out.shared.push(`${k} <- ${ids.join(' ; ')}`);

// A tally of keys, not a sum of fields: each key counts the items carrying it.
const by = (arr, f) => {
  const m = {};
  for (const x of arr) { const k = f(x); m[k] = k in m ? m[k] + 1 : 1; }
  return m;
};
console.log(`CENSUS of ${out.total} odds_history rows (odds_history joined to regular_season_games), file ${file}`);
console.log(`  name evidence: both sides ${out.both}, one side ${out.one}, neither ${out.none}`);
console.log(`  orientation: ${out.swapped} swapped, ${out.unoriented.length} unreadable; ${out.noStart} rows have no archive start_time (no kickoff cross-check)`);
for (const x of out.unoriented) console.log(`    unreadable: ${x}`);
console.log(`\nONE-SIDED (stage-2 class) — ${out.oneSided.length}, by sport: ${JSON.stringify(by(out.oneSided, (x) => x.tag.split(' | ')[1].split(' ')[0]))}`);
for (const x of out.oneSided) console.log(`  ${x.tag}\n      matched ${x.side}; unmatched side: ${x.other}`);
console.log(`\nNO NAME EVIDENCE — ${out.noneRows.length}`);
for (const x of out.noneRows) console.log(`  ${x}`);
console.log(`\nKICKOFF GAP OVER 90 MIN (any class) — ${out.gapOver90.length} of ${out.total - out.noStart} with a start_time`);
for (const x of out.gapOver90) console.log(`  ${x}`);
console.log(`\nSWAPPED, checked against the game row — ${out.backwards.length}`);
for (const x of out.backwards) console.log(`  ${x}`);
console.log(`\nONE VENDOR EVENT STORED AGAINST 2+ GAMES — ${out.shared.length}`);
for (const x of out.shared) console.log(`  ${x}`);
console.log(`\nSYNCED FROM THIS ROW? (game opening moneyline vs this odds_history row, all ${out.total}) ${JSON.stringify(out.synced)}`);
console.log(`  'other writer' = neither conversion matches, so another writer filled the column first; 'positional' includes ties where both teams' prices convert the same way.`);
console.log(`BACKWARDS (exchanged on a straight pairing, or positional on a swapped one) — ${out.signs.length}`);
for (const x of out.signs) console.log(`  ${x}`);
const tally = by(out.repro, (x) => x.split(' | ')[0].replace(/ \(.*$/, ''));
console.log(`\nREPRODUCED with the current matchSlate on a reduced slate — ${out.repro.length} rows (one-sided, or kickoff gap > 90): ${JSON.stringify(tally)}`);
for (const x of out.repro) console.log(`  ${x}`);
console.log(`\nAMERICAN PRICE CONVERTED AGAIN BY THE SYNC — ${out.units.length} side(s) on ${new Set(out.units.map((u) => u.split(' | ')[0])).size} row(s)`);
for (const x of out.units.slice(0, 40)) console.log(`  ${x}`);
if (out.units.length > 40) console.log(`  … ${out.units.length - 40} more`);
