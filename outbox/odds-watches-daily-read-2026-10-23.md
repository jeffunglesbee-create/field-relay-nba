# Odds watches — daily read, 2026-10-23

The read began at 18:33Z, with origin/main at `483cb9a`. Each watch's newest
run and committed log were read directly, through the Actions API (GET only)
and the repo. No credits were spent and nothing was dispatched for this read.

| watch | newest run | today | artifact |
|---|---|---|---|
| odds-daily-vs-vendor | 39901569099, 04:40Z, failure | **RED, not the breach.** `we-overcharge-ourselves` for 2026-10-22: counter 1521/3800, vendor billed 1301 (04:35Z → 04:40Z, 24.1 h), known CI 140, residual `-360` (tolerance 65), unreconciled 0. The over-record direction | `odds-daily-vs-vendor-2026-10-23T0440.log` |
| odds-attribution-gap | 39968075619, 14:15Z, success | `ok` | `odds-attribution-gap-20261023T141535Z.log` |
| odds-site-drift | 39964804825, 13:52Z, success | `inconclusive over 2 interval(s) of 3 same-day sample(s)` | `odds-site-drift-2026-10-23T1352.log` |
| odds-pairing-rate | 39979695080, 15:36Z, success | PASS. `UNEXPLAINED -90` (tolerance 53; one-sided, negative is the reconcile direction). Daily 333/3800 at the read | `odds-pairing-rate-20261023T153626Z.log` |
| silently-dead-crons | 39991639926, 17:01Z, success | **green.** `DECLARES A CRON, NEVER FIRED` reads 0 in all four repos. Carried: jubilant-bassoon `nba-clutch-update.yml` (FAILING 3 CONSECUTIVE RUNS 1) | `silently-dead-crons-2026-10-23T17-04-47-910Z.log` |
| undeployed-src | 39963966951, 13:46Z, success | `deployed`, 0 unbuilt | `undeployed-src-2026-10-23T1346.log` |
| /budget/odds | read once, 18:33Z | 2026-10-23: 372/3800, by_site_sum 372, unaccounted 0, degraded_open 0. Historical 150, live 171, CFL 42, ambientCaptureClosingOdds 9. Monthly 40,916/85,000. Provider requests_used 29,498 | relay self-probe |

## Notes

- **Watch 1** is back in the over-record direction after yesterday's
  window-offset flip. Not re-derived today: it is the direction the filed
  window defect (`docs/CC-CMD-2026-10-13-vendor-residual-window.md`, OPEN)
  and the over-record both push, and no unrecorded caller is in question.
- **silently-dead-crons:** the six false "never fired" readings of 10-22 did
  not recur in the next scheduled run. That is step 1 of the TASK 0 in
  `docs/CC-CMD-2026-10-22-dead-cron-watch-one-empty-read.md`, recorded there.
- **ambientCaptureClosingOdds 9 today** is three calls: the 00:50Z and 01:50Z
  NHL captures of the 10-22 slate (6), and one at about 18:20Z for the
  Bundesliga kickoff at 18:30Z (3), being checked separately under
  `docs/CC-CMD-2026-10-22-closing-capture-before-kickoff.md`.

## Open threads

| thread | state |
|---|---|
| per-consumer ceiling (CC-CMD-2026-09-16 Task 3) | unblocked, not dispatched: the owner's call |
| ~19,700 offset | level only. Ledger − provider = 40,916 − 29,498 = 11,418 (18:33Z) |
| soccer pairing at 0 | blocked on a fixture that spends credits |
| odds charge survives cancellation | blocked until the 2026-10-25T06:30Z read |
| targeted fill | blocked on the owner's approval to spend |

The stored prompt for this read is still stale in the three places listed on
10-21 and 10-22; editing it is the owner's call.
