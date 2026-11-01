#!/usr/bin/env bash
# From a SANDBOX that cannot reach *.workers.dev: read relay routes through a runner and print what came back.
#   scripts/relay-look.sh "/budget/odds?date=2026-11-01" "/health"
# Five routes can be read (scripts/relay-read.mjs ALLOWED); anything else is refused, and the run goes red. docs/relay-from-the-sandbox.md says which and why.
# Needs: gh (authenticated for the relay repo), git, node, and to be run inside a git checkout (the relay's, so `origin` is right). About a minute.
# It dispatches .github/workflows/relay-read.yml over the REST API (the GraphQL default-branch lookup `gh workflow run` uses is refused in sandboxes), finds ITS run by
# title, waits, then FETCHES the artifact the run committed and prints it. It never touches the working tree or the current branch: no pull, no rebase.
# A transient gh failure in a polling loop is retried; if the helper has to give up it says which label and run to look at.
set -uo pipefail
[ "$#" -ge 1 ] || { echo "usage: $0 <route> [<route> ...]" >&2; exit 2; }
REPO="${RELAY_REPO:-jeffunglesbee-create/field-relay-nba}"
WF="repos/$REPO/actions/workflows/relay-read.yml"
LABEL="look$(date -u +%H%M%S)$$"
ROUTES="$*"
ERR=$(mktemp); TMP=$(mktemp); trap 'rm -f "$ERR" "$TMP"' EXIT
T0=$(date -u +%FT%TZ)
# RELAY_LOOK_NAP overrides every wait, so scripts/check-relay-look.mjs can drive the whole helper in a second.
nap() { sleep "${RELAY_LOOK_NAP:-$1}"; }

# A workflow file pushed a moment ago can answer 422 "does not have workflow_dispatch trigger" for a while (recorded in July); retry.
ok=0
for i in 1 2 3; do
  if gh api -X POST "$WF/dispatches" -f ref=main -f "inputs[routes]=$ROUTES" -f "inputs[label]=$LABEL" >/dev/null 2>"$ERR"; then ok=1; break; fi
  echo "dispatch attempt $i of 3 failed: $(head -c 300 "$ERR")" >&2
  [ "$i" -lt 3 ] && nap 10
done
[ "$ok" = 1 ] || { echo "could not dispatch relay-read.yml" >&2; exit 1; }
echo "dispatched label $LABEL; waiting for the run ..." >&2

# Find the run by its title (the workflow's run-name is 'relay-read <label>'). If the title never matches, fall back to the first dispatch created after T0.
RUN=""
for n in $(seq 1 30); do
  nap 4
  RUN=$(gh api "$WF/runs?event=workflow_dispatch&per_page=20" --jq "[.workflow_runs[] | select(.display_title == \"relay-read $LABEL\")] | first | .id // empty" 2>/dev/null) || RUN=""
  if [ -z "$RUN" ] && [ "$n" -ge 15 ]; then
    RUN=$(gh api "$WF/runs?event=workflow_dispatch&per_page=20" --jq "[.workflow_runs[] | select(.created_at >= \"$T0\")] | sort_by(.created_at) | first | .id // empty" 2>/dev/null) || RUN=""
  fi
  [ -n "$RUN" ] && break
done
[ -n "$RUN" ] || { echo "no run appeared for label $LABEL: https://github.com/$REPO/actions/workflows/relay-read.yml" >&2; exit 1; }
URL="https://github.com/$REPO/actions/runs/$RUN"

# Up to six minutes: ten routes at twenty seconds each is the job's worst case. A gh failure here leaves the last good reading in place and tries again.
ST=""
for _ in $(seq 1 72); do
  J=$(gh api "repos/$REPO/actions/runs/$RUN" --jq '.status + "/" + (.conclusion // "")' 2>/dev/null) && ST="$J"
  case "$ST" in completed/*) break ;; esac
  nap 5
done
echo "run $RUN: ${ST:-unreadable}  $URL" >&2
case "$ST" in completed/*) ;; *) echo "the run is still going (or gh could not read it). It commits its artifact when it finishes; label $LABEL, $URL" >&2; exit 1 ;; esac

# The artifact is on main before the run completes. FETCH it; do not pull, so a dirty tree or unpushed commits are none of this script's business.
git rev-parse --git-dir >/dev/null 2>&1 || { echo "not inside a git checkout: run this from a clone of $REPO" >&2; exit 1; }
SRC=origin
git remote get-url origin 2>/dev/null | grep -q "${REPO##*/}" || SRC="https://github.com/$REPO.git"
git fetch -q "$SRC" main 2>"$ERR" || { echo "git fetch $SRC main failed: $(head -c 300 "$ERR")" >&2; exit 1; }
FILE=$(git ls-tree --name-only FETCH_HEAD outbox/ 2>/dev/null | grep "^outbox/relay-read-$LABEL-" | head -1 || true)
[ -n "$FILE" ] || { echo "run $RUN ended ${ST} and committed no artifact for $LABEL. If the policy self-test went red the run stops before reading anything: $URL" >&2; exit 1; }
git show "FETCH_HEAD:$FILE" > "$TMP"
node -e '
const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
console.log(`${process.argv[2]}  (${o.summary.read_ok} read, ${o.summary.refused} refused, ${o.summary.failed} failed, of ${o.summary.requested} requested)`);
for (const e of o.entries) {
  if (e.refused) { console.log(`\nREFUSED ${e.route}\n  ${e.why}`); continue; }
  console.log(`\n${e.route}  ->  ${e.status === null ? "ERROR " + e.error : "HTTP " + e.status + ", " + e.bytes + " bytes, " + e.ms + " ms" + (e.truncated ? " (truncated)" : "")}`);
  const t = typeof e.body === "string" ? e.body : JSON.stringify(e.body);
  console.log(t === undefined ? "" : t.slice(0, 2000) + (t.length > 2000 ? " ..." : ""));
}' "$TMP" "$FILE"
echo "(whole file: git show FETCH_HEAD:$FILE   |   or after a pull: $FILE)" >&2
case "$ST" in completed/success) ;; *) echo "(the run was not green: $ST)" >&2; exit 1 ;; esac
