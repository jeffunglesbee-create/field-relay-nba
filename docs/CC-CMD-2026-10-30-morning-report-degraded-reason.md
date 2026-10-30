# Claude Code Command — the Morning Report says "Quiet night" for two different reasons, and the row does not say which

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba (`src/analytics-engine.js`); jubilant-bassoon and field-laboratory need no change, the displayed text is unchanged
**Filed:** 2026-10-30, by CC, from the question "why is the late brief a template?"
**Status:** IN PROGRESS 2026-10-30. Task 1 (record the reason) and Task 2 (the replay that reads the rejected prose) are built and mutation-tested; Task 3 (the fix) is not chosen. It waits on the replay result, below, and on the owner.

---

## What was measured (Rule 73)

All from D1 `analytics_output` / `analytics_runs` on 2026-10-30.

1. **16 of the 22 mornings 2026-10-08..29 are the template** `Quiet night across the slate for ${date}. Tomorrow brings another set.`
   (73 characters). `circadian_late` is a copy of it, and the client reads `late` first, so this is what a reader sees.
2. **It began on 2026-07-15.** Commit `45bbe898` ("prevent cross-sport team-name substitution in Morning Report generation") added the team-name guard that day.
   Before it: 0 of 27 mornings (2026-06-18..07-14). Since: 53 of 107. By month: Jun 0/13, Jul 5/31, Aug 18/31, Sep 14/30, Oct 16/29.
   A correlation, with other changes the same day; the arithmetic below is the stronger evidence.
3. **Nothing records it.** `analytics_runs.errors` is `[]` on all 22 runs 2026-10-08..29, because phase 5 completes on the template path.
   `wrangler.toml` has no `[observability]` block, so the guard's `console.error` is not kept.
4. **No morning_report row carries a `degraded` key** (0 of 134). `docs/CC-CMD-2026-07-12-analytics-degraded-sweep.md` says every phase's `value` carries one; for `morning_report` that is false.
   `/analytics/degraded` and `session_health` read exactly that key, so they could not have shown a template morning.

## Which cause: arithmetic over the AI-call count, because no log exists

The template has two causes: the proxy returned no text, or it returned text and the guard rejected it. Phase 5 returns `aiCalls: prose ? 1 : 0`, so it counts a call only
when text came back. The run's `ai_calls_made` is the sum over phases, and the other phases' contributions can be read from the rows they wrote:

| run (cron time) | `ai_calls_made` | phase 3 | phase 9 | phase 10A | left for phase 5 |
|---|---|---|---|---|---|
| 2026-10-28 (2026-10-29 09:00Z) | 3 | 1: the stored line is not the finding's raw headline, so the proxy answered | 0: the stored line is the "Not every night has a must-watch" pass line, which returns `aiCalls: 0` | 1: real prose, none of the three fallback strings | **1** |
| 2026-10-29 (2026-10-30 09:00Z) | 2 | 0: the "Quiet night. The truth is…" no-finding branch, `aiCalls: 0` | 0: same pass line | 1: real prose | **1** |

Phases 6b and 6c add calls only on Sundays; 10-28 is a Wednesday and 10-29 a Thursday. So on both runs **the proxy answered and the guard rejected the answer.** The proxy was not the problem.

Sources and limits. The 2 was read from `/analytics/status` on 2026-10-30 (`last_run` 2026-10-30T09:00:29Z). The 3 comes from a reading of that route taken after the 2026-10-29 run, recorded in the session notes;
it cannot be re-read, since the status key is overwritten each run and `analytics_runs` has no such column. So the 2026-10-29 run is verified today and the 2026-10-28 run rests on that earlier reading. This covers two runs. It says nothing yet about the other 14 template mornings, and nothing about WHICH rule fired or on what text. That is what the record below is for.

## What the guard does (read from the code, not yet seen against the model)

For each recap game (the first 16 games with a note or a numeric score) whose score appears in the prose in either order, the morning is rejected if either team is absent
(its bare name, or "the" plus its last word) or if **any capitalised word other than "The" immediately precedes a team's bare name**. `ctx.games` stores bare mascots ("Lightning", "Trail Blazers"), so a city can
never be verified, and the 2026-07-15 comment in the code makes rejecting every city deliberate. A correct "Tampa Bay Lightning" is rejected the same as a wrong one.

On 2026-10-29 the context payload has 24 eligible games; the first 16 are 3 NBA, 11 NHL, 1 WNBA, 1 Serie A. Whether the model's habit of writing the city is what trips the guard is a hypothesis until the replay is read.

## Task 1 — record the reason on the row (built)

