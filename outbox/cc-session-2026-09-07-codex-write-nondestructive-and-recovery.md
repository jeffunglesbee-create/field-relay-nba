# CC session — codex_write non-destructive, and the recovery that did not happen

**Date:** 2026-09-08
**Repo:** field-relay-nba
**CC-CMD:** `docs/CC-CMD-2026-09-07-codex-write-nondestructive-and-recovery.md`
**HEAD progression:** `1b625b5` → `518978e` (Task 0) → `f2cf0fd` (Task 1, deployed run 34264096616) → this doc
**Branch:** `main` throughout. `git branch --show-current` confirmed `main` before each push.

## Outcome in one line

The guard landed and is verified live, 10/10 including a negative control.
**The 26 destroyed bodies were not recovered, and Tasks 2–4 were not run** —
their stated precondition was never met.

---

## TASK 0a — is a prior value journaled anywhere reachable?

**Answer: NO. Measured, not read.**

`scripts/codex-overwrite-diagnostics.mjs`, run twice from a GH Actions runner
(sandbox egress cannot reach `*.workers.dev`). Every statement is a SELECT.

```
change_log rows in the 02:00Z–04:00Z window          0
change_log sources in that window                    (empty)
change_log rows referencing codex, AT ANY TIME       0
codex_history                                        no such table (before the guard)
```

Three deliberate query choices, and one of them earned its place:

- **`change_log` was asked for ANY row in the window before it was asked for
  codex rows.** An empty table across the whole window answers the codex
  question without a predicate that could itself be wrong.
- **The codex-referencing query is UNBOUNDED in time.** A journal written under
  a different clock would be invisible to a windowed query, and "no rows in the
  window" would then read as "no journal exists" — a different claim.
- **`codex_history` was probed before Task 1 added it.** If a prior session had
  already added one, that is where the originals would be.

### The source agreed, and the source was not the evidence

`codex_write` (src/index.js ~19888) was a bare `INSERT ... ON CONFLICT DO
UPDATE` with no history write, and `change_log`'s `CREATE TABLE`
(src/sync-reconciler.js:21) declares `game_id TEXT NOT NULL` — a shape that
cannot hold a codex key meaningfully. Both are the SOURCE of what created the
live table, not the live table. The probe ran anyway because the deployed worker
and the live D1 schema are the things being asked about.

### A defect in my own probe, caught by its own output

The first run printed `codex_history does not exist`. It had not established
that. The query came back **HTTP 403 `{"ok":false,"error":"table not
allowed","table":"codex_history"}`** — `/d1/execute`'s `ALLOWED_TABLES` guard
REFUSING the question, which my verdict logic conflated with a negative answer.

Fixed: the verdict now distinguishes *not asked* from *asked and empty*, and
`codex_history` was added to `ALLOWED_TABLES` alongside the guard. The second
run returned the real answer — `no such table: codex_history: SQLITE_ERROR` —
which is a genuine measurement rather than a refusal.

**A note on that second reading.** It ran at 18:41:41Z, minutes after the guard
deployed and before any `codex_write` had occurred. The table is created lazily
by `ensureCodexHistoryTable` on the first write, so "absent" and "empty" are the
same state until someone writes. The scratch test twelve seconds later created
it. Both readings are correct for their moment.

## TASK 0b — the real Time Travel retention window

**Answer: UNMEASURABLE with the credentials this session has. Not "no window",
and not "a window".**

```
# wrangler d1 time-travel info --database field-archive
✘ [ERROR] A request to the Cloudflare API
  (/accounts/…/d1/database/cc49101c-0569-4d41-8e7a-be139cde4f26) failed.

  Authentication error [code: 10000]

📎 It looks like you are authenticating Wrangler via a custom API token set in
an environment variable. Please ensure it has the correct permissions.

👋 You are logged in with an API Token, associated with jeffunglesbee@gmail.com.
🎢 Membership roles: Super Administrator - All Privileges
```

Two measurements bound this, rather than one reading:

