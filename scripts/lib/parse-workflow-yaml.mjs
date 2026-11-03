// Parse a GitHub Actions workflow the way the runner does: a real YAML parser, never a line scan.
//
// Lifted unchanged from scripts/workflow-yaml-check.mjs so that a second check can share it
// (scripts/check-workflow-timeouts.mjs, docs/CC-CMD-2026-11-03-workflow-jobs-have-no-time-limit.md)
// instead of carrying a second copy. js-yaml if it is installed, else python3's yaml (PyYAML). The
// CI job that runs the gate installs neither package for node, so there it is the python path that
// reads every file; that path takes the FILE, not the text, so a caller must have written the file.
//
// Returns { ok: true, doc } or { ok: false, error }. YAML 1.1 reads a bare `on` as the boolean
// true, so a trigger lives under doc.on ?? doc[true] (the gate's triggersOf).
export async function parseYaml(text, file) {
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
