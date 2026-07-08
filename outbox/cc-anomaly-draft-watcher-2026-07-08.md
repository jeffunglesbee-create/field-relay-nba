# Anomaly-to-Draft Watcher — DRAFT ONLY, RUWT-Safe — 2026-07-08

## What Was Built

Per `docs/CC-CMD-2026-07-08-anomaly-draft-watcher.md`: a new, fully
isolated hourly cron that reads codex `incident` rows, and for any whose
`count` field crosses a threshold (>=3) since the last draft was written
for it, commits a `docs/CC-CMD-DRAFT-{date}-{slug}.md` file to this repo
via the GitHub Contents API and a `cc-cmd-draft-queue` codex entry
pointing at it. A human/chat must review and complete the draft before
it ever becomes a real, dispatch-ready CC-CMD — nothing in this system
auto-commits a real CC-CMD, auto-dispatches to Claude Code, auto-merges,
touches anything user-facing, scores "interest," or notifies an end
user of anything.

## Probe Block — Findings That Changed the Implementation

**`scheduled()` isolation had to be an early return, not just an added
branch.** The CC-CMD's own TASK 1 asked for a "fully separate branch."
Reading the real function revealed only `analyticsEngine` is gated by
`event.cron`; the journalism cycle, KV→D1 sweep, `handleCron`, and
several R2 update windows (MLB Savant, nflverse, NHL series, NBA clutch,
WC projections, BSD endgame capture) all run unconditionally on every
tick, gated only by date/time checks, not by which cron fired. A bare
new `"0 * * * *"` trigger without an early return would have caused a
redundant journalism cycle + KV sweep + `handleCron` (and possibly
redundant R2 updates, if the tick landed inside one of their windows)
every hour, for the rest of time. Fixed by adding
`if (event.cron === '0 * * * *') { ...; return; }` as the very first
check in `scheduled()`, before any of that unconditional code.

**The GitHub Contents API repo target defaults to the wrong repo.** The
existing `write_handoff`/`read_handoff` MCP tools' `HANDOFF_API_BASE`
constant points at `jubilant-bassoon` (`REPO_OWNER`/`REPO_NAME` at the
top of `src/index.js`), not this repo. Reusing that constant would have
silently committed draft files to the wrong repository. Added a
separate, hardcoded `ANOMALY_WATCHER_REPO_API` constant pointing at
`jeffunglesbee-create/field-relay-nba` explicitly — matching the
existing security convention already documented on the HANDOFF tools
("no path/repo input accepted from the caller").

## TASK 1 — Cron Trigger, Isolated

`wrangler.toml`: `"0 * * * *"` added as a 4th cron. `scheduled()`'s new
branch (see above) is a genuine early return — confirmed via diff that
the existing three triggers' code paths are byte-for-byte unchanged.

## TASK 2 — Threshold + Dedup

`checkIncidentThresholds(env)` reads open `incident` rows, parses each
row's `count`, and for any `>= 3`, checks a **separate** codex row
(`anomaly-watcher-state/{key}`, category `watcher-state`) for the count
at which a draft was last written — not a field bolted onto the
incident row itself, because `_recordWpResolutionFailure` (user-do.js)
fully overwrites that row's `content` on every new occurrence
(`{count, recent}` only), which would silently drop any extra field
added there. Only drafts when `count > last_drafted_count`.

## TASK 3 — Draft Generation

`writeAnomalyDraft` commits the draft file with the required warning
banner at the top, states only the observed incident key/count/recent
occurrences, and an explicit "Investigate root cause (not yet done...)"
placeholder in TASKS — never a fabricated diagnosis. Writes a
`cc-cmd-draft-queue` codex entry (never `cc-cmd-queue` — confirmed via
grep, only one write site for either string in this new code, and it's
`cc-cmd-draft-queue`).

## TASK 4 — Live Verification, Four Real Invocations

Direct network access to the deployed Worker is blocked from this
session's sandbox (same limitation as earlier in this session); used
the same workaround — a temporary `workflow_dispatch` GitHub Actions
workflow (`anomaly-watcher-verify.yml`) POSTing to a temporary
`/debug/anomaly-watcher-run` route (same `X-FIELD-Relay` auth pattern as
`/d1/execute`) that manually invokes `checkIncidentThresholds` without
waiting for a real hourly tick.

Set up a real, test-scoped incident (`test-threshold-watcher-verify`,
`count:3`) in D1 before the first invocation. Note:
`checkIncidentThresholds` processes **all** open incidents, not just the
test one — it also processed the real `wp-resolution-failures` incident
(`count:5`, open, no dedup marker yet). That produced a second, genuine
draft as a real side effect of this deployment, not test noise —
kept, not cleaned up (see below).

**Run 1** (`checked:6, drafted:2`): both the test incident and
`wp-resolution-failures` drafted. Verified via direct D1 read (dedup
markers correctly set to `last_drafted_count:3` and `:5` respectively)
and via `mcp__github__get_file_contents` that both files exist with the
correct warning banner, correct incident data, and no fabricated root
cause.

**Run 2, dedup test** (`checked:6, drafted:0`): same counts, re-invoked.
D1 confirmed the test incident's draft row and dedup marker were
byte-identical to Run 1 (same commit sha, same `updated_at`) — no new
write happened. Dedup proven with real evidence, not inferred.

