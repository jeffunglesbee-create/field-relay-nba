#!/usr/bin/env node
/**
 * Rule 90 for scripts/check-saturday-probe-workflow.mjs.
 *
 * Each mutation changes ONE thing in a copy of a workflow and aims the check at the copy. The check must go red for
 * every one; a mutant counts as CAUGHT only when an assertion failed. Every anchor is asserted to occur exactly once,
 * because a mutation that applied nothing would let a green check print a pass for it.
 */
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SAT = '.github/workflows/odds-identity-join-saturday.yml';
const API = '.github/workflows/probe-odds-api.yml';
const sat0 = readFileSync(SAT, 'utf8'), api0 = readFileSync(API, 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'sat-wf-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const run = (satText, apiText) => {
  const s = join(dir, 'sat.yml'), a = join(dir, 'api.yml');
  writeFileSync(s, satText); writeFileSync(a, apiText);
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, ['scripts/check-saturday-probe-workflow.mjs'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SATURDAY_WORKFLOW: s, API_WORKFLOW: a } });
  } catch (e) { out = String(e.stdout || ''); code = e.status ?? 1; }
  const m = /^(\d+) of (\d+) passed\.$/m.exec(out);
  if (code === 0) return m && m[1] === m[2] ? 'pass' : 'error';
  return m && Number(m[1]) < Number(m[2]) && /^FAIL  /m.test(out) ? 'red' : 'error';
};
if (run(sat0, api0) !== 'pass') { console.log('FAIL: the check is already red on the real workflows.'); process.exit(1); }
console.log('baseline: the check passes on the real workflows\n');

const SECRET = '          FIELD_MCP_SECRET: ${{ secrets.FIELD_MCP_SECRET }}\n';
const EXPR = "$(TZ=America/New_York date -d '6 hours ago' +%F)";
const PROBE_SAT = "          node scripts/probe-odds-join.mjs\n";
const MUTANTS = [
  // [name, which, anchor, replacement]
  ['W1 the Saturday workflow stops passing the secret', 'sat', SECRET, ''],
  ['W2 the probe-odds-api workflow stops passing the secret', 'api', SECRET, ''],
  ['W3 the Saturday workflow hands the dispatch input straight to the script (a blank date reaches it)', 'sat',
   "          INPUT_DATE: ${{ inputs.date }}\n", "          PROBE_DATE: ${{ inputs.date }}\n          INPUT_DATE: ${{ inputs.date }}\n"],
  ['W4 the Saturday date is the Eastern day of the moment the run starts, not six hours ago', 'sat', EXPR, "$(TZ=America/New_York date -d '0 hours ago' +%F)"],
  ['W5 the Saturday window is five hours', 'sat', EXPR, "$(TZ=America/New_York date -d '5 hours ago' +%F)"],
  ['W6 the Saturday window is seven hours', 'sat', EXPR, "$(TZ=America/New_York date -d '7 hours ago' +%F)"],
  ['W7 the probe-odds-api date uses the UTC day', 'api', EXPR, "$(date -u +%F)"],
  ['W8 the probe-odds-api window is not six hours', 'api', EXPR, "$(TZ=America/New_York date -d '10 hours ago' +%F)"],
  ['W9 the Saturday workflow stops pinning the weekday', 'sat', "          EXPECT_WEEKDAY: '6'\n", ''],
  ['W10 the cron moves off Saturday', 'sat', "cron: '40 23 * * 6'", "cron: '40 23 * * 0'"],
  ['W11 the cost comment goes back to a single credit', 'sat', 'This comment used to understate the\n# cost and to name one sport;', 'This comment says a single credit.\n#'],
  ['W12 the date is no longer exported to the script', 'sat', 'export PROBE_DATE="${INPUT_DATE:-', 'PROBE_DATE="${INPUT_DATE:-'],
  // THE EXIT-CODE POLICY: a failing probe must end the run red, with its artifact still committed.
  ['W13 the Saturday probe step continues on error', 'sat', "          EXPECT_WEEKDAY: '6'\n        run: |", "          EXPECT_WEEKDAY: '6'\n        continue-on-error: true\n        run: |"],
  ['W14 the Saturday probe step is skipped', 'sat', "          EXPECT_WEEKDAY: '6'\n        run: |", "          EXPECT_WEEKDAY: '6'\n        if: false\n        run: |"],
  ['W15 the Saturday probe swallows its exit code', 'sat', PROBE_SAT, "          node scripts/probe-odds-join.mjs || true\n"],
  ['W16 the Saturday probe is followed by a command that always succeeds', 'sat', PROBE_SAT, "          node scripts/probe-odds-join.mjs; true\n"],
  ['W17 the artifact is no longer committed when the probe fails', 'sat', "      - name: Commit the slate\n        if: always()\n", "      - name: Commit the slate\n"],
  ['W18 the probe-odds-api probe step may be skipped by anything but its own option', 'api', "        if: inputs.join_probe != 'false'\n", "        if: always()\n"],
  ['W19 the probe-odds-api input goes back to four credits', 'api', 'about 12 ledger credits: oddsCreditCost 3 for each of 4 sports; it fails the run when CFB cannot be measured', '4 Odds-API credits'],
];

let missed = 0, nothing = 0, errored = 0;
for (const [name, which, anchor, repl] of MUTANTS) {
  const src = which === 'sat' ? sat0 : api0;
  const count = src.split(anchor).length - 1;
  if (count !== 1) { nothing++; console.log(`NOTHING MUTATED  ${name}\n        the anchor occurs ${count} times in the ${which} workflow, not once`); continue; }
  const text = src.replace(anchor, () => repl);
  const verdict = which === 'sat' ? run(text, api0) : run(sat0, text);
  const label = verdict === 'red' ? 'CAUGHT    ' : verdict === 'pass' ? 'NOT CAUGHT' : 'HARNESS ERROR (no assertion failed; a crash is not a catch)';
  console.log(`${label}  ${name}`);
  if (verdict === 'pass') missed++;
  if (verdict === 'error') errored++;
}
const caughtN = MUTANTS.length - missed - nothing - errored;
console.log(`\nmutations: ${caughtN} of ${MUTANTS.length} caught${missed ? `, ${missed} SURVIVED` : ''}${errored ? `, ${errored} harness error(s)` : ''}${nothing ? `, ${nothing} not applied` : ''}`);
console.log('COVERAGE: the two workflows\' probe step, the date expression (executed), the weekday pin, the cron and the cost comment.');
process.exit(missed || nothing || errored ? 1 : 0);
