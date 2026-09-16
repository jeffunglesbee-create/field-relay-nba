# CC session — one team-name matcher, and the one that shipped scored 0 of 80

Date: 2026-09-16
Repo: field-relay-nba, `main`
HEAD progression: `14b17e6` → `a4efbc4` → `29f2f6a` → (rebased) `014b82a`

## What started this

Yesterday's CFB probe returned 95 vendor events and matched **0 of 80** archive
games. A fixture of both sides was captured so a matcher could be developed
offline instead of at 20 credits per attempt.

## The 22, enumerated

The first ask was the 22 rows a prefix matcher could not reach. Classified
against the fixture, free:

| cause | n |
|---|---|
| name abbreviation, kickoff instant agrees | 16 |
| names fine, kickoff instant disagrees | 5 |
| both | 1 |

Three of those were first reported as "no counterpart in the payload at all".
That was the **diagnostic's** limit, not an absence: `FAU` and `FIU` carry a `U`
(University) absent from the vendor string and `Jax` an `x`, so the
subsequence test used to classify them could not reach their real counterparts,
which sit at the same kickoff instant. Corrected before it went anywhere.

## Rule 42: the instant was the obvious key, and measuring it removed it

`commence_time == start_time` was identical to the second on the first pair
read, and the prior session's commit message called it "a far stronger join key
than any string heuristic". Across all 80 it is not:

```
whole-string equality (what shipped)     0 solved   0 ambiguous  80 none
whole-string prefix + instant           58          0            22
token prefix + instant                  68          0            12
token prefix, NO instant                72          0             8
  + apostrophes stripped                73          0             7
```

Dropping the instant **gains** five games. The five it was discarding are real
pairings whose two systems disagree on kickoff by −90 to +1 minutes:

| pair | delta |
|---|---:|
| Oregon @ Oklahoma St | −90 min |
| Southern Miss @ Auburn | −65 min |
| Arkansas @ Utah | −15 min |
| Prairie View @ Baylor | −8 min |
| New Mexico St @ Hawai'i | +1 min |

It is now an **independent cross-check**: the names chose 73 pairings and the
kickoff instant agrees on 68 of them, with the 5 disagreements named in the
check. Uniqueness and kickoff agreeing by separate routes is stronger evidence
that the pairings are correct than either alone — and stronger than the filter
it replaced.

## The predicate

Positional token prefix. Split on whitespace; every archive token must prefix
the vendor token at the same index; extra trailing vendor tokens are the mascot.

```
["western","ky"]   vs ["western","kentucky","hilltoppers"]   -> ky is NOT
["n","colorado"]   vs ["northern","colorado","bears"]        -> match
["illinois","st"]  vs ["illinois","state","redbirds"]        -> match
```

Whole-string prefix cannot do the middle two: `ncolorado` is not a prefix of
`northerncoloradobears`. Per-token is, and it is one line.

I read `Western KY` as a prefix of `Western Kentucky Hilltoppers` while writing
this up, and checked before reporting it. It is not — the 9th character is `y`
against `e`. The matcher was right and the reading was wrong (Rule 100's
corollary: the belief cost nothing, publishing it would have).

## Residue: 7, and they are initialisms

`ETSU`, `MTSU`, `FAU`, `FIU`, `Jax State`, `Western KY`, `GA Southern`.

An alias table for these is a map of **disagreements between the two systems**,
not a school list — the vendor itself writes `UConn`, `UCF`, `UTSA`, `SMU`,
`BYU`, so those cost nothing. The 7 are named in `check-odds-matcher.mjs`, so a
change that raises the solved count by matching the wrong thing still fails.

**STAGED.** Blocks: nothing technical; it is unbudgeted work. Unblocked by: a
decision to build the alias table, or to add `espn_event_id` to the vendor side
(which the vendor does not carry, so the alias table is the realistic route).
Verify when built: `node scripts/check-odds-matcher.mjs` must report solved 80,
unmatched 0, and the `EXPECT_UNMATCHED` list must be emptied in the same diff.

