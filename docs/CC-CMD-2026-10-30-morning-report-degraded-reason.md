# Claude Code Command — the Morning Report says "Quiet night" for two different reasons, and the row does not say which

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba (`src/morning-report.js`, `src/analytics-engine.js`); jubilant-bassoon and field-laboratory need no change, the field is still one paragraph of text
**Filed:** 2026-10-30, by CC, from the question "why is the late brief a template?"
**Status:** IN PROGRESS 2026-10-30. Task 1 (record the reason) is in `719fc0eb`. Task 2 (the replay) has run and its result is below. Task 3: the owner chose option 4 at 12:12 ET; it is built and live (`7f2549bc`, `a211e14f`, `95871f13`; Worker version `42b46f92`, 2026-10-30T17:27Z). Complete when the first morning written by the new code (the 2026-10-31 09:00Z cron, the row for 2026-10-30) has been read against the games. Task 4 (close the sentence channel) is proposed and is the owner's call.

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

## What the guard did (read from the code, then seen against the model in Task 2; removed by Task 3)

Removed 2026-10-30 (`teamNameSubstitutions` and its call are gone from `src/analytics-engine.js`). Kept because it is the evidence for the choice in Task 3. The present tense below describes the code as it was.

For each recap game (the first 16 games with a note or a numeric score) whose score appears in the prose in either order, the morning is rejected if either team is absent
(its bare name, or "the" plus its last word) or if **any capitalised word other than "The" immediately precedes a team's bare name**. `ctx.games` stores bare mascots ("Lightning", "Trail Blazers"), so a city can
never be verified, and the 2026-07-15 comment in the code makes rejecting every city deliberate. A correct "Tampa Bay Lightning" is rejected the same as a wrong one.

On 2026-10-29 the context payload has 24 eligible games; the first 16 are 3 NBA, 11 NHL, 1 WNBA, 1 Serie A. The first draft of this document guessed that the model's habit of writing the city was what trips the guard. The replay says it is not: no sample was rejected for a qualifier.

What does trip it is the first test. The score is found with `prose.includes("5-1")`, a plain substring that never checks the characters either side. So the hockey score 5-1 is found inside the basketball score "125-124", and 4-1 inside "124-103". A score shared by two games (2-0 twice on 10-27) is found for both while the prose describes one. The guard then asks for the teams of the game that was never written about, finds them absent, and throws the whole morning away.

## Task 1 — record the reason on the row (built)

Replaced in part by Task 3: the reasons are now `no-context`, `prose-empty` and `bad-structure` (a night with no game to cite is `no_games`, not degraded); `team-name-guard`, its `guard` record and `teamNameSubstitutions` are gone. The `degraded` key, `callProxyDetailed`, the public-route rule and the sweep behaviour stand. The table in Task 3 is current.

- `callProxyDetailed` returns `{ text, failure, model }`, `failure` being `http-<status>`, `bad-json`, `no-text` or null. `callProxy` delegates to it, so every other call site is unchanged.
- `selectRecapGames`, `buildMorningReportPrompt` and `teamNameSubstitutions` are the old inline code moved to exported functions. The prompt text is copied from the original lines, not retyped.
- `morning_report.value` now carries `degraded: false` on a good morning, and on a template morning `degraded: true`, `degraded_reason` (`prose-empty` with `proxy_failure`, or `team-name-guard` with `guard: { offenders, first: { sport, away, home, score, missing_team, fabricated_qualifier } }`).
  `recomputeMorningReport` (POST `/analytics/morning-report/recompute`) returns the same `outcome`.
- Unchanged: the template text, KV, `aiCalls`, `word_count`, `stars`, the guard's decision, and `circadian_late` (not marked: it is PURE, so the degraded sweep would re-copy the same template daily).
- **The rejected prose is not stored.** `GET /analytics/{feature}/{date}` serves `value` with `Access-Control-Allow-Origin: *` and `Cache-Control: public, max-age=300`, and the prose is what the guard judged fabricated. The record keeps the game, the score, the missing name or the matched qualifier ("Bay Lightning").
- Once deployed, visible in `/analytics/degraded` (`needs_manual_recompute`, since `morning_report` is AI-costing) and `session_health` (`analytics_phases.morning_report.degraded`). `JSON_EXTRACT(value,'$.degraded')` is 1 for true, 0 for false, NULL for absent (probed on D1 2026-10-30).
  A morning whose row has no key was written before this.

