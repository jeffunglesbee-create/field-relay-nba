#!/usr/bin/env python3
"""Rule 90 harness for scripts/check-deploy-commit-results.sh.

Each mutation is the `Commit results` step of deploy.yml as it could plausibly be written
or regressed: the swallowed add and the swallowed commit that stood there until 2026-11-18,
and the ways the fix itself could be undone or over-corrected. Each must turn the check red
for the reason named.

IT MUTATES COPIES. The mutated workflow is written to a temp file and the check is pointed at
it with DEPLOY_YML, so the real .github/workflows/deploy.yml (the sole deploy path) is never
rewritten and a killed run cannot leave a mutated one behind. It asserts each anchor is unique
and applied before printing any verdict: NOT CAUGHT with nothing mutated would be worse than
no test.
"""
import atexit, os, shutil, subprocess, sys, tempfile

YML = '.github/workflows/deploy.yml'
CHECK = 'scripts/check-deploy-commit-results.sh'

M = lambda name, anchor, replace, expect: dict(name=name, anchor=anchor, replace=replace, expect=expect)

MUTATIONS = [
    # THE DEFECT, restored: any add failure becomes "no artifact to stage".
    M('D1  a failed add is swallowed again',
      '''            echo "::error::git add failed for $1 ($# path(s) in this call) for a reason that is not an empty pathspec."
            exit 1''',
      '''            echo "(no artifact to stage)"
            return 0''',
      'a git add that fails (a held index.lock) fails the step'),

    # The other direction: an empty glob must not abort the step (the 2026-08-06 ruling).
    M('D2  an empty glob is treated as a failure',
      "              *'did not match any files'*)",
      "              *'zzz-never-matches'*)",
      'no artifact at all is a clean exit (an unmatched glob must not abort the step)'),

    # THE SECOND DEFECT, restored: a refused commit reported as "Nothing to commit".
    M('D3  a refused commit is reported as nothing to commit',
      '''            echo "::error::git commit failed; the verification note was not committed."
            exit 1''',
      '''            echo "Nothing to commit — no push needed."
            exit 0''',
      'a git commit that is refused fails the step'),

    # Without the staged-changes test the empty case reaches `git commit`, which fails.
    M('D4  the empty case is no longer detected before the commit',
      '          if git diff --cached --quiet; then',
      '          if false; then',
      'no artifact at all is a clean exit (an unmatched glob must not abort the step)'),

    # The empty-glob test reads git's English message.
    M('D5  the add no longer forces the C locale',
      '            out="$(LC_ALL=C git add -- "$@" 2>&1)" || rc=$?',
      '            out="$(git add -- "$@" 2>&1)" || rc=$?',
      'a localised git does not turn an empty glob into a failure'),

    # A glob can match more than one artifact.
    M('D6  only the first matched path is staged',
      '            out="$(LC_ALL=C git add -- "$@" 2>&1)" || rc=$?',
      '            out="$(LC_ALL=C git add -- "$1" 2>&1)" || rc=$?',
      'both live-verify artifacts are committed (a glob can match more than one)'),

    # The push loop is unchanged by the fix; these guard what it already guaranteed.
    M('D7  a permission failure on the push no longer fails the step',
      '''            echo "::error::Verification-note push failed for a PERMISSION reason, not a race — this is a real defect, not concurrency."
            exit 1''',
      '''            echo "::error::Verification-note push failed for a PERMISSION reason, not a race — this is a real defect, not concurrency."
            exit 0''',
      'a permission failure on the push still fails the step'),

    M('D8  a push that loses every retry fails the run',
      '''          echo "::warning::Verification-note push lost every retry to concurrent writes. The deploy itself is unaffected; only the note was not committed."
          exit 0''',
      '''          echo "::warning::Verification-note push lost every retry to concurrent writes. The deploy itself is unaffected; only the note was not committed."
          exit 1''',
      'a push that loses every retry warns and does not fail the run'),

    # An artifact that is never staged dies with the runner (run 32659418899).
    M('D9  the health-sources artifact is never staged',
      '          stage outbox/health-sources-*.json\n',
      '',
      'and health-sources reached the remote'),

    M('D10 the live-verify artifact is never staged',
      '          stage outbox/live-verify-*.md\n',
      '',
      'and live-verify reached the remote'),

    M('D11 the commit subject changes',
      'git commit -m "chore: post-deploy live verification [skip ci]"',
      'git commit -m "chore: post-deploy verification [skip ci]"',
      'and the commit subject is unchanged'),

    M('D12 the step stops setting its own identity',
      '          git config user.name "github-actions[bot]"',
      '          git config user.name "someone-else"',
      "and the committing identity is the step's own"),

    # A lost race must still be retried and rebased over, not given up on.
    M('D13 the rebase before the push is dropped',
      'if git pull --rebase --autostash origin main >>"$PUSH_LOG" 2>&1 \\\n               && git push origin main >>"$PUSH_LOG" 2>&1; then',
      'if git push origin main >>"$PUSH_LOG" 2>&1; then',
      "and both writers' files are on the remote"),

    # A loop cut to one attempt still passes a push that wins first time.
    M('D14 the push loop gives up after one attempt',
      '          for i in 1 2 3 4 5; do',
      '          for i in 1; do',
      'and reports the attempt that landed (a loop cut to one attempt would not)'),

    # HALF OF THE ORIGINAL DEFECT: the second artifact is the one run 32659418899 lost.
    M('D15 the second artifact goes back to the swallowed add',
      '          stage outbox/health-sources-*.json\n',
      '          git add outbox/health-sources-*.json || echo "(no health-sources artifact to stage)"\n',
      'an artifact git refuses to stage on the SECOND glob fails the step'),

    # Widening the staging commits whatever else is lying in the checkout.
    M('D16 the staging is widened to the whole outbox',
      '          stage outbox/live-verify-*.md\n',
      '          stage outbox/\n',
      'only the two artifact globs are committed (a stray file is not)'),

    # A no-match that arrives with a permission warning is not a no-match.
    M('D17 a no-match with another error or warning is skipped again',
      "                  *'error: '*|*'warning: '*) ;;",
      "                  *'zzz-never-matches'*) ;;",
      'a no-match that arrives with another error or warning is a failure'),

    # YAML the run block cannot see: a step-level or job-level key that turns every loud
    # failure above back into a green run.
    M('D18 the step gains continue-on-error',
      '      - name: Commit results\n        run: |',
      '      - name: Commit results\n        continue-on-error: true\n        run: |',
      'the step carries no key but its name and run (no if, continue-on-error, shell, env)'),

    M('D19 the verify job gains continue-on-error',
      '  verify:\n    needs: deploy',
      '  verify:\n    continue-on-error: true\n    needs: deploy',
      'the verify job has no job-level key that could turn a failure green'),

    # ---- added after the three-lens review of 2026-11-19: each of these was run against the
    # check BEFORE the scenario that catches it existed, and passed (47/47) ----
    # A key written AFTER the run block is as live as one written before it (D18).
    M('D20 the step gains continue-on-error AFTER its run block',
      '          echo "::warning::Verification-note push lost every retry to concurrent writes. The deploy itself is unaffected; only the note was not committed."\n          exit 0\n',
      '          echo "::warning::Verification-note push lost every retry to concurrent writes. The deploy itself is unaffected; only the note was not committed."\n          exit 0\n        continue-on-error: true\n',
      'the step carries no key but its name and run (no if, continue-on-error, shell, env)'),

    # Word splitting: a name with a space becomes two pathspecs, neither of which matches, and the
    # no-match branch calls that an empty glob. A real add failure then looks like nothing to stage.
    M('D21 the matched paths are passed to git unquoted',
      '            out="$(LC_ALL=C git add -- "$@" 2>&1)" || rc=$?',
      '            out="$(LC_ALL=C git add -- $@ 2>&1)" || rc=$?',
      'a name with a space reaches git whole and is committed beside an ordinary one'),

    M('D22 a no-match with an error line (not only a warning) is skipped again',
      "                  *'error: '*|*'warning: '*) ;;",
      "                  *'warning: '*) ;;",
      'a no-match that arrives with an error line (not a warning) is a failure'),

    # A porcelain test calls a stray untracked file a change; the commit then fails with nothing staged.
    M('D23 the empty case is decided by the working tree, not by what was staged',
      '          if git diff --cached --quiet; then',
      '          if [ -z "$(git status --porcelain)" ]; then',
      'a stray untracked file with no artifact is still a clean exit'),

    # A loop that does not stop after the push lands pushes four more times and then warns.
    M('D24 the loop does not stop once the push has landed',
      '              echo "Pushed verification note on attempt $i."\n              exit 0\n',
      '              echo "Pushed verification note on attempt $i."\n',
      'and stops there: one push, no warning (a loop that kept going would print both)'),

    # Each alternative of the permission test, dropped in turn.
    M('D25a the permission test no longer knows denied',
      "grep -qiE 'denied|403|permission|forbidden|authentication'",
      "grep -qiE '403|permission|forbidden|authentication'",
      "a push rejected with 'Access denied' fails the step as a permission defect"),
    M('D25b the permission test no longer knows 403',
      "grep -qiE 'denied|403|permission|forbidden|authentication'",
      "grep -qiE 'denied|permission|forbidden|authentication'",
      "a push rejected with 'HTTP 403 from the proxy' fails the step as a permission defect"),
    M('D25c the permission test no longer knows permission',
      "grep -qiE 'denied|403|permission|forbidden|authentication'",
      "grep -qiE 'denied|403|forbidden|authentication'",
      "a push rejected with 'Permission to push to this ref' fails the step as a permission defect"),
    M('D25d the permission test no longer knows forbidden',
      "grep -qiE 'denied|403|permission|forbidden|authentication'",
      "grep -qiE 'denied|403|permission|authentication'",
      "a push rejected with 'Forbidden by a branch rule' fails the step as a permission defect"),
    M('D25e the permission test no longer knows authentication',
      "grep -qiE 'denied|403|permission|forbidden|authentication'",
      "grep -qiE 'denied|403|permission|forbidden'",
      "a push rejected with 'Authentication failed for the account' fails the step as a permission defect"),

    # An earlier step can leave a modified tracked file; without --autostash the rebase refuses it
    # on every attempt and the note is never pushed.
    M('D26 the rebase no longer autostashes',
      'git pull --rebase --autostash origin main',
      'git pull --rebase origin main',
      'with a modified tracked file in the tree and a writer ahead, the note still lands'),
]

