# CC-CMD: Automated confidence-gate violation detection

**Date:** 2026-07-07
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

**Source:** a real confidence-gate violation happened this session
(`CC-CMD-2026-07-06-drama-score-cost-measurement.md` — wait, correct
date: `CC-CMD-2026-07-07-drama-score-cost-measurement.md` — committed
and deployed at 85/100, below its own required 95 threshold). It was
caught by chat manually cross-referencing `git log` against the
reported score after the fact. That's the same category of gap that
`stale_pending_cc_cmds` (session_health) already exists to close for
"forgot to update Codex" — this is the sibling automation for "shipped
below the confidence gate."

**Honest scope, stated up front:** this cannot *prevent* a violation —
CC decides whether to commit before this check ever runs. What it can
do is make a violation immediately, automatically visible (a failed CI
run) instead of requiring a manual git-log audit to discover it — the
same shift `stale_pending_cc_cmds` made for staleness, applied to this
different failure mode.

## PROBE BLOCK
```bash
cat .github/workflows/post-deploy-live-verify.yml
```
Confirm this still matches — the check gets added as a new step in
this existing, already-triggered-per-deploy workflow, not a new
separate workflow.

## TASK — Add a confidence-gate check step

After the existing "Live-check endpoints" step, add a new step:

```yaml
      - name: Check for confidence-gate violations
        run: |
          # Find outbox files modified in the last 20 commits (a pragmatic
          # window covering "this same work session" without needing exact
          # correlation to this specific deploy, since outbox commits often
          # land a few minutes after the code commit that triggered deploy).
          RECENT_OUTBOX=$(git log -20 --name-only --pretty=format: -- 'outbox/cc-*.md' | grep -v '^$' | sort -u)
          VIOLATION_FOUND=0
          for f in $RECENT_OUTBOX; do
            [ -f "$f" ] || continue
            SCORE=$(grep -oE '(Score:|=)\s*[0-9]+/100' "$f" | grep -oE '[0-9]+' | head -1)
            [ -z "$SCORE" ] && continue
            if [ "$SCORE" -lt 95 ]; then
              # Real violation only if src/ was actually touched in the
              # same recent window -- a sub-95 outbox with no code change
              # (i.e. it correctly stopped) is not a violation.
              SRC_TOUCHED=$(git log -20 --name-only --pretty=format: -- 'src/*.js' | grep -v '^$' | wc -l)
              if [ "$SRC_TOUCHED" -gt 0 ]; then
                echo "CONFIDENCE-GATE VIOLATION: $f reports $SCORE/100 (below 95) alongside real src/ changes in recent history."
                VIOLATION_FOUND=1
              fi
            fi
          done
          if [ "$VIOLATION_FOUND" -eq 1 ]; then
            echo "See output above for details." >> "$GITHUB_STEP_SUMMARY"
            exit 1
          fi
          echo "No confidence-gate violations detected in recent outbox history."
```

This intentionally checks a rolling recent window rather than trying to
precisely correlate one outbox to one deploy — the actual observed
timing pattern this session shows outbox commits landing anywhere from
seconds to several minutes after the triggering code commit, so exact
correlation would be fragile. A pragmatic recent-window check is more
robust than a precise one that misses timing edge cases.

## VERIFICATION

- Confirm the regex correctly extracts `97` from lines like `**Score:
  97/100**` and `= 97/100` (both real formats seen in actual outbox
  files this session) — test against the two real, existing outbox
  files from this session that used each format.
- Confirm it does NOT false-positive on the case that already happened
  correctly this session (the first synthetic-benchmark attempt, 81/100,
  which correctly did not commit any src/ change) — verify against
  that real outbox as a negative test case.
- Confirm it DOES flag the real violation case (the 85/100
  drama-score-cost-measurement outbox alongside its real `04611bc`
  src/ commit) — verify against that real pair as a positive test case,
  even though it's already resolved; this proves the check would have
  caught it.

## DONE CONDITIONS
- [ ] Probe block confirms citation before editing
- [ ] Step added to the existing post-deploy-live-verify.yml, not a new workflow
- [ ] Regex tested against both real score-format variants seen this session
- [ ] Verified against a real negative case (81/100, no src/ change) — does not false-positive
- [ ] Verified against a real positive case (85/100, real src/ change) — does flag it
- [ ] Outbox written, explicitly stating this is detection-only, matching stale_pending_cc_cmds' honesty about its own scope

## CONFIDENCE SCORING TABLE
+30  Step correctly added to existing workflow
+25  Regex verified against both real score formats
+25  Verified against both a real positive and real negative case, not just described
+20  Outbox honestly scopes this as detection-only

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-07-confidence-gate-detection.md. Add
a confidence-gate violation check as a new step in the existing post-
deploy-live-verify.yml workflow -- scans recent outbox files for a
sub-95 score alongside real src/ changes in recent history, fails the
CI run loudly if found. Verify the regex against both real score-format
variants used this session, and test against both a real positive case
(the 85/100 violation) and a real negative case (the 81/100 correct
stop) to confirm it discriminates correctly. Do not commit unless
confidence >= 95. If score < 95, report verbatim and stop.
