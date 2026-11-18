# CC session 2026-11-18 — golf tee times, Task 2 (relay)

**Repo:** field-relay-nba. **HEAD:** `3019b07` → `140fa56` (the change), then this doc and the HANDOFF entry.
**CC-CMD:** `docs/CC-CMD-2026-11-16-golf-tee-times.md` (status IN PROGRESS). The owner's order: "tee times build next please".

## Built (`140fa56`)

- `handleESPNGolfScoreboard`: carries ESPN's `timeValid` beside `startDate` (KV key r3 → r4).
- `/v2/golf/enriched` (KV key v5 → v6): `startDate`, `timeValid`, `roundStart`, `roundLastTee`, `teeTimes {inRound, withTeeTime, failedReads}`.
- `getGolfRoundTeeTimes`: the competition's competitors from the core event the route already reads, each competitor's `status` (concurrency 8, edge-cached 300 s), summarised to the earliest and latest `teeTime` among competitors whose `period` is the round. KV per (event, round): 6 h when complete, 10 min otherwise. Called only from this route.
- `src/golf-tee-times.js` (`summariseGolfTeeTimes`, pure), `scripts/check-golf-tee-times.mjs` (in `deploy.yml`), `CONTRACTS.md` entry.

## Verified

- `check-golf-tee-times` 7/7 against the real probe read (`outbox/golf-tee-times-probe-2026-11-16.json`): round 4, 67 of 67 in-round competitors with a time, 13:30Z to 15:31Z; round 2 after the cut, 52 in the round and none. Self-test: 3 of 3 mutants caught.
- Every single-line step of `deploy.yml` run locally: green, except three that need `RELAY_SHARED_SECRET` (CI holds it) and `check-handoff-current` (red before this session; this entry is its fix). Empty catches hold at the baseline 112; the absence-collapse ratchet holds.
- **Live: not yet.** The done-condition reads (the route on a tournament day; an archive row after the client change) follow the deploy; see the HANDOFF entry for their state.

## Found

- My status line of 2026-11-16 ("Task 1 DONE …") broke `CC-CMD status lines are greppable and consistent` (outside the vocabulary); `Repo guards` was red on it from `ecf05814`. Now "IN PROGRESS".