# NOT MUTATED, on purpose: dropping the `--` before the paths, or `local` on the function's
# variables. Neither is observable for this step's inputs (every path starts with `outbox/`, and
# the function's names collide with nothing), so a mutant would be equivalent to the original and
# could not be caught. A mutant that cannot be caught proves nothing about the check.

with open(YML, encoding='utf-8') as f:
    original = f.read()

# --anchors-only: the guard that lets this run on every push (guards.yml). It runs no check and
# no mutant; it asserts that every anchor still occurs exactly once and still changes the
# workflow, so the harness cannot rot silently when someone edits the step. (The repo was bitten
# by this before: five stale odds-harness anchors.)
if '--anchors-only' in sys.argv:
    broken = 0
    for m in MUTATIONS:
        hits = original.count(m['anchor'])
        if hits != 1 or original.replace(m['anchor'], m['replace']) == original:
            broken += 1
            print(f"  ANCHOR  {m['name']}: occurs {hits} time(s), expected 1", file=sys.stderr)
    print(f"anchors: {len(MUTATIONS) - broken} of {len(MUTATIONS)} mutation anchors still occur exactly once in {YML}"
          f"{'; %d STALE' % broken if broken else ''}. COVERAGE: anchors only. No mutant was run and no check was run.")
    sys.exit(1 if broken else 0)

