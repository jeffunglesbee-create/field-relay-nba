# Claude Code Command — the queue every session reads first is adjudicated by hand, and the hand stopped a month ago

**Date:** 2026-10-11
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** A then B — **Task 1 is a measurement and writes nothing to the codex**
**Status:** FILED, not started.

**Rule F:** comparing two records this project already owns. Commodity.
**Rule A:** pull only. No cron in this document — the schedule is Task 5 and it
is deliberately last.
**Rule 99 (DISTINGUISHABILITY-A)** is the whole design, and
`cc-cmd-2026-09-11-rule99-distinguishability` already calls that rule "the class
every other open item instantiates." This is one more instance of it, sitting in
the tool every session reads before anything else.

## The finding, and it is one field

`session_health` reports `cc_cmd_queue` from the D1 `codex` table, category
`cc-cmd-queue`. Read directly:

```
key:        cc-cmd-2026-10-03-empty-catch-gate
title:      PENDING -- gate empty catches in relay (auditor exists, no
            workflow runs it; 61 bare in src/, baseline not zero)
created_at: 2026-10-03 17:46:14
updated_at: 2026-10-03 17:46:14      ← identical
```

That row has never been touched since it was written. Meanwhile the
2026-10-11b close-out records `docs/CC-CMD-2026-10-03-empty-catch-gate.md` as
**DONE**, with `check-empty-catches.mjs` (35 self-tests) and
`mutate-empty-catches.mjs` (9 of 9 caught) wired into **both** `guards.yml` and
`deploy.yml`, both proven green. So the queue's claim that "no workflow runs it"
is false, and its disposition is a month out of date.

Its *numbers* are roughly sound — 61 bare in `src/` on 10-03 against 60 on
10-11, ~118 bare repo-wide against 112 measured. **The disposition is the lie,
not the measurement.** That distinction matters: this document is about state,
and the row's authored body is genuinely valuable (it records four wrong counts
for one quantity, three of them the author's own). Nothing here should destroy
it.

## TWO THINGS A FIRST READING GETS WRONG

**There is no generator and no parser.** Nothing has ever read a document header
to set a disposition. Do not go looking for a broken parse step; there is no
code to debug.

**But the queue IS maintained — in batch sweeps, by hand, and the last one was
2026-09-10.** The `updated_at` values cluster, which is the signature:

| cluster | rows (of the newest 60) | evidence |
|---|---|---|
| `2026-08-02 04:07–04:08` | 5 | — |
| `2026-09-08 03:11–03:13` | ~27 | — |
| `2026-09-10 00:30:25–26` | ~8 | titles literally read "(adjudicated 2026-09-10)" |

Rows created *after* the last sweep have never been adjudicated at all, and
`cc-cmd-2026-10-03-empty-catch-gate` is one of them. So the mechanism is not
missing, it is **unscheduled and unenforced** — 31 days since it last ran. That
is a different problem from a missing write, and it has a different fix.

## WHY A HEADER-DERIVED CHECK WOULD HAVE BEEN WRONG ON ITS FIRST RUN

The obvious design is "derive the disposition from the document's `Status:`
header." **Measured before writing it: that header is not a universal
convention.** `docs/CC-CMD-2026-09-11-epl-identity-resolve.md` carries
`**Date:**`, `**Repo:**`, `**Branch:**`, `**Type:**` and `**Run BEFORE**` — and
**no `Status:` field of any kind.** Newer documents do carry one
(`**Status:** DONE 2026-10-11`, `**Status:** FILED, not started`). The
convention arrived partway through.

A check that read a missing header as "open" would re-open finished work; as
"closed" it would bury live work. Both are worse than the stale row.

And the disposition vocabulary is **six words, not two** — PENDING, OPEN, DONE,
BLOCKED, SUPERSEDED, WITHDRAWN all appear in titles in the newest 60. A matcher
built for DONE/OPEN mishandles five SUPERSEDED rows and one WITHDRAWN.

## Tasks

**Task 1 — MEASURE THE RATE. Writes nothing.** One artifact,
`outbox/queue-docs-reconcile-<ts>.json`. We currently have **a sample of size
one**: the empty-catch contradiction was found by accident, by reading the
HANDOFF and `session_health` in the same session. Nobody knows whether it is one
of one or one of twenty, and no other task on this list answers that.

For every `cc-cmd-queue` row, join to `docs/CC-CMD-*.md` in **both**
field-relay-nba and jubilant-bassoon and report, with denominators:

