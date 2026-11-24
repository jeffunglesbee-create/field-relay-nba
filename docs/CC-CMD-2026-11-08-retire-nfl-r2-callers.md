# Claude Code Command — remove the Worker's Wednesday call to the retired NFL R2 job

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba (`src/index.js`, `.github/workflows/r2-init.yml`)
**Filed:** 2026-11-08, by CC, from option B of `docs/CC-CMD-2026-11-03-nfl-r2-player-stats-oom.md` (Rule 87.4)
**Status:** DONE 2026-11-24 for the change: the Worker's Wednesday call is removed and deployed (Deploy RELAY Worker run `45445305494`, `success`); the done-condition count is 1. One read is armed, not done: the regression check of Wednesday 2026-11-25's window (`trig_01QLB1MUj4iY8V5aYSBgxQwB`, 2026-11-26T02:00Z). Session doc: `outbox/cc-session-2026-11-24-retire-nfl-r2-callers.md`.

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

## Results, 2026-11-24

**Task 0 (read-only):**
1. *The block is lifted.* `git log --oneline --since=2026-11-23 -- outbox/ | grep -i cfl` finds `0f35c968` ("CFL post-window judged exactly as committed (no VOID; M (a) and M (c) fail; H-whole, H-none and M (b) hold on zeros)"), and the 2026-11-24 15:00Z close-out in `HANDOFF.md` records the same verdict.
2. *The stub is what runs.* `git show HEAD:src/nfl-r2.js` holds `retired: true` (line 30); the two latest completed Deploy RELAY Worker runs on `main` before this change, `45439264953` (head `de53ab71`, 2026-11-24 16:37Z) and `45238580586` (head `e9ca054f`, 2026-11-23), both concluded `success`, both later than the stub's commit (2026-11-08). Not POSTed to `/nfl-r2-update` (the CC-CMD forbids it).
3. *Nothing else imports `src/nfl-r2.js`.* `grep -rn nfl-r2 src scripts .github`: the one import (`src/index.js:155`, `import { runNFLR2Update } from './nfl-r2.js';`), the two callers (the Wednesday block and the admin route), the scripts that only quote the file's history (`nfl-r2-memory-repro.mjs`, `build-nfl-player-stats.mjs`). No gate or script quotes the Wednesday block.
4. *The runner has written every Wednesday since 2026-11-11.* `outbox/nfl-player-stats-2026-11-11T1951.log` and `...-11-18T2053.log` both end `WRITTEN AND SERVED: nfl/2026/player-stats.json` (11-08 and 11-12 also).

**Task 1:** `src/index.js`: the Wednesday block (`_utcDay === 3 && _utcHour >= 12 && _utcHour <= 15`) and its comment are replaced by a two-line pointer comment; `POST /nfl-r2-update` and the `import` stay (removing them is the owner's call: not done, not asked of the runner). `.github/workflows/r2-init.yml`: `nfl-r2-update` dropped from the description. `node scripts/build-route-provenance.mjs` changed nothing (the route stays), `check-route-provenance.mjs` PASS. **`grep -a -c "runNFLR2Update(env)" src/index.js` is 1** (was 2; `grep` needs `-a`, `src/index.js` reads as binary).

**Landed, 2026-11-24:**
- `7fac024d` (17:09Z): the removal. The full run-step sweep of `deploy.yml` (130 steps) ran on the final tree before the push: every step 0. (The first sweep failed one step, "doc citations are anchored": 11 bare against a budget of 9. Two causes, both mine: my Results text cited `src/index.js:155` with nothing quoted, and the OOM CC-CMD's pointer to the removed block lost its anchor when the block went. Both fixed before the push; `origin/main` was at 9.) Deploy RELAY Worker run `45445305494` (head `7fac024d`): `success`, 17:18Z.
- `23895fa1` (17:21Z): comments and docs only (the review's text findings). Its deploy: run `45447662808`.
- **Done condition 1:** `grep -a -c "runNFLR2Update(env)" src/index.js` = **1** (the admin route), checked at `23895fa1`.
- **Done condition 2 (regression check):** Wednesday's `MODE=localise WORKER=field-relay-nba STATUS=exceededMemory` read shows 0 buckets between 12:00 and 16:00 UTC. `worker-cpu-read.yml` reads UTC days ending yesterday, so Wednesday 2026-11-25 is readable on 2026-11-26: armed as `trig_01QLB1MUj4iY8V5aYSBgxQwB` (2026-11-26T02:00Z), which also checks the runner's `outbox/nfl-player-stats-2026-11-25*.log`. This CC-CMD's own text says it already held from 2026-11-11 because of the stub, so it is a regression check, not new evidence.
- **An independent review** (2 lenses, a skeptic per finding): 8 findings, 5 confirmed, all text (the two bare citations; stale counts in the comments above the R2 block; the stub's header; an inaccurate "latest run" and a probe time after the commit). 3 refuted: the armed trigger `trig_01RwwGVVt1uHQg4NXEvXc6Df` (a commit cannot disarm one, and the CC-CMD it reads first records the work), the HANDOFF "pending" lines (dated history), and the committer identity.
- **Not done, the owner's call:** removing `POST /nfl-r2-update`, the import and `src/nfl-r2.js` (the stub). One caller (the admin route) and the stub remain.