# EVERY run below (baseline, mutants, the check's own safety tests) happens under a HOSTILE git
# environment: the committing identity is already the step's own identity, and a config-by-env
# core.hooksPath points at a directory that must stay empty. A check that is not hermetic either
# passes a D12 mutant on the leaked identity or writes its refusing hook into the leak target.
HOSTILE = tempfile.mkdtemp(prefix='hostile-')
atexit.register(shutil.rmtree, HOSTILE, True)
LEAK = os.path.join(HOSTILE, 'hooks')
BOT, BOT_MAIL = 'github-actions[bot]', 'github-actions[bot]@users.noreply.github.com'
env = dict(os.environ, GIT_AUTHOR_NAME=BOT, GIT_AUTHOR_EMAIL=BOT_MAIL, GIT_COMMITTER_NAME=BOT,
           GIT_COMMITTER_EMAIL=BOT_MAIL, GIT_CONFIG_COUNT='1', GIT_CONFIG_KEY_0='core.hooksPath',
           GIT_CONFIG_VALUE_0=LEAK)
base_env = dict(env, DEPLOY_YML=YML)
r = subprocess.run(['bash', CHECK], capture_output=True, text=True, env=base_env)
if r.returncode != 0:
    print('BASELINE FAILED: the unmutated workflow does not pass\n' + '\n'.join(l for l in (r.stdout + r.stderr).splitlines() if l.startswith('FAIL')), file=sys.stderr)
    sys.exit(1)
