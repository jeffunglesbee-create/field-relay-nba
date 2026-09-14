# CC session — 2026-09-14 — closing odds captured after kickoff

Rule 67 session doc. Repo: field-relay-nba. Branch: `main` throughout, 0 PRs.

HEAD progression: `20eed77` → `4ab995a` (89 commits, workflow log commits
included). Gates: `CC-CMD-2026-09-14-closing-odds-captured-after-kickoff.md`,
Tasks 0–4 and the two residuals, all closed in-document.

## Where it came from

Not from this task. Two D.C. United collision pairs each held two *different*
closing lines, and no merge rule could pick between them — delete destroys data,
COALESCE cannot write into a non-NULL, and recency was useless because one
side's `captured_at` was the same wall-clock second on two different dates.
Three dead ends is the Rule 42 signal. What the rows were showing:
`2026-07-25T23:55:28Z` against `2026-07-25T23:41:27.699Z` against a 23:30
kickoff. **Neither is a closing line. One is a closing line and one is an
in-play line in a column that means closing.**

The pairs were not the defect. They were where it became visible.

## Per task

**Task 0 — how wide.** 91 of 877 askable rows carried a closing line captured
after kickoff. The first version of the probe compared timestamps **as text**:
`'Z'` (0x5A) sorts above `':'` (0x3A), so `…20:05:30.000Z` sorts below
`…20:05Z` and a capture 30 seconds after a minute-precision kickoff read as
before it. `90/879` → `91/877` after `Date.parse`. Both shapes were printed by
the probe's own step 0.

**Task 1 — the author of the 62.** `archive_game_closing`, 58 of 62, by dated
elimination. Two blob fingerprints were built and both self-refuted (key-set,
then same-`captured_at`); the third attempt was abandoned for a dated
attribution-gap argument. **968 of 968** unattributed rows predate that writer's
first `change_log` entry (2026-08-23).

A fourth writer claim was wrong in the other direction: "there are only two
writers" survived until `scripts/diagnose-staged-fails-2026-08-22.mjs:81` (`Three writers can set closing_odds`) was
read, which already said **three**. `.github/scripts/odds-backfill.js` is the
third and runs in CI.

**Task 2 — the writers gated.** All three now compare capture against kickoff
**as instants**. The backfill no longer stamps an invented `captured_at`:
`closing_odds` is written only when `snapshot_time` is a real measurement.
Both swallowed `change_log` failures now name the row they could not attribute.
`src/odds-kickoff.js` holds the shared rule; the CC-CMD's own sentence for this
task ("backfill must not write closing_odds for a match already played") was
wrong and was corrected rather than implemented.

**Task 3 — the mark, and backstamping it.** `_kickoff: { at, verified,
late_minutes }` on every closing blob, then backstamped onto existing rows.
Chosen over a relabel: a relabel moves data, a mark makes every row answer for
itself. 530 rows could not be asked because they had no `start_time`; 476 were
resolved from ESPN (476/476, 0 failures) and 25 more of the last 54 by
twin/cardinality. **29 remain with no proven route** — 10 MLS on ambiguous
slates, 19 NBA/NHL Finals — each surviving hypothesis recorded and refuted.

Final archive state: **1383 marked · 1164 verified pre-kickoff · 219 late · 29
unaskable · archive-wide late rate 15.8%** (against the 10.4% that looked like
the answer while a third of the archive was unaskable).

**Task 4 — the 219 (Rule 42).** Relabel, re-fetch and leave all treat the stored
value as the defect. It is a real capture of a real price; the false part is the
column name, and the mark already corrects it. **Nothing read the mark** — five
sites read `closing_odds` by name, and all five want the same property: the last
price before kickoff.

Measured over all 1412 closing values, no sampling:

| | today | under the rule |
|---|---:|---:|
| upset findings (ML ≥ +200) | 66 | 59 |
| tight lines (`\|spread\| < 3`) | 877 | 816 |
| debrief prompts printing an in-play price as `closed` | 126 | 0 |
| "movements" ending in-play | 130/1323 | 0 |

**7 fabricated, 0 erased.** The CFL row: pre-kickoff **−4800**, in-play **+250**
taken 180 min late — published, *"beat Saskatchewan as a +250 underdog"* about
the heaviest favourite on the card. Two WNBA rows rest on prices 857 and 5819
minutes late.

No tolerance, and that is measured: 23 rows are ≤ 2 min late, **96 are over two
hours**. A 2-minute grace buys back 11 rows of scoring signal and readmits 5
wrong claims. Cost of the rule: **88 decided rows lose their only price** —
unknown rather than wrongly known.

## Verified E2E, not STAGED

`outbox/late-close-story-suppressed-2026-09-14T22-49-*.log`, against the
deployed worker: **42 of 42** rows that previously computed a story now return
none, across all 20 dates carrying one, **0 still narrating**. The verifier
fails if the would-have count is zero, so an empty route cannot satisfy it.

Deploy run **960** green, including the new blocking gate (step 23).

## Rules written or applied

- **Rule 100 (PREMISE-FIRST-A)** written this session, from a count of five
  published-then-refuted premises — among them a `23:55:28` timestamp called
  "defaulted" before one `GROUP BY` showed a 40-second cron window, and a
  kickoff derived from `finalized_at` − 2 h when `start_time` on the twin was
  already in the payload that had been read. Its corollary is the expensive
  half: **an untested premise is not reported as a finding.**
- **Rule 90 (MUTATE-FIRST)** — 32 + 14 assertions, 12 + 8 mutations, all caught.
  Two mutations found harness defects before they found product defects: an
  uncaught throw that killed the check before any FAIL line printed, and an
  anchor matching two functions.
- **Rule 91 (SAMPLE-COVERAGE)** — every probe prints its denominator beside PASS.
- **Rule 99** — an unmarked blob is *unknown*, not guilty; treating unknown as
  post-kickoff would blank almost every `opening_odds` in the archive.

## Errors worth carrying forward

- `LOSS_BEARING` reused for a fill planned 64 updates, half of them writing
  `espn_event_id` into the twin and making 19 `WHERE espn_event_id = ? LIMIT 1`
  lookups ambiguous. Narrowed to odds columns before any write.
- A done condition that **re-derived its subject** printed OK while the watch
  read 2 pairs open 55 s later.
- A variant test named its variable `zeroSlates` and filtered
  `rows.length >= 1` — 12/12 green, nothing learned.
- `1207013` failed the brace-balance gate: `/archive/` was at exactly 1500
  lines. The diagnostic I reported from counted zero braces because it
  stringified an object. **9 lines of headroom remain.**
- An estimate of ~50 late among the 476 unmeasurable rows was wrong by 2.4× —
  actual 121. The unmeasurable rows were the most broken.

## Carry-forwards (each has a CC-CMD or is explicitly optional)

1. **29 unaskable rows** — no proven route to a kickoff. Refusals are recorded
   as evidence, not as a TODO.
2. **The 219 values are not modified.** Relabelling them into `inplay_odds` is
   now optional: no reader is misled by them.
3. `CC-CMD-2026-09-14-cup-competitions-under-mls` — filed, unstarted.
4. The 49 brief-repoint pairs among the 82 deleted rows — filed, unstarted.
5. `odds_history.snapshot_time` NULL count — the coverage cost of Task 2's
   `closing_odds` skip is still unmeasured.
