# Era 6: the done condition I wrote could be met by a dimension that does nothing

## Result

```
                       era 5 code      era 6 run 16   run 17   run 19/20
Dim 10 nonzero rows      0 / 190          128/128     128/128    127/128
Dim 10 rows JUDGED       0                      —       4/128     17/128
verdicts available       agrees only            —    agrees 4   agrees 16
                                                              +1 rout call
```

`marginAgreement` replaces the `matchupNote` echo test. Judgement rate 0% →
13.3%, and the dimension has caught its first real defect: one brief calling a
tight game a rout. Runs 19 and 20 returned byte-identical censuses on the same
build, so the 17 is the instrument, not a sampling accident.

Both after-runs: `census_agrees` true, `totals_add_up` true,
`path_disagreement` 0.

## Three things that were nearly recorded as wins

### 1. 128 of 128 nonzero, and 124 of them abstaining

Era 6's own done condition — mine — was
`nonzero_rows_per_dim.matchupDepth > 0, with the count`. Run 16 returned 128 of
128 and the means were 0.500 on in-progress rows and 0.521 on finals.

0.500 across 33 rows is 33 abstains. A dimension returning the midpoint on every
row satisfies "nonzero on every row" while separating nothing — the same
constant the old Dim 10 was, moved from 0 to 15. The spec could not tell those
apart, which is Rule 89 against a spec I wrote myself two hours earlier.

`margin_census` is the fix: `n_judged` counts only rows where the dimension took
a position, full marks or zero, with abstains excluded from both sides.

### 2. Two abstains that mean opposite things

| verdict | n | what it is |
|---|---|---|
| `unknown-result` | 56 | no score to judge — 32 no game row, 24 game row with null `home_score` |
| `no-clear-reading` | 34 | a verdict existed; the prose made no claim |
| `no-honest-verdict` | 21 | ordinary margin, dimension declines by design |

Folding those into one count describes a missing D1 row, a missing column, a
prompt gap and a deliberate design choice as one number.

### 3. The thresholds were made sport-free; the vocabulary was left American

Run 17 said 47 rows scored `no-clear-reading` on rows where a verdict existed.
That has two causes with different fixes — the prose is silent (fix the prompt)
or the regex is blind (fix the regex) — and **the old Dim 10 spent two months
fixed the wrong way** on exactly that ambiguity, labelled "unreachable in the
Worker runtime" while it was really data-starved.

So run 18 was made to carry the actual prose rather than the count. Five of six
sampled briefs said it outright:

```
"Neither side managed to break the deadlock"           0-0, fact tight
"a scoreless stalemate ... finished 0-0"               0-0, fact tight
"This scoreless draw leaves the aggregate tied at 0"   0-0, fact tight
"Brentford dominated ... shutting out Spurs 3-0"       3-0, fact lopsided
"the visitors dominate possession"                     3-0, fact lopsided
```

Blind regex. And the misses have one shape: `one-run`, `one-possession`,
`walk-off`, `extra innings`. The list was written for American sports; this
corpus is mostly European soccer, where a tight game is a deadlock, a stalemate
or a goalless draw. Era 6 made the thresholds sport-free and left the vocabulary
untouched — half of one idea, and the half that shows up in the numbers.

Widening it: judged 4 → 17, `no-clear-reading` 47 → 34.

## Three exclusions, each preventing a false penalty

Not false positives — cases where accurate prose would have been scored zero.

- **`level`, `tied`, bare `draw`.** "It was level at halftime before Arsenal ran
  away with it, 4-1" would read as both and score 0. Finality can treat mixed as
  contradiction because "at halftime" and "held on to win" cannot both be true
  of one brief. A margin that changed during the game is not a contradiction,
  it is a game.
- **`dominated possession`.** A 1-0 where one side dominated possession is a
  tight game described accurately. Excluded by lookahead, not by dropping the
  word — `dominate` is the ordinary English word for winning big and appears in
  the corpus doing exactly that.
- **`emphatic`.** Tried, then dropped: "an emphatic late winner sealed it 1-0"
  came back `contradicts-itself`. It modifies one goal's manner, not the margin.

Each has its own assertion. The four corpus cases are verbatim from
`outbox/rescore-quality-6b-20260824T141752Z.json` — a regex tested only against
phrases its own author thought of is tested against its own blind spot.

## The rename broke two constants, silently

