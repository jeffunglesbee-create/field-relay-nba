#!/usr/bin/env node
// Rule 90 for scripts/check-team-key-substitution.mjs.
//
// M1 is the one that mattered. The obvious mutation — delete the combining-mark
// replace — was written first, ran, and was NOT CAUGHT, because it changes no
// output: the final [^a-z0-9] class drops the mark anyway. That is a harness
// finding about the source, not a check failure, and it is why M1 targets
// normalize('NFKD') instead. See the comment on foldTeamName.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const CHECK = 'scripts/check-team-key-substitution.mjs';
const RESOLVER = 'src/identity-resolver.js';
const INDEX = 'src/index.js';
const sh = (c, a, t = 120000) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: t });

for (const f of [RESOLVER, INDEX]) {
  const dirty = sh('git', ['status', '--porcelain', '--', f]).trim();
  if (dirty) { console.error(`FAIL — ${f} is dirty; refusing to mutate.\n${dirty}`); process.exit(1); }
}

const MUTATIONS = [
  { file: RESOLVER,
    name: 'M1  NFKD decomposition removed — the accented base letter goes too',
    anchor: "    return String(name || '').normalize('NFKD')",
    replace: "    return String(name || '')",
    expect: 'A fold "San José St"' },
  { file: RESOLVER,
    name: 'M2  the derivation test is inverted — own-name keys flagged, aliases cleared',
    anchor: '    if (!key || key === folded) return null;',
    replace: '    if (!key || key !== folded) return null;',
    expect: 'B substitutedKey "Colorado"' },
  { file: RESOLVER,
    name: 'M3  the derivation test is dropped — every resolvable name is a substitution',
    anchor: '    if (!key || key === folded) return null;',
    replace: '    if (!key) return null;',
    expect: 'B substitutedKey "Colorado Buffaloes"' },
  { file: INDEX,
    name: 'M4  a second fold implementation returns to index.js',
    anchor: "                const substituted = [];",
    replace: "                const _fold = (t) => (t || '').normalize('NFKD').toLowerCase();\n                const substituted = [];",
    expect: 'D index.js carries no second fold implementation' },
  { file: INDEX,
    name: 'M5  the census stops reporting its denominator (Rule 91)',
    anchor: '                coverage: `scanned ${totals.rows_scanned} of ${totals.rows_total} rows `',
    replace: '                coverage: "scanned the archive",',
    expect: 'E census emits a coverage string' },
  { file: INDEX,
    name: 'M7  the named-rows list stops saying it was capped',
    anchor: '                rows_with_odds_under_a_substituted_key_found: examplesTotal,',
    replace: '',
    expect: 'E census reports found alongside shown' },
  { file: INDEX,
    name: 'M8  a one-sport scan stops declaring itself',
    anchor: '                sport_filter: sportFilter || null,',
    replace: '',
    expect: 'E census always carries sport_filter' },
  { file: INDEX,
    name: 'M9  the census stops saying which sports it could compare',
    anchor: '                sports_compared: [...keySetBySport.keys()],',
    replace: '',
    expect: 'E census reports which sports it could compare' },
  { file: INDEX,
    name: 'M10  the cross-sport list gains a silent cap',
    anchor: '                cross_sport_rows: crossRows,',
    replace: '                cross_sport_rows: crossRows.slice(0, 20),',
    expect: 'E cross-sport rows are uncapped' },
  { file: INDEX,
    name: 'M11  the classification reaches for the vendor instead of the archive',
    anchor: '            for (const [key, owners] of keyOwners) {',
    replace: '            if (fetchSportOddsLive) { /* noop */ }\n            for (const [key, owners] of keyOwners) {',
    expect: 'E census spends no Odds-API credit' },
  { file: INDEX,
    name: 'M12  soccer competitions stop counting as one family',
    anchor: "SOCCER_SPORT_LABEL_SET.has(sp) ? 'soccer' : String(sp).toUpperCase();",
    replace: "false ? 'soccer' : String(sp).toUpperCase();",
    expect: 'E soccer competitions count as one family' },
  { file: INDEX,
    name: 'M16  the family test becomes case-sensitive — wnba and WNBA split',
    anchor: "SOCCER_SPORT_LABEL_SET.has(sp) ? 'soccer' : String(sp).toUpperCase();",
    replace: "SOCCER_SPORT_LABEL_SET.has(sp) ? 'soccer' : sp;",
    expect: 'E labels differing only by case are one family' },
  { file: INDEX,
    name: 'M17  a count and a list share one name again',
    anchor: 'ambiguous_key_count: ambiguousKeys.length',
    replace: 'ambiguous_keys: ambiguousKeys.length',
    expect: 'E the count and the list have different names' },
  { file: INDEX,
    name: 'M18  rows are classified on the substituted key — Richmond loses its rows',
    anchor: '                const hAmb = r.hResolved && ambiguous.has(r.hResolved);',
    replace: '                const hAmb = r.hk && ambiguous.has(r.hk);',
    expect: 'E rows are classified on the resolved key' },
  { file: INDEX,
    name: 'M19  only substituted rows reach the classifier',
    anchor: '            for (const r of allRows) {',
    replace: '            for (const r of allRows.filter(x => x.hk || x.ak)) {',
    expect: 'E every row is kept for classification, not only substituted ones' },
  { file: INDEX,
    name: 'M20  a narrowed row list stops declaring itself',
    anchor: '                key_filter: keyFilter || null,',
    replace: '',
    expect: 'E census always carries key_filter' },
  { file: INDEX,
    name: 'M14  a single claimant is enough to call a key ambiguous',
    anchor: '                if (owners.size < 2) continue;',
    replace: '                if (owners.size < 1) continue;',
    expect: 'E a key is ambiguous only when two FAMILIES claim it' },
  { file: INDEX,
    name: 'M15  the report names the key but not who claims it',
    anchor: '                        names: [...o.names].sort(),',
    replace: '',
    expect: 'E both claimants are named, not just the suspect one' },
  { file: INDEX,
    name: 'M13  the soccer family set is relisted instead of derived',
    anchor: 'const SOCCER_SPORT_LABEL_SET = new Set(Object.values(SOCCER_LEAGUE_LABELS));',
    replace: "const SOCCER_SPORT_LABEL_SET = new Set(['EPL', 'MLS']);",
    expect: 'D the soccer family set is derived from SOCCER_LEAGUE_LABELS' },
  { file: INDEX,
    name: 'M21  the gap filter narrows the scan instead of the report',
    anchor: '                if (gapsSince && d < gapsSince) continue;',
    replace: '',
    expect: 'E the gap filter narrows the report, not the scan' },
  { file: INDEX,
    name: 'M22  the date column stops being selected, so every gap is undefined',
    anchor: '`SELECT id, sport, date, home, away, opening_odds, closing_odds\n                                   FROM ${table} ORDER BY id LIMIT ? OFFSET ?`',
    replace: '`SELECT id, sport, home, away, opening_odds, closing_odds\n                                   FROM ${table} ORDER BY id LIMIT ? OFFSET ?`',
    expect: 'E the scan selects the date column' },
  { file: INDEX,
    name: 'M23  named_rows returns [] when nothing was asked',
    anchor: '                named_rows: nameFilter ? named : null,',
    replace: '                named_rows: named,',
    expect: 'E named rows are null when unfiltered, not empty' },
  { file: INDEX,
    name: 'M24  the max date counts rows with no odds at all',
    anchor: '                    ? (named.filter(r => r.has_opening_odds)',
    replace: '                    ? (named.filter(r => true)',
    expect: 'E the max-date artifact counts only odds-carrying rows' },
  { file: INDEX,
    name: 'M6  the census gains a write',
    anchor: "env.ARCHIVE_DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`)",
    replace: "env.ARCHIVE_DB.prepare(`UPDATE ${table} SET sport = sport`)",
    expect: 'F census contains no UPDATE' },

  // The read-only guard now decomments before matching, because the route's own
  // comments describe a DELETE. This proves decommenting did not defang it: a
  // real DELETE in executable code must still be caught.
  { file: INDEX,
    name: 'M12 a real DELETE in the census survives the decomment',
    anchor: "                            `SELECT * FROM ${table} WHERE id IN (${chunk.map(() => '?').join(',')})`",
    replace: "                            `DELETE FROM ${table} WHERE id IN (${chunk.map(() => '?').join(',')})`",
    expect: 'F census contains no DELETE' },

  // Defect 2 of docs/CC-CMD-2026-09-11-epl-identity-resolve.md: a substituted key is counted by
  // corroboration against the row's own sport feed. M25 is the CC-CMD's own proposal, "reached
  // through a CANONICAL entry is RESOLVED", reduced to its effect: every alias hit is resolved.
  { file: RESOLVER,
    name: "M25 every alias hit is called resolved (the CC-CMD's literal rule)",
    anchor: "    return ownKeys.has(key) && alsoIn.length === 0 ? 'resolved' : 'substituted';",
    replace: "    return 'resolved';",
    expect: "G a key the sport's own feed lacks is substituted" },
  { file: RESOLVER,
    name: 'M26 a key another probed sport also carries is still resolved',
    anchor: "    return ownKeys.has(key) && alsoIn.length === 0 ? 'resolved' : 'substituted';",
    replace: "    return ownKeys.has(key) ? 'resolved' : 'substituted';",
    expect: "G a key in the own feed AND another probed sport's is not called resolved" },
  { file: RESOLVER,
    name: 'M27 an empty feed is read as no feed',
    anchor: "    if (!ownKeys || typeof ownKeys.has !== 'function') return 'unchecked';",
    replace: "    if (!ownKeys || typeof ownKeys.has !== 'function' || ownKeys.size === 0) return 'unchecked';",
    expect: 'G ...and an EMPTY feed is not "no feed"' },
  { file: RESOLVER,
    name: 'M28 no feed at all is read as resolved',
    anchor: "    if (!ownKeys || typeof ownKeys.has !== 'function') return 'unchecked';",
    replace: "    if (!ownKeys || typeof ownKeys.has !== 'function') return 'resolved';",
    expect: 'G no feed at all is unchecked, never resolved' },
  { file: INDEX,
    name: 'M29 the handler stops classifying',
    anchor: "                    const verdict = classifySubstitution(sub.key, vendorKeysBySport.get(sport), alsoIn);",
    replace: "                    const verdict = 'substituted';",
    expect: "G the handler classifies with the shared function, against the row's OWN sport feed" },
  { file: INDEX,
    name: 'M34 the classifier call is replaced and survives only in a trailing comment',
    anchor: "                    const verdict = classifySubstitution(sub.key, vendorKeysBySport.get(sport), alsoIn);",
    replace: "                    const verdict = 'substituted'; // const verdict = classifySubstitution(sub.key, vendorKeysBySport.get(sport), alsoIn);",
    expect: "G the handler classifies with the shared function, against the row's OWN sport feed" },
  { file: INDEX,
    name: 'M30 every verdict is counted under one name',
    anchor: "                    report[`key_${verdict}`]++;",
    replace: "                    report.key_substituted++;",
    expect: 'G the handler counts each verdict under its own name' },
  { file: INDEX,
    name: 'M31 the raw count returns beside the split',
    anchor: "                report.matched   += matched.length;",
    replace: "                report.key_substituted += substituted.length;\n                report.matched   += matched.length;",
    expect: 'G the raw count is gone' },
  { file: INDEX,
    name: 'M32 an entry stops saying which way it was counted',
    anchor: "                    sub.corroborated = verdict === 'unchecked' ? null : verdict === 'resolved';",
    replace: "",
    expect: 'G each entry says which way it was counted' },
  { file: INDEX,
    name: 'M33 the report stops starting key_resolved at zero',
    anchor: "key_resolved: 0, key_substituted: 0,\n                             key_unchecked: 0,",
    replace: "key_substituted: 0,\n                             key_unchecked: 0,",
    expect: 'G the report starts all three counters at zero' },
];

