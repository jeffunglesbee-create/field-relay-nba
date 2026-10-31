# Claude Code Command — the Morning Report says "Quiet night" for two different reasons, and the row does not say which

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba (`src/morning-report.js`, `src/analytics-engine.js`); jubilant-bassoon and field-laboratory need no change, the field is still one paragraph of text
**Filed:** 2026-10-30, by CC, from the question "why is the late brief a template?"
**Status:** IN PROGRESS 2026-10-30. Task 1 (record the reason) is in `719fc0eb`. Task 2 (the replay) has run and its result is below. Task 3: the owner chose option 4 at 12:12 ET; it is built and live (`7f2549bc`, `a211e14f`, `95871f13`; Worker version `42b46f92`, 2026-10-30T17:27Z). Task 4: the owner ordered it at 16:59 ET; built and live (`b6c46113`; Worker version `c91c0747`, 2026-10-30T21:40Z), with the command that checks a stored morning against its rows. Complete when the first morning written by the new code (the 2026-10-31 09:00Z cron, the row for 2026-10-30) has been read against the games.

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

**The contract** (`src/morning-report.js`; superseded by Task 4 for what the model answers: it now answers `pick:`, `open:` and `close:`. This is the contract that ran from 17:27Z to 21:40Z on 2026-10-30). The model is shown each completed game as `g1 | NHL | final 5-2, margin 3, total 7`, with `, went to overtime` when the row says so, `ended level 1-1` for a draw, and `event update, no score` for an event row (golf). It is shown no team name. Phase 3's game is left out of the list, because its headline is printed already. It answers with lines `open:`, `gN:` and `close:`. The relay prints Phase 3's headline, the open line, then for each pick `Winner score, Loser score.` (winner first; on a tie the away team first; an event row as `Event (round): note`) followed by the model's sentence, then the close line.

A model line is dropped, and recorded by key and reason, never by text, when it contains a digit (`digit`); contains a team or event name from the whole night's slate, as a whole case-sensitive word of 3 or more characters (`team-name`); is over 60 words (`too-long`); has no terminal punctuation (`unterminated`); cites an id that is not in the list (`unknown-id`) or one already used (`duplicate-id`); is a second open or close (`duplicate-open`, `duplicate-close`); is beyond the fifth pick (`over-limit`); or is not in the form (`unrecognized-line`). Nothing in the module looks for a score in prose or decides whether prose is true.

**Row outcomes** (`morning_report.value`). `brief_text` is the composed paragraph in the first row of the table and the template in the other four.

| `degraded` | `degraded_reason` | other keys | when |
|---|---|---|---|
| false | | `cited` (relay game ids); `dropped` only when a line was dropped | at least one game line survived |
| false | | `no_games: true` | no completed game to cite (the template is accurate) |
| true | `no-context` | | the context graph was unreadable |
| true | `prose-empty` | `proxy_failure` | the proxy returned no text |
| true | `bad-structure` | `structure: { recognized, dropped }` | text came back and no game line followed the contract |

**Phase 3 named a winner for a draw.** Found while checking what Phase 5 now prints as written. `detectAnomalies` took `winner = home_score > away_score ? home : away`, which gives every tie to the away side. Three stored `truth_is` rows, read from `/analytics/truth_is/{date}` on 2026-10-30: 2026-10-23 "Málaga beat Alavés 1-1 as a +500 underdog", 2026-10-25 "Troyes beat Toulouse 0-0 as a +450 underdog" (the 0-0 also counted as a shutout), 2026-10-28 "Cincinnati beat Miami 2-2 as a +360 underdog". The old and the fixed function, run over the 22 context snapshots 2026-10-08..29, differ on 9 days: 5 led with a draw described as a win (10-10, 10-17, 10-23, 10-25, 10-28) and 4 counted draws among the "N unusual finishes" (10-11, 10-14, 10-22, 10-24). The fix skips a tied game, whatever the sport, the score or the price. A hat trick in a drawn game is therefore no longer reported. The fix changes new rows only: the three stored rows above still read as quoted, nothing rewrites past rows, and no recompute was fired.

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

**What option 4 did not close** (kept as it stood when option 4 shipped. Task 4 closed items 1, 2 and 4 for the game lines and narrowed item 3 to the open and close lines; items 5 and 6 stand.)

