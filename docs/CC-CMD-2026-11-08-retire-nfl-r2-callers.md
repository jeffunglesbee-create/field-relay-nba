# Claude Code Command — remove the Worker's Wednesday call to the retired NFL R2 job

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba (`src/index.js`, `.github/workflows/r2-init.yml`)
**Filed:** 2026-11-08, by CC, from option B of `docs/CC-CMD-2026-11-03-nfl-r2-player-stats-oom.md` (Rule 87.4)
**Status:** BLOCKED until the CFL experiment's verdict commit exists, and not before 2026-11-24.

---

## Why this is separate

On 2026-11-08 `src/nfl-r2.js` became a stub: `runNFLR2Update` returns
`{ ok: false, retired: true, ... }` and writes nothing. `nfl/{year}/player-stats.json`
is built by `.github/workflows/nfl-player-stats.yml` instead. The callers stay in
`src/index.js`, because a commit to that file between 2026-11-08 and 2026-11-23
voids the CFL experiment (`outbox/odds-cfl-season-end-prediction-2026-10-18.md`,
"What voids the experiment"). Its judge checks `git log --since=2026-11-08`
with no `--until`, so a commit before the verdict voids it too.

## Unblocked when

Both hold:
1. it is 2026-11-24 or later;
2. the judge's verdict commit is on `main`. Find it with
   `git log --oneline --since=2026-11-23 -- outbox/ | grep -i cfl`; if nothing is
   found, the block stands. Do not land without the verdict.

## Task 0 — premises (Rule 100)

1. *The stub is what runs.* The Deploy RELAY Worker run for the stub's commit
   (or a later one) concluded `success`, and `git show HEAD:src/nfl-r2.js` still
   holds `retired: true`. Read-only: do not POST to `/nfl-r2-update` to find out,
   because if the stub were not live, that request would do the write.
2. *Nothing else imports `src/nfl-r2.js`.* `grep -rn "nfl-r2" src scripts .github`.
3. *The runner has written every Wednesday since 2026-11-11.* `ls outbox/nfl-player-stats-*.log`
   and each one ends `WRITTEN AND SERVED`.

## Task 1 — the change

- `src/index.js`, the Wednesday R2 block (`_utcDay === 3 && _utcHour >= 12`): remove
  the `runNFLR2Update` call and its comment line.
- `POST /nfl-r2-update` and its `import`: **keep**. CLAUDE.md forbids removing a
  route without the owner, and the stub already answers it as retired. Removing
  the route and `src/nfl-r2.js` is the owner's call; ask, do not assume.
- `.github/workflows/r2-init.yml`: drop `nfl-r2-update` from the endpoint description.
- Regenerate `src/route-provenance.js` (`node scripts/build-route-provenance.mjs`) and
  run its gate.

## Done condition

- `grep -c "runNFLR2Update(env)" src/index.js` is 1 (the admin route), not 2.
- After the deploy, the next Wednesday's `MODE=localise WORKER=field-relay-nba STATUS=exceededMemory`
  read (`worker-cpu-read.yml`) shows 0 buckets between 12:00 and 16:00 UTC. That
  already holds from 2026-11-11 because of the stub, so it is a regression check,
  not new evidence.
