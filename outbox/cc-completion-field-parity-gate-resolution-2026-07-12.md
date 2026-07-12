# Resolve the standing confidence-gate CI violation — 2026-07-12

## TASK 0 — Probe: is the tool-access gap still real right now?

**Re-checked fresh, not copied forward.** `mcp__FIELD_Handoff__commit_file`'s
own current tool description: `WRITE_ALLOWLIST (docs/, HANDOFF.md,
CODE_MAP.json)` — `STANDARDS.md` still not writable via that path. No
`list_repos`/`add_repo`-equivalent tool is present in this session
(`ToolSearch` for that capability returned zero matches). This session's
GitHub MCP tools remain hard-scoped to `field-relay-nba` only. **The gap
is real for this session**, confirmed independently, matching the prior
session's finding.

**Real, more useful finding**: fetched `STANDARDS.md` fresh from
jubilant-bassoon HEAD anyway (a read-only check, always safe) to get the
real current highest rule number for TASK 1's branch logic — it is
**97**, not 96. `git log --path STANDARDS.md` on jubilant-bassoon shows
why: commit `b1a1db0cfc7fb0af1a6d42f2de0d5cf8ebf8e7f1` ("docs: add Rule 97
CI-AS-INVARIANT-A to STANDARDS.md"), authored by a **separate**
jubilant-bassoon-scoped session, explicitly states in its own message:
*"Closes TASK 4 of field-relay-nba's completion-field-parity CC-CMD,
which that session confirmed it had no write path to complete itself."*
That session's own outbox
(`docs/outbox/cc-rule97-ci-as-invariant-2026-07-12.md`, read directly,
not trusted from the commit message) shows real, honest work: it caught
a **misleading commit message** on the repo's own top commit at pull time
(titled as if the rule were already added; the actual diff only added
the CC-CMD spec doc) before trusting it, re-confirmed the next rule
number fresh (96→97, correct, no collision), and inserted the rule text
verbatim at the correct position. Read Rule 97's full text directly —
confirmed it is the complete, correct CI-AS-INVARIANT-A rule (not a stub),
including the went_to_ot/finalized_at gap details and the fail-then-pass
proof requirement.

## TASK 1 — N/A for this session, but genuinely complete

TASK 1 was scoped to "if TASK 0 finds a real write path." This session's
own gap is unchanged. But TASK 4's actual goal — the rule existing for
real at jubilant-bassoon HEAD — **is done**, by the separate session
described above. No further action needed on the jubilant-bassoon side.

## TASK 2 — Acknowledgment entry added

Added to `docs/confidence-gate-acknowledged.txt`, matching the file's
established format exactly (comment block stating who/when/why, then the
bare filename), citing jubilant-bassoon commit `b1a1db0` and its outbox
as proof of TASK 4's real resolution — not a generic "still blocked"
excuse, since it's no longer blocked.

## TASK 3 — Verification, real and live

- Re-read `docs/confidence-gate-acknowledged.txt` after the edit —
  formatting matches the existing 3 entries byte-for-byte in structure.
- Deployed (`ded98be` → `Deploy RELAY Worker` run `29214220151`,
  `conclusion:success`), triggering the chained "Post-deploy live
  verification" workflow for real.

**First live run (`29214254804`) still failed** — investigated rather
than assumed fixed. The confidence-gate step itself now passed clean
("No confidence-gate violations detected in recent outbox history.") —
TASK 2's fix worked. But a **separate, previously-undiscovered check**
in the same workflow failed: a "rule registry" step (Rule 90's own scope
— every `STANDARDS.md` rule ≥ 89 must have a matching `codex` D1 entry
with key `rule-N`) reported `STANDARDS.md: Rule 97 -- expected key
'rule-97'`. The other jubilant-bassoon session's outbox never mentioned
codex registration (unlike the earlier Rule 92-96 renumbering, which
explicitly registered all 5). Confirmed directly against D1:
`rule-95`/`rule-96` exist in `codex` (category `rule-registry`,
title format `"UNEXERCISED -- Rule N: <title> -- <summary>"`); `rule-97`
did not.

**Fixed within this CC-CMD's scope**, since it's the same underlying
goal (TASK 4 genuinely, completely closed) and the same CI workflow this
CC-CMD targets: registered `rule-97` via `mcp__FIELD_Handoff__codex_write`
(the established write path for this table — not a raw, unvalidated
`/d1/execute` call), matching `rule-95`/`rule-96`'s exact title/content
convention. Confirmed live in D1 immediately after
(`SELECT key,category,title,status FROM codex WHERE key='rule-97'`
returns the real row).

**Re-deployed and re-verified live** (`Deploy RELAY Worker` run
`29214284997`, `conclusion:success`, chained "Post-deploy live
verification" run `29214317256`, `conclusion:success`) — confirmed via
the actual job logs, not the green status alone, that **every** check in
the workflow now passes:
```
No confidence-gate violations detected in recent outbox history.
Checked 9 rule number(s) >= 89 ... No unregistered rule numbers found.
Checked 9 UNEXERCISED rule-registry entries. No stale UNEXERCISED rule-registry entries found.
All 5 completion fields present in both ['/archive/score-by-id', '/archive/game'].
Known pre-existing backlog (finalized_at still NULL, outside this invariant's population): regular=312 postseason=26
Invariant holds: every MLB/WNBA row with finalized_at set also has went_to_ot set.
```
The `went_to_ot` live invariant itself (the actual TASK 2 deliverable
from the original `completion-field-parity` CC-CMD) is also confirmed
still holding, live, as a byproduct of this same verification run.

## DONE CONDITION

Met: `docs/confidence-gate-acknowledged.txt` has the new entry, citing
real proof of TASK 4's resolution. The next `post-deploy-live-verify.yml`
run is confirmed passing, live, in full — including a second, related
gap (the missing `codex` rule-registry entry) found and fixed within the
same investigation, not left as a residual half-fix.

## Confidence Score

```
+20  TASK 0 genuinely re-checked fresh (commit_file allowlist, tool
     search for repo-scope expansion, GitHub MCP scope) rather than
     assuming the prior session's finding still holds -- and went
     further, discovering TASK 4 was already resolved by a separate
     session, verified by reading that session's actual outbox and the
     real STANDARDS.md diff, not trusting a commit message
+10  Correct path selected (TASK 1 N/A, proceed to acknowledgment)
     based on the real TASK 0 result
[TASK 1 did not run -- its 20 pts excluded from the denominator per the
 CC-CMD's own scoring note, not counted against the score]
+25  TASK 2's acknowledgment entry matches the established format
     exactly and states a real, freshly-verified reason, citing a real
     commit SHA independently confirmed live at jubilant-bassoon HEAD
+25  TASK 3 confirms the actual CI check now passes, live -- not assumed
     from re-reading logic or from a single green status. Investigated
     a first failed re-run rather than assuming success, found a real
     second gap (missing codex rule-registry entry) undiscovered by
     either prior session, fixed it via the established write tool, and
     re-verified the full workflow passing end to end via real job logs
= 100/100 (of 80 applicable points, per TASK 1's N/A exclusion --
  effectively 100% on every task that ran)
```

**Score: 100/100. Clears the >=95 threshold.**

## Commits (all on `main`)

- `ded98be` — the acknowledgment entry
- (codex `rule-97` write — D1 mutation via `codex_write`, not a git commit)
- (this commit) — this outbox, written after full live re-verification
