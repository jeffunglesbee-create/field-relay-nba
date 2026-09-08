# Claude Code Command — Make `codex_write` non-destructive, then recover 25 overwritten queue bodies

**Date:** 2026-09-07
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (bug fix) + one-time data recovery
**Severity:** Data loss already occurred. The guard must land before further codex writes.

## CONTEXT — what happened

On 2026-09-08 between approximately 03:11Z and 03:14Z, a chat session made 25
`codex_write` calls against existing `cc-cmd-queue` keys to flip stale PENDING
entries to DONE. `codex_write` **replaces** `content` on an existing key; it does
not append or version. All 25 original entry bodies were destroyed and replaced
with verification notes.

Confirmed by reading two rows afterward: `cc-cmd-2026-08-08-desk-sports-followups`
and `cc-cmd-2026-08-02-warm-mlb-standings-streak-bonuses` both contain only the
2026-09-07 audit note. `created_at` was preserved; `content` was not.

**Loss is unevenly distributed and that drives the scope below.** 24 of the 25
describe work that also has a durable record in `docs/CC-CMD-*.md` and
`outbox/cc-session-*.md`, both verified present during the same audit. Their
codex body was a pointer, not the source of truth.

`cc-cmd-2026-08-08-desk-sports-followups` is the exception and the reason this
CC-CMD exists. It has **no CC-CMD doc and no outbox record in either repo**. Its
codex body was the only description of that work anywhere, and it was overwritten
with a note stating no description could be found.

## WHY THE OBVIOUS FIX IS WRONG

Do **not** run `wrangler d1 time-travel restore` against `field-archive`.
Time Travel rewinds the entire database — not a table, not a row. 60 deployed
routes read or write `d1:ARCHIVE_DB` (`/analytics/*`, `/archive/*`, `/briefs/*`,
`/changelog/*`, `/context/*`, odds and drama backfill, journalism), several on
`*/5` and `*/15` crons. Rewinding to a pre-03:00Z bookmark would destroy hours of
live writes across all of them to recover 25 prose blobs. Net negative.

## TASK 0 — Free diagnostics. Both may make the rest of this unnecessary.

**0a. Does `codex_write` journal to `change_log`?**
`field-archive` has a `change_log` table and a deployed `/changelog/` route.
Read the `codex_write` handler in `src/index.js` and determine whether it writes
a prior-value record. Then query `change_log` for rows touching the `codex` table
between 2026-09-08 02:00Z and 04:00Z.
If the originals are journaled there, they are already in live data — recover
them with an ordinary SELECT and skip Tasks 2 and 3 entirely.

**0b. Does Time Travel retention actually cover this?**
`wrangler d1 time-travel info --database field-archive`. Retention is 30 days on
paid plans and shorter on free. Record the real earliest available bookmark.
Do not assume a window exists. If the window does not reach back past 03:11Z,
say so plainly and stop — the data is gone and that is the honest outcome.

## TASK 1 — Structural guard (land this BEFORE any recovery writes)

Make overwrite non-destructive so this class cannot recur.

Add a `codex_history` table (`key`, `category`, `title`, `content`,
`replaced_at`) and have the `codex_write` handler INSERT the existing row into it
whenever an update would change `content`. Preserve the current `codex_write`
signature — no caller changes, no new required parameter. The guard must be
automatic, because the failure mode is a careless caller, and a caller who has to
opt in is exactly the caller who won't.

Verify by writing twice to a scratch key and confirming the first body survives in
`codex_history`. Delete the scratch key afterward.

## TASK 2 — Side-restore, ONLY if Task 0a failed and 0b confirms a window

Export at a bookmark before 2026-09-08T03:11:00Z and import into a **scratch**
D1 database. Never restore in place. Then:
`SELECT key, content FROM codex WHERE category='cc-cmd-queue'`
Drop the scratch database when done.

**Scope the recovery by value, not by count.** If the side-restore proves
expensive or the export is partial, recover
`cc-cmd-2026-08-08-desk-sports-followups` and stop. The other 24 are
reconstructible from `docs/` and `outbox/` and are not worth an extended
procedure against a production database.

## TASK 3 — Fold, do not replace

For each recovered row, write back with the **original text first**, then a
`--- 2026-09-07 audit ---` separator, then the verification note that is
currently there. Do not discard the audit notes; they contain real verified
evidence (route-manifest confirmations, outbox paths, commit SHAs).

## TASK 4 — Resolve `desk-sports-followups` on its merits

Once its original body is readable, determine whether the entry describes work
that shipped, work never commanded, or work superseded. Close it with evidence or
convert it into a real CC-CMD. This entry is the whole point of the exercise.

## DONE CONDITION (verifiable probe output)

- `codex_history` exists; two-write scratch test output pasted showing the first
  body preserved.
- Either: `change_log` query output showing recovered originals, **or** a stated
  finding that no journal exists and Time Travel `info` output showing the real
  retention window.
- `codex_read` on `cc-cmd-2026-08-08-desk-sports-followups` pasted verbatim,
  showing original text above the audit note — or an explicit statement that it
  is unrecoverable and why.

## TASK 5 — Outbox manifest (last task)

Write `outbox/cc-session-2026-09-07-codex-write-nondestructive-and-recovery.md`
with the Task 0a/0b findings, the commit SHA, the scratch-test output, exactly
which keys were recovered, and which (if any) were not and why.
