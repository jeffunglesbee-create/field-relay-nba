# CC-CMD 2026-11-27: the five items the dead-cron fix left, each with its own done condition

**Repo:** field-relay-nba (items 4 and 5 read it), jubilant-bassoon (items 1 to 3), field-laboratory (item 4) · **Branch:** main — commit directly, no feature branch or PR
**Filed:** 2026-11-27, by the session that fixed the dead crons.
**Status:** PARTIAL — the five items were decided 2026-11-27 on the owner's "go with Claude's best recommendations": item 2 built and run on a runner (done), items 3, 4 and 5 decided with nothing to build, item 1 armed for 2027-01-12 (scheduled task `trig_01GRH95J5SxjppM22mQZ9dQN`; the probe fix, if it is needed, waits for a qualifying-only day). **Confidence gate:** >= 95 before any commit.

**Why this file exists (Rule 87.4).** The session that fixed the dead crons (`outbox/cc-session-2026-11-26-dead-crons-fix.md`) landed three change sets: the tennis client/relay split, the `silently-dead-crons` watch's resilience, and the removal of `nba-clutch-update.yml`. Five things it found were out of its scope. Each is written here with the command that opens it and the artifact that closes it, so none is "worth a separate session".

Probe block first (Rule 87.1). Run this and read it before touching anything; every name below was read from these commands in the session that wrote this file, not from memory.

```
git log --oneline -5
grep -n 'TIER_RANK\|toggleTennisView' tennis_draw_probe.js                       # jubilant-bassoon, item 1
ls scripts/mutate-tennis-draw-pick.mjs; grep -rn 'mutate-tennis-draw-pick' .github smoke.js package.json   # item 2
grep -n 'TENNIS_DRAW_NAMED_RANK\|_TENNIS_DRAW_TIER_RANK' src/legacy/field.js      # item 3
```

## 1. `tennis_draw_probe.js` carries a third copy of the picker (jubilant-bassoon)

**What is true (read, not run).** The probe chooses its tournament with its own `TIER_RANK = { grand_slam: 0, masters_1000: 1, atp_1000: 1, wta_1000: 1 }` and the card's tournament category (line 31, used at line 68). It does not look at `round_name`. The client now decides per row (`_tennisDrawPick`): a Grand Slam or 1000 whose card holds only qualifying rows is not offered a Draw tab.

**What is NOT known.** What `window.toggleTennisView()` (which the probe calls unconditionally at line ~164) does when the client's pick is null, and which branch of the probe's verdict that reaches. The probe has `FAIL` for "the Draw tab opened onto a hidden section" and for `want` rows not drawn. This was not run: no slam or 1000-level singles day with only qualifying rows existed to run it against. **Do not treat "the probe will go red" as a finding until step 1 below has produced the artifact.**

**Why it can wait until a date, and what the date is.** The probe answers `NO DRAW` (exit 0) whenever its own pick is empty, and its pick is empty on any day with no slam or 1000-category singles row. Unblocked when: any Grand Slam or 1000-level event has a day whose card holds only qualifying rows (the next such day is the qualifying start of the first slam or 1000 of 2027). **Run this item before that day.** The relay answers it: `curl -s "$RELAY/bsd/tennis/matches/by-date?date=<day>"` and count rows whose `round_name` is one of the seven main-draw names.

Steps:
1. Dispatch `tennis-draw-probe.yml` on such a day (it runs twice daily on its own schedule; a dispatch reads the same page). Commit its manifest.
2. If it is `FAIL` for the reason above: make the probe take its tournament from the page, not from a copy. Either extract `_tennisDrawPick` from the deployed page text the way `field-relay-nba` `scripts/lib/client-tennis-split.cjs` does, or read which tournament the page's Draw tab shows and compare the relay's draw for THAT tournament. Delete `TIER_RANK` from the probe.
3. If it is not red: record the artifact and close the item; the copy is still a copy, so also add one line to the probe's header naming the client function it mirrors.

