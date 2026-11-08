# Claude Code Command — 16 more client workflows end in a bare `git push`; which of them has actually lost output to a rejected push

**Date:** 2026-11-08
**Repo:** field-relay-nba (the probe and this document); the workflows live in jubilant-bassoon
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** B (a measured defect class, evidence first, then fixes only where evidence exists)
**Confidence gate:** >= 95 before any commit
**Status:** DONE 2026-11-08, as measured. TASK 0 (the probe) and TASK 1 (its run) are done: of the 16 other client workflows with a bare `git push`, **0 have a push-rejected failure in the 467 runs the probe read for them (47 failed, 1 of those at a commit step with an expired log; 507 runs across all 18 workflows)** (denominators under Observed); the one rejected failure in the 18 workflows read is the already-fixed `patent-watch.yml` / `patent-fulltext.yml` case (client `e4093fa`). TASK 2 therefore touches nothing: no client workflow is changed on a census alone (Rule 69). One failure at a commit step is unreadable (an expired log), and four workflows were read for their newest 100 runs only; both are stated, not closed. The one workflow with evidence is tracked under `docs/CC-CMD-2026-11-02-scheduled-job-skipped-every-time.md`, done condition 8.
**Filed by:** the 2026-11-08 read of the dead-cron ratchet (`outbox/silently-dead-crons-2026-11-08T17-56-55-670Z.log`), after finding the cause of the one failed scheduled run that put `patent-watch.yml` in it. Searched first, by content (BUILD-ON-A): `docs/CC-CMD-2026-08-06-deploy-verify-commit-push-race.md` and `docs/CC-CMD-2026-09-14-git-state-swallow-sweep.md` are about the relay's own workflows; no CC-CMD covers the client's. Session doc: `outbox/cc-session-2026-11-08-patent-fulltext-push-race.md`.

```bash
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull; git log --oneline -5
```

---

## What was measured (2026-11-08)

**The failure.** jubilant-bassoon run 41919349025 (`Patent Watch (weekly)`, schedule, 2026-11-04): job `followup / pipeline` steps 1/3 to 3/3 succeeded, "Commit results" failed in one second with `! [rejected] main -> main (fetch first)`. The step ended in a bare `git push`. The six grant hits' full text and comparison tables were generated, uploaded to Dropbox, and lost with the runner. Fixed and recovered: client `e4093fa`, recovery run 42508334232, client `458f17a` (21 files, 6 of 6 comparison tables). A local race harness shows the old step failing on a push race and the new one passing (2 of 4 scenarios, then 4 of 4; three mutants caught): `outbox/patent-push-race-harness-2026-11-08.py`.

**The class (census, probed 2026-11-08 at client `cd3a70f`, 141 workflow files).** 122 files contain `git push`. 17 contain it with no `pull --rebase`, `rebase` or retry helper anywhere in the file; one of the 17 is `patent-fulltext.yml` (fixed). The other 16, by trigger read with PyYAML:
- scheduled (6): `competitor-probe` (Mon 08:00Z), `oura-fetch` (daily 09:00Z, also on push), `smoke-and-verify` (daily 11:00Z, also on push), `update-drama-profiles` (1 September), `whoop-auto-auth` (Mon 10:00Z), `whoop-fetch` (daily 09:15Z, also on push);
- push-triggered and dispatchable (5): `golf-contract-probe`, `sign-shortcut`, `wc-situation-probe`, `whoop-auth-exchange`, plus `send-outbox` (push only, 3 pushes);
- dispatch-only (5): `golf-espn-eur-gir-probe`, `golf-espn-scottish-open-gir-probe`, `golf-espn-stat-names-probe`, `golf-espn-tourcast-probe`, `nhl-analytics-probe`.

**What the census does not say.** Capable of failing is not failing. The dead-cron watch calls every scheduled one healthy (a success in the last three scheduled runs), which does not exclude an occasional lost run. Whether any of the 16 has actually been rejected is what TASK 1 measures.

## TASK 0 — the probe (built)

`scripts/probe-client-bare-push-failures-2026-11-08.mjs`, run by `.github/workflows/probe-client-bare-push-failures.yml` (dispatch-only, `RELAY_GH_PAT`, read-only). For the 17 workflows it lists up to 100 completed runs, opens only the failed ones, and counts a failure as push-rejected only when a step named like `commit|push` failed AND that job's log names the rejection (`[rejected]`, `fetch first` or `non-fast-forward`). Controls at run time: the known-rejected job 126889897528 must classify rejected, the commit step of success run 42508334232 must not. The classifier is a pure function with a self-test (`--self-test`, 4 cases and 4 mutants, 8 of 8) that runs in the workflow before the probe. It prints per-workflow denominators and a coverage line, and says CAPPED where the API holds more runs than it read.

## TASK 1 — run it and read it (done; see Observed)

