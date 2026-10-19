# Claude Code Command — a CFB game priced from another game, and a pair priced backwards

**Date:** 2026-10-19
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** CC, while recording the CFB done condition of
`outbox/cc-session-2026-09-16d-odds-attribution-and-watches.md` §7.6 (Rule
87.4). That record found the production pairing exercised on 19 CFB dates,
and found these two defects in it. Both are live in D1 today.

---

## What was measured (2026-10-19)

Methods: D1 SELECTs on field-archive (`cc49101c`, 0 rows written); a local run
of `src/odds-name-match.js` at HEAD; odds-backfill job logs read through the
GitHub MCP `get_job_logs` tool. Conditions: completed slates.

**1. A game priced from another game.** Row `CFB_2026-09-19_e401856686`:
- **Archive side:** Georgia @ Arkansas, `start_time 2026-09-19T16:00Z`,
  `finalized_at 2026-09-19 19:30:39`.
- **Its `opening_odds`:**
  `{"source":"draftkings","captured_at":"2026-09-19T23:55:18Z","moneyline":{"home":311,"away":-435},…,"_kickoff":{"at":"2026-09-19T16:00Z","verified":false,"late_minutes":475}}`.
- **Its `odds_history` row:** `home_team Jacksonville State Gamecocks`,
  `away_team Georgia Southern Eagles`, `commence_time 2026-09-19T23:02:23Z`,
  draftkings, created `2026-09-20 14:00:43`. That is a different game.
- **The real row for that event,** `CFB_2026-09-19_e401869948` (GA Southern @
  Jax State, 23:00Z), has `opening_odds` NULL.

Reproduced with the real module on a reduced slate: the two archive rows
involved and the one vendor event involved. The full slate had 44 events, 40
in pool. The log is `outbox/cfb-wrong-pair-repro-2026-10-19.log`:

```
nameMatches(Georgia, Georgia Southern Eagles) = true
nameMatches(GA Southern, Georgia Southern Eagles) = false
nameMatches(Jax State, Jacksonville State Gamecocks) = false
nameMatches(Arkansas, Jacksonville State Gamecocks) = false
stage1 0 stage2 1 unmatched 1 ambiguous 0 pool 1
PAIR CFB_2026-09-19_e401856686 -> Georgia Southern Eagles @ Jacksonville State Gamecocks stage 2 swapped false
```

**The mechanism:**
- Stage 2 of `matchSlate` pairs by elimination on ONE side. Arkansas matches
  nothing, and nothing checks the other side, or the 7-hour kickoff gap.
- `scripts/check-odds-matcher.mjs:121` records `'Georgia'` →
  `'Georgia Southern Eagles'` as `true` with the note `PREFIX IS PERMISSIVE:
  pair + ambiguity guard carries this, not the predicate`. At stage 2 no
  pair guard carries it.
- The backfill's single `T23:59:00Z` historical snapshot
  (`.github/scripts/odds-backfill.js:192`) no longer lists Georgia @
  Arkansas, which finished at 19:30Z. So the game's own event was absent
  while its namesake's was unclaimed. GA Southern and Jax State match nothing
  at stage 1 (abbreviations).

**2. A pair priced backwards.** Row `CFB_2026-09-19_e401856802`:
- **Archive side:** `home Virginia`, `away West Virginia`.
- **Its `opening_odds` moneyline:** home **870**, away **−1667**.
- **Its `odds_history` row:** `home_team West Virginia Mountaineers home_ml
  9.7`, `away_team Virginia Cavaliers away_ml 1.06`.
- **So:** the archive's Virginia carries +870, which is West Virginia's price.
  The vendor priced Virginia at 1.06, about −1667. The two teams' prices are
  exchanged.
- **The backfill logged it:** `[odds-backfill] 2026-09-19
  americanfootball_ncaaf: reversed orientation for West Virginia @ Virginia
  -> stored as Virginia Cavaliers @ West Virginia Mountaineers`.
- **The cause:** `buildOddsRow` keys `home_ml` off the vendor's home team
  (`odds-backfill.js:342`, "so a swapped pairing stays internally consistent"). But
  `syncOddsToGameTables` writes `home: decimalToAmerican(row.home_ml)`
  (`:517`) into the archive row by position, not by team.

