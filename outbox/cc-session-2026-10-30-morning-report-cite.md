# Session 2026-10-30 — the Morning Report cites games by id: the relay writes every team name and score

Spec: "#4 please" (12:12 ET), the owner's pick of option 4 in Task 3 of `docs/CC-CMD-2026-10-30-morning-report-degraded-reason.md`, made after the replay in `outbox/cc-session-2026-10-30-morning-report-degraded.md` showed the team-name guard rejecting accurate prose.
Task document: `docs/CC-CMD-2026-10-30-morning-report-degraded-reason.md` (Status IN PROGRESS: Task 3 built and live, Task 4 proposed, the first live morning not yet read).

## HEAD progression

field-relay-nba: `719fc0eb` (the degraded-reason code, deployed 12:21Z) → `7f2549bc` (A) → `a211e14f` (B) → **`95871f13`** (C, the last code commit) → this close-out. Automated outbox commits and other sessions' commits between them are not listed.
Deploy RELAY Worker, all green: A run 41093528801 (16:50–17:01Z), B run 41096192055 (17:08–17:19Z), C run 41097629436 (17:18–17:28Z; Worker version `42b46f92-0e5d-4db8-9ab8-b627f901d33e`, `/health` RELAY OK at 17:27:31Z). Repo guards on C: run 41097629430, success.
jubilant-bassoon and field-laboratory: no change.

## What was built, per commit

`7f2549bc` feat: the contract module, its check and mutations, the replay probe.
- `src/morning-report.js`: pure functions, no I/O. `selectRecapGames`, `citableGames`, `buildMorningReportPrompt`, `slateNamesOf`, `parseMorningReportLines`, `composeMorningReport`, `prepareMorningReport`, `finishMorningReport`. The model sees games under ids with the sport, margin, total and overtime flag and no team name; the relay prints `Winner score, Loser score.` ahead of each model sentence.
- `scripts/check-morning-report-cite.mjs`, `scripts/mutate-morning-report-cite.mjs` and two slate fixtures (10-27 and 10-29, the days the guard rejected accurate prose), as a `deploy.yml` step.
- `scripts/probe-morning-report-cite-replay.mjs` and `.github/workflows/morning-report-cite-replay.yml` (dispatch only).

`a211e14f` feat: Phase 5 prints every team name and score itself.
- `runPhase5MorningReport` uses `prepareMorningReport` and `finishMorningReport`. Deleted: `teamNameSubstitutions`, the score-substring test, the qualifier rule, `scripts/probe-morning-report-guard-replay.mjs` and its workflow. `outbox/morning-report-guard-replay-latest.json` stays as the record.
- Row outcome: `degraded` false with `cited` (and `dropped` when a line was dropped), false with `no_games`, or true with `no-context`, `prose-empty` or `bad-structure`. The dropped text is never stored: the route is public.
- `scripts/check-morning-report-degraded.mjs` rewritten (42 assertions) and `scripts/mutate-morning-report-degraded.mjs` (32 mutations). Prompt revision 1 (the first prompt had the model say "the home side" and "the closest game of the night", claims the data does not carry).

`95871f13` fix: Phase 3 gave every drawn game to the away side; the prompt, again.
- `detectAnomalies` skips a tied game. 9 of 22 days change; 5 led with a draw described as a win. `scripts/check-truth-is-ties.mjs` (12 assertions, three real draw rows and a 400-slate property test) and `scripts/mutate-truth-is-ties.mjs` (6 mutations) run in `deploy.yml`.
- Prompt revision 2: forbids describing how a game went, and names the stock phrases the second replay produced. The replay probe's watch list follows.

## Verified E2E

- Before each push, in a clean worktree on the current `main`: the new checks, every mutation script that touches a changed file, and the full non-mutation suite (on C: 211 steps, 91 pass, 5 fail identically on the unchanged tree because they need `RELAY_SHARED_SECRET` or an OIDC token, 115 skip). In CI the same checks ran with the secrets: C's deploy has the degraded check at 42 of 42 and 32 of 32 mutations caught, the cite check at 70 of 70 and 50 of 50, the tie check at 12 of 12 and 6 of 6.
- Three replays on the production model, 11 dates each (results in the git history of `outbox/morning-report-cite-replay-latest.json`: `f59e6803`, `db3420d9`, `85c212c5`). Numbers in the task document, Task 3.
- The one false statement found in 87 model sentences (replays 2 and 3) was checked at the source: ESPN event 401892599 reads "SEA 5 vs TOR 4 | Final" and the row has `went_to_ot` 0; the sentence said an extra period was needed.
- The Phase 3 defect was read from three stored `truth_is` rows through the public route, then counted over the 22 context snapshots with the old and the fixed function.

## What the work found

The model-written sentence is the channel that is left. Three prompts on the same 11 days: side claims (8 of 11 answers, half wrong), then game-flow narrative (31 of 43 lines carry a marker), then 15 of 44 and one false overtime. The prompt moves the failure and cannot be shown to remove it from 11 observations. Task 4 in the task document proposes closing the channel: the relay writes the game sentence from the row, the model picks the games and writes the open and close lines.

## Process (what was asserted, what one command said)

- A whole-file copy of `deploy.yml` from an older clone would have deleted another session's "degrade counter … UTC hour" step. Read in the commit diff before the push; undone with `git reset --soft`, the two files restored from `origin/main`, and only the change re-applied as a patch. The older clone was a copy of the source.
- "The new gate step passed in CI" was said while the step was still pending, and "about 30 minutes in" was said at 9. Both corrected the same turn. A step is read from the run's status, and elapsed time from `date -u`.
- A first run of the mutation scripts exited 127 (`/usr/bin/time` is absent here) and had run nothing. Re-run with the shell's own timer and the logs read.

## STAGED

The first morning written by the new code. Blocked by: the cron, Sat 2026-10-31 09:00Z (05:00 ET). Unblocked by: that run writing the row for 2026-10-30.
Verify: `curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/analytics/morning_report/2026-10-30?x=1"` shows `data.value.degraded` false with `cited`, or the reason; each `Winner n, Loser n.` pair in `brief_text` is checked against `/context/date/2026-10-30`; each model sentence is read for a claim its row cannot back.
Automated: scheduled task `trig_01YXBNhWJFgRU3SHCY9KMPsR` reads it at 2026-10-31T09:15Z, makes no recompute (Rule 78), and appends the result to the task document.

## Carry-forwards

1. Task 4 (close the sentence channel): the owner's call, about 100 minutes. Evidence in the task document.
2. `field_pick` is the 57-character pass line on 19 of 19 days it has a row. Seen, not investigated.
3. The cause of the other 14 template mornings of the 22 (the replay explained 2). The guard is gone, so a template morning from now on carries its reason on the row.
4. The limits in "What option 4 did not close" in the task document: number words are not machine-checked, a name outside the slate is not detectable, `went_to_ot` NULL reads as silence, the open and close lines repeat across days.
