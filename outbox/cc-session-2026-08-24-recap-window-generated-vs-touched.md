# The check reported a shortfall in the feature; the shortfall was in its window

## Result

```
recap_names_a_scoring_play: PASS — 9/9 recap(s) name someone who actually scored

qualifying_rows  12
generated_rows    9   all grounded
touched_rows      3   all EPL, all created BEFORE the deploy
testable_rows     9
```

Ask 5 is closed. `match_events` reaches the live recap prompt, and every recap
generated since the wiring deployed names a real scorer — nine for nine, across
two sports, no exceptions.

## What the previous run actually measured

`PARTIAL — 9/12`, with three EPL rows ungrounded. I read that as an EPL-specific
delivery failure and was about to go measure the assembler's 600-token budget
ordering for soccer.

The three rows:

```
game_recap_epl_401879319  created 2026-08-23 17:30:19  updated 2026-08-24 02:16:26
game_recap_epl_401879320  created 2026-08-23 15:00:20  updated 2026-08-24 02:16:24
game_recap_epl_401879297  created 2026-08-23 15:00:18  updated 2026-08-24 02:16:07
```

The recap path first called `assembleContext` when `cd9b2e3` deployed at
**18:25:56Z**. All three were written at 15:00 and 17:30 — one to three hours
earlier. Their prose was generated with no context available to it. They were
touched at 02:16 and the window read that as fresh.

The check reported a shortfall in the feature. The shortfall was in the check.

## Two window defects, one insight

The check must window on when the PROSE was produced under the build being
tested, not on when the row last moved.

**1. Wrong constant.** It windowed on `T_MATCH_EVENTS = 2026-08-23 06:12:03` —
when the match_events *source* was registered. That is twelve hours before the
recap path called anything. Every recap in the gap had no context and was scored
as though it had some. Added `T_RECAP_CONTEXT = 2026-08-23 18:25:56`, taken from
run 32657982684's "Deploy to Cloudflare Workers" completion.

**2. `COALESCE` collapsed two facts and discarded both.**

```sql
COALESCE(updated_at, created_at) AS written_at   -- before
created_at, updated_at, COALESCE(...) AS written_at   -- after
```

Each row now carries `generated: created_at > T_RECAP_CONTEXT`. Only generated
rows enter the ratio. Touched rows are counted and listed in `touched_ids`,
never folded in — letting one through is how a check reports a failure of a
build that had not shipped when the text was written.

Third instance of one shape this session, and worth naming as a class: a value
that looks like the answer while measuring something adjacent to it.

| where | the value | what it actually measured |
|---|---|---|
| `docs/history-boundary.txt` | a commit sha | a commit its own push had rebased away |
| `stale-data-sentinel.js:39` | `entries` | computed, then read by nothing |
| check 4 | `written_at` | when the row last moved, not when its text was written |

## What made the reframe checkable rather than a guess

The 02:16 cluster was the tell. WNBA at 01:30, MLB at 20:30 / 21:30 / 23:00 —
all plausible completion triggers in ET. The EPL trio touched within 19 seconds
of each other at 02:16 UTC, which is 03:16 BST, when no EPL match finalises.
Two clusters thirty minutes apart, only one of them plausibly live.

Two easier explanations were ruled out before reaching for that one:

- **Not a missing `sourceId` on the backfill paths.** All four `assembleContext`
  call sites pass it (6652, 8495, 12811, 16072), so a backfill assembles context
  too.
- **Not a check that cannot handle soccer.** `names_in_plays` is fully populated
  for EPL — Elanga, Osula, Gakpo, Gravenberch, Wissa, Szoboszlai. The briefs
  genuinely name nobody, which is exactly what pre-deploy prose looks like.

## Still open, and genuinely open

**EPL has no post-deploy sample.** The three rows in the window are pre-deploy,
so nothing has been observed either way for soccer. That is unanswered, not
answered badly, and the distinction is the entire point of this change.

- **Unblocks on:** the next EPL matchday finalising after 2026-08-23 18:25:56Z.
- **Verify:** `staged-verification.yml` — `recap_names_a_scoring_play` with at
  least one EPL row carrying `generated: true`.
- **Reads as:** grounded → soccer works. `0/N` over generated EPL rows → a real
  delivery gap, and `fpl_match_events` (priority 5, budget 400) crowding
  `match_events` out of the 600-token ceiling is the first thing to measure.

## Files

- `scripts/verify-staged-items.mjs` — `T_RECAP_CONTEXT`, both timestamps
  selected, `generated` per row, ratio over generated rows only
- `scripts/staged-verdicts.mjs` — PENDING wording matches the new window