**The corpus this needed was never built.** CC-CMD-2026-09-11 Task 1 asked
for a collision corpus of every school name that is a token-prefix of
another (`Virginia` / `West Virginia`, `Miami` / `Miami OH`, `Washington` /
`Washington State`), written before the code, and its required shape is
"Match on the PAIR, never a single team". Neither landed:
- `scripts/check-odds-matcher.mjs` has 0 Virginia or Washington cases.
- `nameMatches('Virginia', 'West Virginia Mountaineers')` is `true` at HEAD.
- Stage 2 filters on `nameMatches(home) OR nameMatches(away)`, which is one
  side.

**Scope measured:** CFB only, 2026-09-17 to 10-17, 19 slate dates.
- **Checked:** 150 of 164 production pairs (the ones that wrote an
  `odds_history` row), by team-name tokens and kickoff gap. 1 is wrong, and 1
  is the orientation case.
- **Unexplained:** two name-consistent pairs have kickoff gaps no one has
  explained: Charlotte @ App State at −90 min and Iowa State @ BYU at
  −15 min.
- **Not checked:** other sports, the 14 pairs with no h2h row, and the
  ambiguous decisions, which are logged only as counts.

## TASK 0 — premises, one command each (Rule 100)

1. **How many wrong pairs exist.**
   - Over every sport's `odds_history` rows created since `014b82ad`
     (2026-09-16 10:42Z, the matcher's first commit), list each pair whose
     `|commence_time − start_time|` exceeds 90 minutes.
   - For each one, run `nameMatches` both ways on both sides; a side that
     matches neither way is a candidate wrong pair.
   - Print the denominator with the result (Rule 91).
2. **How many swapped pairs were synced backwards.** Collect every `reversed
   orientation` line in the odds-backfill job logs since 2026-09-16 (through
   `get_job_logs`). Compare each synced row's moneyline signs with its
   `odds_history` row.
3. **Whether stage 2 is the only path.** Reproduce each wrong pair from task
   0.1 with `matchSlate` on its own slate, as above, before any fix.

## TASK 1 — stage 2 may not pair against a contradicting side

Choose the rule after TASK 0 measures the stage-2 pairs. Candidates:
- **Pair evidence on both sides.** The side that did not match must not
  contradict, for example by sharing no leading token with the vendor's
  team while matching a DIFFERENT archive row's team.
- **Kickoff proximity, `|commence_time − start_time| <= N`.** This REVERSES a
  standing ruling in the header of `src/odds-name-match.js`: "THE KICKOFF
  INSTANT IS NOT A KEY … Filtering on the instant would have discarded five
  correct pairings … never as a filter". Correct production pairs reach −90
  min (Charlotte @ App State). The owner rules before this option is used,
  and N comes from TASK 0's measured distribution, not from this document.

Fixtures and checks:
- The fixture is the real 2026-09-19 pair above, which must refuse.
- The collision corpus CC-CMD-2026-09-11 Task 1 asked for gains the
  `Georgia` / `Georgia Southern` and `Virginia` / `West Virginia` pairs.
- Rule 90: delete the new condition, and the fixture must pair again.
- Every existing case in `scripts/check-odds-matcher.mjs` stays as it is.

## TASK 2 — the sync maps prices by team, not by position

`syncOddsToGameTables` must give each archive team the price `odds_history`
holds for that team.
- The fixture is the real `e401856802` rows.
- Rule 90: swap back to positional, and the fixture goes red.

## TASK 3 — repair the rows TASK 0 finds (OWNER DECISION FIRST)

At least `CFB_2026-09-19_e401856686` (opening and closing from another game)
and `CFB_2026-09-19_e401856802` (prices exchanged).

Options for the owner:
- (a) set the wrong blobs to NULL, with a `change_log` row naming this
  document;
- (b) re-derive from `odds_history` by team, for the swapped rows only.

Nothing is written before the owner rules.

## Done condition (Rule 89 artifacts)

1. TASK 0's census is committed, with its denominator.
2. TASKs 1 and 2 each have a fixture that is red before the fix and green
   after, plus their mutations, in a committed log.
3. After TASK 3, a D1 SELECT on each repaired id shows the owner's chosen
   state. Committed.
4. One green deploy-path run on the final commit.

## FORBIDDEN

- No D1 write before the owner rules on TASK 3.
- No Odds API spend.
- No loosening of any existing matcher case.
