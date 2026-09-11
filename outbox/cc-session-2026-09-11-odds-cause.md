# CC session 2026-09-11 — running probe-odds-api on a runner

Rule 67 session doc.

## Ask

"run probe-odds-api on a runner."

## HEAD progression

- `36c4268` ci: run probe-odds-api on a runner, scoped to a dispatch-time date
- `0c460e1` ci: probe whether CFB/NFL/Bundesliga zero odds is the vendor or the join
- this commit: second CC-CMD + manifest

## What ran

| run | workflow | artifact |
|---|---|---|
| 34642392250 | probe-odds-api.yml | outbox/odds-api-probe-20260911T200607Z.json |
| 34642581862 | probe-odds-api.yml (+ join step) | outbox/odds-join-probe-20260911T200950Z.json |

## Two changes made before running, and why

`scripts/probe-odds-api.mjs` was pinned to `date = '2026-08-21'` in three
queries, with a vendor-key list holding only the five competitions the August
question concerned. Run verbatim today it answers the August question.

- `PROBE_DATE` (env, default `'2026-08-21'`) replaces the three literals as a
  bound parameter. Unset reproduces the original measurement exactly; malformed
  exits 1 before any network call.
- The H1 `SELECT` now returns the row's own `date`, so the parameter taking
  effect is provable from the artifact rather than inferred from the manifest
  echoing back what it was handed.

## Findings

**`key_present: false`.** `ODDS_API_KEY` is not a repository secret here, so
run 1 could not read the vendor. Routed around rather than reported as a
blocker: `GET /identity/mismatches` uses the relay's own `ODDS_API_KEY`
binding, so the vendor question is answerable with no secret in CI.

**Three hypotheses dead** — mapping, H1 timing, H2 quota short-circuit. The
evidence is in the CC-CMD; the discriminator for H2 is that its `return`
produces partial coverage, and CFB/NFL/Bundesliga are exact zeros across a
season while MLS is partial.

**Cause: the identity join.** All five of today's CFB games are present on both
sides and none matched. `resolveTeamKey` yields `louisville` where the vendor
yields `louisvillecardinals`. Bundesliga's row matches on the home side exactly
and diverges only on the away side (`schalke` vs `fcschalke04`), which rules
out a format difference.

**Task 0.4 answered: yes.** `soccer_usa_mls` returns markets — 15 events today.

## Corrections to earlier claims in this session

- I reported that MLS receives no odds. It receives 31% (180 of 586). The
  zero-forever set is CFB, NFL, Bundesliga.
- My join probe's first draft read `matched` as an array. It is a count
  (`src/index.js:14939`). Caught by reading the route, not by the probe passing.
- The MLS control did not fire: today's `d1_missing` was 0 for both MLS and
  NFL, so neither could confirm or refute the instrument. CFB carries the
  finding alone — defensible only because its five D1 rows appear verbatim in
  the vendor's own sample, so both sides are demonstrably present.

## Mutations run (Rule 90)

`classify()` in `scripts/probe-odds-join.mjs`, self-tested on 7 fixtures each
invocation. Three mutations, three caught:

| mutation | caught as |
|---|---|
| remove the `C2_JOIN` branch | wanted C2_JOIN, got COVERED |
| loosen the shape check to `un === null` only | wanted SHAPE_UNEXPECTED, got COVERED with `null matched` |
| remove the vendor-zero-events branch | wanted C1_VENDOR, got C2_JOIN |

The third matters most: without it a vendor serving nothing reads as a join
defect, and the fix goes to the alias map instead of the sport list.

## Carry-forward

None deferred without a second CC-CMD.
`docs/CC-CMD-2026-09-11-odds-identity-join-cfb.md` carries the fix, with the
false-positive hazard (`virginia` vs `westvirginia`) as its governing gate.

## Residual for the user, not carry-forwards

- `ODDS_API_KEY` is not a secret in field-relay-nba. Adding it would let
  `probe-odds-api.mjs` read quota and vendor `active` flags directly; not
  required for the fix.
- `ucl` / `europa` / `conference` absent from `ARCHIVE_SPORT_TO_ODDS_KEY` —
  real gap, separate cause, not addressed here.
