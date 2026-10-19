# CC session — CFL archive date keying, 2026-10-18 to 2026-10-19

`docs/CC-CMD-2026-10-16-cfl-archive-date-keying.md`, all five tasks.

**HEAD:** `5e082469` → `147f375e` on 2026-10-18, then held. `119cee49` →
`5e1c067b` on 2026-10-19, then the docs commits.
**Branch:** main. **Deploy:** run 39179159880 (writer fix, green).
**Integration status:** VERIFIED. Writer, D1 rows, `/context/date`, and both
gates are all live.

## What landed, per commit

| commit | what |
|---|---|
| `3ad28bd0` | `scripts/migrate-cfl-date-keying.mjs`, a dry run by default (TASK 3) |
| `3b2fef2a` | The migration reads through `/d1/execute` and emits the write as SQL. This is the deviation, below. |
| `9e76e87d` | `scripts/check-archive-date-keying.mjs`, the guard, run beside the migration (TASK 4) |
| `85a95dac` | verify checks `/context/date` for every planned row (TASK 5) |
| `147f375e` | nine of ten adversarial review findings fixed |
| `e6a5078e` | **TASKs 1 and 2**: `fieldDayOfInstant`, and the CFL writer stamps the ET day. Pushed 00:05Z, deployed by run 39179159880. |
| `3a499e9d` | dry-run artifacts from run 39179186247 |
| (D1) | **the migration applied**, 00:16Z, as one 65-statement transaction |
| `21f724ee` | verify artifacts from run 39180106033 |
| `4bd33e08` | `guards.yml` runs the guard against live D1 |
| `5e1c067b` | `deploy.yml`'s verify job runs the guard |

## Deviations, and why

1. **The executor was the session's D1 connector, not a runner.**
   - The CC-CMD's TASK 3 has the migration script write.
   - The first runner dry run got **7403** from the D1 REST API: this
     repository's `CLOUDFLARE_API_TOKEN` has no D1 access.
   - `/d1/execute` does have access, but it prepares one statement per call.
     That would split each row's guarded UPDATEs across requests, with no
     transaction around them.

   So the script never writes. The dry run reads through `/d1/execute` and
   commits the whole set as ONE multi-statement `.sql`. The session sent that
   file, unchanged, to the D1 connector as one call.

   Measured on this database before relying on it:
   - a multi-statement call is one transaction;
   - `changes()` carries across statements;
   - `json('{')`, `abs(-9223372036854775807 - 1)` and
     `json_extract('{}','bad-path')` each abort it, with "malformed JSON",
     "integer overflow" and "bad JSON path".
2. **The guard was not wired into `guards.yml` until after the migration**,
   against TASK 4 as filed. Before the writer fix it was guaranteed red, and a
   guaranteed-red gate is wallpaper. It ran beside the migration instead:
   - before the apply, as the baseline, expected red;
   - in verify, where it must pass.

   It is now wired into both `guards.yml` and `deploy.yml`.
3. **The writer fix was applied from a stash, then checked against the
   CC-CMD.** Chat's `119cee49` states that the document, not the stash, is the
   source.
   - The stash (`52e745ef`) was applied by SHA, never popped. The stash stack
     is shared with a worktree.
   - Every non-blank line of TASK 1's block (31) and TASK 2's block (21) was
     then checked against `src/index.js`.
   - 51 of 52 matched verbatim. The one that did not is the unchanged context
     line `if (t?.status !== 'complete') continue;`, which carries a trailing
     `// THE GATE` comment in src.
   - The stash entry was dropped after re-finding it by SHA and tag.

## The review: ten findings, all reproduced

From the adversarial review of 2026-10-18. Nine are fixed in `147f375e`:

- **The migration:**
  - A mistyped SET-side literal still matched one row and committed. There is
    now a third in-transaction guard on the row as written.
  - With every row skipped, the dry run said NOTHING-TO-DO. It now exits 1,
    `SKIPPED-ONLY`.
- **The guard:**
  - Its mutation re-ran `classify()` only. It now runs `evaluate()`, whose
    result is the exit code.
  - The self-test requires the CFL writer to stamp from `fieldDayOfInstant`.
  - It counts distinct instants (7), not fixtures.
  - There are new `disc golf` and `PGA Tour Champions` fixtures, because a
    substring exemption fails them.
  - There are per-table floors: a table reading 0, or disagreeing with its own
    count, fails.
- **The workflow:**
  - The guard's self-test runs as its own step.
  - The dry run's tolerated exit 1 needs the live comparison to have run.

The tenth finding is an order: push the writer fix only after
2026-10-19T00:00Z, and apply only after 00:15Z. It was kept:
- the writer was pushed at 00:05Z;
- the apply was sent at 00:16Z, after deploy run 39179159880 was green on both
  deploy and verify.

