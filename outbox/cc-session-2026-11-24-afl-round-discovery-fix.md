# Session doc — AFL round discovery no longer sends a date range, and the club match it exposed

**Date:** 2026-11-24 · **Repo:** field-relay-nba · **Branch:** main · **CC-CMD:** `docs/CC-CMD-2026-11-24-afl-round-discovery-sends-a-date-range.md` (DONE for the change; live in-season read STAGED) and the one it filed, `docs/CC-CMD-2026-11-24-afl-finals-round-and-journalism-club-match.md` (FILED)
**Owner decision, verbatim:** "Build the AFL fix now" (after "Check on espn 400s", which produced the CC-CMD).

## Done condition (artifact)

Actions run **45489913728** (`afl-round-discovery, real ESPN (dispatch only)`, head `b3dbdf81`, 2026-11-24 21:19Z), log `outbox/afl-round-live-check-2026-11-24T2119.log`:

```
ESPN reads recorded: 40, every one HTTP 200 (dates=20260709 -> r18 Fremantle v Sydney Swans; dates=20260711 -> r18 GWS GIANTS v Geelong Cats;
  dates=20260705 -> r17 Port Adelaide v North Melbourne)
Squiggle asked for: [[2026,18],[2026,18],[2026,18],[2026,17]]
answers: Fremantle Dockers -> 0.6   Sydney Swans -> 0.4   GWS GIANTS -> 0.4   Port Adelaide -> 0.7   (source squiggle)
INFO  a date RANGE (dates=20260705-20260714) is answered HTTP 400: {"code":400,"message":"Failed to get events endpoint."}
8 of 8 passed.
```

The control in the same run (`outbox/afl-round-live-check-control-2026-11-24T2119.log`, pre-fix source `7ec2d03f`, same real ESPN): four range reads, all HTTP 400, four nulls, `0 of 8 passed`, "control failed by assertion, as it must". **Met**, for past dates under a pinned clock. **Not met, STAGED** (verifier: `afl_round_in_season`, `relay/staged-verification.yml`, daily 06:00 UTC): an in-season round read live. AFL has no fixtures until 2027; the verifier reads the ten days through the relay's `/v2/games` adapter (an independent path), calls `_discoverAFLRound` for the earliest game's home club and says PASS only if the rounds agree; PENDING off-season. Dry-run of that executor against a real slate with the clock pinned: PASS working, FAIL with ESPN refusing, PENDING with no games; `staged-verdicts-check` 106 passed, `staged-verifier-check` resolves the tag.

## HEAD progression and what each commit was

| commit | what |
|---|---|
| `109d2ed2` | `_discoverAFLRound`: one range request → ten one-day reads (-3d..+6d UTC, parallel, not cached, each failure warned by status and day, a loud warning when none answered); `scripts/check-afl-round-discovery.mjs` + `scripts/mutate-afl-round-discovery.mjs`; wired into `deploy.yml` and `guards.yml` |
| `ac187a0b` | `week.number` 0 (ESPN's Opening Round; Squiggle `round=0` has an Aggregate source) is a round |
| `2da46894` | AFL clubs matched by `resolveAFLTeamKey` equality, not the 5-character prefix rule, in the round search and the tip search |
| `11670e9d` | `afl-round-live-check.yml` + `scripts/afl-round-live-check.mjs`, dispatch only, with the pre-fix control |
| `b3dbdf81` | the second review's findings: check 57 → 69 assertions, harness 33 → 49 mutants, one real ESPN body recorded and replayed, wording |
| `ac52af50` | CI: the live run's two logs (the workflow's own commit) |
| `630ea6aa` | `afl_round_in_season`: check 11 of `verify-staged-items.mjs` (the daily `staged-verification.yml`), the executor for the one STAGED item; `_discoverAFLRound` and the two window constants are exported for it. The deploy gate "a staged claim names a verifier that exists and runs" refused the CC-CMD's STAGED line without it |