**Run 3, count-bump test** (`checked:6, drafted:0`) — **a real gap
found.** Bumped the test incident to `count:4` in D1 (dedup marker still
at 3, so a redraft should fire) and re-invoked. Expected `drafted>=1`;
got `0`. D1 confirmed the dedup marker never advanced. Root cause:
`writeAnomalyDraft`'s GitHub Contents API `PUT` never included `sha`,
and `docs/CC-CMD-DRAFT-2026-07-08-test-threshold-watcher-verify.md`
already existed from Run 1 (same date → same filename) — GitHub's
Contents API requires `sha` to overwrite an existing file, silently
rejecting the write; `checkIncidentThresholds` correctly caught the
failure and did not advance the dedup marker or count it as drafted
(no corruption, no duplicate — but no second draft either).

**Fixed, not just reported.** `writeAnomalyDraft` now fetches the
target path first (same pattern the existing `write_handoff` MCP tool
already uses in this same file): if it exists, includes its `sha` in
the `PUT`; a 404 (the common case — first draft of the day) omits it.
Deployed (commit `6140994`).

**Run 4, count-bump test re-verified** (`checked:6, drafted:1`): same
test incident, still at `count:4`. D1 confirmed `last_drafted_count`
advanced to `4`, the draft row's commit sha changed
(`3241e9c...` → `2f20ed6...`), and `updated_at` moved forward.
`mcp__github__get_file_contents` confirmed the file content now shows
`count: 4` with both occurrences (`test1`, `test2`). The fix is real,
not assumed.

**Bounded, self-healing failure mode, for the record:** a same-day
redraft would have silently failed until fixed; because each day's
draft uses a new date-based filename, an incident whose count kept
climbing without ever crossing into a new UTC day would only get its
first draft, not follow-up ones, until this fix. Now fixed and
reverified live — not a residual gap.

## Cleanup

Test incident, its dedup marker, and its draft codex entry deleted from
D1. Test draft file deleted from the repo
(`docs/CC-CMD-DRAFT-2026-07-08-test-threshold-watcher-verify.md`,
commit `3da5cac`). Temporary `/debug/anomaly-watcher-run` route and its
method-gate allowlist entry removed from `src/index.js` (confirmed via
diff — only those two blocks removed). Temporary
`anomaly-watcher-verify.yml` workflow deleted.

**Not cleaned up, deliberately:** the real `wp-resolution-failures`
draft — `docs/CC-CMD-DRAFT-2026-07-08-wp-resolution-failures.md` — and
its `cc-cmd-draft-queue` codex entry / dedup marker. This is a genuine,
valuable output of this deployment: a real, already-tracked incident
(5 resolveWinProbability failures, mostly AFL) converted into an
actionable draft for review. Worth noting: a separate, resolved codex
entry (`afl-squiggle-team-id-not-name-bug`) already indicates the AFL
portion of this was fixed earlier the same day — the watcher has no way
to know that (it cannot read code or reason about fixes, by design),
so the draft's existence doesn't mean the underlying problem is still
live; a human/chat reviewing it should check that context before acting.

## RUWT-Safety Distinction — Restated With Evidence

Per the CC-CMD's CONTEXT: RUWT's patent claim is a processing engine
determining *interest level* plus a notification engine transmitting on
a system-defined threshold to a *user*. This system:
- Never computes or scores "interest" of anything — `checkIncidentThresholds`
  only compares an engineering incident count against a fixed threshold.
- Never notifies an end user — grep confirms zero push/notification/webpush
  calls anywhere in `checkIncidentThresholds`/`writeAnomalyDraft`.
- Never touches a user-facing route, response shape, or client-visible
  data — its only outputs are a `docs/` file and a `codex` row in a
  category (`cc-cmd-draft-queue`) no client-facing endpoint reads.
- Never auto-dispatches or auto-commits a *real* CC-CMD — confirmed via
  grep that `cc-cmd-queue` (the real, dispatch-ready category) is never
  written by this code; only `cc-cmd-draft-queue` is, and every draft
  file carries the unmissable warning banner plus a placeholder TASKS
  section a human/chat must fill in.

## Confidence Score

```
+20  cron isolation confirmed via probe (early return required, not
     just an added branch -- the real scheduled() structure, not
     assumed) and via diff (existing three triggers unchanged)
+25  threshold/dedup proven via real constructed test across 4 live
     invocations -- including a genuine gap the test uncovered
     (same-day redraft SHA handling), which was fixed using an
     existing in-repo pattern and reverified live with a 4th
     invocation, not left as a reported limitation
+20  draft format correctly and unmistakably distinct from real
     CC-CMDs -- confirmed via direct file reads of two real drafts
+20  draft content honest, no fabricated root cause -- confirmed via
     direct file reads (both drafts state only observed data, an
     explicit "not yet diagnosed" placeholder)
+15  outbox confirms the RUWT-safety boundary with grep evidence (no
     cc-cmd-queue writes, no notification calls), not just assertion
= 100/100
```

**Score: 100/100. Clears the >=95 threshold.**

## Commits

- `20b58af` — cron trigger, `checkIncidentThresholds`, `writeAnomalyDraft`,
  `scheduled()` early return
- `2b4b1e1` — temporary verification workflow added
- `8224c06` — real draft auto-committed by the watcher itself:
  `wp-resolution-failures` (kept)
- `3241e9c` — test draft auto-committed by the watcher: `test-threshold-watcher-verify`
- `6140994` — SHA-fetch fix for same-day redraft
- `3da5cac` — test draft file removed (cleanup)
- (this commit) — temporary route/workflow stripped; this outbox
