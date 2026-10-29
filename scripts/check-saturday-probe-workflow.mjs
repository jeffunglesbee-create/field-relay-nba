#!/usr/bin/env node
/**
 * The two workflows that run scripts/probe-odds-join.mjs pass it what it now requires
 * (docs/CC-CMD-2026-10-19-cfb-saturday-coverage-and-join-probe.md, B2).
 *
 * WHY A CHECK ON YAML. The defect lived in the workflow, not the script: a scheduled run passed no date, the
 * script fell back to the UTC day, and all seven scheduled runs (01:24Z to 02:51Z Sunday) probed the Sunday.
 * The script now refuses a missing date, so a workflow that stops computing one fails at runtime, on a Saturday,
 * once a week. This reads the workflow text instead: each step that runs the probe passes the relay secret,
 * computes PROBE_DATE in the shell (the expression is then EXECUTED, for four instants), the Saturday workflow
 * pins the weekday, and its cost comment no longer says what the script contradicts.
 *
 * SATURDAY_WORKFLOW and API_WORKFLOW let scripts/mutate-saturday-probe-workflow.mjs aim this file at mutated copies.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SAT = process.env.SATURDAY_WORKFLOW || '.github/workflows/odds-identity-join-saturday.yml';
const API = process.env.API_WORKFLOW || '.github/workflows/probe-odds-api.yml';
const results = [];
const check = (name, ok, detail = '') => { results.push([name, !!ok, detail]); };

// The step that runs the probe: from its "- name:" line to the next one. Comment lines are dropped so a sentence
// about the secret cannot stand in for passing it.
function probeStep(text) {
  const code = text.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  const steps = code.split(/\n(?=\s{6}- name:)/);
  const hit = steps.filter(s => s.includes('node scripts/probe-odds-join.mjs'));
  return hit.length === 1 ? hit[0] : null;
}

const EXPR = /\$\{INPUT_DATE:-\$\((TZ=America\/New_York date -d '[^']*' \+%F)\)\}/;
// Run the workflow's own date expression as if the step started at `iso`.
function dateAt(expr, iso) {
  const at = expr.replace(/date -d '([^']*)'/, (_, rel) => `date -d '${iso} UTC ${rel}'`);
  return execFileSync('bash', ['-c', at], { encoding: 'utf8' }).trim();
}

for (const [label, file, saturday] of [['saturday workflow', SAT, true], ['probe-odds-api workflow', API, false]]) {
  const text = readFileSync(file, 'utf8');
  const step = probeStep(text);
  check(`${label}: exactly one step runs the probe`, step !== null);
  if (step === null) continue;
  check(`${label}: it passes FIELD_MCP_SECRET from the repo secret`, /FIELD_MCP_SECRET:\s*\$\{\{\s*secrets\.FIELD_MCP_SECRET\s*\}\}/.test(step));
  check(`${label}: PROBE_DATE is not handed straight from the dispatch input (a blank would reach the script)`, !/^\s*PROBE_DATE:\s*\$\{\{/m.test(step));
  const m = EXPR.exec(step);
  check(`${label}: PROBE_DATE is exported from the input or a computed Eastern day`, !!m && /export PROBE_DATE=/.test(step), m ? m[1] : 'no match');
  if (m) {
    // The window is pinned from both sides. The Eastern day of "six hours ago" flips at 10:00Z (04:00Z is midnight in
    // New York on 2026-10-31 and 2026-11-01, both EDT): one minute before it is still the previous day, and a window of
    // five or seven hours would flip a different minute. The delayed scheduled runs (23:40Z to about 02:51Z) are
    // inside the Saturday either way; these four instants are what tell six hours from any other number.
    const cases = [['2026-10-31T09:59:00', '2026-10-30', 'one minute before the day flips'],
      ['2026-10-31T10:00:00', '2026-10-31', 'the minute it flips'],
      ['2026-11-01T09:59:00', '2026-10-31', 'the Saturday slate, still, the morning after (before the flip)'],
      ['2026-11-01T10:00:00', '2026-11-01', 'the flip to Sunday'],
      ['2026-10-31T23:40:00', '2026-10-31', 'the cron time'], ['2026-11-01T02:51:00', '2026-10-31', 'the latest recorded start']];
    for (const [iso, want, why] of cases) {
      let got; try { got = dateAt(m[1], iso); } catch (e) { got = String(e.message).slice(0, 60); }
      check(`${label}: a run starting ${iso}Z (${why}) probes ${want}`, got === want, got);
    }
  }
  // The exit-code policy: a failing probe must END THE RUN RED with its artifact still committed. Any of these on the
  // probe step reinstates the original always-green defect.
  check(`${label}: the probe step does not continue on error`, !/continue-on-error/.test(step));
  // The dispatch-only workflow may skip the probe on request ('false'); nothing else may skip it.
  const ifs = step.split('\n').filter(l => /^\s{8}if:/.test(l)).map(l => l.trim());
  check(`${label}: ...has no \`if:\` that can skip it${saturday ? '' : " except the dispatch option join_probe != 'false'"}`,
    saturday ? ifs.length === 0 : (ifs.length === 1 && ifs[0] === "if: inputs.join_probe != 'false'"), JSON.stringify(ifs));
  check(`${label}: ...and its run block swallows no exit code (no \`||\`, no \`; true\`, no \`set +e\`)`, !/\|\|/.test(step.replace(EXPR, '')) && !/;\s*true\b/.test(step) && !/set \+e/.test(step));
  check(`${label}: ...and still ends in the probe command, the last thing the step runs`, /node scripts\/probe-odds-join\.mjs\s*$/.test(step.trimEnd()));
  const code = text.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  const commit = code.split(/\n(?=\s{6}- name:)/).filter(x => /git commit/.test(x));
  check(`${label}: a later step commits the artifact under \`if: always()\``, commit.length === 1 && /^\s{8}if: always\(\)/m.test(commit[0]) && code.indexOf(commit[0]) > code.indexOf(step));
  check(`${label}: no comment or input text says one credit, a single credit, a credit per sport or 4 credits any more`, !/one credit|a single credit|1 credit per sport|4 Odds-API credits/i.test(text), 'found a stale cost');
  if (saturday) {
    check(`${label}: EXPECT_WEEKDAY is 6, so a Sunday date is refused by the script`, /EXPECT_WEEKDAY:\s*'6'/.test(step));
    check(`${label}: the cron is still 23:40Z on Saturdays`, /cron:\s*'40 23 \* \* 6'/.test(text));
    check(`${label}: ...and names the 12 it costs and the label it is charged to`, /12/.test(text) && /identityMismatches/.test(text));
  }
}

let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) { failed++; console.log(`FAIL  ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
console.log(`read 2 workflows; the date expression was executed for 4 instants in each.`);
console.log(`${results.length - failed} of ${results.length} passed.`);
process.exit(failed ? 1 : 0);