The five were rebased twice onto `origin/main` (other sessions pushed 25 files, then one bot commit) and the message of `2da46894` was reworded once, before any push, to remove two statements the review showed were inaccurate. **Deploys and guards, all green:** Deploy RELAY Worker run **45489859700** (head `b3dbdf81`, the five code commits) success 21:28:08Z, Repo guards run **45489859672** success 21:29:33Z; Deploy run **45494566975** (head `218fd636`, the staged verifier and the docs) success 21:56:08Z, Repo guards run **45494566890** success 21:57:47Z. **The verifier's first run** (`staged-verification.yml`, dispatched, run **45496124303**, manifest `outbox/staged-verification-20261124T215658Z.json`): 11 checks, none failed, `afl_round_in_season: PENDING` with `coverage: read 10 day(s) of /v2/games?sport=afl, 0 game(s) carrying a round; one club checked` (off-season, as designed: it runs, reads the real relay, and says why it has nothing to prove).

## What the reviews found that I had wrong

Two rounds, seven lenses, 25 agents, a skeptic per finding; every non-note finding was confirmed.

1. **My own cache entry.** The resolver's reads had `cf: { cacheTtl: 300, cacheEverything: true }` on the URL `/v2/games` reads at 15 s: an entry written by a resolver miss would serve the client's AFL poll a stale live scoreboard for five minutes. Reproduced against the real `handleV2Games`. Removed.
2. **The fix un-hid a second defect.** With the round found, `teamNameMatch`'s prefix rule resolved a Melbourne pick through North Melbourne's game (and returned North Melbourne's probability under `source: 'squiggle'`), a Port Adelaide pick through Adelaide's tip, a Western Bulldogs pick through Greater Western Sydney's, and a GWS pick (`GWS GIANTS` at ESPN) to nothing. Shipping the range fix alone would have turned a silent null into a confident wrong number for four clubs. Fixed with the existing AFL identity (commit 3).
3. **Round 0** dropped by `if (!round)`; **shape faults** (a 200 whose body is not a scoreboard) ended the scan silently; comments claimed things with no measurement behind them ("confirmed live" misattributed, a latency figure, "never a prefix").
4. **The check itself.** Its first harness run reported 7 harness errors: the check read `.probability` of a null and crashed instead of failing by assertion (Rule 77: fixed, then every mutant re-run). Round 2 then found, by running its own mutants, that the check could not tell Western Bulldogs from West Coast (same expected number), could not see the Aggregate-source filter (the decoy row sat behind the real one), the empty-key guard, a 3-character key, a window anchored in another zone, a constant year, or "earliest" from "nearest to today". All pinned now; each has a mutant that goes red.

## Gates

- **Local sweep of every `run:` step of `deploy.yml` (to the deploy step) and `guards.yml`, on the final rebased tree:** deploy 128 of 129 runnable green, the 129th (step 10, "the push cron's live-game half stays absent") red once with `src/.mutant-F1-*.js` files named in its own output: leftovers of the previous sweep's mutation harness, which I had killed mid-step to rebase. Re-run alone in an isolated worktree of the pushed head: `19 of 19 passed`, `PASS`. Three KV-bootstrap steps need a Cloudflare token and were not run. Guards 62 of 64: step 44 (BSD frames, `HTTP 0` through this sandbox's proxy) and step 53 (`RELAY_SHARED_SECRET` unset here; its self-test passed) fail in the sandbox only; `Repo guards` on `origin/main` before this push was green in CI.
- **Process change kept from earlier today:** run the whole step list from a YAML parse before pushing, on a clean committed tree, and never kill a sweep mid-step.

## Integration state (Rule 65)

- **Relay contract:** `resolveWinProbability('AFL', { gameId, predictedWinner }, env)` returns `{ probability, source: 'squiggle' | 'kali', label }` or `null`; it reads ESPN `scoreboard?dates=YYYYMMDD` ten times and Squiggle `?q=tips;year=Y;round=R`. Its one caller is `pick_resolved` in `src/user-do.js`. No response shape changed. **Client consumer:** none changed. **Status: VERIFIED** (live proof above) for round discovery and the club match on past dates; **STAGED** for an in-season read, Kali (offline until 2027) and finals. **Known mismatch:** ESPN's finals week (1–5) vs Squiggle's finals rounds (25+), and `buildAFLJournalismContext` (`src/index.js`) with the same prefix-match defect: both in the second CC-CMD.

## Residual (genuine, not deferred work)

Nothing is deferred without a CC-CMD. `scripts/verify-mls-sub-impact.mjs` (one-shot CI probe, sends a range) is left alone (Rule 69). The owner decides whether the second CC-CMD is built now (it is unblocked: every part can be measured on the finished 2026 season).