1. The same `CLOUDFLARE_API_TOKEN` **succeeded** for `wrangler deploy`, KV
   namespace bootstrap and three cross-repo secret syncs in run 34264096616,
   minutes earlier. The token is valid.
2. The D1 database endpoint returned `10000` for this token.

So the token works and lacks permission for D1 Time Travel specifically. The
account role line is about the *account*, not the *token's* scopes.

`time-travel restore` was **not run**, is forbidden by the CC-CMD, was forbidden
again by the dispatcher, and the workflow that carries `info` states in its
header why `restore` must never be added: Time Travel rewinds the entire
database, 60 deployed routes read or write `d1:ARCHIVE_DB`, several on `*/5` and
`*/15` crons, and rewinding past 03:11Z to recover 26 prose blobs would destroy
hours of live writes across all of them.

---

## TASK 1 — the structural guard. LANDED AND VERIFIED.

Commit `f2cf0fd`, deployed in run 34264096616 (85 gates + 13 verify steps, all
green).

`codex_history (id, key, category, title, content, replaced_at)`, and
`codex_write` copies the existing row into it whenever an update would change
`content`. Signature unchanged, no caller changes. Automatic is the requirement
rather than a convenience: the failure mode is a careless caller, and a caller
who has to opt in to history is exactly the caller who will not.

```sql
INSERT INTO codex_history (key, category, title, content, replaced_at)
SELECT key, category, title, content, datetime('now')
FROM codex WHERE key = ? AND content IS NOT ?
```

Four decisions worth their lines:

**`IS NOT`, not `<>`.** In SQLite `content <> ?` evaluates to NULL when content
is NULL, so that row would not be selected and a NULL prior state would go
unjournalled — the one shape where "no history row" and "nothing was replaced"
become indistinguishable. The same WHERE clause is what makes this a no-op for a
brand-new key and for a rewrite that changes nothing.

**One batch, and the ORDER is what the guard rests on.** `batch()` runs its
statements sequentially, so the history copy is attempted before the upsert. D1
additionally documents `batch()` as a single transaction; the sequential
guarantee alone is enough for the property that matters, so the code does not
depend on the stronger claim.

**Fail-closed, and the tension with Rule 5 is stated rather than glossed.** Rule
5 says an MCP tool must not fail because an archive write failed. This history
write is not incidental archival beside the operation; it IS the operation's
safety property, and the only alternative to refusing is destroying a body with
no copy. Because the history statement runs first, a failure leaves the codex row
exactly as it was — refused, never destroyed — and the caller can retry. Nothing
is lost either way. **If that reading of Rule 5 is wrong, this is the line to
overrule.**

**`_codexHistoryReady` latches only on SUCCESS**, unlike `_codexStatusReady`
beside it. That migration's expected outcome is a thrown "duplicate column", so
latching regardless is right there. Here a failure means the table may not exist,
and latching would mark a missing journal as ready for the rest of the isolate's
life.

### The scratch test output, verbatim

`scripts/codex-history-scratch-test.mjs` drives the real `codex_write` MCP tool
rather than the SQL — a test issuing the two INSERTs directly would be testing
SQL this session wrote, not the code path a careless caller takes.

```
PASS  write 1 (new key) succeeds
PASS  a NEW key writes no history row
PASS  the codex row holds the first body
PASS  write 2 (overwrite) succeeds
PASS  THE FIRST BODY SURVIVES IN codex_history
PASS  the codex row now holds the second body
PASS  the history row is stamped
PASS  write 3 (unchanged body) succeeds
PASS  AN UNCHANGED REWRITE ADDS NO HISTORY ROW
PASS  the scratch key is gone from both tables

10/10 assertions passed
```

**The third write is the teeth (Rule 90).** A guard that journalled on every
write regardless of change would satisfy "the first body survives" and be wrong —
it would grow a history row per no-op rewrite forever. Without the negative
control, "journals on change" and "copies everything, always" are
indistinguishable from outside.