The order exists because `/archive/game` upserts `ON CONFLICT(id)`. A writer
still stamping UTC, with `CFL_2026-10-17_e13419748` inside its window, would
have re-created the old id after the rename.

## Harness results (node:sqlite standing in for D1)

- **Migration, ten scenarios** (`147f375e`). Each behaved as stated:
  - clean;
  - three typos;
  - two stale rows;
  - a collision;
  - a briefs reference;
  - skipped-only;
  - a stale consumer view.
- **Earlier, six scenarios** (`3b2fef2a`):
  - clean: 13 of 13 renamed and verified;
  - a stale `start_time`, a stale change_log count, and a mistyped id: each
    rolled the whole transaction back;
  - a collision and a briefs reference: each aborted the dry run.
- **Guard, four scenarios**, plus mutations, all caught:
  - seven mutations, two of them on the verdict path (`147f375e`);
  - six more, plus a 4am rollback in the writer's helper (`9e76e87d`).

## Baselines: 13 → 0 over 3,385 compared rows

| | run | log | result |
|---|---|---|---|
| before the apply | 39179186247 (dry-run) | `outbox/cfl-date-keying-guard-dry-run-20261019T000532Z.log` | **13 mismatches** over 3385 compared, all CFL, exactly the 13 planned; guard exit 1 |
| after the apply | 39180106033 (verify) | `outbox/cfl-date-keying-guard-verify-20261019T001740Z.log` | **0 mismatches** over 3385 compared (3399 checked, 14 exempt as PGA Tour); guard exit 0 |

Both runs also moved one passing row by a day in memory
(`2026-05-25-mlb-pittsb-chicag`) and reported `CAUGHT`. That is TASK 5.6,
observed failing on live data in both runs.

## The apply, verbatim in summary

The file `outbox/cfl-date-keying-migration-dry-run-20261019T000530Z.sql` (sha256
`3bbad392649aa50087a4a44caa2d88bdbfbadaf88e68066a1edc2054d4883e7d`) holds 65
statements. It was sent once, to `cc49101c-0569-4d41-8e7a-be139cde4f26`.

- 65 of 65 statements returned `"success":true`.
- All 39 guards read `ok`: 13 `change_log_guard`, 13 `games_guard` and 13
  `written_row_guard`.
- Each of the 13 `regular_season_games` UPDATEs: `"changes":1`,
  `"rows_written":3`.
- The two `change_log` UPDATEs with rows (`…08-23_torontoargonauts…`,
  `…09-13_e13419731`): `"changes":2`, `"rows_written":4` each. The other
  eleven: `"changes":0`.

## TASK 5, all six

1. **Probe A, per sport, `keyed_UTC`:** CFB 0/100, CFL 0/13, FIFA World Cup
   0/6, MLB 0/333, MLS 0/133, NBA 0/35, NFL 0/35, NHL 0/77, WNBA 0/104. Every
   one of the 836 discriminating rows is on the ET day.
2. **The guard:** exit 0, `PASS — 0 mismatches over 3385 compared rows`.
3. **Ids:** new present 13, old present 0.
4. **change_log:** 4 rows on the two new ids, 0 on the two old ones.
5. **`/context/date`:** 13 of 13 planned rows listed on their new day and gone
   from their old one. This includes `BC Lions v Ottawa RedBlacks`, now
   listed on 2026-10-09 and not on 10-10 (verify log).
6. **Mutation:** `CAUGHT` in both live runs, above.

## Gates

| gate | run | result |
|---|---|---|
| `guards.yml` step "Every archived game is dated on the ET day of its own kickoff" | 39180185016 (push, `5e1c067b`) | **success**; the run is green |
| `deploy.yml` verify step "every archived game is dated on the ET day of its own kickoff", dispatched | 39180192675 (workflow_dispatch, `5e1c067b`) | **success**; deploy and verify jobs green |

## Integration state (Rule 65)

- **Relay contract:** unchanged in shape. The archive `id` is
  `CFL_<ET day>_<tail>` and `date` is the ET day of `start_time`, as for every
  other sport.
- **Consumer:** `/context/date/<day>` lists CFL games on the ET day of
  kickoff. Verified 13 of 13.
- **Known mismatches:** none.

## Residuals

- **The SQL probes in the CC-CMD hardcode `-4 hours`.** That is correct only
  while every checkable row is EDT. From 2026-11-01 it is wrong for new rows.
  The guard is unaffected: it uses `Intl` with the IANA zone, as does
  `fieldDayOfInstant`. Only a hand-run probe A would be.
- **CFL postseason** (2026-10-31, 11-07 and 11-15) has not yet produced a
  row. The guard reads `postseason_games` as well, so its first rows are
  checked by both gates.