Verification (Rule 90): `scripts/check-morning-report-degraded.mjs`, 40 assertions on the real `recomputeMorningReport` against a mocked proxy and D1, and `scripts/mutate-morning-report-degraded.mjs`, 19 mutations, each required to go red for its stated reason. Both run in `deploy.yml` before the deploy. After Task 3 the two files hold 42 assertions and 32 mutations: the guard's cases were replaced by the contract's.
One-off, not committed: the original `analytics-engine.js` from `e7bb7830` and the new one were run through `recomputeMorningReport` on 9,000 generated cases (about 4,300 accepted, 3,200 guard-rejected, 1,500 empty answers): identical prompt, identical text written to D1 and KV,
identical `aiCalls`, 0 differences. The same comparison goes red on three deliberate changes to the new code (a prompt word: 1500 of 1500 cases; home-first scores only: 267 of 1500; the away team ignored: 9 of 1500).

## Task 2 — read the rejected prose (done 2026-10-30)

Both files named below were removed by Task 3, since the guard they replay is gone. `outbox/morning-report-guard-replay-latest.json` stays as the record, and its replacement is `scripts/probe-morning-report-cite-replay.mjs` (Task 3).

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

## Task 3 — the fix (option 4, chosen and built)

The template is a degraded output, and "No fallbacks, only fixes" applies to it. The cause the replay found is in the guard's match, not in the model: a score is found by substring, so the guard attributes it to games that were not written about. The four candidates as filed:

1. **Attribute a score only to the game it describes** (match the score as a whole number). The recommendation: it removed every rejection the replay measured and touched only the match.
2. **One corrective retry** that names the objection. 3 of 6 accepted in the replay; on 10-27 it failed for the same substring reason.
3. **Verify cities** against a (sport, mascot) to city source. The qualifier rule did not fire in any of the 12 samples, and no such table was found.
4. **Take names and scores out of the model's hands.** The largest change, and the only one that closes the class rather than the measured instances.

**The owner chose 4 at 12:12 ET ("#4 please")**, over the recommendation, knowing it was the largest. It went out in three pushes, each deployed green before the next was pushed:

| push | commit | deploy run (UTC) | content |
|---|---|---|---|
| A | `7f2549bc` | 41093528801, 16:50–17:01 | `src/morning-report.js` (pure functions, no I/O); `check-morning-report-cite.mjs` and `mutate-morning-report-cite.mjs` as a deploy step; the replay probe and its dispatch-only workflow; fixtures of the 10-27 and 10-29 slates. Phase 5 still on the old guard. |
| B | `a211e14f` | 41096192055, 17:08–17:19 | Phase 5 rewired to the module. The guard, `teamNameSubstitutions`, the guard probe and its workflow deleted. `check-morning-report-degraded.mjs` rewritten. Prompt revision 1. |
| C | `95871f13` | 41097629436, 17:18–17:28; relay Worker version `42b46f92`, live 17:27:31 | The Phase 3 tie fix (below), prompt revision 2, and `check-truth-is-ties.mjs` with `mutate-truth-is-ties.mjs` as a deploy step. |

In CI on the deploy of C: the degraded check 42 of 42 assertions and 32 of 32 mutations caught, the cite check 70 of 70 and 50 of 50, the tie check 12 of 12 and 6 of 6.

**The contract** (`src/morning-report.js`). The model is shown each completed game as `g1 | NHL | final 5-2, margin 3, total 7`, with `, went to overtime` when the row says so, `ended level 1-1` for a draw, and `event update, no score` for an event row (golf). It is shown no team name. Phase 3's game is left out of the list, because its headline is printed already. It answers with lines `open:`, `gN:` and `close:`. The relay prints Phase 3's headline, the open line, then for each pick `Winner score, Loser score.` (winner first; on a tie the away team first; an event row as `Event (round): note`) followed by the model's sentence, then the close line.

A model line is dropped, and recorded by key and reason, never by text, when it contains a digit (`digit`); contains a team or event name from the whole night's slate, as a whole case-sensitive word of 3 or more characters (`team-name`); is over 60 words (`too-long`); has no terminal punctuation (`unterminated`); cites an id that is not in the list (`unknown-id`) or one already used (`duplicate-id`); is a second open or close (`duplicate-open`, `duplicate-close`); is beyond the fifth pick (`over-limit`); or is not in the form (`unrecognized-line`). Nothing in the module looks for a score in prose or decides whether prose is true.

