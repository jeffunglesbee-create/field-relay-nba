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
    anchor: '                    for (const [other, keys] of keySetBySport) {',
    replace: '                    if (fetchSportOddsLive) { /* noop */ }\n                    for (const [other, keys] of keySetBySport) {',
    expect: 'E census spends no Odds-API credit' },
  { file: INDEX,
    name: 'M6  the census gains a write',
    anchor: "env.ARCHIVE_DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`)",
    replace: "env.ARCHIVE_DB.prepare(`UPDATE ${table} SET sport = sport`)",
    expect: 'F census contains no UPDATE' },
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
