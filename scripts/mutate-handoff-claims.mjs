#!/usr/bin/env node
// Rule 90 for the handoff-claims guard.
//
// H1 is the one that matters. It restores the parser that skipped headings —
// the shape this guard was WRITTEN with, which found zero claims in the very
// document it exists for, because "### OPEN — ... is UNRUN" is a heading. It
// was caught by the self-test on the first run, not by review.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const WATCH = 'scripts/check-handoff-claims.mjs';
const SELF  = [WATCH, '--self-test'];

if (spawnSync('git', ['diff', '--quiet', '--', WATCH]).status !== 0) {
  console.log(`FAIL — ${WATCH} has unstaged changes; restore would lose them.`);
  process.exit(1);
}
if (spawnSync('node', SELF, { stdio: 'ignore' }).status !== 0) {
  console.log(`FAIL — ${WATCH} --self-test is already red on clean source.`);
  process.exit(1);
}
console.log(`baseline: ${WATCH} --self-test passes on clean source\n`);

const MUTATIONS = [
  { name: 'H1 headings are skipped before they are read',
    anchor: '    if (isHeading) section = line.replace(/^#+\\s*/, \'\').trim();',
    replace: '    if (isHeading) { section = line.replace(/^#+\\s*/, \'\').trim(); continue; }',
    catches: 'the original bug — the 2026-09-19 claim lived in a heading, so the guard found nothing to check' },

  { name: 'H2 a failed run counts as the thing having happened',
    anchor: "  const after = runs.filter(r => r && r.conclusion === 'success'",
    replace: '  const after = runs.filter(r => r',
    catches: 'a run that FAILED did not do the thing, and would clear a claim that is still true' },

  { name: 'H3 runs before the close-out contradict it',
    anchor: "    && String(r.run_started_at || '').slice(0, 10) >= closeOutDate);",
    replace: '    && true);',
    catches: 'an older run is exactly what the close-out was written knowing about; every claim goes red' },

  { name: 'H4 an unreadable run list reads as agreement',
    anchor: "  if (!Array.isArray(runs)) return { state: 'unreadable', claim };",
    replace: "  if (!Array.isArray(runs)) return { state: 'consistent', claim };",
    catches: 'an API failure silently confirms every claim in the document (Rule 99)' },

  { name: 'H5 a document with no checkable claim passes as verified',
    anchor: "  if (!results.length) return { state: 'no-claims' };",
    replace: "  if (!results.length) return { state: 'consistent', count: 0 };",
    catches: 'skipped and verified become the same word, which is how this class of guard rots' },

  { name: 'H6 an unsettleable claim is anchored to a nearby workflow',
    anchor: "    if (unfixable) { unanchored.push({ section, phrase: unfixable, line: i + 1, reason: 'no run can settle it' }); continue; }",
    replace: '    if (false) { continue; }',
    catches: '"NOT built" next to a .yml mention becomes a contradiction manufactured from proximity' },
];

let caught = 0;
for (const mut of MUTATIONS) {
  const original = fs.readFileSync(WATCH, 'utf8');
  const hits = original.split(mut.anchor).length - 1;
  if (hits !== 1) {
    console.log(`FAIL       ${mut.name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`);
    continue;
  }
  fs.writeFileSync(WATCH, original.replace(mut.anchor, mut.replace));
  if (fs.readFileSync(WATCH, 'utf8') === original) {
    console.log(`FAIL       ${mut.name}\n            file unchanged — NOTHING MUTATED.`);
    continue;
  }
  const red = spawnSync('node', SELF, { stdio: 'ignore' }).status !== 0;
  fs.writeFileSync(WATCH, original);
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${mut.name}\n            (${mut.catches})`);
  if (red) caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log(`COVERAGE: the three pure predicates. It does NOT exercise HANDOFF.md, the`);
console.log(`Actions API, or the 404-means-never-ran branch — sandbox egress is blocked,`);
console.log(`so those are verified by dispatching the workflow.`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