## A second defect, found by reading rather than by the fixture

`targeted-odds-fill.mjs:150` looked up outcome prices by comparing the VENDOR's
outcome names to the ARCHIVE's team names with equality. A matched event would
have inserted a row with `home_ml` and `away_ml` empty. It was invisible while
the matcher above found nothing, and the script has never run with `--apply`.

`buildOddsRow` at `.github/scripts/odds-backfill.js:231` already did this
correctly. `h2hPrices()` is now shared by both, so the two writers into
`odds_history` cannot drift again. `normTeam` is deleted; nothing called it.

## Rule 90 — 14 of 14, and the three misses were all in the apparatus

First run: 5 caught, 1 NOT CAUGHT, 2 anchors matched nothing.

| miss | what it actually was |
|---|---|
| M7 token-count refusal | the check had no case where the archive name has MORE tokens than the vendor's, so nothing could reach the guard |
| M4 apostrophe strip | the anchor could not match: a heredoc had turned `’` into a literal `’` in the source |
| M8 lowercasing | same cause |

The Unicode one is worth keeping: the module worked correctly with literal
combining marks and a literal right-quote in its regexes — the existing repo
code has the same shape — but they are invisible in source. The mutation harness
is what surfaced it.

Mutations now span the predicate (8), the price reader (3) and both call
sites (3). The call-site mutations run against `check-odds-matcher-wiring.mjs`,
which is the check that would have caught the fourth sport-key registry.

Two synthetic corpora exist because the fixture has **zero** ambiguous pairs and
**zero** orientation swaps — a mutation deleting either guard would have
survived corpus A. A mutation that cannot be caught means the check is missing a
case, not that the guard is safe.

## guards.yml has been RED on main since 2026-09-15

Runs 306–311 all `failure`. I pushed over every one of them this session and
read the commits as landed. Two independent causes:

1. **Mine.** Five scripts added on 09-15/16 hard-coded `RELAY_SHARED_SECRET` in
   their `X-FIELD-Relay` header, taking the scanner from its declared 115 to
   120. `docs/exposed-secrets.sha256` already prescribed the fix — read
   `process.env.RELAY_SHARED_SECRET` with **no default**, because a default
   makes an unset secret indistinguishable from a set one until the relay 401s.
   Raising the declared number would have been the quick route and the wrong
   one: the ratchet exists so that a new hard-coded use fails the build, and I
   was the new hard-coded use. Back to PASS at 115.
2. **This document was stale**, by 5 commits over the 1-day bar.

Both cleared in this session. Run 312 confirmed cause 1 fixed (step 3 green) and
cause 2 still red; the matcher gate was **skipped** behind it and has therefore
not yet run in CI.

## Verified vs staged

- **VERIFIED (offline).** 15 fixture assertions + 13 synthetic cases, 14/14
  mutations. Corpus: `outbox/fixture-cfb-2026-09-12.json`, 80 archive rows vs 95
  vendor events.
- **VERIFIED (structural).** Both call sites import the shared module and route
  prices through `h2hPrices`; four banned shapes absent from each.
- **NOT VERIFIED LIVE.** No vendor call was made for any of this. The cron has
  not run with the new matcher. `odds-backfill.yml`'s next scheduled run is the
  first production evidence, and it remains blocked by the empty `ODDS_API_KEY`
  recorded at the top of HANDOFF.md unless that has since been set.
- **Coverage stated where it is read.** Every script prints its own denominator.
  Zero ambiguity is a property of a 95-event payload; a larger one has more
  collision room. No sport other than CFB has been measured at all.

## Part two — the initialisms, resolved by not reading them

The 7 above were filed as STAGED needing an alias table. They did not need one.