1. The sentence about each game is still written by the model, and carries claims about the game's shape (above). By decision nothing reads it for truth: a check that reads prose can be wrong in both directions, which is what the guard was.
2. Number words are not machine-checked in the relay. The offline check found no wrong number in 87 lines (replays 2 and 3).
3. A name for a team that is not on the night's slate cannot be detected. None was seen in the lines read.
4. `went_to_ot` is 0 for regulation and NULL when ESPN's period was unknown (`computeWentToOT` returns null). The model is told only when it is true, so it cannot tell 0 from NULL, and "after four quarters" or "after sixty minutes" asserts regulation for both. 3 such lines in replay 3, all on rows with 0. No NBA or NHL row in 2026-10-08..29 was NULL (281 scored rows: 235 with 0, 46 with 1), so for these sports the silence has meant regulation; the contract does not say so.
5. A night whose only completed game is Phase 3's gets `no_games` and the template. Never seen: all 22 days 2026-10-08..29 had 11 or more citable games.
6. The open and close lines repeat across days. Replay 3: 9 of 11 closes begin "We look forward", 9 of 11 mention a sunrise, dawn or new day, 7 of 11 opens say "unexpected outcomes". Replays 1 and 2 repeat as well (7 of 11 closes begin "We carry the" in replay 1; 6 of 11 begin "May the quiet" in replay 2). The same prompt gives the same answer, so the repetition comes from the prompt and the slate.

## Task 4 — the relay writes the sentence about each game (built)

The owner ordered it at 16:59 ET ("Task 4"), on the proposal that stood here. Built and live as `b6c46113`: deploy run 41131995398 green (21:34:01Z to 21:41:49Z), relay Worker version `c91c0747-5da4-44b8-90e6-3e1291d34ebc` deployed 2026-10-30T21:40:38Z, `/health` RELAY OK at 21:42:47Z. About 35 minutes from the order to the push, against the 100 estimated. The command that checks a stored morning against its rows (`scripts/verify-morning-report.mjs`) is in the commit with this text.