```js
export const UNREACHABLE_DIMS      = ['ctx', 'matchup'];
export const UNREACHABLE_DIMS_GAME = ['matchup'];
```

Era 6 renamed `SCALE.matchup` → `SCALE.margin`. Neither string then named a key,
so both filters matched **nothing**: `REACHABLE_CEILING` went 245 → 277 and
`REACHABLE_CEILING_GAME` 270 → 294, with no error, no failing test, and no diff
on those lines. `/quality` published `unreachable_points: 0` for the game shape
while still listing "matchup" as unreachable.

The era fingerprint could not see it either — the rename was weight-preserving,
30 points on both sides. Era 6's commit message called that gap "worth its own
look"; it had already happened in that same commit.

And the binary list is now the wrong shape regardless. Eras 5 and 6 replaced both
game-fact dimensions with ones that **abstain at the midpoint** when the fact is
missing: `marginAgreement(text, null)` is 15 of 30, `finalityAgreement(text,
null)` is 10 of 20. Neither is unreachable, neither is fully reachable, and
either label is wrong by 15 and 10 points.

`SLATE_CAPS` is per-dimension and **derived by calling the functions**. Only
`ctx` is declared, because `dim7` is inline in `scoreProse` — and it is checked
against a real no-game `scoreProse` call, with a control asserting that call
scored above zero elsewhere so a broken scorer cannot satisfy it with zeros.

| | before | after |
|---|---|---|
| slate ceiling | 245 (declared) / 277 (actual) | 252 |
| slate four-fifths | 196 | 202 |
| game ceiling | 270 (declared) / 294 (actual) | 294 |
| game four-fifths | 216 | 235 |

The game shape now reaches the full nominal total, which is era 6's actual point:
the last game-unreachable dimension stopped being one.

`check-slate-caps-are-derived.mjs` is a deploy gate. Its load-bearing assertion
is the general one — **every name in every dim list must resolve to a live SCALE
key** — and its self-test replays `['ctx','matchup']` against today's SCALE.

## The recurring shape, fifth and sixth instances

A value whose name and measurement disagree.

| where | the value | what it actually measured |
|---|---|---|
| `docs/history-boundary.txt` | a commit sha | a commit its own push had rebased away |
| `stale-data-sentinel.js` | `entries` | computed, then read by nothing |
| `verify-staged-items.mjs` | `written_at` | when the row last moved, not when its text was written |
| `SCALE` | declared weights | 49 points from the implementation's ceilings |
| **`UNREACHABLE_DIMS`** | **a list of dims** | **a list of strings naming nothing** |
| **`nonzero_rows_per_dim`** | **reachability** | **read as if it were effect** |

## Still open, with unblock criteria (Rule 74)

**34 rows still make no closeness claim.** Sampled prose now goes in every
manifest, so the next reader sees the words rather than the count.
- Unblocks on: someone reading `margin_census.silent_prose_sample` in a manifest
  dated after 2026-08-24T15:16Z.
- Reads as: recognisable closeness language → widen the regex again. Genuinely
  silent prose → the fix is the generation prompt, not this dimension.

**24 rows have a game row with a null `home_score`.** A data gap in
`regular_season_games`, not a scoring gap.
- Verify: `unknown_result_breakdown.n_joined_but_scoreless` in any run.
- Reads as: falling → the writer is being fixed. Flat → nothing is fixing it.

**Separation is UNDERPOWERED.** 16 agrees against 1 disagree. The dimension has
found one defect, and one is not a measurement.
- Unblocks on: `margin_census.separation.n_disagrees >= 2`, which the weekly
  cron (`0 6 * * 1`) will reach or fail to reach on its own.
- Reads as: a `gap` with a `ratio_to_noise` replacing the UNDERPOWERED verdict.

## Files

- `src/journalism-quality.js` — `marginAgreement`, `MARGIN_MAX`, widened
  vocabulary with three documented exclusions, `SLATE_CAPS` / `CAPPED_DIMS`,
  era 6's `measuredEffect`
- `src/index.js` — `slate_caps` + `capped_dims` on `/quality`,
  `matchup_note_status` retired
- `scripts/margin-agreement-check.mjs` — 23 assertions, 4 corpus-drawn
- `scripts/check-slate-caps-are-derived.mjs` — new deploy gate
- `scripts/rescore-quality-6b.mjs` — `margin_census`, `silent_prose_sample`,
  `unknown_result_breakdown`
- `.github/workflows/deploy.yml` — the caps gate
