# "Near miss" was the wrong name for most of what this adds

Closes `CC-CMD-2026-08-23-soccer-near-miss-enrichment`.

## Done conditions

| # | condition | result |
|---|---|---|
| 1 | `match-events-check.mjs` passes with **more** than 25 assertions, none removed | **44 passed, 0 failed** |
| 2 | `CONTRACTS.md` byte-identical in both repos | md5 `66a139bc`, relay `727640f` + client `e129eff` |
| 3 | check 4 of `verify-staged-items.mjs` PASS or PARTIAL for EPL, never FAIL | **PASS — 9/9**, `any_failed: false` |

## The correction that changed the build

ESPN has exactly one type for a shot that missed: `Shot Off Target`. It covers a
tap-in skied over the bar and a speculative 35-yarder identically, and nothing in
the type separates them. **Only `Shot Hit Woodwork` is a genuine near miss.**

Pooling them under one "near misses" heading licenses *"they came close again and
again"* as a description of wild shooting — a claim invented by the **label**
rather than supported by the source. That is a Rule 1 violation manufactured by
naming, which is a quieter route to it than fabricating a number.

So the block emits two labelled groups and says so in its own text:

```
[MATCH EVENTS]
P1 12' — Goal! Arsenal 1, Chelsea 0. Saka.
P2 58' — Goal! Arsenal 1, Chelsea 1. Palmer.
P2 88' — Goal! Arsenal 2, Chelsea 1. Havertz.

Hit the woodwork:
34' — Rice hits the left post.
90' — Havertz rattles the crossbar.
Attempts off target:
70' — Attempt missed. Saka shoots wide.
(None of the above are goals. An off-target attempt is not a near miss — do not
describe these as chances that nearly scored.)
(3 of 16 attempts — woodwork first, then the latest.)
```

Fouls are excluded despite sitting in the same container. A foul is not an
attempt, there are dozens per fixture, and the budget is better spent on the
woodwork line.

## The regression this existed to cause, and doesn't

The ask says "read them into the same `[MATCH EVENTS]` block". Done literally,
that routes attempts through `selectScoringPlays`, which ranks by running score:

```js
if (scored.length !== items.length) return items.slice(-cap);   // cap = 8
```

An attempt carries no score. On a 3-goal, 16-attempt fixture (19 > the enumerate
max of 12) the selector bails to *the last 8 things that happened*. Measured:

```
merged -> 8 items, goals kept: 2 of 3
```

**The opening goal is dropped.** The generator gets a 2-1 with two goals and no
account of how the lead was taken — strictly worse than goals-only, which is
what the enrichment exists to improve on. It also labels 19 items "scoring
plays" when 16 are misses.

Attempts are therefore a separate appended section. `formatMatchEvents(items)`
with no second argument is byte-identical to its pre-enrichment self, which makes
the five-sport requirement **structural** rather than something to test for — the
new code is unreachable without the second argument. Tested anyway, five ways.

## Cap 3, measured against the drop that is silent

`match_events` declares 200 tokens and the assembler drops any block over
`budget * 1.5` = 300 — presenting as a brief with **no** events, not a long one.

| cap | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|
| tokens | 167 | **214** | 255 | 297 | 338 over |

The ask's instruction was to raise the declared budget to fit. That is the wrong
lever: `remaining` is decremented by **actual** tokens, so raising the declared
number widens the drop ceiling without creating an ounce of room in the 600-token
total. A 338-token block would leave `fpl_match_events` — ~98 real tokens, and
authoritative for EPL goals, assists, cards, saves and bonus per CONTRACTS.md —
unable to fit. The enrichment would have been funded by dropping the better
source.

The volume rides in the count note instead. `(3 of 16 attempts)` tells the
generator there were sixteen for four tokens; fourteen more lines of ESPN prose
cost a hundred and twenty.

**Every woodwork item survives the cap**, even past it — a fixture with five
posts is the one most worth describing. The first version kept all ten off-target
attempts in that case, because `slice(-0)` is `slice(0)` and returns the whole
array. Caught by the five-woodwork assertion, which is in the guard precisely
because the interesting fixture is the one that breaks the arithmetic.

## Two places the spec was a correlate, not the thing

- **Tiering.** `commentary.length >= 60` is a measured proxy for "has attempts",
  bimodal over 20 fixtures. The array is already in hand, so counting attempts
  directly cannot mis-tier when ESPN changes how chatty its commentary is. The
  raw count is still reported so the bimodal claim stays checkable.
- **Absence.** A fixture with no attempt data now says it is **missing data**:
  *"not a quiet game: do not infer that few chances were created."* Silence about
  an absence reads as an account of the match.

## One recommendation withdrawn

Before reading Drive I proposed probing the other nine soccer slugs first, on the
grounds that EPL is 9 of 218 finalized soccer rows while 209 get no match-events
block at all. **That was the wrong priority and the row count was the wrong
measure.** EPL is the most instrumented competition in the system — it alone
carries `fpl_match_events`, `fpl_player_context`, the FPL table, `soccer_xg` and
BSD xG/possession. Depth there is deliberate. The slug question stands on its own
merits and is not a prerequisite for this.

I also overstated a budget contention: I read the 600 total as saturated by
declared budgets (200 + 400). It is not — the assembler spends actual tokens, and
`fpl_match_events` actually costs ~98. The contention is real but far smaller
than I said.

## Files

- `src/context-assembler.js` — `selectNearMisses`, `formatNearMisses`,
  `formatMatchEvents(items, opts)`, `commentary` read in
  `buildMatchEventsContext` (no extra fetch)
- `scripts/match-events-check.mjs` — 25 → 44 assertions
- `CONTRACTS.md` — both repos, byte-identical

## Still open

**No post-deploy EPL sample.** The three EPL rows in check 4's window are still
pre-deploy (created 2026-08-23 17:30, before `cd9b2e3` at 18:25:56). The
enrichment is verified by construction and by 44 assertions; it has not yet been
observed on a live EPL fixture.

- Unblocks on: the next EPL matchday finalising.
- Verify: `staged-verification.yml`, check 4, an EPL row with `generated: true`.
- Reads as: grounded → the path works end to end. `0/N` over generated EPL rows →
  a delivery gap, and the block being dropped for budget is the first thing to
  measure.