**Row outcomes** (`morning_report.value`). `brief_text` is the composed paragraph in the first row of the table and the template in the other four.

| `degraded` | `degraded_reason` | other keys | when |
|---|---|---|---|
| false | | `cited` (relay game ids); `dropped` only when a line was dropped | at least one game line survived |
| false | | `no_games: true` | no completed game to cite (the template is accurate) |
| true | `no-context` | | the context graph was unreadable |
| true | `prose-empty` | `proxy_failure` | the proxy returned no text |
| true | `bad-structure` | `structure: { recognized, dropped }` | text came back and no game line followed the contract |

**Phase 3 named a winner for a draw.** Found while checking what Phase 5 now prints as written. `detectAnomalies` took `winner = home_score > away_score ? home : away`, which gives every tie to the away side. Three stored `truth_is` rows, read from `/analytics/truth_is/{date}` on 2026-10-30: 2026-10-23 "Málaga beat Alavés 1-1 as a +500 underdog", 2026-10-25 "Troyes beat Toulouse 0-0 as a +450 underdog" (the 0-0 also counted as a shutout), 2026-10-28 "Cincinnati beat Miami 2-2 as a +360 underdog". The old and the fixed function, run over the 22 context snapshots 2026-10-08..29, differ on 9 days: 5 led with a draw described as a win (10-10, 10-17, 10-23, 10-25, 10-28) and 4 counted draws among the "N unusual finishes" (10-11, 10-14, 10-22, 10-24). The fix skips a tied game, whatever the sport, the score or the price. A hat trick in a drawn game is therefore no longer reported.

**What the production model did.** `scripts/probe-morning-report-cite-replay.mjs` (dispatch only) rebuilds the prompt with the production function for 11 dates (2026-10-19..29), asks the real proxy once per date, and runs the production parser and composer over the answer. One sample per date, because repeated samples of one prompt are byte-identical. `gemini-3.1-flash-lite` answered all 33. Results are in the git history of `outbox/morning-report-cite-replay-latest.json` (`f59e6803`, `db3420d9`, `85c212c5`).

| | replay 1: first prompt (run 41093765836) | replay 2: revision 1 (run 41096216815) | replay 3: revision 2, live (run 41097656905) |
|---|---|---|---|
| composed | 11 of 11 | 11 of 11 | 11 of 11 |
| game lines kept (dropped) | 37 (0) | 43 (0) | 44 (0) |
| answers naming a slate team or event | 0 | 0 | 0 |
| a digit in a sentence | not measured | 0 | 0 |
| answers that named a side (home, visitors) | 8, with 10 claims of which 5 were wrong | 0 | 0 |
| answers saying "closest" or "biggest" | 3 | 0 | 0 |
| lines with a flow, crowd or conduct marker | 6 of 37 | 31 of 43 | 15 of 44 |
| days with at least one such line | 4 of 11 | 10 of 11 | 9 of 11 |
| a false fact about the game | not measured | 0 of 43 | 1 of 44 |

How the last three rows were measured: offline, on the raw answers; the relay parses nothing of the kind. A *marker* is any of: throughout, until the, from the (very) first/start/opening/outset, early on, to the end, duration of, final moments/buzzer/whistle/out; traded, trading, pull/pulled/pulling away, maintained, controlled the pace, mounted, surged, rallied, comeback, battled, remained tense/tight/competitive/undecided; poise, composure, resolve, focus, tension, tense, tight, thrilling, exhilarating, intense, intensity, spirited, relentless, effort; spectators, fans, observers, crowd, engaged; exhibition, classic, rivalry. The list over-counts: a game that went to overtime was undecided until the extra period, and "fans witnessed" is filler. Read by eye, 6 of the 15 marker lines in replay 3 assert something the row cannot back ("kept spectators fully engaged", "of great intensity", "from the very first moment", "offensive efficiency throughout", "from the very first pitch until the final out", "struggled to find their offensive flow throughout"), 3 more assert effort or focus, and 6 are filler or follow from the row. A *false fact* is a sentence compared with its own game row on number words (against the two scores, the margin and the total), overtime (against `went_to_ot`), "single goal/point/run" (against margin 1), a level result (against equal scores) and the sport word.

