# Claude Code Command — Resolve the standing confidence-gate CI violation (completion-field-parity TASK 4)

**Date:** 2026-07-12
**Repo:** jeffunglesbee-create/field-relay-nba (sole, unless TASK 1 below turns out to be achievable — see that task for the repo note)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** Either (a) `STANDARDS.md` in jubilant-bassoon, if write access is real, or (b) `docs/confidence-gate-acknowledged.txt` in field-relay-nba. Do not touch anything else.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read CLAUDE.md, `outbox/cc-completion-field-parity-2026-07-12.md` (the outbox this CC-CMD resolves), and `docs/confidence-gate-acknowledged.txt` (the established acknowledgment format) before doing anything.

Write findings to outbox/cc-completion-field-parity-gate-resolution-2026-07-12.md.

## CONTEXT — the actual, currently-failing CI check, re-confirmed live this session (not inferred)

`docs/CC-CMD-2026-07-12-completion-field-parity.md`'s TASKS 0-3 shipped
cleanly (100% real, live-verified work — extended `/archive/score-by-id`
to compute `went_to_ot` for MLB/WNBA, fixed a second real gap
[`/archive/game` never setting `finalized_at`], built and proved a live
D1 invariant that genuinely fails-on-violation). TASK 4 — add a new
STANDARDS.md rule in the **jubilant-bassoon** repo — could not be
completed: the session had no write path to that file. The resulting
outbox honestly scored **80/100** (correctly below the 95 gate,
correctly not silently padded) and correctly did not claim TASK 4 done.