if os.path.exists(LEAK):
    print('BASELINE LEAKED: the check wrote into core.hooksPath from the environment', file=sys.stderr)
    sys.exit(1)
print('baseline (under a hostile git environment, nothing leaked): ' + (r.stdout.strip().splitlines() or [''])[-1])

bad = 0
for m in MUTATIONS:
    hits = original.count(m['anchor'])
    if hits != 1:
        bad += 1
        print(f"  ANCHOR  {m['name']}\n          anchor occurs {hits} time(s), expected 1. NOTHING WAS MUTATED.", file=sys.stderr)
        continue
    mutated = original.replace(m['anchor'], m['replace'])
    if mutated == original:
        bad += 1
        print(f"  NO EFFECT  {m['name']}", file=sys.stderr)
        continue
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, 'deploy.mutant.yml')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(mutated)
        r = subprocess.run(['bash', CHECK], capture_output=True, text=True, env=dict(env, DEPLOY_YML=path))
    out = r.stdout + r.stderr
    red = [l for l in out.splitlines() if l.startswith('FAIL')]
    if r.returncode == 0:
        bad += 1
        print(f"  NOT CAUGHT  {m['name']}\n          check still passed", file=sys.stderr)
    elif not any(m['expect'] in l for l in red):
        bad += 1
        print(f"  WRONG REASON  {m['name']}\n          no FAIL line mentioned \"{m['expect']}\".\n" + "\n".join(red[:6]), file=sys.stderr)
    else:
        print(f"  caught  {m['name']}\n          by \"{m['expect']}\" ({len(red)} red)")

# ---- the check's OWN safety, each proven by breaking it (Rule 90) -----------------------------
with open(CHECK, encoding='utf-8') as f:
    check_src = f.read()

def check_copy(transform):
    d = tempfile.mkdtemp(prefix='checkcopy-')
    atexit.register(shutil.rmtree, d, True)
    out = transform(check_src)
    assert out != check_src, 'the transform changed nothing: NOTHING WAS MUTATED'
    path = os.path.join(d, 'check.sh')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(out)
    return path

# H1: the check unsets every GIT_* variable. Without that line, the hostile environment gets through.
hook_line = next(l for l in check_src.split('\n') if l.startswith('for v in $(env | sed -n'))
assert check_src.count(hook_line) == 1
shutil.rmtree(LEAK, True)
path = check_copy(lambda t: t.replace(hook_line + '\n', ''))
r = subprocess.run(['bash', path], capture_output=True, text=True, env=base_env)
red = [l for l in (r.stdout + r.stderr).splitlines() if l.startswith('FAIL')]
if r.returncode != 0 or os.path.exists(LEAK):
    print(f"  caught  H1  the check stops unsetting GIT_* ({len(red)} red; hook written to the leaked hooksPath: {os.path.exists(LEAK)})")
else:
    bad += 1
    print('  NOT CAUGHT  H1  the check stops unsetting GIT_*\n          it still passed and wrote nothing to the leaked hooksPath', file=sys.stderr)
shutil.rmtree(LEAK, True)

