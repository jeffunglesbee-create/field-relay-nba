# CC session — build-bdb-frames, Tasks 1-4 — 2026-10-16

**CC-CMD:** `docs/CC-CMD-2026-10-15-build-bdb-frames.md`. Task 0 is recorded
separately in `outbox/cc-session-2026-10-16-build-bdb-frames-task0.md`.
**Result:** the route is live and verified, 11 of 11 checks, on the deployed
worker: `/nflverse/bdb_event_frames.json` serves 1,816,808 bytes from R2
(`X-Source: r2`), 7 whole games of 2022 week 2, both events, envelope
complete, no `targetYear`.

## What remains open

- **The consumer is STAGED.** No client reads the route yet. Its consumer is
  field-laboratory's Gravity Well (empowerment-metrics Task 4), built in the
  same session; the `STAGED` marker in `src/index.js` comes off when that module
  reads this route. Unblock check: a field-laboratory source file that fetches
  or decodes `bdb_event_frames.json`.
- **Scope cut, as ruled:** 7 of week 2's 16 games, 14 of 32 teams. The
  ceiling is 2,000,000 bytes on the bytes uploaded.

## Task 1 — the builder

jubilant-bassoon `scripts/build-bdb-frames.py`, `build-bdb-frames.yml`
(dispatch-only). The six existing builders are untouched.

| variant | frames | bytes, whole week | whole games under 2,000,000 | bytes kept |
|---|---|---|---|---|
| (a) `ball_snap` on every play | 2,809 | 4,922,091 | 5 | 1,664,979 |
| (b) `ball_snap` on dropbacks and pass plays | 2,117 | 3,710,699 | **7** | **1,816,808** |

**(b) is used**, as the ruling directs when it keeps more games. No written
metric reads a snap frame on a play that is neither a dropback nor a pass.
The envelope says so in `playFilter`. Whole games are cut in gameId order:
2022091500, 2022091800-2022091805.

Each upload is checked against the gate, the ceiling, before it leaves the
runner: the builder serializes compact JSON once, measures those bytes, and
uploads the same bytes. It reads the R2 object back and compares sha256
(`6be5a282...d249`, matched). The same bytes are committed to
`outbox/nfl/bdb_event_frames.json` as the relay's raw-GitHub fallback. Unlike
the sibling builder, every failure exits non-zero: no swallowed upload.

## Task 2 — the wire contract, and the coordinate convention

Envelope: `updated`, `season` 2022, `sourceDataset`, `week` 2, `metric`,
`events`, `playFilter`, `coordinateConvention`, `scope`, `data`. Each row:
`nflId`, `team`, `pos` (per player, from `players.csv`), `side` (from
`possessionTeam`), `x`, `y`. No `targetYear`.

**Convention, declared as data:** offense-right, yards. x runs 0 to 120 in the
offense's direction of play, end zones included; y runs 0 to 53.3, increasing
to the offense's left. Rows from plays whose source `playDirection` is `left`
are rotated 180 degrees: `x' = 120 - x`, `y' = 53.3 - y`.

**Verified on the week's own plays before upload**, against the raw frame and
an x-only mirror (run 38945906448, week 2 in full):

| check | declared | raw | x-only mirror |
|---|---|---|---|
| x: offense mean behind defense mean at the snap, left plays | **910/910** | 0/910 | 910/910 |
| x: same, right plays | 895/895 | 895/895 | 895/895 |
| y: `passLocationType` side, ball at release vs ball at snap, left plays | **53/53** | 0/53 | 0/53 |
| y: same, right plays | 57/57 | 57/57 | 57/57 |

**The play where they differ, by hand:** game 2022091500, play 1191, source
direction left, `OUTSIDE_RIGHT`. At the snap the offense's raw mean x is
79.17 and the defense's 73.01, so in the raw frame the offense is ahead of
the defense. In the declared frame they are 40.83 and 46.99. The ball at
release is at declared y 14.92 and the ball at the snap at 23.62: the QB
threw from the offense's right, as labelled.

**What `passLocationType` means was measured, not assumed.** The dataset's
definition was not found. Three readings were tried on right-direction plays,
where every candidate frame is the same frame: the ball at release agreed
57/57, where the pass arrived 37/39, and the end of an outside run
(`rushLocationType`) 122/148. So the label describes where the QB was when
he threw. Two earlier runs failed the check for this reason:

- 38944765768 judged the side by where the ball arrived, measured from the
  field's centre line: 33/37 on left plays.
- 38945202682 measured it from the ball at the snap instead, with the same
  result.

The builder refused to upload both times, as designed.

## Task 3 — allow-list and route

`fc2b78f`: `bdb_event_frames.json` in `NFL_R2_FILES` (the R2-first read) and
`NFLVERSE_OUT_ALLOWED` (the raw-GitHub fallback), with a comment naming the
builder and the STAGED consumer. Order, as ruled: builder run, R2 object
confirmed (read-back sha256), then the relay commit. Deployed by run
38946567184. Before pushing, 126 deploy pre-checks were run locally: 122
passed; 2 need the shared secret, which CI has; 2 refused a dirty tree and
passed once it was committed.

## Task 4 — verification on the deployed route

`scripts/verify-bdb-event-frames.mjs`, `verify-bdb-event-frames.yml`, run
38947116335, artifact `outbox/verify-bdb-event-frames-latest.json`: **11/11.**

1. Envelope: `season` 2022, `sourceDataset`, `week` 2, `events`, 1,036 data
   items; no `targetYear`; the convention declared.
2. 1,816,808 bytes received, under 2,000,000; `X-Source: r2`.
3. Play 2022091500/1191: 22 players at the snap, 11 offense and 11 defense,
   the offense behind the defense in the declared frame (40.83 against 46.99).
4. `pass_forward` on 491 of the 545 plays carrying a snap (90.1%). Over the
   kept games' dropbacks (`isDropback`), the builder measured 490 of 544
   (90.07%).

Every assertion was made to fail on purpose in `--self-test` (12/12). Coverage:
7 of 16 games; check 3 reads one play.

## Verification of the code

- Builder: self-test, 28/28 mutations caught (harness asserts a unique anchor
  and a passing baseline), end to end against a fake Kaggle and R2 (15
  checks): upload failure, an upload that raises, a read-back that differs, a
  missing season, and a contradicted convention each exit non-zero with
  nothing committed under `outbox/nfl/`.
- Workflow: the first run lost its failure report (`git add` given a missing
  path stages nothing). Fixed in jubilant-bassoon `d1b20cf4`, checked under
  `bash -e`.

## HEAD progression

- jubilant-bassoon: `b42d6614` builder, `d1b20cf4` report fix, `80127b01`
  and `7726fab0` convention check, `58b59a2a` artifact (bot).
- field-relay-nba: `fc2b78f` allow-list, `918f4d5` verifier, `24cec24`
  verification reading (bot).