The scratch key is namespaced and timestamped (`scratch/codex-history-selftest/
<iso>`); a fixed key would collide with a concurrent run and with its own
uncleaned remains. Cleanup is verified, not assumed — the final assertion
re-counts both tables.

### Scope: the four codex INSERT sites NOT changed

`src/index.js` has five `INSERT INTO codex` sites. Only one was touched, and the
analysis is recorded rather than left implicit:

| line | category | overwrites content? | why not guarded |
|---|---|---|---|
| 5786 | `watcher-state` | yes | machine-generated dedup JSON, own namespaced key, rewritten every anomaly-watcher cycle by design |
| 5910 | `cc-cmd-draft-queue` | yes | machine-generated draft pointer JSON, `draft/<date>/<slug>` |
| 14708 | `session` | yes | machine-generated session JSON, `session_<date>_<head>` |
| 14738 | `incident` | **NO** — `ON CONFLICT DO NOTHING` | cannot destroy anything |
| **19888** | **`codex_write`, any category** | **yes** | **the one that accepts an arbitrary key and arbitrary caller-supplied prose. It caused the loss.** |

Guarding the three machine-generated writers adds a history row per watcher tick
and per session record — growth without value. Widening beyond `codex_write` is a
second CC-CMD, not a "while I'm here" (Rule 69).

---

## TASKS 2, 3, 4 — NOT RUN. The precondition was never met.

Task 2's own gate: *"ONLY if Task 0a failed **and** 0b confirms a window."*

0a failed. **0b confirms nothing** — it could not read the retention window at
all. The CC-CMD is explicit: *"Do not assume a window exists."* An unmeasurable
window is not a confirmed one, so the side-restore was not started, and Tasks 3
(fold) and 4 (resolve on merits) depend on its output.

### The damage, measured rather than inherited (Rule 72)

The CC-CMD says 25 rows. It is **26**.

```
cc-cmd-queue rows, total            285
touched in the 02:00Z–04:00Z window  28
  of which CREATED in the window      2   ← new rows, not overwrites
OVERWRITTEN                          26
CC-CMD's inherited figure            25
```

The two creations are `cc-cmd-2026-09-07-session-health-queue-coverage`
(03:11:24) and `cc-cmd-2026-09-07-soccer-season-gates-autoroll` (03:11:16),
identified by `created_at` falling inside the window rather than by their names.
Separating creations from updates is what turns "28 touched" into a real count.

Full key list: `outbox/codex-overwrite-diagnostics-2026-09-08T18-41-41-102Z.json`,
`findings.damage.keys_overwritten`.

### Task 4 — `cc-cmd-2026-08-08-desk-sports-followups`

Its original body is **unrecoverable**: no journal (0a), no confirmed Time Travel
window (0b). The CC-CMD's Task 4 begins "once its original body is readable" — it
is not.

The audit note's claim was verified independently rather than inherited. Both
repos, filenames and file contents:

```
field-relay-nba   docs/ outbox/ filenames matching desk.sport   none
field-relay-nba   grep -rl "desk-sports|desk sports"            none
jubilant-bassoon  docs/ outbox/ filenames matching desk.sport   none
jubilant-bassoon  grep -rl "desk-sports|desk sports"            none
```

Current row, verbatim:

```
key         cc-cmd-2026-08-08-desk-sports-followups
title       PENDING -- desk sports followups, NOT VERIFIED
            (no CC-CMD doc, no outbox record in either repo)
status      open
created_at  2026-08-08 22:38:47
updated_at  2026-09-08 03:13:38

STILL UNVERIFIED after the 2026-09-07 audit. Neither repo contains a CC-CMD
doc or an outbox/cc-session record matching "desk-sports".

CORRECTION: this audit initially reported the entry DONE on the reasoning that
"CFL work landed across four CC-CMDs". That was pattern-matching, not evidence
-- the four CFL documents found (cfl-circadian-state-wire, cfl-live-scoreboard-
wire, cfl-live-poll, pickem-cfl-mlb-gaps) are all dated 2026-07-04/05 and
address different scopes than a 2026-08-08 desk-sports follow-up set. A name
adjacency is not a match for the right reason.

Needs someone to locate the original CC-CMD (it may never have been written)
or close the entry as superseded.
```