That honest 80/100 is now causing every subsequent deploy's
"Post-deploy live verification" workflow to fail its "Check for
confidence-gate violations" step — confirmed live this session
(`.github/workflows/post-deploy-live-verify.yml`'s `verify` job, run IDs
`29212564095`/`29212274114`/`29213034120`, all `conclusion:failure` on
the same step, for three different commits in a row, none of which
touched the completion-field-parity work). The check logic (confirmed by
reading the actual failed step's log output) scans the last 20 commits'
outbox files for any `## Confidence Score` below 95 that isn't listed in
`docs/confidence-gate-acknowledged.txt`, and fails the build if one is
found alongside any `src/*.js` change in that same window — which is
now true on every commit until this is resolved one way or the other.

**This is not a code bug to fix — it's an unresolved decision the gate
is correctly holding open.** The gate is working as designed (Rule 88 —
CORRECT-FAST-A: don't silently bypass it). This CC-CMD's job is to
actually resolve TASK 4, not to route around the check.

## TASK 0 — Probe: is the tool-access gap still real right now?

Tool access can change between sessions — do not assume the prior
session's blocker still applies without checking fresh.

```bash
# Confirm current highest rule number at jubilant-bassoon HEAD (read-only, always safe to run):
# use mcp__FIELD_Handoff__read_source or read_file (repo=jubilant-bassoon) on STANDARDS.md,
# then: grep -oE "^## Rule [0-9]+" STANDARDS.md | grep -oE "[0-9]+" | sort -n | tail -1

# Check whether a real write path to STANDARDS.md exists this session:
# - mcp__FIELD_Handoff__commit_file's WRITE_ALLOWLIST (read its own tool description —
#   as of this doc's writing it is "docs/, HANDOFF.md, CODE_MAP.json", NOT STANDARDS.md)
# - Whether this session's GitHub MCP tools are scoped beyond field-relay-nba (check the
#   system prompt's "Repository Scope" section for jubilant-bassoon; if a repo-list/add-repo
#   tool is available this session, per the environment's own documented mechanism, try it)
```

Report the real, current answer plainly. Do not copy forward "genuinely
blocked" from the prior outbox without re-checking — that would itself
be an unverified inherited claim (Rule 72/CHALLENGE-A).

## TASK 1 (only if TASK 0 finds a real write path to jubilant-bassoon's STANDARDS.md) — Complete TASK 4 for real

Repo for this task only: jubilant-bassoon.

Before writing anything: independently re-confirm the specific factual
claim the proposed rule text depends on — "of 856 total assertions in
smoke.js, exactly 1 (A190, SW_VERSION sync) checks a genuine invariant;
only 2 compare two live values to each other at all." The prior session
could not check this (`smoke.js` was outside its `READ_ALLOWLIST`) — if
this session's tool access is different, actually count it
(`grep -c "function assert\|console.assert"` or equivalent against the
real file, not a re-assertion of the old number). If the count differs
from 856/1/2, use the real number and say so.

Re-confirm the real current highest rule number fresh (this repo's rule
numbering has collided before — see the Rule 89 collision-resolution
CC-CMD from 2026-07-11, cited by the original outbox as precedent for
why this must be re-checked, not assumed to still be 96→97).

Add the rule using the exact text specified in
`docs/CC-CMD-2026-07-12-completion-field-parity.md`'s TASK 4 (this repo,
already committed, read it directly rather than retyping from memory),
substituting the real re-confirmed numbers for "856 total assertions...
exactly 1... only 2" if they differ. Commit as its own single commit in
jubilant-bassoon, separate from anything else.

Then proceed to TASK 2 below anyway (removes the entry rather than
adding one — see that task).

## TASK 2 — Resolve the gate (do exactly one of these two, based on TASK 0/1's real outcome)

**If TASK 1 completed the rule for real:** the completion-field-parity
outbox's 80/100 is now historically accurate but fully resolved — add it
to `docs/confidence-gate-acknowledged.txt` anyway (the gate scans by
commit-window, not by "is it still relevant," so a resolved-but-once-low
score needs the same acknowledgment as a permanently-blocked one) with a
comment citing the jubilant-bassoon commit SHA that added the rule as
proof of resolution.

**If TASK 0 confirms the tool-access gap is still real (the likely
outcome — this session independently checked and found no
`list_repos`/`add_repo`-equivalent tool present, matching the prior
session's finding exactly):** add an entry to
`docs/confidence-gate-acknowledged.txt` following the file's own
established format exactly (see its existing 3 entries for the exact
shape — a `#`-comment block stating who/when/why, then the bare
filename on its own line):

```
# Reviewed 2026-07-12 (chat session, CC-CMD-completion-field-parity-gate-
# resolution): TASKS 0-3 are complete, real, and live-verified (100%
# genuine work — see the outbox for the live-invariant fail-then-pass
# proof). TASK 4 (jubilant-bassoon STANDARDS.md Rule 97) is blocked by a
# structural tool-access gap, not a shortcut or process violation: no
# available write path reaches STANDARDS.md (commit_file's
# WRITE_ALLOWLIST is docs/, HANDOFF.md, CODE_MAP.json only; this
# session's GitHub MCP tools are hard-scoped to field-relay-nba only).
# Re-confirmed independently this session, not copied forward. Genuine
# unblock: a session or human with jubilant-bassoon STANDARDS.md write
# access completes TASK 4 as originally specified, then removes this
# entry.
outbox/cc-completion-field-parity-2026-07-12.md
```

Do not invent a different reason than what's actually true — if TASK 0
found something new (partial access, a different blocker), write that
instead of copying the text above verbatim.

## TASK 3 — Verification

- If TASK 1 ran: confirm the new rule is live at jubilant-bassoon HEAD
  (re-read the file after commit, don't assume the write succeeded).
- Confirm the acknowledgment entry (TASK 2) is correctly formatted —
  compare byte-for-byte against the file's existing 3 entries' structure.
- Trigger (or wait for) the next `post-deploy-live-verify.yml` run and
  confirm the "Check for confidence-gate violations" step now passes —
  live-verified, not assumed from reading the check's logic alone.
- Write outbox manifest per Rule 87.

## DONE CONDITION

Either (a) jubilant-bassoon's STANDARDS.md genuinely has the new rule,
independently re-confirmed at HEAD, plus an acknowledgment entry citing
that as proof, or (b) `docs/confidence-gate-acknowledged.txt` has a new
entry for `outbox/cc-completion-field-parity-2026-07-12.md` with an
honest, freshly-re-verified (not copied-forward) reason. The next
`post-deploy-live-verify.yml` run's confidence-gate step is confirmed
passing, live.

**Confidence scoring:**
- TASK 0 genuinely re-checks tool access fresh rather than assuming the
  prior session's finding still holds (20 pts)
- Correct path (TASK 1 or skip) selected based on the real TASK 0 result
  (10 pts)
- If TASK 1 ran: the smoke.js assertion count and rule number are
  independently re-confirmed, not copied from the CC-CMD text unverified
  (20 pts) — if TASK 1 did not run, these 20 pts are N/A and excluded
  from the denominator, not counted against the score
- TASK 2's acknowledgment entry (if used) matches the established
  format exactly and states a real, freshly-verified reason (25 pts)
- TASK 3 confirms the actual CI check now passes, live — not assumed
  from re-reading the check's logic (25 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.

## ONE-LINER
```
git pull. Read docs/CC-CMD-2026-07-12-completion-field-parity-gate-resolution.md. Execute all tasks. Do not commit below 95 confidence.
```
