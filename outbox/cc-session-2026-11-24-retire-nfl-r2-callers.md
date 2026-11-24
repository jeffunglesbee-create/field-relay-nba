# Session doc — the Worker's Wednesday NFL R2 call is retired

**Date:** 2026-11-24 · **Repo:** field-relay-nba · **Branch:** main · **CC-CMD:** `docs/CC-CMD-2026-11-08-retire-nfl-r2-callers.md` (DONE for the change; one regression read armed)
**Trigger of the work:** the owner's word "11-24 means the cfl block is over", then "Remind us about the r2 and what is the better thing that is replacing it?" (answered in the session: see Background).

## Background (what the R2 job was and what replaced it)

- **Was:** `runNFLR2Update` (`src/nfl-r2.js`), a Worker cron job on Wednesdays 12:00 to 15:00 UTC (the `*/15` window, 16 ticks). It downloaded nflverse's all-seasons `player_stats.csv` (33.4 MB), parsed it inside the Worker and wrote `nfl/{year}/player-stats.json` to the R2 bucket `FIELD_DATA`, which the client reads (`NFL_QB_STATS`) through the relay's `/nflverse/` route.
- **Why it had to go (measured 2026-11-03):** it ran out of the Worker's 128 MB memory on 45 ticks over four Wednesdays (a 532 MB peak, `scripts/nfl-r2-memory-repro.mjs`), killing whatever shared the invocation (the cron handler, the journalism cycle, the KV sweep); and when it finished it published wrong data (the file stops at the 2024 season; a naive comma split misread 75,416 of 134,470 lines; its two other sources answer 404).
- **Replaced by (since 2026-11-08, option B of `docs/CC-CMD-2026-11-03-nfl-r2-player-stats-oom.md`):** `.github/workflows/nfl-player-stats.yml` running `scripts/build-nfl-player-stats.mjs` once on Wednesdays at 12:41 UTC, on a GitHub runner: it reads the CURRENT season's weekly file (3.8 MB) with a quote-aware parser, writes the same key with the same envelope and fields (the client is unchanged), reads it back and checks the public `/nflverse/` route serves the same bytes. Logs `outbox/nfl-player-stats-2026-11-{08,11,12,18}*.log` all end `WRITTEN AND SERVED`.
- **What this session did:** removed the Worker's last call to the retired job (the Wednesday block), now that the CFL experiment's block is lifted.

## Done condition

`grep -a -c "runNFLR2Update(env)" src/index.js` = **1** (was 2), the admin route. Deploy RELAY Worker run `45445305494` (head `7fac024d`) `success` at 17:18Z. Met. The regression read is armed (`trig_01QLB1MUj4iY8V5aYSBgxQwB`, 2026-11-26T02:00Z).

## HEAD progression

| commit | what |
|---|---|
| `7fac024d` | the removal (`src/index.js`, `.github/workflows/r2-init.yml`), the CC-CMD's Task 0 and Task 1 results, two citation fixes |
| `23895fa1` | the review's text fixes: the stale comments, the stub header, the CC-CMD Task 0 record (deploy `45447662808`) |

## What was verified, and how

- **Task 0 premises (Rule 100, read-only):** the verdict commit `0f35c968` on `main` (no VOID); the stub's `retired: true`; the two callers (the Wednesday block and the admin route) and no other importer; the runner's logs. No POST to `/nfl-r2-update`.
- **Before each push, every run-step of `deploy.yml`** (130) was run locally from a YAML parse on the clean tree. The first sweep failed one step (the citation ratchet, 11 bare against 9: my own bare citation and a pointer to the block I removed); both fixed before the push. The second and third sweeps: every step 0.
- **An independent review** (2 lenses, a skeptic per finding): 8 findings, 5 confirmed, all text, fixed in `23895fa1`.

## Coordination

The armed one-shot `trig_01RwwGVVt1uHQg4NXEvXc6Df` (2026-11-24T17:30Z, into `session_017FXC1oRxRstzY2xGJBFu2k`) was set on 2026-11-11 to do this same CC-CMD. It was not touched: its prompt reads the CC-CMD first, which by 17:09Z said the call was removed. Nothing on `origin/main` touched `src/` between my base and my push.

## Residual

- The regression read (armed). If a bucket appears between 12:00 and 16:00 UTC the Wednesday call is gone, so something else is killing the Worker: investigate first.
- Owner's call, not done: remove `POST /nfl-r2-update`, the `import` and `src/nfl-r2.js`.
