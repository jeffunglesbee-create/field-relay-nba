# CC-CMD-2026-09-15 — name the writer that emits a DraftKings blob with no total

**Status:** FILED, not started. Second CC-CMD required by Rule 87.4, opened
because `CC-CMD-2026-09-15-backfill-captured-at-not-snapshot-time` Task 0 proved
who the writer is **not**.

## What is known

22 archived `closing_odds` blobs (and, on the same games, the `opening_odds`
blobs) have this shape:

```
captured_at  2026-08-22T10:00:52.499Z    milliseconds — a writer's own clock
moneyline    115 / 180                   American
total        absent
source       draftkings
```

Their `odds_history` row carries decimal prices, a different bookmaker, a total,
and a whole-second `snapshot_time` ~1 minute before kickoff.
`.github/scripts/odds-backfill.js` cannot emit that shape: it carries the
history row's bookmaker, converts that row's decimal price, and copies that
row's `over_under`. `change_log` named it only because the sync loop logged
writes that matched nothing — now fixed.

All eight sampled games share one `opening_odds` `captured_at`:
`2026-08-22T10:01:21.633Z`. A single batch, one write per game, ~10:00–10:01Z.

## Tasks

0. **Probe by SHAPE, not by change_log.** Census every archived odds blob by
   `source`, by whether `total` is present, and by `captured_at` shape
   (milliseconds vs whole seconds), split by table and by month. The population
   that looks like the 22 is the population to attribute.
1. **Find the emitter in source.** Which writer sets `source: 'draftkings'` and
   omits `total`? Candidates to eliminate by reading, not guessing:
   `archive_game_closing` (`POST /archive/game`), `AmbientDO._captureClosingOdds`,
   and any `/d1/execute` caller. The Odds API returns a `markets` array — a
   consumer reading only `h2h` would produce exactly a moneyline with no total.
2. **Then decide** whether the 22 `captured_at` values are measurements (a live
   capture stamping its own clock is correct) or replays (a historical snapshot
   stamped with run time is not). Only then is repair a question.
3. A check that can fail, and an outbox manifest.

## Done condition

A named writer, with the source line that emits `source: 'draftkings'` without a
total, and a count of how many archived blobs it wrote.

## Scope boundary

No D1 writes. Do not modify any odds blob. Do not repair `captured_at` values
before the writer is named — a repair aimed at the wrong writer is a second
false fact on top of the first.

---

## CLOSED (2026-09-15) — named from source, in four fields

`extractOddsForGame` — `src/index.js:6439` — reached from the `/archive/game`
closing capture at `src/index.js:13032`.

| the 22 blobs carry | the function emits |
|---|---|
| `source: draftkings` | `source: bk.key`, `preferredBook = ODDS_PREFERRED_BOOK = 'draftkings'` |
| American prices | `out.moneyline = { home: h.price, away: a.price }`, the vendor's American odds |
| no `total` | `if (totals)` — absent when the DraftKings book prices no totals market |
| millisecond `captured_at` | `captured_at: capturedAt || new Date().toISOString()` |

### Why it stamped the clock

It no longer does. `a1937eb`, **2026-08-22T21:11:07Z** — *"captured_at said 'now'
for data that was a fixed noon-UTC snapshot"* — added the `capturedAt` parameter
and threaded the snapshot time through. The latest of the 22 blobs is stamped
**2026-08-22T10:00:52.499Z**, eleven hours earlier. **Every one of the 22
predates the fix.** They are its residue, not a live defect.

### Why change_log never named it

That route's first `change_log` entry is **2026-08-23** (measured
`CC-CMD-2026-09-14` Task 1). The 22 are dated 08-19 and 08-22 — written before
the route logged anything. The `odds_backfill` entries that appeared against
them were phantoms from a loop that logged after every UPDATE, fixed the same
day.

### Three call sites, and only one may omit capturedAt

