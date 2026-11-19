#!/usr/bin/env bash
# Rule 90 for the `Commit results` step of .github/workflows/deploy.yml (job `verify`).
#
# THE STEP'S OWN TEXT IS WHAT RUNS. Inline in YAML that shell could only ever be
# exercised by a real deploy, which is how `git add ... || echo "(no ... artifact to
# stage)"` and `if ! git commit ...; then echo "Nothing to commit"; exit 0` stayed in the
# sole deploy path: they turned a held index.lock, a gitignored artifact and a refused
# commit into a green run with the readout never committed (reproduced 2026-11-18 against
# scripts/probe-commit-retry.sh, which had the same defect). This extracts the step's
# `run:` block from the workflow file and drives it through real clones and a real remote.
#
# COVERAGE, stated where the result is read (Rule 91): the step's `run:` block, every
# step-level key (asserted to be `name` only, wherever it sits relative to `run:`) and the
# `verify` job's header keys (asserted free of anything that turns a failure green). NOT
# covered: the workflow's `defaults:` and `permissions:`, any other job, the runner's git
# (2.56.1 on 2026-11-18) or token, a shallow checkout. Tested here on whatever
# `git --version` this machine has. The final COVERAGE line says the same with the count.
#
# DEPLOY_YML picks the workflow file, so scripts/mutate-deploy-commit-results.py can aim
# this at a mutated COPY. The real file is never rewritten.
#
# GitHub runs a `run:` step with no `shell:` as `bash -e {0}` (WITHOUT pipefail; observed in
# the log of a real verify job on 2026-11-18), so that is how the step is run here.
# `sleep` is replaced by a no-op on PATH: the push loop sleeps 5, 10, 15, 20, 25 seconds.
set -uo pipefail

YML="${DEPLOY_YML:-.github/workflows/deploy.yml}"
checked=0; failed=0
ok()   { checked=$((checked+1)); echo "ok    $1"; }
bad()  { checked=$((checked+1)); failed=$((failed+1)); echo "FAIL  $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — got '$2', want '$3'"; fi; }

# The step greps its own push log for 403|denied|permission|forbidden|authentication, and
# that log contains this directory's path: a random path containing "403" would turn the
# lost-race case red.
WORK="$(mktemp -d)"
while printf '%s' "$WORK" | grep -qiE '403|denied|permission|forbidden|authentication'; do rm -rf "$WORK"; WORK="$(mktemp -d)"; done
trap 'rm -rf "$WORK"' EXIT HUP INT TERM

# HERMETIC: an inherited GIT_DIR would put the seed commit in the CALLER's repository, an
# inherited GIT_CONFIG_COUNT/KEY_n/VALUE_n (this very sandbox exports three) outranks every
# config file and would send the refusing hook below somewhere else, and an inherited
# GIT_AUTHOR_NAME would satisfy the identity assertion without the step setting anything.
# So every GIT_* variable goes, not a list of four. scripts/mutate-deploy-commit-results.py
# runs this under exactly those leaks and fails if any of them get through.
for v in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$v"; done
export HOME="$WORK/home"; mkdir -p "$HOME"
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null

# ── extract the step, its own keys and its job's header ────────────────────
python3 - "$YML" "$WORK" <<'PY'
import sys
lines = open(sys.argv[1], encoding='utf-8').read().split('\n')
work = sys.argv[2]
STEP = '      - name: Commit results'
starts = [i for i, l in enumerate(lines) if l == STEP]
if len(starts) != 1:
    sys.exit('want exactly one step named "Commit results", found %d' % len(starts))
start = starts[0]
# ... and it must be the one in the `verify` job, not a same-named step somewhere else
import re
owner = [l for l in lines[:start] if re.match(r'^  [A-Za-z0-9_-]+:\s*$', l)][-1]
if owner != '  verify:':
    sys.exit('the "Commit results" step belongs to %r, not to verify' % owner.strip())
# the step ends where the next step begins, or where the job or file does
def indent(l): return len(l) - len(l.lstrip(' '))
end = next((i for i in range(start + 1, len(lines))
            if lines[i].strip() and (indent(lines[i]) < 6 or lines[i].startswith('      - '))), len(lines))
run = next((i for i in range(start + 1, end) if lines[i] == '        run: |'), None)
if run is None:
    sys.exit('the step has no `run: |` block before the next step')
