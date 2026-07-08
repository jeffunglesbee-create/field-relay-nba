# CC-CMD: Anomaly-to-draft watcher — DRAFT ONLY, never dispatches, never touches user-facing content

**Date:** 2026-07-08
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## CONTEXT — READ THE SAFETY BOUNDARY BEFORE WRITING ANY CODE

FIELD currently has zero closed-loop autonomy: incidents get tracked
(codex `incident` category already has real counters, e.g.
`wp-resolution-failures` reaching 5 today with no automated response),
but nothing ever converts "this keeps happening" into a proposed fix
without a human or chat session investigating by hand.

**This CC-CMD stays deliberately, explicitly on the safe side of the
RUWT line.** RUWT's actual patent claim (per STANDARDS.md / the patent
defense record) is a processing engine determining *interest level* and
a notification engine transmitting on a *system-defined threshold* —
i.e., autonomous judgment about what's interesting to a *user*, surfaced
to that user. What this CC-CMD builds is categorically different:
DevOps triage automation over *engineering* incident counts, producing
a *draft document a human must review*, never touching anything
user-facing, never scoring "interest," never notifying an end user of
anything. State this distinction explicitly in the outbox — it is the
entire reason this is being built at all.

**Hard constraints, non-negotiable:**
1. Output is a DRAFT CC-CMD file only — never auto-committed, never
   auto-dispatched to Claude Code, never auto-merged. A human/chat
   reviews and decides whether to actually push it as a real CC-CMD.
2. Draft files live in a visibly distinct location from real CC-CMDs —
   `docs/CC-CMD-DRAFT-{date}-{slug}.md`, never `docs/CC-CMD-{date}-*.md`
   (the real, dispatch-ready naming) — so nothing downstream could ever
   mistake a draft for something already reviewed and approved.
3. Draft codex entries go in a new, separate category
   (`cc-cmd-draft-queue`), never `cc-cmd-queue` (which represents
   human/chat-reviewed, dispatch-ready work) — no conflation.
4. v1 scope is exactly one trigger source: codex `incident` entries
   whose content contains a numeric count (the existing
   `wp-resolution-failures` shape: `{"count": N, ...}`) crossing a
   small, explicit threshold. Do not build a generic "watch anything"
   framework — that's speculative generalization for a system that
   doesn't exist yet in even one working instance.
5. The watcher cannot diagnose root cause — it has no ability to read
   code, trace logic, or reason about what's actually wrong the way a
   chat session does. The draft it produces must say exactly that: "N
   occurrences observed, root cause not yet investigated" — never
   fabricate a plausible-sounding fix. A wrong guess dressed as a draft
   is worse than an honest "needs investigation" flag.

## PROBE BLOCK

```bash
git log --oneline -5

grep -n "async scheduled" -A15 src/index.js
# Confirm exactly how the existing scheduled() handler routes between
# its 3 current cron triggers (*/5, */15, 0 9) via event.cron matching,
# before adding a 4th trigger — do not assume the dispatch pattern,
# read it.

grep -n "\\[triggers\\]" -A3 wrangler.toml
# Confirm the exact current crons array before editing it.

grep -n "category.*incident\|incident.*category" src/index.js
# Find how codex incident entries are actually read/queried from D1 --
# reuse the existing read pattern, don't invent a new one.

curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/mcp" ... 
# (adjust to whatever the actual codex read mechanism is once found via
# the grep above -- confirm the real shape of a stored incident row,
# e.g. wp-resolution-failures, by reading it live, not from memory of
# what this doc describes it as)
```

## TASK 1 — Add a new, isolated cron trigger