**The contract now.** The model is shown the same list as before (`g1 | NHL | final 5-2, margin 3, total 7`, with `, went to overtime` when the row says so, and no team name; Phase 3's game is left out). It answers three lines: `pick:` the ids of the games to feature, most important first (the first five known ids are kept); `open:` one sentence; `close:` one sentence. The relay prints Phase 3's headline, the open line, then for each pick `Winner n, Loser n.` followed by one sentence the relay writes from the game's row, then the close line. A pick line is read as a list of known ids and nothing else, so no word of the model's reaches a game line. The open and close lines are held to the rules in Task 3 (no digit, no name from the night's slate, 60 words, a full stop). New drop reasons: `unrecognized-pick` (a word on the pick line that is not an id, recorded once per line) and `duplicate-pick` (a second `pick:` line); the retired per-game `gN:` form is `unrecognized-line`. The keys on a row's `dropped` are `pick`, `open`, `close` and the ids. Row outcomes are unchanged.

**The sentence** (`resultShape` and `resultSentence` in `src/morning-report.js`). The sport label gives a family, the unit of score and the word for play past regulation. The kind of result comes from the two scores and `went_to_ot`, tested in this order:

| kind | when | phrasings, in the order they are handed out (hockey, 5-2 shown as 3) |
|---|---|---|
| `scoreless` | 0-0 | Neither side scored. / A scoreless finish. / Not a score on the board for either side. |
| `level-ot` | level, row says overtime | Level after overtime. / Overtime could not separate the sides. / All square after overtime. |
| `level` | level | Finished level. / All square at the end. / Neither side finished ahead. |
| `win-ot` | row says overtime | A one-goal win after overtime. / Won by one goal after overtime. / It went to overtime, and one goal separated the sides. |
| `shutout` | the loser scored 0 | A four-goal shutout. / The losing side was held scoreless. / Four goals to nothing. |
| `wide` | margin at or over the family's wide threshold | A lopsided four-goal win. / Won by a wide margin of four goals. / Four goals clear at the end. |
| `narrow` | margin at or under the family's narrow threshold | A narrow one-goal win. / Won narrowly, by one goal. / Just one goal between the sides at the end. |
| `win` | any other | A three-goal win. / Won by three goals. / Three goals separated the sides. |

| family | labels | unit | past regulation | narrow at or under | lopsided at or over |
|---|---|---|---|---|---|
| hockey | NHL | goal | overtime | 1 | 4 |
| soccer | EPL, MLS, La Liga, Serie A, Bundesliga, Ligue 1, FIFA World Cup, the UEFA Champions, Europa and Europa Conference Leagues and their qualifying rounds, EFL Championship, League One, League Two, Cup and Trophy | goal | extra time | 1 | 3 |
| basketball | NBA, WNBA, wnba | point | overtime | 3 | 20 |
| baseball | MLB | run | extra innings | 1 | 6 |
| gridiron | NFL, CFB, CFL, UFL | point | overtime | 3 | 21 |
| fact line only | AFL, IPL, PGA Tour, golf, and any label the table does not name | | | | |

Three phrasings per kind are handed out in turn within one report, per kind, so two plain wins in one report read differently. "After overtime", "extra time" and "extra innings" are printed only when the row's `went_to_ot` is `1` or `true`; `0`, NULL, missing and anything else say nothing, and no sentence claims regulation. A score that is not a whole, non-negative number gets no sentence. The row's own sport word is used (goals, points, runs), and number words are spelled out ("An eleven-point win.", "A lopsided twenty-one-point win.").

**How it was checked.** `scripts/lib/morning-report-oracle.mjs` states the spec a second time, with its own sport table, thresholds, number words and the wording of every phrasing, and imports nothing from `src/`, so a change in the module disagrees with it. `check-morning-report-cite.mjs` runs the module against it over every declared label × score × overtime flag, every margin from 0 to 144 in each family, the edges of both classes, 400 random slates with canary tokens (no word of the model's reaches a game line) and the two real slates in the Task 3 fixtures; it also asserts that every sport label the archive declares has a decision. Rule 90: `mutate-morning-report-cite.mjs` breaks the module 127 ways (the kind order, the overtime rule, each threshold, the number words, the articles, each phrasing, the rotation, the parser) and requires the check to go red for the stated reason each time; `mutate-morning-report-degraded.mjs` breaks Phase 5 32 ways. In CI on `b6c46113`: cite check 107 of 107 and 127 of 127 mutations, degraded check 43 of 43 and 32 of 32, tie check 12 of 12 and 6 of 6. Measured on the saved context of 2026-10-08..29: 908 scored rows, 901 with both team names, and all 901 get a sentence; no label is unmapped. (Rows with no score, such as golf, are not in that count and print as a fact line.)

Share of rows by kind in those 901 (the classes are wording, set by reading these margins; a different cut changes the word and not the truth): hockey 160 rows, narrow 19%, lopsided 14%, overtime 24%; basketball 132, narrow 9%, lopsided 22%, overtime 7%; gridiron 235, narrow 23%, lopsided 21%; soccer 357, narrow 23%, lopsided 9%, level 20%, shutout 33%; baseball 17.

**The verifier.** `node scripts/verify-morning-report.mjs YYYY-MM-DD` reads `/analytics/morning_report/<date>`, `/context/date/<date>` and `/analytics/truth_is/<date>` (three GETs, no LLM call) and checks the stored morning against the rows with the same oracle. For each game the row cites, the text must hold exactly the fact line and exactly the sentence the spec has for that row, in the phrasing its turn calls for; before the first game it must hold Phase 3's headline and an open line, after the last the close line, and nothing else; the open and close lines are checked for a digit, a slate name, length and a full stop; `word_count` must equal the text's. Exit 0 verified, 1 defects (each names the game and the text), 2 nothing to verify (a degraded morning names its reason; a night with no game; no row), 64 usage, 70 a route or saved answer could not be read. `--dir DIR` reads three saved route answers instead of the network. A difference can be a row finalised after the 09:00Z cron (a `went_to_ot` filled in later); the finding says which game, so `finalized_at` can be read beside it. The check pins the library with 21 tampered mornings (a number, "after overtime", a score, a team, a phrasing out of turn, a sentence removed or added, two games swapped, a digit or a slate name in the open or close line, a missing headline, a wrong `word_count`) and 17 mutations of the library, and pins the command's exit codes through `--dir`. Local result for the commit with this text: 145 assertions, 144 mutations caught. CI runs them from the next deploy that touches `src/`; this commit changes scripts only.

**What the production model did.** Replay 4 (run 41132004691, 2026-10-30T21:34Z, commit `a1d85a64`; the same 11 dates, one sample each, `gemini-3.1-flash-lite` answered all 11). Every printed fact line, descriptor and sentence was then compared with the game's row from the saved context, with the oracle: 44 picks, 43 with a relay sentence and all 43 equal the oracle's sentence for the row, the 44th a golf row printed as its fact line. A tampered copy of the same file (24 sentences altered: a number word, "after overtime" turned into "in regulation", an article) is flagged on 24 of 24.

| | replay 3: the model wrote each game's sentence (live prompt, run 41097656905) | replay 4: the relay writes it |
|---|---|---|
| composed | 11 of 11 | 11 of 11 |
| picks printed | 44 | 44 (4 per day) |
| lines dropped | 0 | 0 |
| answers naming a slate team or event | 0 | 0 |
| a digit in a model line | 0 | 0 |
| sentences about a game written by the model | 44 | 0 |
| game sentences that disagree with their row | 1 of 44 (Kraken 5, Maple Leafs 4: "required an extra period"; the row and ESPN 401892599 have no overtime) | 0 of 43 |
| game lines with a flow, crowd or conduct marker | 15 of 44 | 0 (there is no model text in a game line) |
| open and close lines with such a marker (the same list) | 0 of 22 | 1 of 22 ("the cycle of effort begins once again", not about a game) |
| opens saying "unexpected" | 7 of 11 | 4 of 11 |
| closes beginning "We look forward" | 9 of 11 | 11 of 11 |
| closes mentioning light, dawn, sunrise, sun, morning or a new day | 9 of 11 | 7 of 11 |
| words in the composed morning | | 77 to 102 |

The kinds the model's picks fell in (43 sentences): overtime win 19, plain win 12, narrow 8, level 2, lopsided 1, shutout 1. 19 of the 43 picks were overtime games; overtime games are 48 of the 901 scored rows (5%) in 2026-10-08..29.

The same game on the same date, before and after. 2026-10-28, replay 3: "Kraken 5, Maple Leafs 4. This hockey match required an extra period before the winning side finally emerged victorious." Replay 4: "Kraken 5, Maple Leafs 4. A narrow one-goal win." 2026-10-29, replay 4: "Mammoth 4, Penguins 3. A one-goal win after overtime. Islanders 4, Wild 3. Won by one goal after overtime. Kings 6, Senators 5. It went to overtime, and one goal separated the sides."

**What the voice costs.** The game lines are now the score and a statement of the result. "Rangers 5, Ducks 2. The victors displayed a commanding presence on the ice during this hockey encounter." (replay 3) reads "Rangers 5, Ducks 2. A three-goal win." A plain win's sentence restates the margin. That is the trade the proposal named.

**What Task 4 did not close**

1. The open and close lines are still the model's, and nothing reads them for truth. They are generic by construction: 11 of 11 closes begin "We look forward", and 4 of 11 opens say "unexpected" (on a night whose Phase 3 type is `convergence` that follows the gloss the prompt gives; on 10-29, type `none`, the open was "The gentle stillness of the evening"). Another prompt revision would move the stock phrase, as the three before it moved the others, and 11 observations cannot show a rate. If the repetition matters, the relay can write the close line too (a few fixed lines chosen by date), which closes the last channel and drops the close from the model's task. That is the owner's call.
2. The class thresholds (narrow, lopsided) are wording set from 22 days of margins. "Lopsided" for 21 points in the NFL or 20 in the NBA is a choice.
3. `went_to_ot` is filled only for NBA, NHL, MLB, WNBA, EPL and MLS in 2026-10-08..29. For other leagues an overtime game prints as its margin alone ("A narrow one-point win."), true and incomplete. No sentence claims regulation.
4. AFL, IPL, PGA Tour, golf and any label the table does not name print the fact line only. An unmapped label fails the declared-label test in the check, so a new league is a decision made in the module, not a silent gap.
5. Rows stored before 2026-10-31 09:00Z keep the sentences the model wrote.
6. A night whose only completed game is Phase 3's still gets `no_games` and the template (never seen; all 22 days had 11 or more citable games).
7. Replay 4 shows the model followed the form on 11 of 11 days; it cannot show a rate. What the relay writes is checked by construction and by the oracle, not sampled.

## Done conditions

1. Deployed. Met: push C live 2026-10-30T17:27:31Z, relay Worker version `42b46f92`.
2. The replay has been run and its numbers are in this document. Met (three runs).
3. A fix is chosen with the owner and shipped. Met: option 4.
4. The first morning written by the new code is read against the games. Run `node scripts/verify-morning-report.mjs 2026-10-30` (Node 22; with `--dir` on three saved route answers if its fetch cannot reach the relay). The row is written by the 2026-10-31 09:00Z cron (05:00 ET; daylight time ends 2026-11-01). Exit 0: every game the report cites is printed as exactly the fact line and the sentence the oracle has for its row, and the open and close lines follow the form. Exit 1: the findings name the game and the text. Exit 2: nothing to verify, with the reason on the row (`degraded_reason`, `no_games`). The open and close lines are read for stock wording. Scheduled task `trig_01YXBNhWJFgRU3SHCY9KMPsR` runs it at 09:15Z and appends the result here. No recompute (Rule 78).
5. Task 4 is decided, or closed with a reason, by the owner. Met: ordered 2026-10-30 16:59 ET, built and live 21:40Z. What it left open is the list above; closing this document is the owner's.

## Observed 2026-10-31

Read 2026-10-31T09:17:17Z (verifier run; route GETs at unix time 1793438228 + cache-busting `x=`). Row written `2026-10-31 09:00:16`; `/analytics/status` `last_run` `2026-10-31T09:00:20.075Z`, `date_processed` 2026-10-30, `phases_failed` [], `ai_calls_made` 3, `errors` []. `/analytics/degraded`: `total` 0 since 2026-10-17. `/analytics/truth_is/2026-10-30`: type `convergence`, headline "5 unusual finishes — led by Espanyol beat Villarreal 1-0 as a +650 underdog."

`data.value` verbatim:

```
{"word_count":80,"stars":2,"degraded":false,"cited":["Ligue 1_2026-10-30_e401876420","NBA_2026-10-30_e401909280","NHL_2026-10-30_e401892611","Bundesliga_2026-10-30_e401884746"]}
```

No `dropped` key, so nothing was dropped.

`brief_text` verbatim:

```
5 unusual finishes — led by Espanyol beat Villarreal 1-0 as a +650 underdog. A collection of unexpected outcomes unfolded across the globe while the world remained tucked away in peaceful slumber. Lille 1, Lens 0. A one-goal shutout. 76ers 98, Knicks 93. A five-point win. Devils 5, Golden Knights 2. Won by three goals. Elversberg 4, Mainz 1. A lopsided three-goal win. Fresh possibilities await as the sun rises to illuminate the path toward another cycle of athletic endeavor.
```

Verifier output (`node scripts/verify-morning-report.mjs 2026-10-30`, Node 22.23.4, live fetch, no `--dir`), verbatim:

```
morning_report 2026-10-30  written 2026-10-31 09:00:16  read 2026-10-31T09:17:17.287Z
value: {"word_count":80,"stars":2,"degraded":false,"cited":["Ligue 1_2026-10-30_e401876420","NBA_2026-10-30_e401909280","NHL_2026-10-30_e401892611","Bundesliga_2026-10-30_e401884746"]}
brief_text: 5 unusual finishes — led by Espanyol beat Villarreal 1-0 as a +650 underdog. A collection of unexpected outcomes unfolded across the globe while the world remained tucked away in peaceful slumber. Lille 1, Lens 0. A one-goal shutout. 76ers 98, Knicks 93. A five-point win. Devils 5, Golden Knights 2. Won by three goals. Elversberg 4, Mainz 1. A lopsided three-goal win. Fresh possibilities await as the sun rises to illuminate the path toward another cycle of athletic endeavor.
games on the night: 23; Phase 3 headline: 5 unusual finishes — led by Espanyol beat Villarreal 1-0 as a +650 underdog.

  Ligue 1_2026-10-30_e401876420  Lille 1, Lens 0. A one-goal shutout.   [shutout, phrasing 0]
  NBA_2026-10-30_e401909280  76ers 98, Knicks 93. A five-point win.   [win, phrasing 0]
  NHL_2026-10-30_e401892611  Devils 5, Golden Knights 2. Won by three goals.   [win, phrasing 1]
  Bundesliga_2026-10-30_e401884746  Elversberg 4, Mainz 1. A lopsided three-goal win.   [wide, phrasing 0]
  open : A collection of unexpected outcomes unfolded across the globe while the world remained tucked away in peaceful slumber.
  close: Fresh possibilities await as the sun rises to illuminate the path toward another cycle of athletic endeavor.

VERIFIED  4 game(s): each fact line and sentence is the spec's for its row; open and close follow the form
exit=0
```

Exit code: 0.

Verdict: VERIFIED. The morning was composed (`degraded:false`, no `no_games`), and every game line is the relay's and true of its row. Counts: 23 games on the night, 4 cited and printed, 4 verified, 0 findings, 0 dropped.

Open line, verbatim: "A collection of unexpected outcomes unfolded across the globe while the world remained tucked away in peaceful slumber."
Close line, verbatim: "Fresh possibilities await as the sun rises to illuminate the path toward another cycle of athletic endeavor."

Stock wording: the open says "unexpected outcomes", which is replay 4's stock phrase (4 of 11 opens). The close does not begin "We look forward" (replay 4: 11 of 11), but it uses the sunrise image ("as the sun rises"), one of the stock motifs the task names. The open also carries a night/sleep image ("peaceful slumber"). The open fits the Phase 3 type `convergence`, following the gloss the prompt gives for it ("unexpected"). One morning is one observation and shows no rate.

Done condition 4: met. The row was written by the 2026-10-31 09:00Z cron, the verifier exited 0, and the open and close lines were read for stock wording (above). The Status line is unchanged; closing this document and the question of the relay writing the close line remain the owner's.