**The reframe.** Every route considered — prefix, token prefix, an alias table,
expanding `ETSU` through `espn_event_id` at ESPN — assumed the question was
*what does ETSU stand for*. It is not. The archive slate and the vendor slate
are the SAME 80 GAMES. A vendor event belongs to at most one archive row, so
once the 73 unambiguous pairs are made those events are spent, and each of the
7 remaining rows still matches uniquely on the side that is **not** abbreviated.
`ETSU @ North Carolina` has exactly one unclaimed opponent at North Carolina.

This is not a fallback, which this repo bans. A fallback guesses when the
primary fails; this adds a fact about the domain — one event, at most one game.

**The second half was sitting in data already read.** The historical endpoint
returns FUTURE fixtures. 15 of the 95 events kick off between 09-17 and 09-20.
They were never candidates, and their only effect was to manufacture ambiguity:
`GA Southern @ Clemson` had two Clemson opponents to choose between and the
rival was 09-19. The window is the date AND the next day, because 10 of the 80
real events kick off after midnight UTC.

```
vendor payload 95 -> in-window pool 80   (15 dropped)
stage 1 (both sides, unique)   73
stage 2 (one side + elim)       7
unmatched 0, ambiguous 0        80 of 80
```

Six of the seven land at kickoff delta 0. A forced pairing rests on ONE side's
name, so the kickoff agreeing independently is what makes it credible — the
cross-check earns more here than it did in part one.

**Degradation is tested, not asserted.** All committed as assertions:

| property | result |
|---|---|
| the 7 forced pairings claim 7 distinct events | 7 of 7 |
| each archive row dropped in turn — another row steals its event | 0 of 80 |
| each forced event removed — its row takes a substitute | 0 of 7 |
| a row with two candidates | refused |
| two rows wanting one event | both refused, not ordered |

**Rule 90, again in the apparatus.** 23 of 23, after two misses that were both
holes in the checks rather than the module:

- **M17** (take the first candidate instead of requiring exactly one) was
  *unreachable*: after windowing, every residual row in the fixture has exactly
  one candidate, so the two implementations are indistinguishable on this
  corpus. Closed with a synthetic `Ohio Bobcats` / `Ohio State Buckeyes`
  collision — a real CFB case that would have shipped unguarded.
- **M13** (the cron pairs nothing) survived because the wiring check asserted
  the IMPORT and not the CALL. A call site can carry the import and pair
  nothing. It now asserts both.

## The automated follow-up

`odds-pairing-rate-watch.yml`, daily at 11:00 UTC, one hour after the backfill's
own cron so the progress row exists before it is read.

It is aimed at **why the 0-of-80 lasted months**, not at the matcher that caused
it. Nothing could see it: the cron was not dead, so `silently-dead-crons.yml`
had nothing to report; it spent credits, so the budget checks were satisfied; it
wrote `games_processed 0` and went green.

The signature is durable and unambiguous — `credits_used > 0 AND
games_processed = 0`, in `odds_backfill_progress`. Paid for a payload, paired
nothing out of it. A date with no mappable games spends nothing; a date whose
vendor holds no data is counted separately so the two cannot be conflated.

An **empty result is a failure**, not a pass: no progress row in the window
means the cron has not recorded a run, and treating that as clean would rebuild
the absence collapse inside the watcher built to catch it.

`--self-test` exercises the predicate against 6 enumerated rows with no network,
so the gate runs in CI where D1 is unreachable. M22 is the mutation worth
naming: **D1 returns `'0'` as a string**, so a predicate written
`r.games_processed === 0` never fires and the watcher passes forever — a check
that cannot fail, which is the exact failure mode it exists to detect.

Coverage, in its own output: `odds_backfill_progress` is keyed by DATE, so a
date mixing a paired sport with an unpaired one reads as paired. It catches
total failure per date, not per sport.

## No push affordance was added

A matcher, two checks, a mutation harness and two CI gates. No app code, no
route, no value pushed to a user (ADR-002 Rule A). The one live-write path
(`targeted-odds-fill.mjs`) still requires `--apply` and still has not been run.
