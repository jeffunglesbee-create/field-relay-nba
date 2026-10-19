#!/usr/bin/env node
// Rule 90 for the deploy path itself: does deploy.yml stop a gutted odds wrapper?
//
// docs/CC-CMD-2026-10-18-odds-gate-reads-wrapper-bodies.md, done conditions 1
// and 2. Each of the three odds wrappers (consumeOddsCredit in src/index.js and
// src/wp-resolver.js, _consumeAmbientOddsCredit in src/ambient-do.js) is
// replaced WHOLE, found by name, its signature kept, by a body that:
//   - returns true                                   -> must turn deploy.yml red
//   - charges, then drops the verdict                -> must turn deploy.yml red
//   - returns early whenever KV is bound (one `!`)   -> must turn deploy.yml red
//   - names the verdict, then returns it             -> must stay GREEN
// A CONTROL, HEAD unmutated, must be all green first, or no verdict is printed.
//
// The steps run are READ FROM deploy.yml AT HEAD, out of the same archive the
// cases run in: every step of the deploy job before "Deploy to Cloudflare
// Workers" whose command names an odds or budget script. Reading the working
// tree's deploy.yml while running HEAD's source would test wiring the commit
// does not contain (2026-10-19 review). Each case runs in a fresh committed
// `git archive` copy, so scripts that refuse a dirty tree see a clean one.
//
//   node scripts/mutate-deploy-odds-wrappers.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve('.');
const DEPLOY_STEP = 'Deploy to Cloudflare Workers';
const ODDS_SCRIPT = /scripts\/[\w-]*(odds|monthly|ceiling|degrade|batch-order|budget|reconcile|lambdas|created-tables)[\w-]*\.mjs/;
const CONCURRENCY = 3;

async function loadYaml(file) {
  try {
    const m = await import('js-yaml');
    return (m.default ?? m).load(readFileSync(file, 'utf8'));
  } catch (_) {
    const r = spawnSync('python3', ['-c', 'import sys,yaml,json; print(json.dumps(yaml.safe_load(open(sys.argv[1])), default=str))', file], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`cannot parse ${file}: ${r.stderr}`);
    return JSON.parse(r.stdout);
  }
}

const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
const head = git(ROOT, 'rev-parse', '--short', 'HEAD').trim();
const dirty = git(ROOT, 'status', '--porcelain', '--', 'src', 'scripts', '.github').trim();
if (dirty) console.log(`NOTE: uncommitted changes under src/, scripts/ or .github/ are NOT tested; this runs HEAD ${head}.\n`);

function freshCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-odds-'));
  execFileSync('bash', ['-c', `git -C "${ROOT}" archive HEAD | tar -x -C "${dir}"`]);
  return dir;
}

// The step list, from HEAD's deploy.yml.
const listDir = freshCopy();
const wf = await loadYaml(join(listDir, '.github/workflows/deploy.yml'));
rmSync(listDir, { recursive: true, force: true });
const all = wf.jobs.deploy.steps;
const cut = all.findIndex((s) => s.name === DEPLOY_STEP);
if (cut < 0) { console.log(`FAIL — no "${DEPLOY_STEP}" step in deploy.yml's deploy job`); process.exit(1); }
const before = all.slice(0, cut);
const runnable = before.filter((s) => typeof s.run === 'string' && !(s.env && Object.values(s.env).some((v) => String(v).includes('secrets.'))));
const steps = runnable.filter((s) => ODDS_SCRIPT.test(s.run));
if (!steps.length) { console.log('FAIL — no odds step found before the deploy step'); process.exit(1); }

const W = {
  index:   { path: 'src/index.js',       name: 'consumeOddsCredit' },
  wp:      { path: 'src/wp-resolver.js', name: 'consumeOddsCredit' },
  ambient: { path: 'src/ambient-do.js',  name: '_consumeAmbientOddsCredit' },
};
const KV = 'if (!env || !env.FIELD_JOURNALISM) return true;';
const BODIES = [
  { expect: 'red',   label: 'the wrapper returns true',                        body: [KV, 'return true;'] },
  { expect: 'red',   label: 'the charge runs, the verdict is dropped',         body: [KV, 'await chargeOdds(env, units, site);', 'return true;'] },
  { expect: 'red',   label: 'returns early whenever KV is bound (one `!` gone)', body: ['if (!env || env.FIELD_JOURNALISM) return true;', 'return chargeOdds(env, units, site);'] },
  { expect: 'green', label: 'the verdict is named, then returned (equivalent)', body: [KV, 'const charged = await chargeOdds(env, units, site);', 'return charged;'] },
];
const CASES = [];
for (const [key, w] of Object.entries(W)) for (const b of BODIES) CASES.push({ key, expect: b.expect, name: `${w.path}: ${b.label}`, body: b.body });

