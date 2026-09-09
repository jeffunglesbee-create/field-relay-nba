# session_health queue coverage — Task 0 complete, Tasks 1-3 STOPPED

2026-09-09 · field-relay-nba
**CC-CMD:** `docs/CC-CMD-2026-09-07-session-health-queue-coverage.md`
**Status:** Task 0 done and committed. **Tasks 1-3 not executed.** Confidence on
the predicate choice is ~70, below the 95 the dispatcher requires.

## Why this stopped

The CC-CMD's own Task 3.3:

> Confirm `total_open` matches the Task 0.2 hand count exactly. If it does not,
> **stop and report the discrepancy rather than adjusting the number to match.**

There is no unambiguous hand count to match. Any predicate I write *chooses* the
number rather than measuring it, which is the thing that instruction forbids.

## Task 0.1 — the real query

`src/index.js:19384` — `WHERE category = 'cc-cmd-queue' AND title LIKE 'PENDING%'`.
The CC-CMD says ~19232; the file has moved. Text is otherwise as transcribed,
with one addition the document does not mention:

```js
const cq = await env.ARCHIVE_DB.prepare(`
    SELECT key, title, updated_at,
           ROUND((julianday('now') - julianday(updated_at)) * 24, 1) AS hours_stale
    FROM codex
    WHERE category = 'cc-cmd-queue' AND title LIKE 'PENDING%'
    ORDER BY updated_at ASC LIMIT 15
`).all();
out.stale_pending_cc_cmds = (cq.results || [])
    .filter(r => r.hours_stale >= 2)          // ← A THIRD FAULT
    .map(r => ({ key: r.key, title: r.title, hours_stale: r.hours_stale }));
```

**Fault 3, not named in the CC-CMD.** `LIMIT 15` is applied in SQL and the
`hours_stale >= 2` filter in JS afterwards. So `returned` is not the number the
LIMIT allowed — a fix reporting `returned` without accounting for the post-hoc
filter reports a number the payload does not contain. Benign today (ordering is
`updated_at ASC`, so the oldest and therefore stalest come first), but a fix that
declares coverage has to declare this too.

## Task 0.2 — the counts, and they contradict the CC-CMD

| the CC-CMD says | measured 2026-09-09 |
|---|---|
| 29 rows match `title LIKE 'PENDING%'` | **10** |
| the query returns 15, truncating silently | returns **10** — no truncation is occurring |
| "the real number was 31" | 285 queue rows; 24 whose leading word is not unambiguously closed |
| `queue-deadcode-and-ambiguous` begins `CORRECTED, still PENDING --` | begins `PENDING --` — **it matches today** |
| `playground-weatherpoll-wrong-endpoint` begins `OPEN — ` | **confirmed**, still invisible |

```
total_queue_rows            285
matching_pending_prefix      10
not_matching_unresolved     140
current_query_rows           10
current_query_after_2h       10
```

### Why the premises are false: the CC-CMDs collided

The 2026-09-08 `codex_write` incident — the subject of the *other* CC-CMD this
session executed — rewrote **26** `cc-cmd-queue` titles. That is what took the
`PENDING%` population from 29 to 10.

