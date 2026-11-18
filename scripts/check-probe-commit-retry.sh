#!/usr/bin/env bash
# Rule 90 for scripts/probe-commit-retry.sh.
#
# DRIVES THE REAL FILE THROUGH A REAL RACE. Two clones of one bare repo each
# rewrite outbox/provenance-runtime-probe-latest.json, the first pushes, the
# second runs the retry loop. Inline in YAML this could only have been exercised
# by dispatching runs and hoping they collided — which is how the broken loop
# shipped and stayed shipped.
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/probe-commit-retry.sh"
checked=0; failed=0
ok()   { checked=$((checked+1)); echo "ok    $1"; }
bad()  { checked=$((checked+1)); failed=$((failed+1)); echo "FAIL  $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — got '$2', want '$3'"; fi; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

setup() {
  rm -rf "$WORK"/*
  git init -q --bare "$WORK/remote.git"
  git clone -q "$WORK/remote.git" "$WORK/seed"
  (cd "$WORK/seed"
   git config user.email t@t; git config user.name t
   mkdir -p outbox
   echo '{"run":"seed"}' > outbox/provenance-runtime-probe-latest.json
   echo 'seeded.md' > outbox/.drive-uploaded
   git add -A; git commit -qm seed; git push -q origin HEAD:main) 
  git clone -q "$WORK/remote.git" "$WORK/a"
  git clone -q "$WORK/remote.git" "$WORK/b"
  for d in a b; do (cd "$WORK/$d"; git config user.email t@t; git config user.name t; git checkout -q main 2>/dev/null || git checkout -q -b main origin/main); done
}

# ── 1. the race this exists for ────────────────────────────────────────────
setup
(cd "$WORK/a"; echo '{"run":"A"}' > outbox/provenance-runtime-probe-latest.json
 git add -A; git commit -qm A; git push -q origin HEAD:main)
out="$(cd "$WORK/b"; echo '{"run":"B"}' > outbox/provenance-runtime-probe-latest.json
      PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: B" 2>&1)"
rc=$?
eq "a losing run still pushes" "$rc" "0"
final="$(cd "$WORK/seed"; git fetch -q origin; git show origin/main:outbox/provenance-runtime-probe-latest.json)"
# THE ASSERTION THAT CATCHES AN OURS/THEIRS INVERSION. During a rebase the
# replayed commit is "theirs"; picking "ours" silently keeps A and looks like a
# clean pass.
eq "the later run's content wins" "$final" '{"run":"B"}'
case "$out" in *"resolved outbox/provenance-runtime-probe-latest.json"*) ok "and it says which file it resolved";; *) bad "and it says which file it resolved";; esac

# ── 2. no race, nothing clever ─────────────────────────────────────────────
setup
out="$(cd "$WORK/b"; echo '{"run":"solo"}' > outbox/provenance-runtime-probe-latest.json
      PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: solo" 2>&1)"
eq "an unconflicted push succeeds first time" "$?" "0"
case "$out" in *"pushed on attempt 1"*) ok "on the first attempt";; *) bad "on the first attempt — $out";; esac

# ── 3. THE APPENDED LEDGER MUST NOT BE AUTO-RESOLVED ───────────────────────
# outbox/.drive-uploaded accumulates Drive deliveries and lives in the same
# directory this step stages wholesale. Picking either side discards a real run's
# work, so the loop must refuse and leave a clean branch behind.
setup
(cd "$WORK/a"; echo 'from-A.md' >> outbox/.drive-uploaded
 git add -A; git commit -qm A; git push -q origin HEAD:main)
out="$(cd "$WORK/b"; echo 'from-B.md' >> outbox/.drive-uploaded
      PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: B" 2>&1)"
rc=$?
eq "a conflict in the appended ledger fails rather than picking a side" "$rc" "1"
case "$out" in *"not a regenerated artifact"*) ok "and names why it refused";; *) bad "and names why it refused — $out";; esac
inrebase="$(cd "$WORK/b"; git rev-parse --git-path rebase-merge)"
if [ -d "$(cd "$WORK/b" && git rev-parse --show-toplevel)/.git/rebase-merge" ] || [ -d "$(cd "$WORK/b" && git rev-parse --show-toplevel)/.git/rebase-apply" ]; then
  bad "and leaves no half-rebased tree behind"
else ok "and leaves no half-rebased tree behind"; fi
branch="$(cd "$WORK/b"; git rev-parse --abbrev-ref HEAD)"
eq "and is back on a branch, not detached" "$branch" "main"

# ── 3b. THE .txt HALF OF THE REGENERATED LIST ──────────────────────────────
# is_regenerated matches outbox/*-latest.txt as well as .json, and until now
# only .json had ever been exercised. An untested branch of a list that decides
# what gets overwritten is the same class of gap as an untested retry loop.
setup
(cd "$WORK/a"; echo 'A' > outbox/seed-coverage-latest.txt
 git add -A; git commit -qm A; git push -q origin HEAD:main)
out="$(cd "$WORK/b"; echo 'B' > outbox/seed-coverage-latest.txt
      PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: B" 2>&1)"
eq "a -latest.txt conflict resolves too" "$?" "0"
final="$(cd "$WORK/seed"; git fetch -q origin; git show origin/main:outbox/seed-coverage-latest.txt)"
eq "and the later run's text wins" "$final" "B"

# ── 3c. ONE REBASE, TWO CONFLICTS, ONE OF THEM THE LEDGER ──────────────────
# The loop walks the conflicted paths in git's order. If the regenerated file
# comes first it is staged BEFORE the ledger is reached, so the abort has to
# undo a partially-staged rebase. Nothing had tested that it does.
setup
(cd "$WORK/a"; echo '{"run":"A"}' > outbox/provenance-runtime-probe-latest.json
 echo 'from-A.md' >> outbox/.drive-uploaded
 git add -A; git commit -qm A; git push -q origin HEAD:main)
out="$(cd "$WORK/b"; echo '{"run":"B"}' > outbox/provenance-runtime-probe-latest.json
      echo 'from-B.md' >> outbox/.drive-uploaded
      PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: B" 2>&1)"
eq "a mixed conflict refuses rather than half-resolving" "$?" "1"
branch="$(cd "$WORK/b"; git rev-parse --abbrev-ref HEAD)"
eq "and unwinds the staged half back to a branch" "$branch" "main"
top="$(cd "$WORK/b" && git rev-parse --show-toplevel)"
if [ -d "$top/.git/rebase-merge" ] || [ -d "$top/.git/rebase-apply" ]; then
  bad "and leaves no half-rebased tree after the partial stage"
else ok "and leaves no half-rebased tree after the partial stage"; fi
ledger="$(cd "$WORK/seed"; git fetch -q origin; git show origin/main:outbox/.drive-uploaded)"
case "$ledger" in *from-A.md*) ok "and the ledger on main still holds the other run's entry";; *) bad "and the ledger on main still holds the other run's entry";; esac

# ── 3d. ATTEMPTS EXHAUSTED ─────────────────────────────────────────────────
# The exit at the bottom of the loop had never run. A remote that rejects every
# push with a race-shaped message drives it: the rebase keeps succeeding and the
# push keeps being refused.
setup
cat > "$WORK/remote.git/hooks/pre-receive" <<'HOOK'
#!/bin/sh
echo "Updates were rejected because the remote contains work that you do not have locally"
exit 1
HOOK
chmod +x "$WORK/remote.git/hooks/pre-receive"
out="$(cd "$WORK/b"; echo '{"run":"B"}' > outbox/provenance-runtime-probe-latest.json
      PROBE_ATTEMPTS=2 PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: B" 2>&1)"
eq "a push refused forever exhausts the attempts and fails" "$?" "1"
case "$out" in *"exhausted 2 attempts"*) ok "and says how many it tried";; *) bad "and says how many it tried — $out";; esac
rm -f "$WORK/remote.git/hooks/pre-receive"

# ── 3e. THE COMMITTING IDENTITY IS THE CALLER'S ────────────────────────────
# Three workflows now share this loop. If it stamped its own name on every
# commit, `git log --author` would stop telling you which one wrote a row.
setup
(cd "$WORK/b"; echo '{"run":"who"}' > outbox/provenance-runtime-probe-latest.json
 PROBE_AUTHOR_NAME="identity-ambiguity-watch" PROBE_AUTHOR_EMAIL="w@x"  PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: who" >/dev/null 2>&1)
author="$(cd "$WORK/b"; git log -1 --format=%an)"
eq "the caller's identity is used when given" "$author" "identity-ambiguity-watch"
setup
(cd "$WORK/b"; echo '{"run":"dflt"}' > outbox/provenance-runtime-probe-latest.json
 PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: dflt" >/dev/null 2>&1)
author="$(cd "$WORK/b"; git log -1 --format=%an)"
eq "and the template's default still applies when not" "$author" "reusable-probe-bot"

# ── 3f. STAGING IS A PARAMETER, AND NARROW STAYS NARROW ────────────────────
# Three callers stage one named file on purpose. If the shared loop widened that
# to outbox/ it would sweep the appended Drive ledger into their commits — the
# one file it refuses to auto-resolve.
setup
(cd "$WORK/b"
 echo 'wanted' > outbox/odds-coverage-census.log
 echo 'unrelated' > outbox/.drive-uploaded
 PROBE_PATHS="outbox/odds-coverage-census.log" PROBE_SLEEP_UNIT=0    bash "$SCRIPT" "chore: narrow" >/dev/null 2>&1)
staged="$(cd "$WORK/b"; git show --name-only --format= HEAD | sort | tr '\n' ' ')"
eq "a narrow PROBE_PATHS stages only that file" "$staged" "outbox/odds-coverage-census.log "

# More than one path, including one outside outbox/ — provenance-census's shape.
setup
(cd "$WORK/b"
 mkdir -p src; echo 'x' > src/route-provenance.js
 echo 'y' > outbox/provenance-census-latest.json
 echo 'z' > outbox/.drive-uploaded
 PROBE_PATHS="outbox/provenance-census-latest.json src/route-provenance.js"    PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: multi" >/dev/null 2>&1)
staged="$(cd "$WORK/b"; git show --name-only --format= HEAD | sort | tr '\n' ' ')"
eq "several paths stage together, including outside outbox/"    "$staged" "outbox/provenance-census-latest.json src/route-provenance.js "

# And the default is unchanged for every caller that passes nothing.
setup
(cd "$WORK/b"; echo 'd' > outbox/whatever.json
 PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: default" >/dev/null 2>&1)
staged="$(cd "$WORK/b"; git show --name-only --format= HEAD | tr '\n' ' ')"
eq "the default still stages outbox/" "$staged" "outbox/whatever.json "

# ── 4. a non-race push failure is loud and immediate ───────────────────────
setup
out="$(cd "$WORK/b"; echo '{"run":"x"}' > outbox/provenance-runtime-probe-latest.json
      PROBE_REMOTE="$WORK/nope.git" PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: x" 2>&1)"
rc=$?
eq "a push failure that is not a race exits non-zero" "$rc" "1"
case "$out" in *"not a race"*) ok "and says so instead of retrying into silence";; *) bad "and says so instead of retrying into silence — $out";; esac

# ── 5. nothing staged is not a failure ─────────────────────────────────────
setup
out="$(cd "$WORK/b"; PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: none" 2>&1)"
eq "no change to commit exits clean" "$?" "0"

# ── 6. A FAILED git add IS NOT "NOTHING TO COMMIT" ─────────────────────────
# Until 2026-11-18 the add was unchecked: any add that failed left an empty index,
# and the script printed "nothing to commit", exited 0 and pushed nothing. Two ways
# it fails (a held index.lock, an explicitly ignored path) and the cases that must
# stay clean (an empty pathspec, one absent path among several, in every position),
# each driven for real. The 74 workflows that reach this script (55 directly, 19
# through _reusable-probe.yml) depend on the empty-pathspec case staying a clean exit.
remote_commits() { git --git-dir="$WORK/remote.git" rev-list --count main; }

setup
before="$(remote_commits)"
out="$(cd "$WORK/b"; echo 'data' > outbox/lockme.log
      touch "$(git rev-parse --git-path index.lock)"
      PROBE_PATHS="outbox/lockme.log" PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: lock" 2>&1)"
rc=$?
eq "a git add that fails (a held index.lock) is a failure, not nothing to commit" "$rc" "1"
case "$out" in *"git add failed for outbox/lockme.log"*) ok "and names the path it could not stage";; *) bad "and names the path it could not stage — $out";; esac
if printf '%s\n' "$out" | grep -qx 'nothing to commit'; then bad "and does not claim there was nothing to commit"; else ok "and does not claim there was nothing to commit"; fi
eq "and nothing was pushed" "$(remote_commits)" "$before"

setup
out="$(cd "$WORK/b"; echo 'data' > outbox/ignored.log; echo 'outbox/ignored.log' > .gitignore
      PROBE_PATHS="outbox/ignored.log" PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: ignored" 2>&1)"
eq "an explicit path git ignores is a failure, not nothing to commit" "$?" "1"
case "$out" in *"git add failed for outbox/ignored.log"*) ok "and names the ignored path";; *) bad "and names the ignored path — $out";; esac

# THE CASE THE FIX MUST NOT BREAK. `git add` exits 128 on a pathspec that matches
# nothing; a step that produced no file is not a failure.
setup
out="$(cd "$WORK/b"; PROBE_PATHS="outbox/nomatch-*.log" PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: empty" 2>&1)"
eq "a pathspec that matches nothing is not a failure" "$?" "0"
case "$out" in *"nothing to commit"*) ok "and says there was nothing to commit";; *) bad "and says there was nothing to commit — $out";; esac

# One path present, one absent. git stages NOTHING when any pathspec fails, so the
# unchecked add stranded the file that did exist and the run stayed green.
setup
out="$(cd "$WORK/b"; echo 'kept' > outbox/present.log
      PROBE_PATHS="outbox/present.log outbox/absent.log" PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: partial" 2>&1)"
eq "one missing pathspec among several is not a failure" "$?" "0"
staged="$(cd "$WORK/b"; git show --name-only --format= HEAD | tr '\n' ' ')"
eq "and does not strand the one that exists" "$staged" "outbox/present.log "
final="$(cd "$WORK/seed"; git fetch -q origin; git show origin/main:outbox/present.log)"
eq "and it reached the remote" "$final" "kept"

# ── 7. A LOCALISED git MUST NOT TURN AN EMPTY PATHSPEC INTO A FAILURE ──────
# The empty-pathspec test reads git's English message. On a runner with another
# locale git would say something else, the test would miss it, and every caller
# whose earlier step wrote no file would fail. The script forces LC_ALL=C for the
# add; this drives that with a git that answers in German unless LC_ALL is C.
setup
mkdir -p "$WORK/shim"
REALGIT="$(command -v git)"
cat > "$WORK/shim/git" <<SHIM
#!/bin/sh
if [ "\$1" = "add" ] && [ "\${LC_ALL:-}" != "C" ]; then
  echo "fatal: Pfadspezifikation 'x' stimmt mit keiner Datei überein" >&2
  exit 128
fi
exec "$REALGIT" "\$@"
SHIM
chmod +x "$WORK/shim/git"
out="$(cd "$WORK/b"; PATH="$WORK/shim:$PATH" LC_ALL=de_DE.UTF-8 PROBE_PATHS="outbox/nomatch-*.log" PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: de" 2>&1)"
eq "a localised git does not turn an empty pathspec into a failure" "$?" "0"

# Same defect, the other positions: the absent path FIRST and in the MIDDLE. A skip
# that stops at the first miss (a `break` where there is a `continue`) passes the
# present-first case above and strands everything after the miss.
setup
out="$(cd "$WORK/b"; echo 'one' > outbox/p1.log; echo 'two' > outbox/p2.log
      PROBE_PATHS="outbox/absent-first.log outbox/p1.log outbox/p2.log" PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: first" 2>&1)"
eq "an absent path FIRST does not strand the ones after it" "$?" "0"
staged="$(cd "$WORK/b"; git show --name-only --format= HEAD | sort | tr '\n' ' ')"
eq "and both present files are committed" "$staged" "outbox/p1.log outbox/p2.log "
setup
out="$(cd "$WORK/b"; echo 'one' > outbox/p1.log; echo 'two' > outbox/p2.log
      PROBE_PATHS="outbox/p1.log outbox/absent-middle.log outbox/p2.log" PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: middle" 2>&1)"
eq "an absent path in the MIDDLE does not strand the one after it" "$?" "0"
staged="$(cd "$WORK/b"; git show --name-only --format= HEAD | sort | tr '\n' ' ')"
eq "and both present files are committed from that call" "$staged" "outbox/p1.log outbox/p2.log "

# git's own words are printed on a SUCCESSFUL add too. An embedded repository makes
# git warn and still exit 0; the old script printed that, and a script that only
# prints stderr on failure would make a skipped directory look like a clean add.
setup
out="$(cd "$WORK/b"; mkdir -p outbox/embedded; git init -q outbox/embedded
      (cd outbox/embedded; git config user.email t@t; git config user.name t; echo x > f; git add f; git commit -qm e)
      PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: embedded" 2>&1)"
case "$out" in *"embedded git repository"*) ok "a successful add's warnings are still printed";; *) bad "a successful add's warnings are still printed — $out";; esac

# A PROBE_PATHS that splits into nothing must not read as "nothing to commit".
setup
out="$(cd "$WORK/b"; echo 'data' > outbox/exists.log
      PROBE_PATHS="  " PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: blank" 2>&1)"
eq "a PROBE_PATHS of only whitespace is a failure, not nothing to commit" "$?" "1"
case "$out" in *"PROBE_PATHS names no path"*) ok "and says why";; *) bad "and says why — $out";; esac

# ── 8. A REFUSED git commit IS NOT "pushed" ────────────────────────────────
# The commit was unchecked: a refusal fell through to a push of the unchanged HEAD
# and the script printed "pushed on attempt 1" with the file never committed.
setup
before="$(remote_commits)"
out="$(cd "$WORK/b"; echo 'data' > outbox/hooked.log
      mkdir -p "$(git rev-parse --git-path hooks)"
      printf '#!/bin/sh\necho "hook refuses"\nexit 1\n' > "$(git rev-parse --git-path hooks)/pre-commit"
      chmod +x "$(git rev-parse --git-path hooks)/pre-commit"
      PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: hooked" 2>&1)"
rc=$?
eq "a git commit that is refused is a failure" "$rc" "1"
case "$out" in *"git commit failed; nothing was pushed"*) ok "and says nothing was pushed";; *) bad "and says nothing was pushed — $out";; esac
case "$out" in *"pushed on attempt"*) bad "and does not claim it pushed";; *) ok "and does not claim it pushed";; esac
eq "and the remote did not move" "$(remote_commits)" "$before"

echo
if [ "$failed" -eq 0 ]; then echo "PASS: $((checked-failed))/$checked assertions — real clones, real conflicts, real pushes"; exit 0
else echo "FAILED: $((checked-failed))/$checked assertions"; exit 1; fi
