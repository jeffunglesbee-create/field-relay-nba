# Claude Code Command — the Morning Report says "Quiet night" for two different reasons, and the row does not say which

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba (`src/analytics-engine.js`); jubilant-bassoon and field-laboratory need no change, the displayed text is unchanged
**Filed:** 2026-10-30, by CC, from the question "why is the late brief a template?"
**Status:** IN PROGRESS 2026-10-30. Task 1 (record the reason) is in `719fc0eb`. Task 2 (the replay) has run and its result is below. Task 3 (the fix) is not chosen: the replay found a different cause from the one this document first assumed, and the choice is the owner's.

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

## What the guard does (read from the code, then seen against the model in Task 2)

For each recap game (the first 16 games with a note or a numeric score) whose score appears in the prose in either order, the morning is rejected if either team is absent
(its bare name, or "the" plus its last word) or if **any capitalised word other than "The" immediately precedes a team's bare name**. `ctx.games` stores bare mascots ("Lightning", "Trail Blazers"), so a city can
never be verified, and the 2026-07-15 comment in the code makes rejecting every city deliberate. A correct "Tampa Bay Lightning" is rejected the same as a wrong one.

On 2026-10-29 the context payload has 24 eligible games; the first 16 are 3 NBA, 11 NHL, 1 WNBA, 1 Serie A. The first draft of this document guessed that the model's habit of writing the city was what trips the guard. The replay says it is not: no sample was rejected for a qualifier.

What does trip it is the first test. The score is found with `prose.includes("5-1")`, a plain substring that never checks the characters either side. So the hockey score 5-1 is found inside the basketball score "125-124", and 4-1 inside "124-103". A score shared by two games (2-0 twice on 10-27) is found for both while the prose describes one. The guard then asks for the teams of the game that was never written about, finds them absent, and throws the whole morning away.

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

## Task 2 — read the rejected prose (done 2026-10-30)

`scripts/probe-morning-report-guard-replay.mjs`, dispatched by `.github/workflows/morning-report-guard-replay.yml` (dispatch only, no schedule). For 4 dates × 3 samples it rebuilds the prompt with the production function from the public routes,
sends it with the production call, judges the answer with the production guard, and prints what the model wrote and which rule fired. For each rejected answer it also tries ONE corrective retry that names the objection, as an experiment: nothing in the relay does this.
Cost (Rule 78): 12 inferences plus one per rejection, at the production `max_tokens` of 250, one at a time and 2.5 seconds apart. The proxy's own header comment gives its Gemini key 30 requests a minute and 1,500 a day; that comment is a copy of whatever the key's tier was when it was written, so the pacing keeps the run under the per-minute figure without relying on it, and a 429 is recorded as `http-429` rather than retried. Read-only: nothing is written to D1 or KV. Output: `outbox/morning-report-guard-replay-latest.json`.

**Replay result** (run 41054042599, 2026-10-30 12:16Z, `outbox/morning-report-guard-replay-latest.json`; `gemini-3.1-flash-lite` answered all 12):

- The proxy answered all 12 calls. 6 were accepted (10-26 and 10-28) and 6 rejected (10-27 and 10-29). **No sample was rejected for a qualifier; every rejection is the missing-team rule.**
- The 3 samples for a date are byte-identical, and so are their retries. These are 4 observations, not 12.
- Every flagged game traces to a score written for a different game:

  | date | flagged game | its score | where that text sits in the prose |
  |---|---|---|---|
  | 10-27 | Devils at Stars | 5-1 | inside the Celtics-Nets "125-124" |
  | 10-27 | Panthers at Jets | 5-1 | the same |
  | 10-27 | Sabres at Sharks | 2-0 | the Canadiens-Blues 2-0, a different game with the same score |
  | 10-29 | Blackhawks at Red Wings | 1-4 | inside the Grizzlies-Trail Blazers "124-103", read as 4-1 |
  | 10-29 | Bruins at Blues | 1-4 | the same |

  The rejected paragraphs are accurate: checked against `/context/date/`, 10-27's Celtics 125-124 over the Nets and Canadiens 2-0 over the Blues, and 10-29's Dream 80-69 over the Valkyries, Lightning 6-4 over the Jets and Grizzlies 124-103 over the Trail Blazers are the real results.
- **The corrective retry** (the experiment) was accepted on 3 of 6: all of 10-29. On 10-27 it named the three flagged games and was rejected again, because "124-125" then contained "4-1", the score of a fourth game (Senators at Golden Knights). A retry moves the collision; it does not remove it.
- **Limits.** The replay reproduced the stored outcome on 3 of 4 dates (10-26 prose; 10-27 and 10-29 template) and not on 10-28 (stored template, replay accepted): its inputs were fetched today, not at 09:00Z the next day. Every one of the 22 slates 2026-10-08..29 holds at least one score that sits inside another game's score or repeats it, so that exposure does not separate the 16 template days from the 6 prose days; whether it fires depends on which games the model writes about. The replay explains the two days it reproduced. It does not say what wrote the other 14 template mornings.

## Task 3 — the fix (not chosen)

The template is a degraded output, and "No fallbacks, only fixes" applies to it. The cause the replay found is in the guard's match, not in the model: a score is found by substring, so the guard attributes it to games that were not written about. The candidates, on those numbers:

1. **Attribute a score only to the game it describes.** Find the score as a whole number (the characters either side are not digits), and treat an occurrence as explained when any recap game with that score has its teams present. Both measured classes go away, the embedded score and the repeated one. The check that a written game's teams are named, and the qualifier rule, are unchanged, and the new rule rejects a subset of what the old one rejected. The replay's two rejected paragraphs become regression fixtures that must be accepted; the 2026-07-15 incident text must still be rejected. It changes what the guard lets through, so it is the owner's call.
2. **One corrective retry** that names the objection. Measured above: 3 of 6 accepted, and it fails on 10-27 for the same substring reason. +1 inference on each rejection morning, bounded by `AI_BUDGET_CEILING`, which phase 10A already honours. It treats the symptom and leaves the false rejections.
3. **Verify cities** against a (sport, mascot) to city source. The qualifier rule did not fire in any of the 12 samples, so this answers a problem the replay did not find. No such table was found by one search: `Boston Celtics` appears once in `src/`, in the `/wiki/trending` title map. It would touch the team-identity tables that `docs/CC-CMD-2026-09-13-team-key-sport-blind.md` and `docs/CC-CMD-2026-09-13-alias-table-silent-overwrite.md` are about.
4. **Take names and scores out of the model's hands.** The prompt asks for sentences that cite games by id, and the relay writes the team names and scores from the data. A model that never writes a name cannot substitute one, and the guard has nothing to match. The largest change, and the only one that closes the class rather than the measured instances.

Recommendation: 1 now, because it removes every rejection the replay measured and touches only the match. 4 if the owner wants the class closed.

## Done conditions

1. Deployed, and the morning after (`GET /analytics/morning_report/2026-10-30`, written by the 2026-10-31 09:00Z cron) has `value.degraded` set, with its reason when true.
2. The replay has been run and its numbers are in this document. Met 2026-10-30.
3. A fix is chosen with the owner and shipped, or Task 3 is closed with a reason.