- rows whose `updated_at` equals `created_at` (never adjudicated)
- rows whose `updated_at` predates the last commit touching their document
- rows whose title disposition **contradicts** their document's `Status:` header
- rows whose document carries **no `Status:` header** — count this separately,
  it is the 09-11-era population and it is not a defect in the row
- rows with **no document in either repo** — at least 7 of the 26 open ones,
  and `cc-cmd-2026-08-08-desk-sports-followups` says so in its own title

**State the denominator for the row set itself.** `session_health` reports
`total: 295`; a `codex_list` capped at 60 returned exactly 60, so it was
truncated. Page the whole category or say how many were read. Rule 91 — print
the coverage where the result is read.

**Task 2 — FOUR STATES, and none of them is a guess (Rule 99).**

| state | meaning |
|---|---|
| `closed` | document has a `Status:` header stating DONE / CLOSED / SUPERSEDED / WITHDRAWN |
| `open` | document has a `Status:` header stating OPEN / FILED / PENDING / BLOCKED |
| `header-absent` | document exists, carries no `Status:` header — **unreadable, not open and not closed** |
| `no-document` | nothing in either repo under that key — **its own state, never "open"** |

The queue today collapses `open`, `header-absent` and `no-document` into one
count. That is the absence-collapse the rule forbids, and it is why items sit at
760–2,200 hours "stale" when some of them cannot be verified either way.

Handle all six disposition words. An unrecognised word is a **fifth** outcome
(`disposition-unparsed`), reported, never defaulted.

**Task 3 — THE CHECK IS REPORT-ONLY, AND THAT IS NOT TIMIDITY.**
`codex_write` is still destructive — `cc-cmd-2026-09-07-codex-write-nondestructive-and-recovery`
exists because it overwrote **25 queue bodies** and has been PENDING for 806
hours. A reconciler that auto-corrected titles would rewrite rows whose authored
bodies are the most useful thing in them.

**Do not write to the codex in this document.** Emit the diff. Fixing
`codex_write` first is the prerequisite for any write-back, and it is a separate
CC-CMD that already exists.

**Task 4 — wire it into `guards.yml`, failing on contradiction only.** A
contradiction (Task 1, bullet 3) is a defect and must go red. `header-absent`
and `no-document` are **counts, not failures** — a check that went red on 7
document-less rows from August would be red from the moment it shipped, and
`check-exposed-secrets.mjs`'s own header already records why that is fatal: *"a
red check nobody can make green is a check that gets deleted."* Ratchet the two
non-failing counts the way that file ratchets: declare the current number, fail
when it RISES.

Mutate it (Rule 90): plant a row whose title says DONE against a document whose
header says FILED, and assert the check goes red. An assertion that has never
failed on purpose is not trusted here.

**Task 5 — the schedule, last and smallest.** The sweep's real defect is that it
is unscheduled; 31 days passed and nothing said so. Give the reconciler a daily
read-only run so the *age of the last adjudication* is itself a reported number.
No write, no cron that mutates anything.

## What this does NOT do, deliberately

- It does not add `Status:` headers to the 09-11-era documents. That is additive
  and cheap and it is **not** a prerequisite: the check reports the count, and
  backfilling headers is follow-up work with its own judgement calls.
- It does not touch `READ_ALLOWLIST`. Restoring visibility into `STATUS.md` and
  `outbox/drift-log.md` is worth doing and blocks nothing on this list; bundling
  it here would pad an urgent change with a convenience. When it is done, add
  **those two paths by name** — not the `outbox/` prefix, which is shared across
  all four repos and would expose a hundred-plus relay session docs and fill logs.
- It does not correct the one row we know is wrong. Task 3 says why.

## Stop conditions

- **Task 1 writes nothing to the codex.** If a task tempts a write-back, STOP.
- If the `Status:` header turns out to be missing from a *majority* of
  documents, STOP and report the rate before building Task 2's classifier — the
  header would not be a usable signal yet and the design needs re-deciding.
- Do not read a missing header as either open or closed. Ever.
- Do not fail the gate on `no-document` or `header-absent` on its first run.
- Do not reconcile by editing document headers to match the queue. The document
  lives in the commit that did the work; the queue row does not. **The document
  is authoritative.**

## Done conditions

1. An artifact reports all five populations with denominators, and states how
   many of the ~295 rows were read.
2. Four states are distinguishable in the output, plus `disposition-unparsed`,
   and no missing header is resolved to open or closed.
3. All six disposition words are handled.
4. Nothing was written to the `codex` table.
5. A check runs in `guards.yml`, red on contradiction, ratcheted on the two
   count-only populations, and mutation-proven in the red direction.
6. The age of the last adjudication sweep is a reported number.