`created_at 2026-08-08 22:38:47` survived and is the only surviving fact about
the original. The entry cannot be closed with evidence and cannot be converted
into a real CC-CMD, because nothing describing its scope exists anywhere.

**This is the honest outcome the CC-CMD's Task 0 anticipated: the data is gone.**

---

## What would unblock the recovery

One thing, and it is the user's to give: **a `CLOUDFLARE_API_TOKEN` with D1
read permission**, so `wrangler d1 time-travel info field-archive` can state the
real earliest bookmark. If that bookmark reaches back past 2026-09-08T03:11:00Z,
Task 2 becomes runnable exactly as written — export at a pre-03:11Z bookmark
into a **scratch** database, never in place, `SELECT key, content FROM codex
WHERE category='cc-cmd-queue'`, drop the scratch database.

If it does not reach back, the answer is already the one above and no procedure
changes it.

Scope reminder from the CC-CMD itself, for whoever picks this up: recover
`cc-cmd-2026-08-08-desk-sports-followups` and stop if the export proves
expensive. The other 25 are reconstructible from `docs/` and `outbox/`.

## Residual

- **26 bodies destroyed, 25 of them reconstructible** from `docs/CC-CMD-*.md` and
  `outbox/cc-session-*.md`, which the 2026-09-07 audit verified present. Their
  codex body was a pointer, not the source of truth.
- **1 body destroyed with no other copy anywhere** —
  `cc-cmd-2026-08-08-desk-sports-followups`. Not recovered. Not recoverable
  without the token above.
- **No carry-forward is being created for Tasks 2–4.** They are not deferred
  work; their precondition is unmet and the CC-CMD names stopping as a valid
  outcome. If the token arrives, they run under this same document.

## Artifacts

```
outbox/codex-overwrite-diagnostics-2026-09-08T18-31-59-595Z.json   0a, first run
outbox/codex-overwrite-diagnostics-2026-09-08T18-41-41-102Z.json   0a, corrected
outbox/codex-overwrite-0a.log                                      0a console
outbox/codex-overwrite-0b-timetravel.txt                           0b, verbatim
outbox/codex-history-scratch-test-2026-09-08T18-41-53-671Z.json    Task 1
outbox/codex-history-scratch-test.log                              Task 1 console
```

Workflow runs: 34263581991 (Task 0), 34264096616 (deploy of `f2cf0fd`),
34264545410 (Task 0 re-run + scratch test, same workflow file).

Run 34264545410 checked out `b711751`, a `[skip ci]` probe commit that landed
after the guard; `git merge-base --is-ancestor f2cf0fd b711751` confirms the
checkout contained it. The deploy finished 18:38:40Z and that run started
18:41:34Z, so the scratch test exercised a worker that already carried the
guard rather than one that happened to share a branch name.

### One correction inside this document

The run id on the line above was written as `34264241932` in the first draft.
That number was invented — no such run exists. It was replaced with the id read
back from the Actions API. Recorded rather than silently fixed, because a
fabricated identifier in a manifest is indistinguishable from a real one to
every later reader, and this document's whole subject is a record that could not
be checked against anything.

## Confidence

**96.** The guard is deployed and proven live in both directions, including the
control that separates "journals on change" from "copies always". The 0a finding
is measured twice and agrees with the source. The 0b finding is a refusal by the
Cloudflare API, bounded by the same token succeeding at `wrangler deploy`
minutes earlier — so "the token lacks D1 permission" is measured, not inferred
from a single failure.

The 4 points withheld: `batch()`'s transactional rollback is Cloudflare's
documented behaviour and was not independently exercised here (the code does not
depend on it — sequential ordering carries the guarantee — but the comment cites
it), and the fail-closed reading of Rule 5 is a judgement stated for overrule
rather than a measurement.