# H2: when the test clones cannot be created, the step must not run in the caller's directory.
# Run the check from a throwaway repo whose `git clone` fails, then look at that repo and its origin.
def throwaway():
    d = tempfile.mkdtemp(prefix='throwaway-')
    atexit.register(shutil.rmtree, d, True)
    sh = lambda *a, **k: subprocess.run(a, check=True, capture_output=True, text=True, cwd=k.get('cwd'), env={**os.environ, 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1'})
    sh('git', 'init', '-q', '--bare', os.path.join(d, 'origin.git'))
    sh('git', 'clone', '-q', os.path.join(d, 'origin.git'), os.path.join(d, 'repo'))
    repo = os.path.join(d, 'repo')
    sh('git', 'config', 'user.name', 'developer', cwd=repo); sh('git', 'config', 'user.email', 'dev@example.com', cwd=repo)
    os.makedirs(os.path.join(repo, 'outbox')); open(os.path.join(repo, 'outbox', '.keep'), 'w').write('.\n')
    sh('git', 'add', '-A', cwd=repo); sh('git', 'commit', '-qm', 'seed', cwd=repo); sh('git', 'push', '-q', 'origin', 'HEAD:main', cwd=repo)
    sh('git', 'checkout', '-q', '-B', 'main', cwd=repo)
    shim = os.path.join(d, 'shim'); os.makedirs(shim)
    real = shutil.which('git')
    with open(os.path.join(shim, 'git'), 'w') as f:
        f.write(f'#!/bin/sh\nif [ "$1" = "clone" ]; then echo "fatal: simulated clone failure" >&2; exit 128; fi\nexec "{real}" "$@"\n')
    os.chmod(os.path.join(shim, 'git'), 0o755)
    return d, repo, shim

def run_from_throwaway(script_path):
    d, repo, shim = throwaway()
    count = lambda: int(subprocess.run(['git', '--git-dir', os.path.join(d, 'origin.git'), 'rev-list', '--count', 'main'], capture_output=True, text=True).stdout.strip())
    before = count()
    r = subprocess.run(['bash', script_path], capture_output=True, text=True, cwd=repo,
                       env=dict(env, PATH=shim + os.pathsep + os.environ['PATH'], DEPLOY_YML=os.path.join(os.getcwd(), YML)))
    who = subprocess.run(['git', 'config', 'user.name'], capture_output=True, text=True, cwd=repo).stdout.strip()
    return r.returncode, count() - before, who

rc, pushed, who = run_from_throwaway(os.path.abspath(CHECK))  # absolute: the throwaway repo is the cwd
if rc == 2 and pushed == 0 and who == 'developer':
    print('  caught  H2a with the clones unavailable the check stops (exit 2), pushes nothing and leaves the caller\'s identity alone')
else:
    bad += 1
    print(f'  UNSAFE  H2a the check ran the step in the caller\'s repository: exit {rc}, {pushed} commit(s) pushed, user.name is now {who!r}', file=sys.stderr)

unguarded = check_copy(lambda t: t.replace(' || exit 99', ''))
with open(unguarded, encoding='utf-8') as f:
    src = f.read()
a = src.index('  if [ ! -d "$WORK/w/.git" ]')
b = src.index('    exit 2\n  fi\n', a) + len('    exit 2\n  fi\n')
assert src.count('  if [ ! -d "$WORK/w/.git" ]') == 1
with open(unguarded, 'w', encoding='utf-8') as f:
    f.write(src[:a] + src[b:])
rc, pushed, who = run_from_throwaway(unguarded)
if pushed > 0 or who != 'developer':
    print(f'  caught  H2b without its guards the check runs the step in the caller\'s repository ({pushed} commit(s) pushed, user.name {who!r}): the test can tell')
else:
    bad += 1
    print('  NOT CAUGHT  H2b the guards removed and nothing unsafe happened: H2a proves nothing', file=sys.stderr)

with open(YML, encoding='utf-8') as f:
    assert f.read() == original, 'the real workflow changed during the run'
print(f"\nran {len(MUTATIONS)} mutation(s) against {CHECK}, each in a temp copy; {YML} was not touched{'; %d PROBLEM(S)' % bad if bad else ''}")
sys.exit(1 if bad else 0)