out = []
for l in lines[run + 1:end]:
    if l.strip() == '':
        out.append('')
        continue
    if len(l) - len(l.lstrip(' ')) < 10:
        break
    out.append(l[10:])
open(work + '/step.sh', 'w', encoding='utf-8').write('\n'.join(out).rstrip('\n') + '\n')
# keys of the step itself: every line at the step's own key indent, BEFORE or AFTER the run
# block (a `continue-on-error: true` written after the last line of the script is as live as
# one written before it). Lines inside the run block are indented deeper and are not keys.
keys = [l.strip() for l in lines[start + 1:end]
        if l.strip() and not l.strip().startswith('#') and indent(l) == 8 and l != '        run: |']
open(work + '/stepkeys.txt', 'w').write('\n'.join(keys) + '\n')
# the verify job's own header keys, between `  verify:` and its `    steps:`
j = next((i for i, l in enumerate(lines) if l == '  verify:'), None)
if j is None:
    sys.exit('no job named verify')
k = next((i for i in range(j + 1, len(lines)) if lines[i] == '    steps:'), None)
if k is None:
    sys.exit('the verify job has no steps: block')
open(work + '/jobkeys.txt', 'w').write('\n'.join(l.strip() for l in lines[j + 1:k] if l.strip() and not l.strip().startswith('#')) + '\n')
PY
rc=$?
eq "the step is found in the workflow and extracted" "$rc" "0"
lines="$(wc -l < "$WORK/step.sh")"
if [ "$lines" -gt 20 ] && grep -q 'git push origin main' "$WORK/step.sh"; then ok "and it is the whole step (the push is in it)"; else bad "and it is the whole step — $lines lines"; fi
eq "the step carries no key but its name and run (no if, continue-on-error, shell, env)" "$(cat "$WORK/stepkeys.txt")" ""
if grep -qE 'continue-on-error|^defaults:|^if:' "$WORK/jobkeys.txt"; then bad "the verify job has no job-level key that could turn a failure green — $(tr '\n' ' ' < "$WORK/jobkeys.txt")"; else ok "the verify job has no job-level key that could turn a failure green"; fi

mkdir -p "$WORK/shim"
printf '#!/bin/sh\nexit 0\n' > "$WORK/shim/sleep"; chmod +x "$WORK/shim/sleep"
REALGIT="$(command -v git)"

# `real` seeds the remote with artifacts of earlier runs already TRACKED, which is what the
# real verify job checks out (hundreds of them): the shell then expands each glob to existing
# files, and the empty-glob branch is not reachable.
setup() {
  rm -rf "$WORK/remote.git" "$WORK/seed" "$WORK/w" "$WORK/a"
  git init -q --bare "$WORK/remote.git"
  git clone -q "$WORK/remote.git" "$WORK/seed" 2>/dev/null
  (cd "$WORK/seed" || exit 99
   git config user.email t@t; git config user.name t
   mkdir -p outbox; echo '.' > outbox/.keep
   if [ "${1:-}" = real ]; then
     for n in 1 2 3; do echo "old verify $n" > "outbox/live-verify-$n.md"; echo "{\"old\":$n}" > "outbox/health-sources-$n.json"; done
   fi
   git add -A; git commit -qm seed; git push -q origin HEAD:main) >/dev/null 2>&1
  git clone -q "$WORK/remote.git" "$WORK/w" 2>/dev/null
  git clone -q "$WORK/remote.git" "$WORK/a" 2>/dev/null
  (cd "$WORK/w" || exit 99; git checkout -q main 2>/dev/null || git checkout -q -b main origin/main)
  (cd "$WORK/a" || exit 99; git config user.email t@t; git config user.name t; git checkout -q main 2>/dev/null || git checkout -q -b main origin/main)
  # setup swallows its own errors above. If a clone failed, the step would run in the CALLER's
  # directory and commit and push there with the caller's credentials. Stop instead.
  if [ ! -d "$WORK/w/.git" ] || [ ! -d "$WORK/a/.git" ] || [ ! -d "$WORK/remote.git" ] \
     || [ "$(cd "$WORK/w" && git rev-parse --show-toplevel)" != "$WORK/w" ]; then
    echo "FATAL: the test clones were not created; no assertion can mean anything. Nothing was run." >&2
    exit 2
  fi
}
# NOTE the clone `w` gets NO identity: the step sets github-actions[bot] itself, and one
# assertion below depends on that.
step() { (cd "$WORK/w" || exit 99; PATH="$WORK/shim:$PATH" "$@" bash -e "$WORK/step.sh" 2>&1); }
remote_count() { git --git-dir="$WORK/remote.git" rev-list --count main; }
remote_has()   { git --git-dir="$WORK/remote.git" cat-file -e "main:$1" 2>/dev/null && echo yes || echo no; }

