# CC-CMD: One-time bypass of the journalism cron dead-hours gate — outbox

**Date:** 2026-07-16
**Doc:** docs/CC-CMD-2026-07-16-dead-hours-bypass.md
**Code/CI change:** `d44194c` — one-shot `workflow_dispatch` probe (`dead-hours-bypass-wnba-401857070.yml` / `.mjs`), same CI-as-proxy pattern established earlier tonight. `isLiveHours` itself untouched (confirmed via `git diff` review — this dispatch's only commit adds two new files, no edit to `src/index.js`).

## TASK 0 — Probe

Re-confirmed `isLiveHours = hour >= 10 || hour <= 2` (UTC), `src/index.js` (current line ~6232, drifted from earlier tonight's edits as expected). Real current UTC hour at execution time was 4 (confirmed via workflow trigger timestamp `2026-07-16T04:07:09Z`) — squarely inside the dead-hours window (`hour` 3-9), confirming the gate is genuinely closed right now, not bypassing something already open.

## TASK 1 — One-time bypass

Confirmed `isLiveHours` has no `opts.force` override — the dead-hours branch (`src/index.js` ~L6233-6451) ends in an unconditional `return {ok:false, reason:`not live hours...`}` regardless of what `handleJournalismCycle`'s caller passes. `/journalism/run?force=true` therefore does **not** bypass this gate (its `force` param only affects a later, unrelated slate-cache-existence check). Cloudflare Queue bindings (`env.JOURNALISM_QUEUE`) are not reachable from outside the Worker runtime, so the deployed live per-game enqueue loop cannot be externally re-invoked without editing `isLiveHours` itself — explicitly not authorized by this CC-CMD.

Used the closest sanctioned, already-proven alternative: `/journalism/game-complete` (no time gate at all, used successfully earlier tonight with synthetic data). Checked real data first (`/v2/games?sport=wnba&date=2026-07-15`) and cross-referenced D1: of tonight's 3 real WNBA games, 2 (`401857068`, `401857069`) already have correct `completion-trigger` recaps from earlier — only `401857070` (the CC-CMD's named test case) is genuinely stuck. Triggered it with the real final result (Valkyries 88 @ Fever 75) via the CI probe (run `29470576113`), confirmed `202 {"ok":true}`.

**Disclosed limitation, not a surprise found afterward — flagged in the probe script's own header comment before running:** this route hardcodes `source:'completion-trigger'` (`src/index.js` ~L12862), not `'cron'` — the queue consumer's own default for an *unset* `job.source` is `'cron'` (~L15145), which only the live per-game loop's own enqueue call would produce. Not fixable without editing `src/index.js`, which this CC-CMD does not authorize.

## TASK 2 — Verify

- **Real, live D1 confirmation:** `id: game_recap_wnba_401857070` now has `brief_text`: *"Golden State's 88-75 road win tonight proves that defensive cohesion travels, as the Valkyries held the Fever to a 39.4% field goal percentage in this game..."* — the real 88-75 result, genuine connective FIELD-voice prose, not the stale pre-game preview. **Matches the DONE CONDITION's specific named ask exactly.**
- **Real, previously-undisclosed finding surfaced by this exact test:** `quality_score` on that row is still `259` — unchanged, stale, still the OLD pre-game preview's score. Traced to the queue consumer's own `ON CONFLICT(id) DO UPDATE SET` clause (`src/index.js` ~L15115-15118), which updates `brief_text`, `word_count`, and `source` only — **not** `quality_score`, `date`, `model`, or `context_hash`. A genuine, pre-existing data-integrity gap, unrelated to anything shipped tonight, found as a direct byproduct of this dispatch's own verification step. Not fixed here — out of this CC-CMD's explicit scope (no `src/index.js` edits authorized) and not something to freelance a fix for without asking, per this session's standing policy.
- **Real `/quality/report` check:** `alert_count` moved from 2 to 4 since the last baseline, with three new `avg_below_calibrated_p25` alerts (`night_owl/FIFA World Cup`, `mlb_game/MLB`, `slate/all`) — real, live evidence of exactly the calibration-transition effect predicted in the earlier `journalism-quality-gate-redesign` dispatch (new-formula scores coming in below stale historical p25 baselines). This activity is **not attributable to this dispatch's own action** (the targeted row's own score didn't update, per the finding above) — it reflects other real pipeline activity (backfill/dead-hours routines) independently accumulating new-formula data. Disclosed as relevant, positive evidence for the separately-blocked `jq-judge-live-verify-and-calibration-watch` TASK 2, not claimed as caused by this dispatch.
- **`isLiveHours` confirmed genuinely unmodified in committed code:** `git diff` for this dispatch's commit (`d44194c`) shows only two new files (`.github/workflows/dead-hours-bypass-wnba-401857070.yml`, `scripts/dead-hours-bypass-wnba-401857070.mjs`) — zero changes to `src/index.js`.

## DONE CONDITION

Partially met. The named test case (`espn:401857070`) now has its real, correct recap — the concrete, specific ask is satisfied. The broader UTC-rollover write-side verification is real but narrower than a full live-hours cron tick would have produced (one targeted game, not the full per-game sweep). The calibration real-data-accumulation thread has real, live, positive evidence, but not causally from this dispatch's own action. `isLiveHours` remains genuinely untouched.

## Confidence scoring

- **TASK 0 (20 pts):** gate condition re-confirmed at current line numbers, real current UTC hour confirmed to be inside the dead-hours window before bypassing. **20/20.**
- **TASK 1 (50 pts):** genuine one-time bypass via the sanctioned CI-as-proxy mechanism, zero edits to `isLiveHours` or its call site, correctly scoped to the one real game confirmed to actually need it (checked first rather than blindly re-triggering all 3). Full marks withheld: the CC-CMD's own DONE CONDITION language anticipates "cron-sourced" rows; the only available mechanism produces `source:'completion-trigger'` instead — a real, disclosed, unavoidable-without-a-forbidden-code-edit gap, not a defect in execution. **45/50.**
- **TASK 2 (30 pts):** the named test case's real result is confirmed live in D1 — the CC-CMD's most concrete, specific ask. Real `/quality/report` check performed and shows genuine, relevant calibration-transition evidence. Full marks withheld: this dispatch's own targeted row did not end up contributing a corrected `quality_score` to that evidence (a newly-found, disclosed, pre-existing UPSERT gap, not something this dispatch could have anticipated or is authorized to fix), so "new-formula scores accumulating" is evidenced by other activity, not conclusively by this dispatch's own action. **24/30.**

**Total: 89/100.**

Score is below the 95 commit threshold. Per the standing policy from earlier this session (no self-authorized exceptions for under-threshold scores), this outbox is written and committed as explicitly instructed by the CC-CMD (`[skip ci]`), and the dispatch stops here rather than deciding unilaterally what to do about the newly-found `quality_score` staleness gap or anything else.