It also rewrote `queue-deadcode-and-ambiguous`'s title from `CORRECTED, still
PENDING --` to `PENDING -- dead-code removal HALF LANDED…`, so one of the two
keys this CC-CMD calls permanently invisible **is visible now — because of the
data loss, not because anything was fixed.**

**Fault 1 is real but latent.** 10 < 15, so it is not firing. It will fire again
the moment the queue grows past 15 open entries.

**Fault 2 is confirmed** for `playground-weatherpoll-wrong-endpoint`, and for
more rows than the two named.

## Task 0.3 — `status` is NOT a reliable predicate. Decisively.

The CC-CMD asks whether `status` beats title-prefix matching and says to report
which is actually true. It is not.

```
status distribution     resolved 135    open 122    done 28
```

Three values, not the two `codex_write` documents (`open`/`resolved`). And the
cross-tab against title class:

| status | title class | rows |
|---|---|---|
| resolved | title:DONE | 99 |
| **open** | **title:DONE** | **89** |
| done | title:DONE | 28 |
| resolved | title:contains RESOLVED | 26 |
| open | title:other | 16 |
| open | title:PENDING | 10 |
| resolved | title:other | 10 |
| open | title:contains RESOLVED | 5 |
| open | title:OPEN | 1 |
| open | title:contains PENDING | 1 |

**89 rows are marked `open` while their title says DONE.** That is
`ensureCodexStatusColumn`'s `ALTER TABLE codex ADD COLUMN status TEXT DEFAULT
'open'` backfilling every pre-existing row. A default is not a judgement, and a
predicate resting on one reports the whole table as open forever.

Title is the only signal carrying information. Which is where it stops being
answerable.

## Why the predicate cannot be derived without a decision

The first-word census over all 285 rows found **20 distinct leading words**.
Eight are unambiguously closed — DONE (215), RESOLVED (26), SUPERSEDED (14),
CLOSED (2), WITHDRAWN (1), MERGED (1), EXECUTED (1), `DONE,` (1). Excluding
those leaves **24 rows**, and their disposition is written in prose by earlier
sessions:

**Clearly open (7):**

| key | title says |
|---|---|
| `playground-weatherpoll-wrong-endpoint` | `OPEN — WeatherPoll: wrong endpoint` |
| `CC-CMD-2026-07-09-enqueue-context-gap.md` | "TASK 3-4 (relay) still pending" |
| `relay-empty-catches-sweep` | "~95 remain, not 34" |
| `2026-07-16-drama-gateway-and-amnesty-zone-held` | "4 remain genuinely held" |
| `CC-CMD-2026-07-07-espn-cache-date-qualification.md` | "urgent fix untouched" |
| `p15b-p16-getqualitytarget` | "P16 confirmed still open" |
| `brief-archive-health-audit` | "flagged unexamined" |

**Clearly closed despite a non-closed first word (4):**

| key | why |
|---|---|
| `cf/2026-07-02/soccer-player-identity-shipped` | status `resolved`, "shipped … live" |
| `CC-CMD-2026-07-01-completion-triggered-journalism.md` | status `resolved`, "I wrongly kept re-listing this as open" |
| `datamuse-relay-proxy` | "TASK 1 DONE / TASK 2 DONE" |
| `CC-CMD-2026-07-07-worth-watching-display.md` | "just pushed" |

**Genuinely ambiguous (3):**

| key | the ambiguity |
|---|---|
| `cliche-freshness-scoring` | `BLOCKED -- premise empirically disproven` — blocked-forever is closed; blocked-pending is open |
| `bucketc-inverse-problem-confirmed` | "standing check to carry into future clusters, not a full audit" — a standing check has no completion |
| `journalismbrief-endpoint-correction` | `CORRECTED — my correction was itself partly false` — states no disposition at all |

The remaining 10 are the `PENDING%` rows already visible.

**So `total_open` is 12, or 15, or 24, depending on judgements about other
people's prose that I would be making, not measuring.** An exclusion-based
predicate ("not in the closed vocabulary") reports 24 and over-states by at least
4 demonstrably-closed rows. A prefix-list predicate reports whatever list I
choose. Either way the number comes from me.

The CC-CMD's subject is an instrument that reported a wrong number as fact. A fix
that swaps one chosen number for another is the same defect wearing the new
LIMIT.

## What is needed to finish

One decision, and it is the queue owner's:

1. **Adjudicate the 3 ambiguous rows** — blocked, standing-check, and
   self-contradicting-correction: open or closed?
2. **Fix the 4 clearly-closed rows' titles** (or statuses) so no predicate has to
   special-case them, OR accept that `total_open` over-reports by 4.

Given either, the predicate follows immediately and Tasks 1-3 are ~30 minutes:
exclusion-based title matching, `total_open` / `returned` / `truncated` in the
payload, LIMIT raised with a declared cap, `hours_stale` filter moved into SQL so
`returned` means what it says, and the live response pasted here.

## What was done and committed

Read-only probes only. No behaviour changed.

```
08d824a  scripts/session-health-queue-probe.mjs   + workflow   Task 0.1-0.3
93358d0  scripts/session-health-queue-titles.mjs               Task 0 second pass
```

Artifacts: `outbox/session-health-queue-probe.log`,
`outbox/session-health-queue-titles.log`, and the two timestamped JSON files
beside them.

## Confidence

**Task 0: 97.** The query location, the three counts, the `status` unreliability
(89 contradictions is not a marginal signal), fault 3, and the collision with the
09-08 overwrite are all measured, twice where it mattered.

**Tasks 1-3: ~70.** Not because the mechanism is hard — it is a predicate and
three extra fields — but because the CC-CMD's done condition requires
`total_open` to match a hand count that does not exist, and manufacturing one is
the failure this CC-CMD was written about.
