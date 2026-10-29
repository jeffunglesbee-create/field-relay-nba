#!/usr/bin/env node
// Rule 90 harness for the archive-counting rule in scripts/check-seed-coverage.mjs.
//
// Each mutation breaks one clause of archivedCount or its parser, and the --self-test must go red on that clause's
// own FAIL line. An anchor that is not unique, a mutation that did not apply, or a crash with no FAIL line is a
// harness defect, reported as one and never counted as a catch.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const SRC = 'scripts/check-seed-coverage.mjs'
const MUTATIONS = [
  { name: 'S1  the individual flag is never parsed',
    anchor: "individual: /\\bindividual:\\s*true\\b/.test(m[4])", replace: 'individual: false',
    expect: 'the cron parser reads the individual flag' },
  { name: 'S2  archivedCount ignores the individual rule and counts by label',
    anchor: "  return games.filter(g => row.individual\n    ? g.sport === row.sport && g.league === row.label\n    : g.sport === row.label).length",
    replace: "  return games.filter(g => g.sport === row.label).length",
    expect: 'golf-aware rows (sport=golf, league=PGA Tour) count' },
  { name: 'S3  the category-error row also counts for an individual competition',
    anchor: "? g.sport === row.sport && g.league === row.label\n", replace: "? (g.sport === row.sport && g.league === row.label) || g.sport === row.label\n",
    expect: 'the category-error row (sport=PGA Tour) does NOT count' },
  { name: "S4  the individual rule drops the league, so another tour's rows count",
    anchor: "? g.sport === row.sport && g.league === row.label\n", replace: "? g.sport === row.sport\n",
    expect: "another tour's golf row does not count" },
  { name: 'S5  a team competition is counted by the ESPN sport name',
    anchor: "    : g.sport === row.label).length", replace: "    : g.sport === row.sport).length",
    expect: 'a team competition is still counted by its label' },
  { name: 'S6  the live half goes back to an inline rule',
    anchor: "archive: archivedCount(games, r)", replace: "archive: games.filter(g => g.sport === r.label).length",
    expect: 'the live half counts through archivedCount' },
]

let bad = 0
for (const m of MUTATIONS) {
  const before = readFileSync(SRC, 'utf8')
  const hits = before.split(m.anchor).length - 1
  if (hits !== 1) { bad++; console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s), expected 1. NOTHING WAS MUTATED.`); continue }
  const after = before.replace(m.anchor, m.replace)
  if (after === before) { bad++; console.error(`  NO EFFECT  ${m.name}`); continue }
  copyFileSync(SRC, SRC + '.mutbak')
  writeFileSync(SRC, after)
  let out = '', code = 0
  try { out = execFileSync('node', [SRC, '--self-test'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}` }
  finally { copyFileSync(SRC + '.mutbak', SRC); unlinkSync(SRC + '.mutbak') }
  const red = out.split('\n').filter(l => l.startsWith('  FAIL  '))
  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}`) }
  else if (!red.length) { bad++; console.error(`  CRASH  ${m.name}\n          exit ${code} with no FAIL line (a harness or syntax error, not a catch).\n${out.slice(-400)}`) }
  else if (!red.some(l => l.includes(m.expect))) { bad++; console.error(`  WRONG REASON  ${m.name}\n          no FAIL line mentioned "${m.expect}".\n${red.join('\n')}`) }
  else console.log(`  caught  ${m.name}\n          by "${m.expect}" (${red.length} red)`)
}

execFileSync('node', ['--check', SRC])
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${SRC} --self-test; each asserted its anchor unique and its effect present; the source is restored and parses`)
process.exit(bad ? 1 : 0)
