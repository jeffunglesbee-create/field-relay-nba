#!/usr/bin/env python3
"""
Does the "Commit results" step of a workflow survive another repository push landing between the checkout and its own push?

It runs the step's REAL text (extracted from the workflow file with PyYAML, ${{ inputs.patents }} substituted) under `bash -e`, as the runner does, in a depth-1
file:// clone of a bare repository, with a second actor pushing to main after the clone and before the step. Nothing is simulated except `sleep`, which is shimmed
to return at once (the step sleeps 5, 10, 15 s between attempts).

Scenarios (each asserted, each printed with its denominator):
  S1 race        a second actor pushes to main after the clone, before the step. The step must exit 0 AND its commit must be on the remote's main.
  S2 no race     the same step with nobody else pushing: exit 0, commit on the remote's main. (The control: the harness can see a pass.)
  S3 rejected    the remote refuses every push (pre-receive hook). The step must exit NON-zero: a push that did not land must not read as green.
  S4 no clobber  after S1 the remote's main holds BOTH the second actor's commit and the step's, and was fast-forwarded (no force).

usage: patent-push-race-harness.py <workflow.yml> [--mutants]
"""
import os, re, shutil, stat, subprocess, sys, tempfile, textwrap
import yaml

WF = sys.argv[1]
STEP_NAME = 'Commit results'


def step_text(path_or_text, is_text=False):
    doc = yaml.safe_load(path_or_text if is_text else open(path_or_text, encoding='utf-8'))
    steps = None
    for job in doc['jobs'].values():
        for s in job.get('steps', []):
            if s.get('name') == STEP_NAME:
                steps = s['run']
    assert steps, f'no step named {STEP_NAME!r}'
    return steps.replace('${{ inputs.patents }}', '12786287')


def sh(cmd, cwd, env=None, check=True):
    e = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t', **(env or {}))
    r = subprocess.run(cmd, cwd=cwd, env=e, shell=isinstance(cmd, str), capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f'{cmd} failed in {cwd}: {r.stdout}{r.stderr}')
    return r


def scenario(step, kind):
    root = tempfile.mkdtemp(prefix='pfr-')
    try:
        bare, seed, runner, other, shim = (os.path.join(root, d) for d in ('origin.git', 'seed', 'runner', 'other', 'bin'))
        os.makedirs(shim)
        with open(os.path.join(shim, 'sleep'), 'w') as f:
            f.write('#!/bin/sh\nexit 0\n')
        os.chmod(shim, 0o755); os.chmod(os.path.join(shim, 'sleep'), 0o755)
        sh(f'git init -q --bare -b main {bare}', root)
        sh(f'git init -q -b main {seed}', root)
        open(os.path.join(seed, 'README'), 'w').write('seed\n')
        sh('git add . && git commit -q -m seed && git remote add origin ' + bare + ' && git push -q origin main', seed)
        # the runner: depth-1 clone over file://, as actions/checkout@v4 with fetch-depth 1
        sh(f'git clone -q --depth 1 file://{bare} {runner}', root)
        # the step's own work product, uncommitted (the pipeline's steps 1 to 3 wrote it)
        os.makedirs(os.path.join(runner, 'outbox', 'patents'))
        open(os.path.join(runner, 'outbox', 'patents', 'US12786287-compare.md'), 'w').write('result\n')
        if kind in ('race', 'clobber'):
            sh(f'git clone -q {bare} {other}', root)
            open(os.path.join(other, 'other.txt'), 'w').write('someone else\n')
            sh('git add . && git commit -q -m "other actor" && git push -q origin main', other)
        if kind == 'rejected':
            hook = os.path.join(bare, 'hooks', 'pre-receive')
            open(hook, 'w').write('#!/bin/sh\necho "rejected by the harness" >&2\nexit 1\n')
            os.chmod(hook, 0o755)
        env = {'GITHUB_REF_NAME': 'main', 'PATH': shim + os.pathsep + os.environ['PATH']}
        r = sh(['bash', '-e', '-c', step], runner, env=env, check=False)
        # what the remote now holds
        check = os.path.join(root, 'check')
        sh(f'git clone -q {bare} {check}', root)
        subjects = sh('git log --format=%s main', check).stdout.split('\n')
        landed = any(s and s not in ('seed', 'other actor') for s in subjects)   # any commit that is neither the seed nor the second actor's: the step's own
        other_kept = 'other actor' in subjects
        first_parent_linear = len(sh('git log --merges --format=%h main', check).stdout.split()) == 0
        return dict(code=r.returncode, landed=landed, other_kept=other_kept, linear=first_parent_linear, err=(r.stdout + r.stderr).strip().splitlines()[-1:] )
    finally:
        shutil.rmtree(root, ignore_errors=True)


def judge(step):
    res = {}
    s1 = scenario(step, 'race');       res['S1 race'] = (s1['code'] == 0 and s1['landed'], s1)
    s2 = scenario(step, 'norace');     res['S2 no race'] = (s2['code'] == 0 and s2['landed'], s2)
    s3 = scenario(step, 'rejected');   res['S3 rejected must exit non-zero'] = (s3['code'] != 0 and not s3['landed'], s3)
    res['S4 no clobber'] = (s1['landed'] and s1['other_kept'] and s1['linear'], s1)
    return res


def show(label, res):
    ok = sum(1 for v in res.values() if v[0])
    for k, (good, d) in res.items():
        print(f"  {'ok  ' if good else 'FAIL'}  {k:34s} exit={d['code']} landed={d['landed']} other_kept={d['other_kept']} {d['err'][0][:90] if d['err'] and not good else ''}")
    print(f'  {label}: {ok} of {len(res)} scenarios pass')
    return ok == len(res)


print(f'workflow: {WF}')
base = step_text(WF)
all_ok = show('REAL STEP', judge(base))

if '--mutants' in sys.argv:
    print('\nMUTANTS of the real step (each must go red; anchors asserted exactly once; a mutant identical to the source is refused)')
    mutants = [
        ('M1 no rebase before the push', 'git pull --rebase --autostash origin "${GITHUB_REF_NAME}" && ', ''),
        ('M2 verification after the loop removed', re.search(r'\n\s*git fetch -q origin "\$\{GITHUB_REF_NAME\}"\n\s*git merge-base.*?exit 1; \}', base, re.S).group(0) if re.search(r'git merge-base', base) else None, ''),
        ('M3 force push in place of rebase and push', 'git pull --rebase --autostash origin "${GITHUB_REF_NAME}" && git push origin "HEAD:${GITHUB_REF_NAME}"', 'git push --force origin "HEAD:${GITHUB_REF_NAME}"'),
    ]
    caught = 0; applied = 0
    for name, old, new in mutants:
        if not old or base.count(old) != 1:
            print(f'  FAIL  {name}: ANCHOR occurs {0 if not old else base.count(old)} times, not once; NOTHING WAS MUTATED'); all_ok = False; continue
        mutated = base.replace(old, new)
        if mutated == base:
            print(f'  FAIL  {name}: identical to the source'); all_ok = False; continue
        applied += 1
        res = judge(mutated)
        red = [k for k, v in res.items() if not v[0]]
        if red:
            caught += 1; print(f'  ok    {name}: CAUGHT by {", ".join(red)}')
        else:
            print(f'  FAIL  {name}: NOT CAUGHT (all scenarios still pass)'); all_ok = False
    print(f'  {caught} of {applied} applied mutants caught ({len(mutants)} defined)')
    all_ok = all_ok and caught == applied == len(mutants)

sys.exit(0 if all_ok else 1)