let bad = 0;
for (const m of MUTATIONS) {
  const before = fs.readFileSync(m.file, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) {
    bad++; console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s) in ${m.file}, expected 1.`
                       + ` NOTHING WAS MUTATED — harness defect, not a result.`);
    continue;
  }
  fs.writeFileSync(m.file, before.replace(m.anchor, m.replace));
  if (!fs.readFileSync(m.file, 'utf8').includes(m.replace)) {
    bad++; console.error(`  NOTAPPLIED  ${m.name}`); sh('git', ['checkout', '--', m.file]); continue;
  }

  let out = '', code = 0, hung = false;
  try { out = sh('node', [CHECK], 20000); }
  catch (e) {
    if (e.killed || e.signal) { hung = true; code = 1; }
    code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`;
  }
  sh('git', ['checkout', '--', m.file]);

  if (hung) { console.log(`  caught  ${m.name}\n          by HANGING the check (still a red, still reported)`); continue; }
  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}\n          the check still passed.`); }
  else if (!(out.match(/^FAIL {2}.*$/gm) || []).some(l => l.includes(m.expect))) {
    bad++; console.error(`  WRONG REASON  ${m.name}\n          failed, but no FAIL line mentioned "${m.expect}". Output:\n${out.slice(0, 1200)}`);
  } else {
    const n = (out.match(/^FAIL {2}/gm) || []).length;
    console.log(`  caught  ${m.name}\n          by "${m.expect}" (${n} assertion(s) went red)`);
  }
}

for (const f of [RESOLVER, INDEX]) {
  const post = sh('git', ['status', '--porcelain', '--', f]).trim();
  if (post) { console.error(`FAIL — ${f} not restored:\n${post}`); process.exit(1); }
}
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}; each asserted its anchor unique`
          + ` and its effect present before the verdict; ${RESOLVER} and ${INDEX} restored clean`);
if (bad) { console.error(`FAIL — ${bad} mutation(s) not caught or not applied.`); process.exit(1); }
console.log('PASS');
