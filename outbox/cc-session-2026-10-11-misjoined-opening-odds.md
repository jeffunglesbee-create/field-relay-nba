# CC session — the journalism cron wrote settled prices into `opening_odds`

**Date:** 2026-10-11
**Repo:** field-relay-nba, branch `main` — direct commits, no PR
**CC-CMD:** `docs/CC-CMD-2026-08-25-misjoined-opening-odds.md`

## Step 1 — the in-window denominator, which was the open question

The document had 156 of 789 across 90 days and asked for the rate *inside* the
window: *"if it is nearly all of them, the capture path was wrong for that whole
period rather than intermittently."*

Run `38145700814`, 19 dates, all served 200:

```
archive rows in the window          315
captured within 60s of finalized_at 180   (57.1%)
census-eligible rows                179
of those, at finalisation           155   (86.6%)
```

**86.6% of the eligible corpus — the path was wrong for essentially the whole
period.** And 155 lands on the document's own 156, reached a different way from
a different endpoint, which is the cross-check that makes either number worth
quoting.

### The five "empty" dates are settled, and one of them is a real finding

The document says it is not established whether 06-25, 06-26, 06-29, 06-30 and
07-01 were clean or simply absent from the census corpus.

| date | rows | census-eligible | flagged |
|---|---:|---:|---:|
| 2026-06-25 | 11 | **0** | 0 |
| 2026-06-26 | 10 | **0** | 0 |
| 2026-06-29 | 4 | **0** | 0 |
| 2026-06-30 | 20 | **0** | 0 |
| **2026-07-01** | 17 | **13** | **0** |

Four were absent from the corpus. **07-01 is genuinely clean** — 13 eligible
rows, none flagged. So the block really was discontinuous, and exactly one of
the five dates says so.

## Step 2 — the writer, named from source and corroborated by the blob

**`snapshotCronOdds`**, called from `handleJournalismCycle` at `src/index.js`,
**after** the archive catch-up finalises games in the same tick. It selected on
`opening_odds IS NULL` with no finality condition, so a game that had just
ended got its `opening_odds` filled with whatever the vendor was serving at
that moment — a settled price.

**It still runs**, every 15 minutes, and nothing in the chain checked finality.
So this was live, not historical, and step 3 applied.

The discriminating detail is the stamp. Two functions fill this column on the
same `IS NULL` condition:

| | stamp | why |
|---|---|---|
| `snapshotCronOdds` | `extractOddsForGame(og)` — **run clock** | one argument, so the capture time is "now" |
| `runOddsBackfillForDate` | `extractOddsForGame(og, book, snapshotAt)` | stamps the historical snapshot's own time |

Only the first can land `captured_at` 1.9 seconds after `finalized_at`, which
is what the document's decisive row shows.

### The document's signal 3 is refuted

It says these rows carry no `_oddsProof` — *"Every current row carries
`{adapterId: odds-api}`. These do not."*

```
flagged rows                180
of those, WITH _oddsProof   149
of those, WITHOUT            31
distinct proof shapes         1   {"adapterId":"odds-api","sourceId":"odds-api-the-odds-api"}
```

**149 of 180 carry it.** The document sampled three rows from 06-28 and
generalised. The marker landed 2026-09-20, after the window, so its presence
means those rows were touched later — and it names the writer from the blob
rather than only from source, which is a stronger result than the document
expected to be available.

## Steps 3 and 4 — one condition, three selections, one function

`AND finalized_at IS NULL` on the cron's row query **and** on both
sport-discovery queries. Guarding the discovery queries too means a sport whose
only pending rows are already finished no longer triggers a paid vendor fetch
(Rule 78).

**Not on `runOddsBackfillForDate`.** Backfilling a past date is *supposed* to
touch finalised rows — it writes a historical snapshot and stamps that
snapshot's time. A guard that could not tell the two apart would break the
backfill to fix the cron.

