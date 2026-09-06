// Parse every GitHub Actions workflow and assert it is a workflow.
//
// Written because a workflow shipped that GitHub refused to register. The
// failure mode is quiet: a `run: |` block containing a multi-line `git commit
// -m "…"` breaks the block scalar at the blank line, YAML parsing dies, and
// GitHub reports only "Workflow does not have 'workflow_dispatch' trigger" --
// a message about the trigger, from a file where nothing at all parsed.
//
// The check that let it through said "no tabs, no CRLF" and passed. That is
// Rule 90 exactly: it had only ever passed, and it could not detect the class
// of defect it stood in front of. A string scan is not a parse.
//
// Assertions per file, each with a mutation that proves it can fail
// (test/workflow-yaml-fixtures/):
//   1. parses as YAML at all
//   2. has a trigger -- read from `true`, not 'on', because YAML 1.1 parses
//      the bare word `on` as the boolean true, which is why a naive
//      d['on'] check reads undefined on a perfectly good workflow
//   3. has at least one job
//   4. every job names a runner or reuses a workflow
//
// A fifth assertion was written and deleted before this shipped: a string scan
// for a blank line inside a `run:` block, aimed at the exact shape that caused
// the outage. It flagged 41 of 107 files -- deploy.yml 42 times -- all of which
// parse. It could not tell the illegal case from the ordinary blank line before
// the next step, which is most of them. The parse already catches the real
// defect (the broken file died with `could not find expected ':'`), so the scan
// added nothing but noise. A check that fires on two thirds of a healthy
// codebase is not strict, it is broken.

import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.WORKFLOW_DIR || '.github/workflows';

// Minimal YAML subset parser is NOT acceptable here -- the whole point is to
// parse the way the runner does. js-yaml if present, else python3's yaml.
async function parseYaml(text, file) {
  try {
    const jsyaml = await import('js-yaml');
    return { ok: true, doc: (jsyaml.default ?? jsyaml).load(text) };
  } catch (_) { /* fall through to python */ }
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('python3', ['-c',
    'import sys,yaml,json; print(json.dumps(yaml.safe_load(open(sys.argv[1])), default=str))', file],
    { encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, error: (r.stderr || '').trim().split('\n').slice(-3).join(' ') };
  try { return { ok: true, doc: JSON.parse(r.stdout) }; }
  catch (e) { return { ok: false, error: `parser output unreadable: ${e.message}` }; }
}

// YAML 1.1: bare `on` is the boolean true. js-yaml's default schema and
// python's safe_load both do this, and a check keyed on the string 'on' reads
// undefined for every valid workflow in the repo -- a check that fails
// everywhere is as useless as one that passes everywhere.
const triggersOf = (doc) => (doc && (doc.on ?? doc[true] ?? doc['true'])) ?? null;

const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort()
  : [];

const failures = [];
for (const f of files) {
  const full = path.join(DIR, f);
  const text = fs.readFileSync(full, 'utf8');
  const fail = (msg) => failures.push(`${full}: ${msg}`);

  const { ok, doc, error } = await parseYaml(text, full);
  if (!ok) { fail(`does not parse: ${error}`); continue; }
  if (!doc || typeof doc !== 'object') { fail('parses to nothing'); continue; }

  if (triggersOf(doc) == null) fail('no trigger — GitHub will never run it');
  const jobs = doc.jobs;
  if (!jobs || typeof jobs !== 'object' || !Object.keys(jobs).length) fail('no jobs');
  else for (const [name, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object') { fail(`job ${name} is not a mapping`); continue; }
    if (!job['runs-on'] && !job.uses) fail(`job ${name} has neither runs-on nor uses`);
  }
}

console.log(`workflow-yaml-check: ${files.length} workflow file(s) in ${DIR}, ${failures.length} failing`);
for (const m of failures) console.log(`  FAIL ${m}`);
if (!files.length) { console.log('  no workflow files found — that is a finding, not a pass'); process.exit(1); }
process.exit(failures.length ? 1 : 0);