# ── 1. nothing was produced: a clean exit, as the 2026-08-06 ruling requires ──
setup
before="$(remote_count)"
out="$(step env)"; rc=$?
eq "no artifact at all is a clean exit (an unmatched glob must not abort the step)" "$rc" "0"
case "$out" in *"Nothing to commit"*) ok "and says there was nothing to commit";; *) bad "and says there was nothing to commit — $out";; esac
eq "and nothing was pushed" "$(remote_count)" "$before"

# ── 2. the normal deploy: both artifacts, committed and pushed ────────────
setup
out="$(cd "$WORK/w" || exit 99; echo 'verify' > outbox/live-verify-111.md; echo '{}' > outbox/health-sources-111.json
      PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" 2>&1)"; rc=$?
eq "both artifacts present: the step succeeds" "$rc" "0"
case "$out" in *"Pushed verification note on attempt 1."*) ok "and pushes on the first attempt";; *) bad "and pushes on the first attempt — $out";; esac
eq "and stops there: one push, no warning (a loop that kept going would print both)" "$(printf '%s\n' "$out" | grep -c 'Pushed verification note')$(printf '%s\n' "$out" | grep -c '::warning::')" "10"
eq "and live-verify reached the remote" "$(remote_has outbox/live-verify-111.md)" "yes"
eq "and health-sources reached the remote" "$(remote_has outbox/health-sources-111.json)" "yes"
eq "and the commit subject is unchanged" "$(git --git-dir="$WORK/remote.git" log -1 --format=%s main)" "chore: post-deploy live verification [skip ci]"
eq "and the committing identity is the step's own" "$(git --git-dir="$WORK/remote.git" log -1 --format=%an main)" "github-actions[bot]"
eq "and so is its address" "$(git --git-dir="$WORK/remote.git" log -1 --format=%ae main)" "github-actions[bot]@users.noreply.github.com"

# ── 3. the REAL shape: earlier artifacts already tracked, the globs always match ──
setup real
out="$(cd "$WORK/w" || exit 99; echo 'this run' > outbox/live-verify-777.md; echo '{"run":777}' > outbox/health-sources-777.json
      PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" 2>&1)"; rc=$?
eq "with earlier artifacts tracked, this run's two new ones are committed" "$rc$(remote_has outbox/live-verify-777.md)$(remote_has outbox/health-sources-777.json)" "0yesyes"
setup real
before="$(remote_count)"
out="$(step env)"; rc=$?
eq "with earlier artifacts tracked and none new, the step has nothing to commit and exits clean" "$rc" "0"
case "$out" in *"Nothing to commit"*) ok "and says so";; *) bad "and says so — $out";; esac
eq "and nothing was pushed" "$(remote_count)" "$before"

# a stray untracked file and no artifact is still "nothing to commit": the test is on what was
# STAGED, not on what is lying in the tree (an empty-glob ruling, 2026-08-06)
setup
before="$(remote_count)"
out="$(cd "$WORK/w" || exit 99; echo 'stray' > outbox/stray.txt; echo 'x' > unrelated.txt
      PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" 2>&1)"; rc=$?
eq "a stray untracked file with no artifact is still a clean exit" "$rc" "0"
case "$out" in *"Nothing to commit"*) ok "and says there was nothing to commit";; *) bad "and says there was nothing to commit — $out";; esac
eq "and nothing was pushed" "$(remote_count)" "$before"

