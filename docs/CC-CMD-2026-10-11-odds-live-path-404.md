# Claude Code Command — repoint `/odds-live` or delete it, and either way it is a budget decision

**Date:** 2026-10-11
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** D (decision) — one of two, and a fix for a 404 does not get to pick
**Status:** OPEN. Filed rather than deferred, per Rule 87.4, by
`docs/CC-CMD-2026-10-11-no-header-estimates-unreconciled.md`, whose Task 0
established the 404 and whose fix stopped the spend without choosing a future.

## What is already settled

`_fetchLiveOdds` called `/v4/sports/{sport}/odds-live`, which the vendor does not
serve. Measured 2026-10-11, run `38186065943`, invalid key, zero credits:

```
/v4/sports/soccer_fifa_world_cup/odds       401 INVALID_KEY
/v4/sports/soccer_fifa_world_cup/odds-live  404 Not Found
/v4/sports/soccer_epl/odds                  401 INVALID_KEY
/v4/sports/soccer_epl/odds-live             404 Not Found
```

Every call was a 404, so the function has never produced an odds row, and the
charge above its fetch billed our own ledger 2 credits per attempt — 1037 calls
and 2074 credits on 2026-10-10 alone.

**The spend is stopped.** `ODDS_LIVE_PATH_404` returns before the charge, held
by `scripts/check-odds-live-disabled.mjs` (7/7, six mutations) in `guards.yml`.

## What is NOT settled, and why this document exists

The guard stops the bleeding. It does not decide whether in-play odds should
exist at all, and that is a money question:

- **Repoint at `/odds`.** Those calls would succeed and bill for real, at 2
  credits each, across **eleven sports** on a 15-second poll with a per-sport
  cooldown. The daily ceiling is 3800 and was already reached at 14:03:59Z on
  2026-10-11 **without** these calls succeeding.
- **Delete the path.** The in-play WP bars lose their intended input — which
  they have never had, so nothing that works today stops working.

`src/odds-sport-keys.js` says this in as many words about the neighbouring
decision: raising ambient's coverage is *"a budget change gated by
CC-CMD-2026-09-11 Task 2 and it is NOT made here."* The same applies here.

## The load-bearing premise, and the ONE command for it

**Premise:** `/odds` returns in-play prices for a live game, so repointing would
give the WP bars what they were built for.

**The alternative:** `/odds` is the pre-match board and in-play prices are a
separate paid product, in which case repointing buys nothing at 2 credits a
call and the answer is delete.

The command: one authenticated `/odds` call for a sport with a game **currently
in progress**, reading whether the returned prices move with the score. That
spends 2 credits and needs approval — but it is the only thing that separates a
feature from a bill.

A cheaper partial answer first, free: re-run
`scripts/probe-odds-live-endpoint.mjs` against the vendor's documented in-play
path names (`/odds-live` was a guess by whoever wrote it, and 404 is what a
guess looks like). If a real in-play path exists, its name is the answer.

## Tasks

**Task 0 — find the vendor's in-play path name, free.** Extend the endpoint
probe with the candidate paths and run it. A 401 on any of them names the real
endpoint; 404 on all of them says there is no in-play product on this key.

**Task 1 — if there is no in-play path**, delete `_fetchLiveOdds`, its caller
guard, `ODDS_LIVE_PATH_404` and `check-odds-live-disabled.mjs` in one commit.
Rule 63: no dead code. The WP bars' input is then a separate question with its
own document.

**Task 2 — if there is one**, do not repoint without a budget. The ceiling is
3800/day and is already being reached. Repointing adds eleven sports of
15-second polling at 2 credits a call; a per-sport cooldown and a sub-ceiling
belong in the same commit, and the arithmetic goes in the document before any
code.

**Task 3 — either way, the watch's named overcharge should go to zero.**
`noHeaderCredits` in `watch-odds-daily-vs-vendor.mjs` reports the tally beside
the residual. Once this path stops being called, `no-header` should empty. If it
does not, another site is keeping estimates and this document missed it.

## Stop conditions

- **Do not repoint at `/odds` without the arithmetic.** It is a live spend
  increase on a ceiling that is already saturating before noon.
- Do not delete the guard while the URL still says `odds-live` — the check
  fails on exactly that, and it is the state that cost 2074 credits in a day.
- Do not change `ODDS_HARD_LIMIT`, the daily ceiling, or any cron frequency.

## Done conditions

1. The vendor's in-play path named, or established not to exist, from a probe
   output in the outbox.
2. A stated decision between Task 1 and Task 2, with that output as its reason.
3. `no-header` credits at zero on a closed day in
   `outbox/odds-daily-vs-vendor-*.log`, or the site that is still keeping
   estimates named.
   **Open, first reading in.** 2026-10-11 closed at 292 calls / 584 credits
   (05:48Z run), all pre-fix as expected. 2026-10-12's 02:50Z drift sample has
   **zero** `no-header` cells among all 11 in its reconcile tally, the
   00:00–00:25Z pre-deploy minutes included. The closed-day reading for 10-12
   lands with the ~05:45Z run on 2026-10-13.