The one false fact: 2026-10-28, Kraken 5, Maple Leafs 4. The sentence said "This hockey match required an extra period before the winning side finally emerged victorious." The row has `went_to_ot` 0 and ESPN event 401892599 reads "SEA 5 vs TOR 4 | Final", with no overtime or shootout suffix. The model was not told of any overtime.

What the three runs show: names, scores and the form hold in all 33 answers (composed 11 of 11 in each, against 53 template mornings of 107 under the guard). The failure that is left moves with the prompt: forbidding the side words and the comparatives (revision 1) removed them and the model filled the sentences with how the game went; forbidding that (revision 2) cut the markers from 31 to 15 and left a false overtime. The prompt is a request; nothing in the contract can enforce it without reading the prose.

**What option 4 did not close**

1. The sentence about each game is still written by the model, and carries claims about the game's shape (above). By decision nothing reads it for truth: a check that reads prose can be wrong in both directions, which is what the guard was.
2. Number words are not machine-checked in the relay. The offline check found no wrong number in 87 lines (replays 2 and 3).
3. A name for a team that is not on the night's slate cannot be detected. None was seen in the lines read.
4. `went_to_ot` is 0 for regulation and NULL when ESPN's period was unknown (`computeWentToOT` returns null). The model is told only when it is true, so it cannot tell 0 from NULL, and "after four quarters" or "after sixty minutes" asserts regulation for both. 3 such lines in replay 3, all on rows with 0. No NBA or NHL row in 2026-10-08..29 was NULL (281 scored rows: 235 with 0, 46 with 1), so for these sports the silence has meant regulation; the contract does not say so.
5. A night whose only completed game is Phase 3's gets `no_games` and the template. Never seen: all 22 days 2026-10-08..29 had 11 or more citable games.
6. The open and close lines repeat across days. Replay 3: 9 of 11 closes begin "We look forward", 9 of 11 mention a sunrise, dawn or new day, 7 of 11 opens say "unexpected outcomes". Replays 1 and 2 repeat as well (7 of 11 closes begin "We carry the" in replay 1; 6 of 11 begin "May the quiet" in replay 2). The same prompt gives the same answer, so the repetition comes from the prompt and the slate.

## Task 4 — close the sentence channel (proposed, the owner's call)

Option 4 moved names and scores out of the model's hands. The sentence it writes about each game is still a channel for claims the row cannot back, and three prompts on the same 11 days show the failure moving: side claims, then game-flow narrative, then fewer markers and one false overtime. Each revision costs a suite run, a deploy (about 11 minutes) and a replay, and 11 observations cannot show that a rate has reached zero.

Proposal: the relay writes the sentence for each game from the row it prints the score from: the sport, the margin class (thresholds per sport), `went_to_ot` (when true), a level result and the total class, from a small set of fixed phrasings. The model keeps what only it can do: choose which games to feature (`pick: g3, g7, g1`) and write the open and close lines, which name no game and no team and are held to the rules above. No game sentence is then model-written, so none can be false.

What it costs: the game lines lose the model's voice. Replay 3 printed "Rangers 5, Ducks 2. The victors displayed a commanding presence on the ice during this hockey encounter."; this would print "Rangers 5, Ducks 2. A three-goal win." The open and close lines stay generic. About 100 minutes: the phrase function and its thresholds, the form and the parser, the check and its mutations, the suite, one deploy and one replay.

Not needed before Saturday. The first morning under the current design is read by the check in the done conditions below.

## Done conditions

1. Deployed. Met: push C live 2026-10-30T17:27:31Z, relay Worker version `42b46f92`.
2. The replay has been run and its numbers are in this document. Met (three runs).
3. A fix is chosen with the owner and shipped. Met: option 4.
4. The first morning written by the new code is read against the games. `GET /analytics/morning_report/2026-10-30`, written by the 2026-10-31 09:00Z cron (05:00 ET; daylight time ends 2026-11-01), has `value.degraded` false with `cited` non-empty, or a `degraded_reason`. Each `Winner n, Loser n.` pair in `brief_text` equals the row in `/context/date/2026-10-30`. Each model sentence is read for a claim its row cannot back: overtime on a row whose `went_to_ot` is 0 or NULL, a margin or total that is not the row's, how the game went. Scheduled task `trig_01YXBNhWJFgRU3SHCY9KMPsR` reads it at 09:15Z and appends the result here. No recompute (Rule 78).
5. Task 4 is decided, or closed with a reason, by the owner.