# ── 4. every matched path is staged, not just the first ───────────────────
setup
(cd "$WORK/w" || exit 99; echo 'one' > outbox/live-verify-1.md; echo 'two' > outbox/live-verify-2.md
 PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" >/dev/null 2>&1)
eq "both live-verify artifacts are committed (a glob can match more than one)" "$(remote_has outbox/live-verify-1.md)$(remote_has outbox/live-verify-2.md)" "yesyes"

setup
(cd "$WORK/w" || exit 99; echo 'one' > "outbox/live-verify-a b.md"; echo 'two' > outbox/live-verify-3.md
 PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" >/dev/null 2>&1)
eq "a name with a space reaches git whole and is committed beside an ordinary one" "$(remote_has "outbox/live-verify-a b.md")$(remote_has outbox/live-verify-3.md)" "yesyes"

setup
(cd "$WORK/w" || exit 99; echo 'only' > outbox/health-sources-9.json
 PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" >/dev/null 2>&1)
eq "an absent live-verify artifact does not strand a present health-sources artifact" "$(remote_has outbox/health-sources-9.json)" "yes"

# ── 5. SCOPE: only the two artifact globs are committed ───────────────────
setup
(cd "$WORK/w" || exit 99; echo 'verify' > outbox/live-verify-12.md; echo 'stray' > outbox/stray.txt; echo 'x' > unrelated.txt
 PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" >/dev/null 2>&1)
eq "only the two artifact globs are committed (a stray file is not)" "$(remote_has outbox/live-verify-12.md)$(remote_has outbox/stray.txt)$(remote_has unrelated.txt)" "yesnono"

# ── 6. THE DEFECT: a failed add is not "no artifact to stage" ─────────────
setup
before="$(remote_count)"
out="$(cd "$WORK/w" || exit 99; echo 'verify' > outbox/live-verify-5.md; touch "$(git rev-parse --git-path index.lock)"
      PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" 2>&1)"; rc=$?
eq "a git add that fails (a held index.lock) fails the step" "$rc" "1"
case "$out" in *"::error::git add failed for outbox/live-verify-5.md"*) ok "and names the path it could not stage";; *) bad "and names the path it could not stage — $out";; esac
case "$out" in *"index.lock"*) ok "and prints git's own reason";; *) bad "and prints git's own reason — $out";; esac
case "$out" in *"artifact to stage"*) bad "and does not claim there was no artifact (the swallowed add said so)";; *) ok "and does not claim there was no artifact (the swallowed add said so)";; esac
eq "and nothing was pushed" "$(remote_count)" "$before"

setup
out="$(cd "$WORK/w" || exit 99; echo 'verify' > outbox/live-verify-6.md; echo 'outbox/live-verify-6.md' > .gitignore
      PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" 2>&1)"; rc=$?
eq "an artifact git refuses to stage (ignored) fails the step" "$rc" "1"
case "$out" in *"::error::git add failed for outbox/live-verify-6.md"*) ok "and names the ignored path";; *) bad "and names the ignored path — $out";; esac

# the SECOND glob: half of the original defect was here, and it is the artifact run 32659418899 lost
setup
before="$(remote_count)"
out="$(cd "$WORK/w" || exit 99; echo 'verify' > outbox/live-verify-13.md; echo '{}' > outbox/health-sources-13.json; echo 'outbox/health-sources-13.json' > .gitignore
      PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" 2>&1)"; rc=$?
eq "an artifact git refuses to stage on the SECOND glob fails the step" "$rc" "1"
case "$out" in *"::error::git add failed for outbox/health-sources-13.json"*) ok "and names it";; *) bad "and names it — $out";; esac
eq "and fails closed: nothing was committed, so the first artifact did not land either" "$(remote_count)" "$before"

# ── 7. A REFUSED COMMIT IS NOT "Nothing to commit" ────────────────────────
setup
before="$(remote_count)"
out="$(cd "$WORK/w" || exit 99; echo 'verify' > outbox/live-verify-7.md
      mkdir -p "$(git rev-parse --git-path hooks)"
      printf '#!/bin/sh\necho "hook refuses"\nexit 1\n' > "$(git rev-parse --git-path hooks)/pre-commit"
      chmod +x "$(git rev-parse --git-path hooks)/pre-commit"
      PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" 2>&1)"; rc=$?
eq "a git commit that is refused fails the step" "$rc" "1"
case "$out" in *"::error::git commit failed"*) ok "and says the note was not committed";; *) bad "and says the note was not committed — $out";; esac
case "$out" in *"Nothing to commit"*) bad "and does not claim there was nothing to commit";; *) ok "and does not claim there was nothing to commit";; esac
eq "and the remote did not move" "$(remote_count)" "$before"

# ── 8. THE NO-MATCH TEST, against what else git can say ───────────────────
# A localised git: the test reads English, so the add runs under LC_ALL=C.
setup
mkdir -p "$WORK/gshim"
cat > "$WORK/gshim/git" <<SHIM
#!/bin/sh
if [ "\$1" = "add" ] && [ "\${LC_ALL:-}" != "C" ]; then
  echo "fatal: Pfadspezifikation 'x' stimmt mit keiner Datei überein" >&2
  exit 128