Add a 4th cron to `wrangler.toml`'s `[triggers]` array — hourly
(`"0 * * * *"`), not tied to the existing `*/5`/`*/15`/`0 9` triggers,
so this new, unproven concern never risks interfering with journalism
generation or the analytics pipeline. Wire it into `scheduled()`'s
existing `event.cron` dispatch (per the probe's findings) as a fully
separate branch — do not merge its logic into an existing branch.

## TASK 2 — Threshold-crossing detection with dedup

New function, e.g. `checkIncidentThresholds(env)`:
- Reads codex `incident` rows (via the probe-confirmed real read
  pattern).
- For each, attempts to parse a `count` field from its JSON content.
- Threshold: `count >= 3` (matches the size of real incidents observed
  this session before they got attention — not arbitrary).
- **Dedup, critical:** track the count *at which a draft was last
  written* for each incident key (e.g., a small KV entry or a field on
  the incident row itself — probe-confirm which is cleaner given what
  already exists). Only draft again if the count has increased *since*
  the last draft, not on every hourly tick once the threshold is
  crossed once. Without this, the system spams identical drafts hourly
  forever — a real failure mode to design out from the start, not patch
  later.

## TASK 3 — Draft generation

When a genuine new threshold-crossing is found, write
`docs/CC-CMD-DRAFT-{date}-{incident-slug}.md` using the same structural
template every real CC-CMD this session has used (CONTEXT, PROBE BLOCK,
TASKS, DONE CONDITIONS, CONFIDENCE SCORING, ONE-LINER) — but:
- CONTEXT section states only the observed fact (incident key, count,
  timestamps of occurrences) — no invented root-cause narrative.
- TASKS section is explicitly a placeholder: "Investigate root cause
  (not yet done — this draft was machine-generated from an incident
  count, not a real diagnosis). A human or chat session must complete
  this section before this draft is dispatch-ready."
- Top of the file, unmissable: `**⚠️ AUTO-GENERATED DRAFT — NOT
  REVIEWED, NOT DISPATCH-READY. A human/chat must investigate and
  complete this before it becomes a real CC-CMD.**`

Write the codex entry (`cc-cmd-draft-queue` category) pointing at the
draft file.

## TASK 4 — Live verification, not just "the cron exists"

Since this can't wait for a real incident to hit threshold naturally
without knowing how long that takes, construct a real, temporary test
incident (mirroring the CFL cache-guard / confidence-gate audit
precedent's methodology: build real conditions, observe real behavior,
clean up after) — write a genuine codex incident entry with `count: 3`
under a clearly-test-scoped key (e.g. `test-threshold-watcher-verify`),
manually invoke the new scheduled logic path (however the probe
confirms is possible — `workflow_dispatch` equivalent, or a temporary
debug route, matching whichever workaround this session's precedents
already used for sandbox network limitations), confirm a real draft
file and codex entry get created, confirm a second invocation at the
same count does NOT create a duplicate draft (dedup working), confirm
a third invocation after bumping the count to 4 DOES create a new
draft. Clean up the test incident and any test draft files afterward.

## DONE CONDITIONS

- [x] New cron trigger isolated from existing three, confirmed via
      `wrangler.toml` diff and `scheduled()` dispatch logic
- [x] Threshold + dedup logic correct, verified via real constructed
      test scenario (not just code review)
- [x] Draft file format unmistakably distinct from real CC-CMDs (naming,
      codex category, and in-file warning banner)
- [x] Draft content is honest about not having diagnosed root cause —
      no fabricated fix
- [x] Outbox explicitly restates the RUWT-safety distinction and confirms
      no auto-dispatch/commit/notification path exists anywhere in this
      code

## CONFIDENCE SCORING

- +20 — cron trigger correctly isolated, dispatch logic confirmed via probe
- +25 — threshold/dedup logic correct, proven via real constructed test
  (not just read-through)
- +20 — draft format correctly and unmistakably distinct from real CC-CMDs
- +20 — draft content honestly flags "not yet diagnosed," no fabricated
  root cause
- +15 — outbox explicitly confirms the safety boundary (no auto-dispatch,
  no user-facing touch, no notification path) with evidence, not just
  assertion

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-08-anomaly-draft-watcher.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