function replaceWrapper(text, w, body) {
  const i = text.indexOf(`async function ${w.name}(`);
  const j = i < 0 ? -1 : text.indexOf('\n}\n', i);
  if (i < 0 || j < 0) return null;
  const sig = text.slice(i, text.indexOf('\n', i));
  return `${text.slice(0, i)}${sig}\n${body.map((l) => `    ${l}`).join('\n')}\n}${text.slice(j + 2)}`;
}

const runStep = (dir, s) => new Promise((res) => {
  const p = spawn('bash', ['-e', '-c', s.run], { cwd: dir, stdio: 'ignore' });
  const t = setTimeout(() => p.kill('SIGKILL'), 300_000);
  p.on('close', (code, signal) => { clearTimeout(t); res({ code, signal }); });
});

async function runCase(c) {
  const dir = freshCopy();
  try {
    if (existsSync(join(ROOT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    if (c.key) {
      const w = W[c.key];
      const next = replaceWrapper(readFileSync(join(dir, w.path), 'utf8'), w, c.body);
      if (next == null) return { c, error: `${w.name} was not found in ${w.path} — NOTHING MUTATED` };
      writeFileSync(join(dir, w.path), next);
    }
    git(dir, 'init', '-q'); git(dir, 'add', '-A');
    git(dir, '-c', 'user.email=harness@local', '-c', 'user.name=harness', 'commit', '-q', '-m', c.name);
    const red = [];
    for (const s of steps) {
      const r = await runStep(dir, s);
      // A kill is no verdict: by signal, or as bash -e's 128+n when the killed
      // command was not the last line of a multi-line run (2026-10-19 review).
      if (r.signal || (r.code ?? 0) >= 128) return { c, error: `step "${s.name}" was killed (${r.signal || `status ${r.code}`}) — no verdict` };
      if (r.code !== 0) red.push(s.name);
    }
    return { c, red };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log(`deploy.yml at ${head}: running ${steps.length} odds steps of the ${runnable.length} runnable steps (no secret) before "${DEPLOY_STEP}":`);
for (const s of steps) console.log(`  - ${s.name}`);
console.log('');

const control = await runCase({ key: null, expect: 'green', name: 'CONTROL: HEAD, unmutated' });
if (control.error || control.red.length) {
  console.log(`FAIL       CONTROL: HEAD, unmutated — ${control.error || `red on clean source: ${control.red.join('; ')}`}`);
  console.log('No mutant verdict is printed: a step red on clean source would read as a catch.');
  process.exit(1);
}
console.log('GREEN      CONTROL: HEAD, unmutated');

const results = new Array(CASES.length);
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < CASES.length) { const k = next++; results[k] = await runCase(CASES[k]); }
}));

let ok = 0;
for (const r of results) {
  const c = r.c;
  if (r.error) { console.log(`FAIL       ${c.name}\n           ${r.error}`); continue; }
  const pass = c.expect === 'red' ? r.red.length > 0 : r.red.length === 0;
  if (pass) ok++;
  console.log(`${c.expect === 'red' ? (pass ? 'CAUGHT    ' : 'NOT CAUGHT') : (pass ? 'GREEN     ' : 'RED (BAD) ')} ${c.name}`);
  for (const n of r.red) console.log(`           red step: ${n}`);
}
const reds = CASES.filter((c) => c.expect === 'red').length;
console.log(`\n${ok} of ${CASES.length} cases as expected (control green first): ${reds} mutants must turn a step red, ${CASES.length - reds} equivalents must leave all ${steps.length} odds steps green.`);
console.log(`COVERAGE: ${steps.length} of ${runnable.length} runnable pre-deploy steps (the odds ones), ${Object.keys(W).length} of 3 wrappers mutated, ${BODIES.length} bodies each. Not run: the other ${runnable.length - steps.length} runnable steps, ${before.length - runnable.length} steps needing a secret or with no command, the deploy, and the live verify job.`);
process.exit(ok === CASES.length ? 0 : 1);