Dispatch `probe-client-bare-push-failures.yml`; read the committed `outbox/probe-client-bare-push-failures-<ts>.json`. Record here, under "Observed": the controls, the per-workflow lines, and the summary. **Done condition 1: the artifact exists, both controls pass, and the summary line is quoted.**

## TASK 2 — fix only what the evidence names (done: the evidence names none of the 16)

For each workflow with `pushRejected` > 0: apply the loop `patent-watch.yml` and `patent-fulltext.yml` now share (`git pull --rebase --autostash origin "${GITHUB_REF_NAME}" && git push origin "HEAD:${GITHUB_REF_NAME}"`, three attempts, then verify HEAD is an ancestor of `origin/<ref>` and fail the job if not), as its own client commit, proved first with `outbox/patent-push-race-harness-2026-11-08.py` pointed at that file's commit step (the harness takes the workflow path; its `STEP_NAME` is `Commit results` and must be set to that file's step name, which is a one-line change per file). Workflows with 0 rejected failures are NOT touched (Rule 69), and stay listed here as capable-not-failed with the probe's denominator. **Done condition 2: every workflow with a rejected failure has its client commit hash here and a harness run red before, green after; every other workflow is named with its 0 and its run count.**

## Rules this document obeys

Rule 100: the claim "the 16 may be losing output" was not published before TASK 1 could refute it; it is stated as capable. Rule 90: the probe's classifier failed on purpose (4 mutants) before its verdict was trusted. Rule 91: the coverage line is in the probe's own output.

## Observed

### 2026-11-08 18:30Z — the probe's two runs (written by the session that built and read them)

**Run 1 (`outbox/probe-client-bare-push-failures-2026-11-08T18-13-11-789Z.json`) found a hole in its own listing, and that is why it is not the artifact.** It read `patent-fulltext.yml`'s own runs: 16 runs, 6 failed, 0 push-rejected. But `patent-fulltext.yml` is a reusable workflow, and the 2026-11-04 loss (run 41919349025) belongs to its CALLER `patent-watch.yml`; a "0" there would have read as "patent-fulltext never lost a push" when it lost exactly one. Its control had passed only because the control job id is hard-coded. Fix (`scripts/probe-client-bare-push-failures-2026-11-08.mjs`): `patent-watch` joins the list, and a control through the LISTING path (run 41919349025 must be found among patent-watch's rejected runs) marks the reading broken when it is not.

**Run 2, the artifact: `outbox/probe-client-bare-push-failures-2026-11-08T18-15-21-256Z.json`.** Controls: positive (job 126889897528) push-rejected, negative (the commit step of success run 42508334232) not rejected, listing path (run 41919349025 found via `patent-watch`) FOUND. `broken` false.

```
18 workflows, 507 runs read, 54 failed, 2 failed at a commit/push step, 1 push-rejected
patent-watch          runs  24  failed  1  commit-step 1  rejected 1   <- run 41919349025, the known loss (fixed e4093fa)
patent-fulltext       runs  16  failed  6  commit-step 0  rejected 0   (read through its caller above)
competitor-probe 18/0/0/0   golf-contract-probe 2/0/0/0   golf-espn-eur-gir-probe 1/0/0/0   golf-espn-scottish-open-gir-probe 1/0/0/0
golf-espn-stat-names-probe 1/0/0/0   golf-espn-tourcast-probe 1/0/0/0   nhl-analytics-probe 3/0/0/0   sign-shortcut 3/0/0/0   wc-situation-probe 2/0/0/0
send-outbox           runs   4  failed  1  commit-step 0  rejected 0
update-drama-profiles runs   8  failed  4  commit-step 1  rejected 0   (1 log unreadable: expired)
whoop-auth-exchange   runs  23  failed 21  commit-step 0  rejected 0
oura-fetch 100 of 159 CAPPED, failed 0   smoke-and-verify 100 of 2500 CAPPED, failed 21, commit-step 0   whoop-auto-auth 100 of 170 CAPPED, failed 0   whoop-fetch 100 of 155 CAPPED, failed 0
```

(Columns for the one-line rows: runs read / failed / failed at a commit-or-push step / push-rejected.)

**Read as:** 0 of the 16 other workflows has a rejected push in the runs read. **Not shown:** anything older than the newest 100 runs of `oura-fetch` (59 not read), `smoke-and-verify` (2,400 not read), `whoop-auto-auth` (70) and `whoop-fetch` (55); the one failure at a commit step of `update-drama-profiles` (a yearly cron; the log has expired, so whether it was a rejected push is unknown); any reusable-workflow caller outside the 18. **Seen, not investigated, not asserted:** `whoop-auth-exchange` failed 21 of its 23 runs and `smoke-and-verify` 21 of its newest 100, none at a commit or push step; their causes were not read here.

