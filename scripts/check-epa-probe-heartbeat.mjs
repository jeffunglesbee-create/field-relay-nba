#!/usr/bin/env node
// The heartbeat half of nfl-epa-route-probe.yml, executed instead of read.
//
// The probe's header and the closed CC-CMD-2026-08-27-relay-per-play-epa both say
// NOT OBSERVABLE is "fatal on a deploy and neutral on the heartbeat". Nothing ever
// executed that claim: the job's `if:` skipped every scheduled tick for ten weeks
// (docs/CC-CMD-2026-11-02-scheduled-job-skipped-every-time.md). When the path was
// finally run, the claim held in the script and failed in the workflow: the probe
// exited 0, then "Surface the verdict" (`if: always()`) read `d.game.name` from an
// artifact that has no game, threw, and turned the run red. In the off-season,
// when no NFL game is within 14 days, that is every day, and three of them make
// the dead-cron watch report the probe as failing.
//
// This runs the real pieces; nothing in it is a copy of them:
//   - scripts/nfl-epa-route-probe.mjs, with `fetch` stubbed to an empty scoreboard,
//     once as the heartbeat and once as a deploy;
//   - the "Surface the verdict" step, its `run:` text taken out of the workflow
//     file, under `bash -e` and under `bash --noprofile --norc -eo pipefail` (so the
//     answer does not depend on whether pipefail is set), on each artifact above;
//   - the same step on the newest COMMITTED artifact that has a game, which is a
//     real output of the real probe on live data;
//   - the workflow's EPA_PROBE_HEARTBEAT expression, judged with the same evaluator
//     the workflow YAML gate uses: '1' on a schedule event and on no other.
// scripts/mutate-epa-probe-heartbeat.mjs proves this file can fail.
//
// Run: node scripts/check-epa-probe-heartbeat.mjs   (from the repository root)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { judgeIf } from './lib/workflow-if-eval.mjs';

const WORKFLOW = '.github/workflows/nfl-epa-route-probe.yml';
const PROBE = path.resolve('scripts/nfl-epa-route-probe.mjs');
const PROBE_STEP = 'Probe the deployed route against the client';
const SURFACE_STEP = 'Surface the verdict';
const SHELLS = [['bash', '-e'], ['bash', '--noprofile', '--norc', '-eo', 'pipefail']];

let ran = 0, bad = 0;
// Strict equality over scalars, and COUNTED: a hardcoded total hides a deleted case.
const one = (label, got, want, why) => (ran++, got === want
  ? console.log(`  PASS  ${label} -> ${JSON.stringify(got)}  (${why})`)
  : (bad++, console.log(`  FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`)));