`scripts/check-opening-odds-not-at-finalisation.mjs` asserts that difference
rather than assuming it, and **counts** the selections rather than matching one:
the cron has three, and a check passing on any single one would have missed the
two that trigger the fetch. Each is removable on its own and each removal is
caught. Blocking in `deploy.yml` and `guards.yml`.

The 156 existing rows are **not** corrected. The scope boundary is explicit:
there is no source of true opening lines for games played months ago, and
nulling them needs the human.

## Two defects of my own, both caught by this repo's own gates

**1. A comment counted as a call site, and the deploy went red.** The commit
that added the fix also added a comment explaining *which* caller omits the
third argument — writing the words `extractOddsForGame(og)` in prose.
`check-captured-at-explicit.mjs` scanned raw source line by line, counted the
sentence as a fourth call site omitting `capturedAt`, and deploy
`38145913886` failed at *"A closing line's captured_at is a snapshot time, not
the clock"*.

A comment about the pattern is not the pattern. Two sibling checks in this repo
already carry self-tests for that exact shape — `check-doc-citations` refuses a
path that quotes itself, `check-empty-catches` refuses a comment mentioning
`.catch(()=>{})` — so the fix is theirs: blank comments before the scan, track
quotes so a `//` inside a string is not a comment, keep the line mapping so
reported numbers still match the file. Three new assertions, run every time
rather than behind a flag, that would have caught it. **11/11, 3 call sites, 5
of 5 mutations still caught.**

**2. My own probe laundered an unknown into a number.**
`check-aggregate-launders-unknowns` refused `(r[k] || 0)` inside a reduce: a
per-date record missing the key and one that genuinely counted zero would both
contribute 0, and the total could not tell them apart. Routed through
`lib/summary-invariants.mjs` `total()`, which reports `skipped`; a nonzero
skipped count now fails loudly instead of printing a sum nobody can read.

**The real miss was mine.** I ran five gates before pushing, not all of them,
and both defects were in the set I skipped. All 89 `check-*` scripts now run
clean locally, bar four that need network or an argument.

**And the fix commit did not re-trigger the deploy** — it touched only
`scripts/`, while the `src/index.js` change sat in the commit whose deploy had
failed. Dispatched manually. A gate repair that cannot redeploy the code it
unblocks is the same trigger-versus-inputs gap `guards.yml`'s own header is
about.

## Done condition

| | |
|---|---|
| a named writer | `snapshotCronOdds`, with the stamp difference that proves it |
| the in-window denominator | 180/315 all rows, **155/179 census-eligible** |
| census count does not grow | baseline recorded below; re-check after a cron cycle |

`favourite-band-census` over 120 days, run `38145971449`:
**`opening odds captured at finalisation 120 of 140`**. That is the
retrospective baseline. History cannot shrink, so the test is growth.

Deploy `38146540922` — **deploy and verify both `success`, 122 of 122 gate
steps, 0 failed.** The fix is live.

Two readings of today's date after it, one cron cycle apart (`38146824024`,
`38146944806`):

```
rows                 46        46
atFinalisation        0         0
census-eligible       1         1
of those, flagged     0         0
states    not-finalised 11, no-opening-odds 34, before-finalisation 1   (both)
```

**Zero flagged, and the one row carrying both odds and a `finalized_at` was
captured BEFORE it** — which is what `opening_odds` is supposed to mean.

**What those two readings do NOT show.** They are byte-identical, state
distribution included, so **no game finalised between them**. The cycle did not
exercise a finalisation transition, and a fix that has not been crossed is not
a fix that has been tested in production. What is tested: the condition is in
the deployed source, and a gate that counts all three selections and fails on
any one of them runs in both `deploy.yml` and `guards.yml`.

**The real exposure that remains, stated:** 34 of today's rows carry no
`opening_odds` at all. Before the fix, the first cron tick after any of them
finished would have filled it with a settled price. After it, `finalized_at IS
NULL` excludes them. Tomorrow's census is the reading that crosses that
boundary with real games — and the watch is the ratchet, not this session.