fi
exec "$REALGIT" "\$@"
SHIM
chmod +x "$WORK/gshim/git"
out="$(cd "$WORK/w" || exit 99; PATH="$WORK/gshim:$WORK/shim:$PATH" LC_ALL=de_DE.UTF-8 bash -e "$WORK/step.sh" 2>&1)"; rc=$?
eq "a localised git does not turn an empty glob into a failure" "$rc" "0"

# A no-match that ARRIVES WITH another error or warning (a directory git could not open,
# which git 2.43 prints and then ends on the same fatal line) is a failure, not a skip.
setup
mkdir -p "$WORK/pshim"
cat > "$WORK/pshim/git" <<SHIM
#!/bin/sh
if [ "\$1" = "add" ]; then
  echo "warning: could not open directory 'outbox/': Permission denied" >&2
  echo "fatal: pathspec 'outbox/live-verify-*.md' did not match any files" >&2
  exit 128
fi
exec "$REALGIT" "\$@"
SHIM
chmod +x "$WORK/pshim/git"
out="$(cd "$WORK/w" || exit 99; PATH="$WORK/pshim:$WORK/shim:$PATH" bash -e "$WORK/step.sh" 2>&1)"; rc=$?
eq "a no-match that arrives with another error or warning is a failure" "$rc" "1"
# ... while a harmless hint beside a bare no-match is still a skip (newer gits may add one)
setup
mkdir -p "$WORK/hshim"
cat > "$WORK/hshim/git" <<SHIM
#!/bin/sh
if [ "\$1" = "add" ]; then
  echo "fatal: pathspec 'outbox/live-verify-*.md' did not match any files" >&2
  echo "hint: Disable this message with \"git config advice.addEmptyPathspec false\"" >&2
  exit 128
fi
exec "$REALGIT" "\$@"
SHIM
chmod +x "$WORK/hshim/git"
out="$(cd "$WORK/w" || exit 99; PATH="$WORK/hshim:$WORK/shim:$PATH" bash -e "$WORK/step.sh" 2>&1)"; rc=$?
eq "a bare no-match with a hint line beside it is still a skip" "$rc" "0"

# ── 9. THE PUSH LOOP IS UNCHANGED: a lost race retries, a permission error fails ─
setup
(cd "$WORK/a" || exit 99; echo 'other writer' > outbox/other.json; git add -A; git commit -qm other; git push -q origin HEAD:main) >/dev/null 2>&1
out="$(cd "$WORK/w" || exit 99; echo 'verify' > outbox/live-verify-8.md
      PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" 2>&1)"; rc=$?
eq "a concurrent writer ahead of the step is rebased over and the note still lands" "$rc" "0"
eq "and both writers' files are on the remote" "$(remote_has outbox/other.json)$(remote_has outbox/live-verify-8.md)" "yesyes"

# a race that is REJECTED twice and then lands: the loop must keep trying
setup
cat > "$WORK/remote.git/hooks/pre-receive" <<HOOK
#!/bin/sh
n=\$(cat "$WORK/pushes" 2>/dev/null || echo 0); n=\$((n+1)); echo \$n > "$WORK/pushes"
if [ "\$n" -le 2 ]; then echo "Updates were rejected because the remote contains work that you do not have locally"; exit 1; fi
exit 0
HOOK
chmod +x "$WORK/remote.git/hooks/pre-receive"; rm -f "$WORK/pushes"
out="$(cd "$WORK/w" || exit 99; echo 'verify' > outbox/live-verify-14.md
      PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" 2>&1)"; rc=$?
eq "a lost race that is retried and then lands succeeds" "$rc" "0"
case "$out" in *"Pushed verification note on attempt 3."*) ok "and reports the attempt that landed (a loop cut to one attempt would not)";; *) bad "and reports the attempt that landed (a loop cut to one attempt would not) — $out";; esac
eq "and the note reached the remote" "$(remote_has outbox/live-verify-14.md)" "yes"
rm -f "$WORK/pushes"

