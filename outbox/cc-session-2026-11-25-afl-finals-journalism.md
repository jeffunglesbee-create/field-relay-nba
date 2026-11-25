# Session doc — AFL finals, the journalism club match, round 0 and the year: built, and reviewed three times

**Date:** 2026-11-24 to 2026-11-25 · **Repo:** field-relay-nba · **Branch:** main · **CC-CMD:** `docs/CC-CMD-2026-11-24-afl-finals-round-and-journalism-club-match.md` (DONE for the change; the live finals read STAGED) and the one it filed, `docs/CC-CMD-2026-11-24-afl-squiggle-reads-and-the-round-label.md` (Items 1 and 5 built, Items 2, 3, 4, 6, 7 for the owner).
**Owner decision, verbatim:** "build the finals and journalism CC-CMD" (after "Build the AFL fix now", which built the CC-CMD's parent).

## Done condition (artifact)

The live proof is a dispatch, `.github/workflows/afl-finals-live-check.yml` (resolver against real ESPN and Squiggle from a runner, a pre-fix control, and the deployed relay): it runs twice, once before the deploy lands (the relay step must FAIL, documenting the old behaviour: 2026-09-05 Adelaide v Western Bulldogs served 47.29) and once after. The runs and their logs are recorded below in "Live runs" (appended by the commit that adds the logs).

The artifact that exists at this commit: the two checks and their harnesses, run on the final tree: `scripts/check-afl-round-discovery.mjs` 82 of 82, `scripts/check-afl-journalism-context.mjs` 48 of 48, `scripts/mutate-afl-round-discovery.mjs` 65 of 65 mutants caught, `scripts/mutate-afl-journalism-context.mjs` 68 of 68, `scripts/staged-verdicts-check.mjs` 142 passed.

## HEAD progression and what each commit was

| commit | what |
|---|---|
| `576918b0` | `sameAFLClub` (exact equality of `resolveAFLTeamKey`) moves into `src/identity-resolver.js`: the resolver's copy, and the one the journalism context was missing |
| `497fd391` | Parts A, B and D: both clubs of a row must be the game's (by AFL identity, so ESPN's "GWS GIANTS" is Squiggle's "Greater Western Sydney"); round 0 is a round; the year is the events' own season year (it was the constant 2026) |
| `9713a394` | Part C: a final's tip is the Aggregate row of its own two clubs on its Melbourne kickoff day (`src/afl-squiggle.js`, one team-season read); Kali not asked; used by the resolver and the journalism context |
| `a43a654e` | check 12 of `scripts/verify-staged-items.mjs`: `afl_finals_tip_in_season` |
| `279649f1` | `afl-finals-live-check.yml` + `scripts/afl-finals-live-check.mjs`, dispatch only, with the pre-fix control |
| `9f8b245c` | `;source=8` on the two round-based reads: 3,378 bytes for a round instead of 104,416 |
| `12bc1f67` | check 13: `afl_regular_tip_in_season` (Squiggle's 2027 numbering) |
| `96ba1c45` | the control finds the fix commit by its own subject, oldest first (a later commit quoting the subject would have become "the fix") |
| `7ec39e1b` | the verdicts: a served value that is not a number is FAIL, not PASS; the verifier reads Squiggle with the relay's own User-Agent |
| `67256e06` | the review's code and test findings: the slate's round, hconfidence validation, a timeout on the finals read, no false second warning, and the checks' blind spots (below) |
| `20c7faac` | the `journalism` section of `CONTRACTS.md` |
| `bf7bff8d` | ESPN's preseason games (season.type 1, week 1) get no tip instead of round 1's |
| `7f7cd26d` | checks 12 and 13 choose their game by Squiggle's `is_final`, not by ESPN's `season.type` |
| `33b8a9c7` | the two CC-CMDs and the Task 0 record |
| `ffdffeaa` | the live check's relay step also asserts a 2027 date is not served 2026's tip (live today: 71.48 against Squiggle's own 68.10 for 2027-03-18) |
| `89fbe1c5` | `scripts/staged-verifier-check.mjs` requires the executor to report the claimed verdict (deleting check 12's call left every gate green) |
| this commit | this doc and the HANDOFF close-out |

Rebased onto `origin/main` before the push (other sessions pushed 10 commits meanwhile); four commit messages were reworded before any push, to correct statements the review showed were wrong (the finals commit: the red counts on the previous commit were 8 and 10, not 7 and 6, and the edge-cache claim; the verdict commit: 28 assertions, not 26).

## What Task 0 measured (`outbox/afl-finals-task0-measurements-2026-11-24.md`)

20 of 20 finals events (11 in 2026, 9 in 2025) carry event-level `season.type` 3 and slug `post-season`; a regular event carries 2, and the league-level season in the same body stays 2. ESPN's week + 24 equals Squiggle's round in 2025 and 2026, but 24 is the last regular round and not a constant (Squiggle's season starts at round 1 from 2027), and the stage names differ by year, so neither is a key. ESPN's kickoff equals Squiggle's `unixtime` exactly. Measured on the deployed relay before the fix: the 2026-09-05 Adelaide v Western Bulldogs final was served 47.29 (March's round-2 tip, for the other club; its own is 68.60), the Grand Final null, GWS GIANTS v Geelong Cats null, the Opening Round games no `journalism` key. Task 0 also found the fourth defect: the year was a constant.

## What the review found that I had wrong (one run: five lenses, then a skeptic per finding; the third adversarial review of the AFL work today, after two on the round-discovery fix)

It reviewed `497fd391`, `9713a394` and the checks that guard them, from five angles (callers and the route, the Squiggle module, the checks as mutation targets, the staged verifier and the live workflow, and the premises the design rests on). Every finding below was closed or filed, and the checks that now fail without the fix are named. The skeptic verdicts for the should-fix findings were still arriving when the fixes were made; each fix was made on the finding's own evidence, which I re-ran where it was a claim about the repo (the red counts, the lookup, the late resolve, the real 2025 row).

1. **The checks could not see most of the module.** The module lens applied 35 hand mutants to `src/afl-squiggle.js`: 18 survived both checks; the checks lens applied about 95 over `src/index.js`, the module and the resolver and listed the survivors. Not pinned: 17 of 18 team ids, the abort signal reaching the request, the cache options, the headers, a thrown fetch, an ambiguous pair, a null row, a body with no `tips` array, a reversed row for a final, and every "said" warning. `67256e06` takes the journalism check from 24 to 47 assertions and its harness from 32 to 67 mutants, the resolver check from 78 to 81 and its harness from 57 to 62; the commit message of `9713a394` is corrected where it said "the team table" was mutated (one entry was).
2. **`undefined` equals `null` in my own comparisons.** `JSON.stringify` turns `undefined` in an array into `null`, so a final that LOST its `journalism` key passed an assertion that expected a served null. `sqOf` now returns a named value for a missing key.
3. **A fallback that brings the original defect back passed.** A final with no tip of its own could fall back to the round read at ESPN's week and no check failed, because the stub's round route had no rows for ESPN's finals weeks. The stub now serves March's rows there (the real Adelaide v Western Bulldogs 47.29 among them), and a mutant that reinstates the fallback is caught with the wrong value, not only a null.
4. **My verdict said PASS for a relay that served no number.** `Math.abs(Number(served) - expected) > 0.005` is false for NaN. Fixed, 28 new assertions (14 per verdict), 12 red on the old verdict.
5. **hconfidence `null` is 0.** `Number(null)` served certainty for one club. Validated in one place (`squiggleHomePct`) and used by both paths.
6. **A premise refuted: ESPN also serves PRESEASON games** (season.type 1, week 1, late February). Both callers read their week 1 as Squiggle's round 1; the resolver returned 0.298 for Richmond's preseason game, which is 100 - 70.18 of Carlton v Richmond, a March game. `bf7bff8d`.
7. **A premise the staged check shared with the code.** Check 12 chose its final by ESPN's `season.type` 3, the field the relay uses, so if the first 2027 final is typed 2 the relay is wrong and the check reads PENDING all season. It now chooses by Squiggle's `is_final` and the relay is the thing compared; a dry-run with ESPN typing the finals as regular and the relay serving March's tip is FAIL (it was PENDING). Whether ESPN types by calendar window is a hypothesis from two college football reads, not a measurement for AFL.
8. **A claim I made without a measurement: "edge-cached an hour".** `api.squiggle.com.au` is another Cloudflare customer's zone and Cloudflare's docs say a Worker cannot override its cache policy. Removed from the comments and the commit message; the cf options are asserted as sent, and the effect is Item 7 of the third CC-CMD, unmeasured.
9. **A control that could find the wrong commit.** `git log -n1 --grep` takes the newest commit quoting the subject. Now the oldest by subject line, proved on a scratch history.
10. **The slate's round was the first game's**, so a weekless first game ended the context for every game after it. It is the first game that has one.
11. **Coverage lines that said finals were not covered** while asserting them (Rule 91), and a synthetic 2025 row that Squiggle's real row (GWS v Hawthorn, 51.74) replaces.
12. **The Squiggle contract in the CC-CMD said an untagged "STAGED until"**, which the staged-claim gate never saw; now tagged with `afl_finals_tip_in_season`. And the gate itself resolved a claim's id against the registry but never asked whether the executor reports it: deleting check 12's call and lowering `EXPECTED_CHECKS` left every gate green. It now does (`89fbe1c5`; with the call deleted the gate exits 1).

## Gates

- **Local sweep of every `run:` step of `deploy.yml` (to the deploy step) and `guards.yml`, on the final rebased tree, from a checkout directory named `field-relay-nba`** (one gate demands that name): every runnable `run:` step of `deploy.yml` (to the deploy step: 127 passed, 5 need Cloudflare credentials) and of `guards.yml` (61 passed, 1 skipped), on the final tree from a clean worktree. Three failures in `guards.yml`, none from this change: step 45 (the BSD frame checks, HTTP 0: no egress), step 54 (needs `RELAY_SHARED_SECRET`), and step 60 ("HANDOFF close-outs name a session doc": 7 without against a budget of 6, which `origin/main` already fails before this push: the 2026-11-24 23:50Z BSD close-out names its session doc in prose, not in the `**Session doc:**` form the gate reads; another session's entry, not touched). The first full sweep found the one real failure of mine, the absence-collapse ratchet (the text of mutant B21 contained `|| []`); fixed in its commit and re-run green. Also run by hand: `staged-verifier-check.mjs` (and its self-test, and with check 12's call deleted: exit 1), `cc-cmd-status-check.mjs`, `check-doc-citations.mjs` (bare 9 of budget 9), `check-handoff-current.mjs`, `check-handoff-claims.mjs`, `check-commit-skip-prose.mjs`.
- Sandbox-only failures, not regressions: the BSD frame checks (HTTP 0, no egress), the steps that need `RELAY_SHARED_SECRET`, the three Cloudflare-bootstrap steps, and the two gates that read production secrets.

## Integration state (Rule 65)

- **Relay contract:** `GET /v2/games?sport=afl&date=YYYY-MM-DD` carries `journalism: { kali, squiggle }` per game (when `KALI_AFL_TOKEN` is set); `squiggle` is `{ homeConfidence: string, awayConfidence: number }` for THIS game; documented in `CONTRACTS.md`. `resolveWinProbability('AFL', ...)` returns `{ probability, source: 'squiggle' | 'kali', label }` or null.
- **Client consumer:** none reads a value (jubilant-bassoon's one reader is an optional-chained spec; field-laboratory reads none). Nothing to sync.
- **INTEGRATION STATUS: STAGED** for the live finals read and the 2027 numbering: verifier `afl_finals_tip_in_season` and `afl_regular_tip_in_season` @ `staged-verification.yml` (daily 06:00 UTC), PENDING until AFL has a game in the window. VERIFIED for past dates, from a runner, against real ESPN and Squiggle (the dispatch above).
- **Known mismatches:** `game.round` is a number on the AFL board (CONTRACTS.md says a string), `homeConfidence` a string and `awayConfidence` a number: Items 2 and 3, for the owner.

## Residual (genuine, not deferred work; each has a CC-CMD item)

Five items wait on the owner (Items 2, 3, 4, 6, 7 of `docs/CC-CMD-2026-11-24-afl-squiggle-reads-and-the-round-label.md`): the types of `journalism.squiggle`, `game.round` as a number, a contact address in the Squiggle User-Agent (Squiggle's changelog says non-compliant clients may be blocked at the edge: not blocked today), the window a pick resolves in (reproduced: Adelaide's 2026-09-05 final resolved four days later answers the semi-final, 0.307 for 0.686), and whether the Squiggle cache options do anything on its zone.