**Done condition (artifact).** `outbox/tennis-draw-probe-manifest-<day>.json` for a day that satisfies the unblock criterion, with `verdict` not `FAIL`, committed, and `grep -c TIER_RANK tennis_draw_probe.js` printing 0 (or the header line from step 3).

**Decided and armed 2026-11-27 (recommendation taken: do it on the day, not before).** Why not now: whether the probe goes red on a qualifying-only day is exactly the thing that was never run, and the only honest artifact is a probe run on such a day; a fix written before it would be a fix for a guess. The Australian Open 2027 qualifying runs Monday 2027-01-11 to Saturday 2027-01-16 (the official Melbourne Park event page and the LTA preview agree; one outlier site says 11 to 15 January; the main draw starts 2027-01-17). Scheduled task `trig_01GRH95J5SxjppM22mQZ9dQN` fires 2027-01-12T18:00Z (after that day's 15:20Z probe) in a fresh session and carries steps 1 to 3 above, with the rule that a result which disagrees with the expectation is reported as plainly as one that agrees. If the slam week passes without a usable run it re-arms for the next 1000-level event rather than guessing a date.

## 2. `scripts/mutate-tennis-draw-pick.mjs` is run by nothing (jubilant-bassoon)

**Fact.** 28 mutants, all caught on 2026-11-27, 1m14s when the machine was busy. No workflow, `smoke.js` row or `package.json` script runs it (`grep` above prints nothing). The 33 designed cases in `smoke.js` are what runs on every deploy; the harness is what proves those cases can fail. Without it the cases can rot without anyone seeing.

**Decision for the owner (Actions budget).** A step in `deploy-gate.yml` costs 75 s on every deploy. A weekly workflow costs 75 s a week. **Recommendation: weekly**, in a new `mutation-harnesses-weekly.yml` that also holds any later harness. If the owner prefers the deploy gate, the step goes after `smoke.js` and before the esbuild bundle.

**Decided and done 2026-11-27 (recommendation taken: weekly).** `jubilant-bassoon/.github/workflows/mutation-harnesses-weekly.yml`, commit `61a9f8b4`, Wednesdays 06:40Z plus dispatch, read-only, node builtins only, `timeout-minutes: 10`, one step per harness so a later harness going red names itself. Before it was pushed the step was shown to go red (exit 1) with the harness path replaced by a file that does not exist, and green on current main. Dispatched on a runner: run `45925668008`, success, the step took 52 s and the job 1m18s (faster than the 75 s measured here under load); its log, read from the runner, ends `ran 28 mutations, caught 28 of 28 (a neutral edit counts when smoke stays green); not caught 0; harness defects 0.` The weekly cost is about 78 s of runner time, against 75 s on every deploy for the other placement.

**Done condition (artifact).** A workflow run id, committed to `outbox/`, whose log holds the line `caught 28 of 28` from `node scripts/mutate-tennis-draw-pick.mjs` and whose step exited 0. (The harness asserts each mutant's anchor is unique and applied and runs a control on the unmutated copy, so the log line is the proof; no second deliberate break is needed.)

## 3. Named events outrank 250s whatever their row count (owner policy)

`_TENNIS_DRAW_NAMED_RANK` defaults a named event (for example Davis Cup or United Cup) to rank 2 and the Finals to rank 1; 250s are rank 3 (`_TENNIS_DRAW_TIER_RANK`). A Davis Cup tie with one row beats a 250 with thirty. Cases I, I-rev, I-count, I-slam and I-1000 in `smoke.js` pin it. The alternative is to compare row counts within a tier. **Owner chooses; if no reply, nothing changes.** If it changes, the six `smoke.js` cases and mutants M19-M23 change with it, and the relay detector's I2 check is unaffected (it asserts that SOME tab is offered, not which).

**Decided 2026-11-27 (recommendation taken: keep as is, change nothing).** The reasoning, labelled as reasoning and not as a measurement: the alternative, comparing row counts within a tier, would let a 250 with a full early-round card beat a team-event day that has only a few rows by construction, so the named event would almost never be offered, which is the Davis Cup quarterfinal defect this work fixed. A named event is a bigger draw than a 250 whatever the count of rows on the day. What the rule gives up: a thin named-event day outranks a busy 250 day, and a reader who wanted the 250 reaches it by the other tabs. `smoke.js` cases I, I-rev, I-count, I-slam, I-1000 pin the choice and mutants M19 to M23 hold it, and the weekly workflow above now runs them. Revisit only if the owner finds a real day where the choice was wrong.

**Done condition.** The owner's answer recorded in `HANDOFF.md`, and if it is "change", `node scripts/mutate-tennis-draw-pick.mjs` printing `caught N of N` with the new cases. Met for "keep": recorded in HANDOFF.md, 2026-11-27.

## 4. `field-laboratory` lists `bsd-join-probe.yml` as an active workflow and has no such file

Workflow id `396892304`, state `active`. The contents API answers 404 for `.github/workflows/bsd-join-probe.yml`. The watch (this session) now files it in its own bucket, "listed active, file absent", which is not red, so the ratchet is quiet. Cause unknown; the likely story is a file deleted from main while GitHub still lists its last-seen definition, which clears when the workflow has no runs for 90 days or is disabled.

Probe: `curl -s -H "Authorization: Bearer $T" https://api.github.com/repos/jeffunglesbee-create/field-laboratory/actions/workflows/396892304 | node -e 'const w=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(w.state, w.path, w.updated_at)'`, and `git log --diff-filter=D --oneline -- .github/workflows/bsd-join-probe.yml` in field-laboratory.

**Decided 2026-11-27 (recommendation changed by what was read: leave it).** Read 2026-11-27: workflow `396892304` is named `bsd join probe`, `state` active, `created_at` and `updated_at` both 2026-10-26T05:59:36-04:00, `path` `.github/workflows/bsd-join-probe.yml`; the commits API for field-laboratory's default branch with that path returns `[]` (no commit on `main` ever touched it); directory listings of `.github/workflows` on the other two live branches, `claude/bsd-list-caller-search-5jd70z` and `epl-alias-coverage`, do not name it (the same calls listed 42 and 56 workflow files, so the listing works). So it was never on `main` and is on no live branch. The likely story, an inference and not something read, is a registration from a branch that was deleted. It is inert: with no file on any live branch there is no cron that can fire, and the watch files it as "not judged, not red". Removing it needs a runner holding a token with Actions write on field-laboratory plus a one-shot workflow to carry the call, and removing that workflow afterwards would leave its own "listed active, file absent" registration, the mechanism that probably made this one. That costs more than an inert line in a daily log. **Reopen only if** the workflow gets a run, or the watch's `listed active, file absent` count rises above 1.

**Done condition.** Either the file is restored (if the deletion was an accident, the `git log` line names the commit), or the workflow is disabled (`PUT /repos/.../actions/workflows/396892304/disable`, run from a runner with `RELAY_GH_PAT`) and the next `silently-dead-crons` log prints `listed active, file absent  : 0`. Whichever, the log line is the artifact.

## 5. Considered and NOT built: a breaker for a sustained GitHub outage in the watch

**Decision stands 2026-11-27 (recommendation taken: do not build).**

The reviewers asked whether the watch should stop retrying after N consecutive UNREAD reads. It was not built, and here is the measurement it rests on: the retry transport sleeps at most `RETRY_BUDGET_MS` = 120 s per run, each attempt is cut at `ATTEMPT_TIMEOUT_MS` = 20 s, and the job has `timeout-minutes: 20` (the whole job measured 6m50s on 2026-11-27, run 45923006298, of which the 109-mutant harness was 4m21s and the reading 2m17s). A sustained outage therefore costs at most the budget plus attempts, never a storm, and ends in UNREAD by name. Build it only if a run is observed spending its whole budget on a single outage, and then the artifact is that run's log. Nothing to do now.

## Also filed, not repeated here

`docs/CC-CMD-2026-11-26-nba-clutch-r2-stale-and-dead-fallback.md` (relay): the relay-side staleness and dead fallback the clutch workflow's deletion exposed.
