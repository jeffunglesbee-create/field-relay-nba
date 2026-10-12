# CC session — 2026-10-12 — D1 overload degrades

**Document:** `docs/CC-CMD-2026-10-11-d1-overload-degrades.md` — DONE.
**Filed:** `docs/CC-CMD-2026-10-12-degrade-reasons-by-hour.md` — OPEN, per Rule 87.4.

## Done condition 1 — the per-call count and the call volume

### D1 per odds call at HEAD, by path (`src/budget-helpers.js`)

| path | round trips | statements |
|---|---|---|
| vetoed at the daily ceiling | 1 | 3 |
| charged, no correction | 3 | 6 |
| charged, corrected or cache-hit | 4 | 9 |
| once per cold isolate | 1 | 4 CREATE IF NOT EXISTS (67 ms median, 2026-09-20) |

The document guessed 8. No relay commit between 2026-10-09 and 2026-10-11T18:10Z
added a D1 call.

### Volume, from committed artifacts

| day | fetched calls | ceiling | D1 overloads |
|---|---|---|---|
| 2026-10-09 | ≥ 1,812 | not reached | **0** (reasons present) |
| 2026-10-10 | 2,149 | 19:37:09Z | **13** |
| 2026-10-11 | 1,891 | 14:03:59Z | **155** |
| 2026-10-12 | 205 by 02:50Z | — | 0 by 02:50Z |

Fetched calls fell 12% while overloads rose 12x. Vetoed attempts — which still
run a D1 batch — have no counter and are recorded as unmeasured.

## Three things this session got wrong before it got them right

1. **The document's own command.** `odds_reconcile_state.n` counts calls that
   FETCHED. Vetoed attempts never fetch and still hit D1, so it undercounts
   post-ceiling load, and that exposure was 0 / 4.4 / 9.9 hours across the three
   days. Caught by reading the guard before using the count.
2. **A false 22-day baseline.** The first pass over the series printed
   `d1-overload 0` for every sample back to 2026-09-18. The reasons map only
   exists from 2026-10-09T00:44Z; before that the field is ABSENT. Checked the
   key's presence per row before believing the zeros (Rule 99).
3. **An earlier published false negative.** `outbox/odds-watches-daily-read-2026-10-11.md`
   said the month-batch reason count was "nowhere in `outbox/`". Both series
   files carried it — the 1183 / 5849 figures that note dropped as untraceable.
   The search had looked for field names the series does not use, and never
   searched for the string at all. Corrected in place.

## Task 3 — the reader

`watch-odds-pairing-rate.mjs` gained a closed-day read and `d1OverloadVerdict`:
69 self-tests (the three real days verbatim), 7/7 mutations — **P7 survived its
first run** and the missing `events: null` test was added — and an end-to-end
run of the real watch against a local fake relay:

```
2026-10-11 shape  → degraded_open over, 155 overloads   → FAIL
2026-10-09 shape  → degraded_open none, 0               → no D1 FAIL
field absent      → degraded_open not-reported          → FAIL
```

**Not dispatched.** The watch differences consecutive readings with no window
gate, so an off-schedule run would split the next interval. Its first live
verdict is the next scheduled run and must read `over` for 2026-10-11.

The harness killed my own shell once more with `pkill -f` matching its own
command line (exit 144) — the third time this session. `pkill -f "[f]ake..."`
cannot match itself.

## Verified vs STAGED

| thing | state |
|---|---|
| per-call D1 cost, by path | **VERIFIED** — source |
| no D1-adding commit in the window | **VERIFIED** — git log |
| the series and its 2026-10-09 reasons boundary | **VERIFIED** — per-row key check |
| CI activity per day's window | **VERIFIED** — Actions API |
| the predicate | **VERIFIED** — 69/69, 7/7 |
| the watch's runtime path | **VERIFIED** — end to end against a fake relay |
| the watch's first live verdict | **VERIFIED 2026-10-12T20:05Z** — scheduled run `38301876359`: `degraded_open: over`, `D1 overloads: 155`, FAIL; month-batch `1075`; self-test 69/69 and 7/7 mutations in the same job |
| attribution of the 155 to a cause | **NOT ESTABLISHED** — needs `by_hour`, filed |

**Credits spent: 0.**
