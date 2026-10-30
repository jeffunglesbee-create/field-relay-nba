# Session 2026-10-30 (evening) — the relay writes the sentence about each game in the Morning Report

Spec: "Task 4" (Fri 2026-10-30 16:59 ET), the owner's answer to "Reply `task 4` to build it", on the proposal in Task 4 of `docs/CC-CMD-2026-10-30-morning-report-degraded-reason.md`. The estimate there was about 100 minutes.
Task document: that file (Status IN PROGRESS: Tasks 1 to 4 are built and live; the first live morning is not read yet).

## HEAD progression

field-relay-nba: `b25cb617` → **`b6c46113`** (the code, deployed) → `a1d85a64` (the replay result, automated `[skip ci]`) → this close-out (the verifier and the docs). Other sessions' automated commits between them are not listed.
Deploy RELAY Worker run 41131995398, green (21:34:01Z to 21:41:49Z). Worker version `c91c0747-5da4-44b8-90e6-3e1291d34ebc` deployed 21:40:38Z; `/health` RELAY OK at 21:42:47Z. Repo guards (run 41131995356) and Workflow YAML Gate (run 41131995389) on `b6c46113`: success.
jubilant-bassoon and field-laboratory: no change.

## What was built

`b6c46113` feat: the relay writes the sentence about each game; the model picks the games and writes only the open and close lines.
- `src/morning-report.js`: `resultShape` (sport family, unit, kind of result from the two scores and `went_to_ot`), `resultSentence` (three phrasings per kind), the pick / open / close parser, the composer, prompt revision 3. Tables and thresholds are in Task 4 of the task document.
- `scripts/check-morning-report-cite.mjs` and `mutate-morning-report-cite.mjs` rewritten around an oracle that holds its own sport table, thresholds, number words and wording; `check-morning-report-degraded.mjs` and its mutations updated for the new form. No `deploy.yml` change: the script names are the same.
- `scripts/probe-morning-report-cite-replay.mjs` keeps, for each pick, the descriptor the model saw, the fact line and the sentence the relay wrote; `src/analytics-engine.js` changed in a comment only.

This close-out's commit (scripts, docs; no `src/`):
- `scripts/lib/morning-report-oracle.mjs`: the oracle, moved out of the check so a second user can import it. `scripts/lib/morning-report-verify.mjs`: checks a stored morning against the day's rows. `scripts/verify-morning-report.mjs`: the command (three GETs, or `--dir` on saved answers; exit 0 verified, 1 defects, 2 nothing to verify, 64 usage, 70 unreadable).
- The check gains the verifier's tests: 21 tampered mornings, two rows that disagree with the text, the not-composed cases, the event-row cases, and the command's exit codes through `--dir`. The mutation script gains 17 mutations of the verifier. Local: 145 assertions, 144 mutations caught.

## Verified E2E

- Before the push, in a clean worktree on the current `main`: the new checks, every mutation script that touches a changed file (cite 127, degraded 32, tie 6, odds-consumer 10), and the full non-mutation suite of `deploy.yml` and `guards.yml` (211 steps: 91 pass, 5 fail as they do on the unchanged tree because they need `RELAY_SHARED_SECRET` or an OIDC token, 115 skip). In CI on `b6c46113`: cite check 107 of 107 and 127 of 127 mutations, degraded 43 of 43 and 32 of 32, tie 12 of 12 and 6 of 6.
- A canned model answer through the replay probe against the live public routes (dates 10-27 and 10-29) before the real replay, to test the probe's answer path without a secret.
- Replay 4 on the production model (run 41132004691), then every printed fact line, descriptor and sentence compared with the game's row from the saved context, by the oracle: 44 picks, 43 sentences, all equal; the 44th is a golf row. The same comparison on a tampered copy flagged 24 of 24 altered sentences. Numbers in Task 4 of the task document.
- The live routes' shapes (`/analytics/morning_report/<date>` and `/analytics/truth_is/<date>` answer `data.value` and `data.brief_text`) were read before the command was written; the command was run against the live 2026-10-29 row (a template row: exit 2) and 2026-10-30 (no row yet: exit 2).

## What the work found

With no model text in a game line, what the model gets wrong is limited to the open and close lines, which name no game. Replay 4: the false overtime of replay 3 became "A narrow one-goal win."; 11 of 11 closes begin "We look forward" (9 of 11 before) and 4 of 11 opens say "unexpected" (7 of 11 before). The model chose overtime games for 19 of its 43 sentenced picks; overtime games are 5% of the scored rows in 2026-10-08..29. The game lines now say little beyond the score; a plain win's sentence restates the margin.

## Process (what was asserted, what one command said)

- A command started as `nohup … &` inside a background-run call was reported complete at once while it kept running. A check was run against a module the mutation process had changed (102 of 107) and a file was edited under the live process. Nothing was committed from that state. The runs were repeated after waiting on the real process id (`tail --pid`): 127 of 127 caught, no `.mutbak`.
- The first run of the replay probe without a secret overwrote the committed `outbox/morning-report-cite-replay-latest.json` with an empty run. Restored with `git checkout` before any commit; later runs used a scratch working directory.
- One assertion ("the answer text is not stored in the value") looked for strings the answer never held, so it could not fail. It was found because the mutation that stores the answer was caught by a different assertion than the one named for it. It now looks for the answer's own lines.
- An expected sentence worked out by reading (Dream 80, Valkyries 69 as "An eleven-point win.") was wrong: it is the second plain win in that report. Running the check found it (3 of 43 red).
- A code comment said "2,000+ completed games". The measured number is 901 scored rows with both team names. Corrected before the commit.
- Elapsed time was read from `date -u`: 49 minutes at 21:48Z, against 100 estimated.
- The older oracle was inside the check, where a second user could only reach it by reading the check's source. It was moved to `scripts/lib/` when the verifier needed it, the same way `allowed-tables.cjs` was extracted.

## STAGED

The first morning written by the new code. Blocked by: the cron, Sat 2026-10-31 09:00Z (05:00 ET). Unblocked by: that run writing the row for 2026-10-30.
Verify: `node scripts/verify-morning-report.mjs 2026-10-30` exits 0 (VERIFIED, each cited game printed as the spec's fact line and sentence), or exits 2 with the reason on the row.
Automated: scheduled task `trig_01YXBNhWJFgRU3SHCY9KMPsR` runs it at 2026-10-31T09:15Z, reads the open and close lines for stock wording, makes no recompute (Rule 78), and appends the result to the task document.

## Carry-forwards

1. The close line is the model's and repeats across days (11 of 11 begin "We look forward"). The relay could write it from a few fixed lines chosen by date. The owner's call.
2. The verifier's tests and mutations (145 and 144) ran locally on this commit; CI runs them at the next deploy that touches `src/`, since this commit changes scripts and docs only.
3. `field_pick` is the 57-character pass line on 19 of 19 days it has a row. Seen, not investigated.
4. The cause of the other 14 template mornings of the 22 (the replay in Task 2 explained 2). From now on a template morning carries its reason on the row.
5. The stored `truth_is` rows for 2026-10-23, 2026-10-25 and 2026-10-28 still carry the draw-as-win headline. The tie fix changes new rows only; no recompute was fired.
6. The limits in "What Task 4 did not close" in the task document: the class thresholds are wording, `went_to_ot` is filled only for six leagues, a few sports print the fact line only, past rows keep the model's sentences.