| site | payload | capturedAt | writes |
|---|---|---|---|
| `6646` | live fetch | omitted — **correct**, the clock IS the capture moment | `opening_odds` |
| `6782` | historical | `snapshotAt` | `opening_odds` |
| `13032` | historical | `snapshotAt` | `closing_odds` |

`scripts/check-captured-at-explicit.mjs` states that as an invariant that can
fail: no call feeding `closing_odds` omits `capturedAt`, at most one call omits
it, and that one writes `opening_odds`. A blanket ban would be wrong — it would
push a fixed time into the one place the clock is the right answer. 7
assertions, 5 mutations, all caught, blocking in `deploy.yml`.

### The 22 values themselves — NOT repaired, and the gap is stated

The true capture time is **not fully recoverable**. The fix stamps
`servedAt || snapshot`: `snapshot` is derivable (`<date>T12:00:00Z`, the noon
anchor), `servedAt` — what the vendor actually returned — is not, for calls made
weeks ago. A repair could write the noon anchor with a mark saying it is the
anchor and not a measurement. That is a D1 write to 22 rows and is the owner's
call, not this task's.

**No consumer is affected today, and that is measured rather than assumed for
the sampled rows:** every sampled blob is stamped ~10:00Z against a 23:5x
kickoff, so `_kickoff.verified` is `true` either way. Whether that holds for all
22 is unmeasured — a repair proposal should measure it first.

---

## Repair verification (2026-09-15, `outbox/captured-at-repair-verify-*.log`)

**Verdict: do not run the anchor repair.** Read-only; nothing was written.

### 1. The population is 58, not 22

The 22 were everything the `odds_history` join could see — and `odds_history`
holds only 184 rows. Selecting by the **shape** that identified the writer
(`source: draftkings` + no `total` + millisecond `captured_at`) finds **58**.
The join was a keyhole.

### 2. The anchor repair buys nothing for 57 rows and breaks the 58th

| | rows |
|---|---:|
| kickoff verdict unchanged by the anchor | **57** |
| **verdict flips** | **1** |
| `late_minutes` changes | 1 |
| no `start_time` to judge against | 0 |

```
EPL_2026-08-22_hull_manunited
  kickoff  2026-08-22T11:30Z
  stored   2026-08-22T10:00:37.362Z  -> verified true
  anchor   2026-08-22T12:00:00Z      -> verified false
```

For 57 rows the repair changes a timestamp no consumer reads into a different
timestamp no consumer reads. For this one it changes a verdict — and **neither
value is supportable**. The historical endpoint is asked for `<date>T12:00:00Z`
and serves the snapshot at-or-before it, so the true capture is somewhere in a
window ending at noon. This match kicked off at 11:30. The capture could be
before or after that, and `servedAt` — the one value that would say — is gone.

The correct answer for that row is **unknown**, which is neither of the two
values on offer. A repair that writes `false` asserts a fact as surely as the
run-time stamp that currently asserts `true`.

### 3. A repair must write two fields or none

`stampKickoff` is `captured_at`'s only reader, and its output `_kickoff` is
already materialised on every row. Rewriting `captured_at` alone leaves the row
asserting two different capture times.

### What this leaves

Nothing is broken today: 57 of 58 verdicts are unaffected, and the one that
moves is already carrying the more plausible of two unprovable values. The
defect that produced them was fixed on 2026-08-22 and is now gated by
`scripts/check-captured-at-explicit.mjs`.

**The honest repair is not a better timestamp — it is a mark saying the
timestamp is not a measurement.** That is still a D1 write to 58 rows and needs
its own authorisation and its own done condition. Not started here.

**One thing this surfaced and did not fix:** `kickoffMark` returns
`{ verified: false, late_minutes: null }` both for "captured after kickoff, by
an unknown amount" and for "unreadable". Those are different states and a row
like the EPL one above needs the second. Recorded, not changed —
`src/odds-kickoff.js`, and changing it moves 1383 existing marks.