async function loadYaml(file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    const y = await import('js-yaml');
    return (y.default ?? y).load(text);
  } catch (_) { /* js-yaml is not installed: fall through to python's parser */ }
  const r = spawnSync('python3', ['-c',
    'import sys,yaml,json; print(json.dumps(yaml.safe_load(open(sys.argv[1])), default=str))', file],
    { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`cannot parse ${file}: ${(r.stderr || '').trim().split('\n').slice(-2).join(' ')}`);
  return JSON.parse(r.stdout);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epa-heartbeat-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const dirFor = (name) => { const d = path.join(tmp, name); fs.mkdirSync(path.join(d, 'outbox'), { recursive: true }); return d; };

let doc;
try { doc = await loadYaml(WORKFLOW); }
catch (e) { console.log(`FAIL — ${e.message}`); process.exit(1); }
const steps = doc?.jobs?.probe?.steps ?? [];
const named = (n) => steps.filter((s) => s?.name === n);

// ── the wiring this check relies on ────────────────────────────────────────
const probeStep = named(PROBE_STEP);
const surfaceStep = named(SURFACE_STEP);
one(`the workflow has one step named "${PROBE_STEP}"`, probeStep.length, 1, 'renaming it must be a decision');
one(`the workflow has one step named "${SURFACE_STEP}"`, surfaceStep.length, 1, 'its run: text is what gets executed below');
one('the probe step runs the script this check runs', String(probeStep[0]?.run ?? '').trim(),
    'node scripts/nfl-epa-route-probe.mjs', 'else this would test a different file from the one the workflow runs');
const hbExpr = probeStep[0]?.env?.EPA_PROBE_HEARTBEAT;
const isHb = (eventName) => judgeIf(`(${String(hbExpr ?? 'null').replace(/^\s*\$\{\{|\}\}\s*$/g, '')}) == '1'`, { eventName }).verdict;
one('EPA_PROBE_HEARTBEAT is 1 on a schedule event', isHb('schedule'), true, 'only the cron is a heartbeat');
one('...and not on a manual dispatch', isHb('workflow_dispatch'), false, 'a dispatch has to prove the route works');
one('...and not on a deploy (workflow_run)', isHb('workflow_run'), false, 'a deploy has to prove the route works');

// ── the script that stands behind the step, run for real ───────────────────
const stub = path.join(tmp, 'no-game-stub.mjs');
fs.writeFileSync(stub, "globalThis.fetch = async () => new Response(JSON.stringify({ events: [] }), { status: 200 });\n");
const surfaceSh = path.join(tmp, 'surface.sh');
fs.writeFileSync(surfaceSh, String(surfaceStep[0]?.run ?? 'exit 99'));

const surface = (dir, label, want) => {
  for (const sh of SHELLS) {
    const r = spawnSync(sh[0], [...sh.slice(1), surfaceSh], { cwd: dir, encoding: 'utf8', timeout: 60000 });
    const out = `${r.stdout}${r.stderr}`;
    const tag = `${label}, the step under \`${sh.slice(1).join(' ')}\``;
    one(`${tag}: exits 0`, r.status, 0, 'a verdict that cannot be shown must not fail the job');
    one(`${tag}: prints the verdict`, out.includes(want.verdict), true, `looking for ${want.verdict}`);
    if (want.extra) one(`${tag}: ${want.extraLabel}`, out.includes(want.extra), true, `looking for ${want.extra}`);
    one(`${tag}: prints no "undefined"`, /undefined/.test(out), false, 'a field the artifact does not have');
  }
};

for (const m of [
  { name: 'heartbeat', hb: '1', exit: 0, why: 'no game is not observable, and on the cron that is neutral' },
  { name: 'deploy', hb: '0', exit: 1, why: 'a deploy that cannot be checked has not been checked' },
]) {
  const dir = dirFor(m.name);
  const r = spawnSync('node', ['--import', stub, PROBE],
    { cwd: dir, env: { ...process.env, EPA_PROBE_HEARTBEAT: m.hb }, encoding: 'utf8', timeout: 60000 });
  one(`${m.name}, no game: the probe exits`, r.status, m.exit, m.why);
  const files = fs.readdirSync(path.join(dir, 'outbox')).filter((f) => /^nfl-epa-route-probe-.*\.json$/.test(f));
  one(`${m.name}, no game: the probe writes one artifact`, files.length, 1, 'the manifest is written before the exit');
  const art = files.length ? JSON.parse(fs.readFileSync(path.join(dir, 'outbox', files[0]), 'utf8')) : {};
  one(`${m.name}, no game: the verdict`, art.verdict, 'NOT OBSERVABLE', 'the same words either way');
  one(`${m.name}, no game: the trigger it records`, art.trigger, m.name, 'only the exit code differs');
  surface(dir, `${m.name}, no game`, { verdict: 'NOT OBSERVABLE' });
}

// ── the same step on a real artifact that has a game ──────────────────────
const committed = fs.existsSync('outbox') ? fs.readdirSync('outbox')
  .filter((f) => /^nfl-epa-route-probe-.*\.json$/.test(f)).sort().reverse() : [];
let real = null, realFile = null;
for (const f of committed) {
  try {
    const a = JSON.parse(fs.readFileSync(path.join('outbox', f), 'utf8'));
    if (a && a.game && a.verdict && a.verdict !== 'NOT OBSERVABLE') { real = a; realFile = f; break; }
  } catch (_) { /* an unreadable artifact is skipped; none readable is a failure below */ }
}
one('a committed artifact with a game exists to run the step on', realFile !== null, true,
    `${committed.length} committed artifact(s) examined`);
if (real) {
  const dir = dirFor('real');
  fs.copyFileSync(path.join('outbox', realFile), path.join(dir, 'outbox', realFile));
  surface(dir, `a real artifact (${realFile})`, { verdict: real.verdict, extra: `game: ${real.game.name} (`, extraLabel: 'prints the game' });
}

console.log(bad ? `\n${bad} of ${ran} FAILED` : `\nepa-probe heartbeat check: ${ran}/${ran}`);
console.log('COVERAGE: the probe script with an empty scoreboard, as heartbeat and as deploy; the Surface step');
console.log('under two shells on both artifacts and on one real committed artifact; the heartbeat expression');
console.log('on three event names. It does NOT reach ESPN or the relay and does not run the commit step:');
console.log('the first real scheduled tick is TASK 5 of docs/CC-CMD-2026-11-02-scheduled-job-skipped-every-time.md.');
process.exit(bad ? 1 : 0);
