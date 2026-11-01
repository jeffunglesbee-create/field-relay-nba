#!/usr/bin/env node
// Rule 90 for scripts/relay-look.sh: each mutation puts back a defect the independent review of 2026-11-01 found in the first version of the helper, or removes a clause
// that keeps it honest, and scripts/check-relay-look.mjs must go red. Each asserts its anchor is unique and applied before reporting a result. Mutates in place and restores;
// needs the helper's changes staged or committed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const FILE = 'scripts/relay-look.sh';
const CHECK = 'scripts/check-relay-look.mjs';
if (spawnSync('git', ['diff', '--quiet', '--', FILE]).status !== 0) { console.log(`FAIL — ${FILE} has unstaged changes; restoring would lose them.`); process.exit(1); }
if (spawnSync('node', [CHECK], { stdio: 'ignore' }).status !== 0) { console.log(`FAIL — ${CHECK} is already red on clean source.`); process.exit(1); }
console.log(`baseline: ${CHECK} passes on clean source\n`);

const M = [
  ['L1 the artifact is brought in with git pull --rebase', "git fetch -q \"$SRC\" main 2>\"$ERR\" ||", "git pull -q --rebase origin main 2>\"$ERR\" ||", 'a dirty working tree or an unpushed commit stops the helper after the run has finished'],
  ['L2 the dispatch is not retried', "for i in 1 2 3; do", "for i in 1; do", 'a workflow pushed a moment ago answers 422 and the helper gives up'],
  ['L3 one failed poll is fatal', "2>/dev/null) && ST=\"$J\"", "2>/dev/null) || exit 1; ST=\"$J\"", 'one HTTP 502 kills the helper with no label and no run'],
  ['L4 the run is chosen by id, not by its title', "select(.display_title == \\\"relay-read $LABEL\\\")", "select(.id == 999)", 'someone else\'s newer run is read as this one'],
  ['L5 the "still going" message omits the run URL', "label $LABEL, $URL\" >&2; exit 1", "label $LABEL\" >&2; exit 1", 'the reader cannot find the run that is still going'],
  ['L6 the "no artifact" message omits the run URL and the self-test hint', "committed no artifact for $LABEL. If the policy self-test went red the run stops before reading anything: $URL\"", "committed no artifact for $LABEL.\"", 'a failed run reads as a mystery'],
  ['L7 a red run exits 0', "(the run was not green: $ST)\" >&2; exit 1", "(the run was not green: $ST)\" >&2; exit 0", 'a look that refused a route reads as green'],
  ['L8 a failed dispatch is not an error', "[ \"$ok\" = 1 ] ||", "[ \"$ok\" = 0 ] || true ||", 'the helper waits for a run that was never started'],
  ['L9 the artifact is read from the working tree, not from the fetch', "git show \"FETCH_HEAD:$FILE\" > \"$TMP\"", "cat \"$FILE\" > \"$TMP\"", 'the artifact is only there after a pull, which the helper must not do'],
];
let caught = 0;
for (const [name, anchor, replace, why] of M) {
  const src = fs.readFileSync(FILE, 'utf8');
  const hits = src.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`); continue; }
  if (anchor === replace) { console.log(`FAIL       ${name}\n            replacement equals the anchor — NOTHING MUTATED.`); continue; }
  fs.writeFileSync(FILE, src.replace(anchor, () => replace));
  const run = spawnSync('node', [CHECK], { encoding: 'utf8', timeout: 120000 });
  const fails = String(run.stdout ?? '').split('\n').filter((l) => l.includes('FAIL'));
  const red = run.status !== 0 && fails.length > 0;   // a crash, a syntax error or a timeout is BROKE, not CAUGHT: an assertion must have fired
  fs.writeFileSync(FILE, src);
  console.log(`${red ? 'CAUGHT    ' : run.status !== 0 ? 'BROKE     ' : 'NOT CAUGHT'} ${name}\n            (${why})${red ? `\n            <- ${fails[0].trim().slice(0, 120)}` : ''}`);
  if (red) caught++;
}
console.log(`\n${caught} of ${M.length} mutations caught.`);
process.exit(caught === M.length ? 0 : 1);