setup
cat > "$WORK/remote.git/hooks/pre-receive" <<'HOOK'
#!/bin/sh
echo "Updates were rejected because the remote contains work that you do not have locally"
exit 1
HOOK
chmod +x "$WORK/remote.git/hooks/pre-receive"
out="$(cd "$WORK/w" || exit 99; echo 'verify' > outbox/live-verify-9.md
      PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" 2>&1)"; rc=$?
eq "a push that loses every retry warns and does not fail the run" "$rc" "0"
case "$out" in *"::warning::Verification-note push lost every retry"*) ok "and says so as a warning";; *) bad "and says so as a warning — $out";; esac

setup
cat > "$WORK/remote.git/hooks/pre-receive" <<'HOOK'
#!/bin/sh
echo "remote: Permission to field-relay-nba.git denied to github-actions[bot]."
exit 1
HOOK
chmod +x "$WORK/remote.git/hooks/pre-receive"
out="$(cd "$WORK/w" || exit 99; echo 'verify' > outbox/live-verify-10.md
      PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" 2>&1)"; rc=$?
eq "a permission failure on the push still fails the step" "$rc" "1"
case "$out" in *"for a PERMISSION reason"*) ok "and says it is a permission defect, not a race";; *) bad "and says it is a permission defect, not a race — $out";; esac

# each alternative of the permission test on its own: one dropped from the pattern would still
# pass a message that happens to contain another
i=0
for msg in "remote: HTTP 403 from the proxy" "remote: Forbidden by a branch rule" "remote: Authentication failed for the account" "remote: Permission to push to this ref" "remote: Access denied"; do
  i=$((i+1))
  setup
  printf '#!/bin/sh\necho "%s"\nexit 1\n' "$msg" > "$WORK/remote.git/hooks/pre-receive"
  chmod +x "$WORK/remote.git/hooks/pre-receive"
  out="$(cd "$WORK/w" || exit 99; echo 'verify' > "outbox/live-verify-2$i.md"
        PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" 2>&1)"; rc=$?
  eq "a push rejected with '${msg#remote: }' fails the step as a permission defect" "$rc" "1"
done

# a modified TRACKED file at push time (an earlier step can leave one) and a writer ahead:
# the rebase needs --autostash, otherwise every attempt fails and the note is never pushed
setup
(cd "$WORK/a" || exit 99; echo 'other writer' > outbox/other.json; git add -A; git commit -qm other; git push -q origin HEAD:main) >/dev/null 2>&1
out="$(cd "$WORK/w" || exit 99; echo 'edited by an earlier step' >> outbox/.keep; echo 'verify' > outbox/live-verify-30.md
      PATH="$WORK/shim:$PATH" bash -e "$WORK/step.sh" 2>&1)"; rc=$?
eq "with a modified tracked file in the tree and a writer ahead, the note still lands" "$rc$(remote_has outbox/live-verify-30.md)" "0yes"

# a no-match that arrives with an ERROR line (not only a warning) is a failure too
setup
mkdir -p "$WORK/eshim"
cat > "$WORK/eshim/git" <<SHIM
#!/bin/sh
if [ "\$1" = "add" ]; then
  echo "error: unable to read directory 'outbox/'" >&2
  echo "fatal: pathspec 'outbox/live-verify-*.md' did not match any files" >&2
  exit 128
fi
exec "$REALGIT" "\$@"
SHIM
chmod +x "$WORK/eshim/git"
out="$(cd "$WORK/w" || exit 99; PATH="$WORK/eshim:$WORK/shim:$PATH" bash -e "$WORK/step.sh" 2>&1)"; rc=$?
eq "a no-match that arrives with an error line (not a warning) is a failure" "$rc" "1"

echo
echo "COVERAGE: $checked assertions on the step's run block, EVERY key of the step (before or after the run block) and the verify job's header keys, on git $(git --version | sed 's/git version //'). NOT covered: the workflow's defaults and permissions, any other job, the runner's git (2.56.1 on 2026-11-18) and token (a 403 is simulated by a pre-receive hook), a shallow checkout (the job uses fetch-depth 200; these clones are full), or the first real deploy. The step's PUSH_LOG is a fixed /tmp path, so two runs of this check at once share it. The mutants (scripts/mutate-deploy-commit-results.py) run in no workflow; only their --anchors-only run is in guards.yml."
if [ "$failed" -eq 0 ]; then echo "PASS: $((checked-failed))/$checked assertions — the step's own text, real clones, real pushes"; exit 0
else echo "FAILED: $((checked-failed))/$checked assertions"; exit 1; fi