- `callProxyDetailed` returns `{ text, failure, model }`, `failure` being `http-<status>`, `bad-json`, `no-text` or null. `callProxy` delegates to it, so every other call site is unchanged.
- `selectRecapGames`, `buildMorningReportPrompt` and `teamNameSubstitutions` are the old inline code moved to exported functions. The prompt text is copied from the original lines, not retyped.
- `morning_report.value` now carries `degraded: false` on a good morning, and on a template morning `degraded: true`, `degraded_reason` (`prose-empty` with `proxy_failure`, or `team-name-guard` with `guard: { offenders, first: { sport, away, home, score, missing_team, fabricated_qualifier } }`).
  `recomputeMorningReport` (POST `/analytics/morning-report/recompute`) returns the same `outcome`.
- Unchanged: the template text, KV, `aiCalls`, `word_count`, `stars`, the guard's decision, and `circadian_late` (not marked: it is PURE, so the degraded sweep would re-copy the same template daily).
- **The rejected prose is not stored.** `GET /analytics/{feature}/{date}` serves `value` with `Access-Control-Allow-Origin: *` and `Cache-Control: public, max-age=300`, and the prose is what the guard judged fabricated. The record keeps the game, the score, the missing name or the matched qualifier ("Bay Lightning").
- Once deployed, visible in `/analytics/degraded` (`needs_manual_recompute`, since `morning_report` is AI-costing) and `session_health` (`analytics_phases.morning_report.degraded`). `JSON_EXTRACT(value,'$.degraded')` is 1 for true, 0 for false, NULL for absent (probed on D1 2026-10-30).
  A morning whose row has no key was written before this.

Verification (Rule 90): `scripts/check-morning-report-degraded.mjs`, 40 assertions on the real `recomputeMorningReport` against a mocked proxy and D1, and `scripts/mutate-morning-report-degraded.mjs`, 19 mutations, each required to go red for its stated reason. Both run in `deploy.yml` before the deploy.
One-off, not committed: the original `analytics-engine.js` from `e7bb7830` and the new one were run through `recomputeMorningReport` on 9,000 generated cases (about 4,300 accepted, 3,200 guard-rejected, 1,500 empty answers): identical prompt, identical text written to D1 and KV,
identical `aiCalls`, 0 differences. The same comparison goes red on three deliberate changes to the new code (a prompt word: 1500 of 1500 cases; home-first scores only: 267 of 1500; the away team ignored: 9 of 1500).

## Task 2 — read the rejected prose (built; result below once run)

`scripts/probe-morning-report-guard-replay.mjs`, dispatched by `.github/workflows/morning-report-guard-replay.yml` (dispatch only, no schedule). For 4 dates × 3 samples it rebuilds the prompt with the production function from the public routes,
sends it with the production call, judges the answer with the production guard, and prints what the model wrote and which rule fired. For each rejected answer it also tries ONE corrective retry that names the objection, as an experiment: nothing in the relay does this.
Cost (Rule 78): 12 inferences plus one per rejection, at the production `max_tokens` of 250, one at a time and 2.5 seconds apart. The proxy's own header comment gives its Gemini key 30 requests a minute and 1,500 a day; that comment is a copy of whatever the key's tier was when it was written, so the pacing keeps the run under the per-minute figure without relying on it, and a 429 is recorded as `http-429` rather than retried. Read-only: nothing is written to D1 or KV. Output: `outbox/morning-report-guard-replay-latest.json`.

**Replay result:** not yet run.

## Task 3 — the fix (not chosen)

The template is a degraded output, and "No fallbacks, only fixes" applies to it. The measured cause points at the guard's fail-closed rule meeting a model that writes cities. The candidates, to be chosen on the replay's numbers:

1. **Verify instead of fail closed.** Give the model and the guard full names from a source that has them, and accept a qualifier only when it is that team's own city. The largest change. No table mapping a game row's (sport, bare name) to a city was found by one search:
   `Boston Celtics` appears once in `src/`, in the `/wiki/trending` title map. It would touch the team-identity tables that `docs/CC-CMD-2026-09-13-team-key-sport-blind.md` and
   `docs/CC-CMD-2026-09-13-alias-table-silent-overwrite.md` are about.
2. **One corrective retry** that names the objection (the replay's experiment). +1 inference on each rejection morning, bounded by `AI_BUDGET_CEILING`, which phase 10A already honours. The guard stays as it is.
3. **Narrow the rule** to the cases the replay shows are wrong rejections, if there is a clear class of them.

## Done conditions

1. Deployed, and the morning after (`GET /analytics/morning_report/2026-10-30`, written by the 2026-10-31 09:00Z cron) has `value.degraded` set, with its reason when true.
2. The replay has been run and its numbers are in this document.
3. A fix is chosen with the owner and shipped, or Task 3 is closed with a reason.
