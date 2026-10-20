# Readers of odds_history prices and of opening/closing moneylines — 2026-10-20

docs/CC-CMD-2026-10-19-odds-history-american-converted-twice.md TASK 0.2 and 0.3.

**Method:** a workflow of 38 agents (workflow run wf_822e317f-e78), read-only.
- **Finders:** one per repo. Each searched with the patterns listed under its repo below.
- **Verifiers:** a skeptic re-read every reader whose finder did not answer "no" to *affected*, told to refute it.

**Columns:**
- *unit*: the unit the code assumes.
- *affected*: whether 211 American odds_history rows, or blobs holding +27400 or a null side, change its output.
- *verdict*: the skeptic's call (confirmed or refuted).

**Citations:** relay readers carry a fragment of the cited line, read at commit-time. Other repos' readers name the repo and the line as the census found it.

**Totals:** 69 readers. 34 re-checked: 27 confirmed, 7 refuted.

**Coverage:** every reader each finder found, in all four repos. Tracked files only. The census ran before the repair, against the damaged state.

**After the repair (2026-10-20):**
- Blobs hold the row's own American integers, which every blob reader below assumes.
- odds_history holds decimal, which every reader of it assumes.
- No committed artifact in any repo holds a damaged value.
- D1 holds 0 briefs and 0 analytics_output rows for these games written after the damage landed.
- The one reader the D1 repair cannot reach is the client's field-debriefs Cache API. It is filed as jubilant-bassoon docs/CC-CMD-2026-10-20-debrief-cache-outlives-archive-repair.md.

## field-relay-nba — 30 readers

<details><summary>Searches</summary>

```
Repo /home/user/field-relay-nba, read-only; nothing edited. Patterns (grep -a / rg):
1. grep -rlaE 'opening_odds|closing_odds|odds_history|home_ml|away_ml|draw_ml|americanToDecimal|decimalToAmerican' src scripts .github/scripts .github/workflows workers containers (93 files)
2. grep -naE 'opening_odds|closing_odds|odds_history|home_ml|away_ml|draw_ml|moneyline|americanToDecimal|decimalToAmerican|impliedProb' src/index.js, then the same per src module
3. grep -rnaE 'winnerMoneylinePrice|selectLineOdds|computeOddsStory|lineSpread\(|parseOddsJSON|knownPostKickoff' src scripts .github workers
4. grep -rnaE 'home_ml|away_ml|draw_ml|moneyline|decimalToAmerican|americanToDecimal|impliedProb|implied' scripts .github/scripts, plus a per-file count over every odds script
5. grep -naiE 'odds|moneyline|underdog|favorite' src/analytics-engine.js; grep -naiE "lineMovement|favorite|underdog|\.moneyline" src/index.js
6. grep -naE "SELECT \* FROM (regular_season_games|postseason_games)" src/*.js (passthrough routes)
7. grep -rnaE 'getRecentChanges|new_value' src/*.js
8. grep -rnaE 'oddsFormat=[a-z]+' src scripts .github/scripts (blob convention American: index.js line 6780/6921, ambient-do.js line 812; odds_history writers: odds-backfill.js line 195 decimal, targeted-odds-fill.mjs American)
9. grep -rnaE 'INTO odds_history' src scripts .github/scripts
10. grep -naE 'opening_odds|closing_odds|odds_history|home_ml|away_ml|moneyline' .github/workflows/*.yml (no inline readers)
11. Route callers: grep -rnlE 'debrief-backfill|/archive/backfill|backfill/game-briefs|odds-story/preview|/odds/history/|analytics/newspaper|/archive/date/|/archive/sport/' scripts .github src
12. Committed artifacts: grep -rlaE 'moneyline\\?"?:\{[^}]{0,80}(-?[0-9]{5,}|null)|ML [0-9]{4,}|27400|\+[0-9]{5,}' outbox docs; grep for 'sacramentost' in field-laboratory/jubilant-bassoon *.json
13. node over outbox/fixture-odds-pairs-2026-10-19.json (_targeted rows) and outbox/targeted-odds-fill-*.log (apply times)

Facts that differ from the task's framing:
(a) The committed fixture holds 210 _targeted rows. They are dated 2026-05-24 (La Liga 1), 08-08 (EFL Cup 29), 08-25 (EFL Cup 17), 08-29/09-03/09-05/09-12 (CFB 8/8/67/67) and 09-13 (NFL 13). That is not 08-22..09-19.
(b) All 210 snapshot_times precede start_time, so most damaged closing blobs will not be marked post-kickoff and the kickoff-rule readers still use them. This is an inference from snapshot timing; the _kickoff marks were not read from D1.
(c) opening == closing moneyline on all 210.
(d) Targeted applies ran 2026-09-16T01:24Z (1 row), 09-18T17:32Z (66), 09-19T02:51Z (1) and 03:26Z (143), 211 in total. The sync runs at 10:00Z, so the blobs landed 2026-09-16..09-19. That is after every game-time reader (recaps, daily analytics) had already run for those dates.
(e) The working tree has an uncommitted edit to scripts/targeted-odds-fill.mjs (oddsFormat=decimal, citing scripts/check-odds-history-units.mjs, which does not exist yet) and an untracked outbox/fixture-odds-american-targeted-2026-10-20.json. I did not make or touch either.
Not checked: jubilant-bassoon or field-laboratory reader code (out of scope), and D1 contents (briefs/analytics_output/change_log), since no network calls were made.
```
</details>

| reader | unit | affected | artifacts | verdict |
|---|---|---|---|---|
| `.github/scripts/odds-backfill.js:441` `async function syncOddsToGameTables() {` | decimal. decimalToAmerican at 434-438 does 'dec <= 1 -> null', 'dec >= 2 -> (dec-1)*100'. Applied at 547-548 (home/away… | yes. This is where the damage happens: 275 -> 27400, -345 -> null, and the same for draw. Repair caveat: the candidate predicate is 'opening_odds IS NULL OR closing_odds IS NULL', so if TASK 2(b) NUL… | D1 only: 206 game rows (both columns) and change_log rows source='odds_backfill' whose new_value holds the damaged JSON, written by the runs of 2026-09-16 to 0… | confirmed: Yes. All six of the finder's line references are real. The trace holds: - I ran decimalToAmerican under node: 275 -> 27400, -345 -> null, 250 -> 24900, -110 ->… |
| `src/odds-name-match.js:221` `export function pricesByTeam(game, row) {` | either/agnostic. It only re-orders the two prices by team orientation and returns them unchanged. | no. The unit passes through untouched. | none | not re-checked (finder: no effect) |
| `src/analytics-engine.js:454` `const ml = winnerMoneylinePrice(g);` | american. 'if (ml != null && ml >= 200)' -> headline 'as a +${Math.round(ml)} underdog', rarity_score = min(0.95, 0.5 +… | yes, whenever it runs for a damaged date. If the underdog (positive side) won, it reads +27400 and publishes 'beat X as a +27400 underdog' at rarity 0.95. For soccer, both sides are positive, so any … | D1 analytics_output rows feature='truth_is'/'morning_report' and KV field:morning_report:{date}, served by /analytics/*. Nothing committed. Only a re-run of /a… | confirmed: The code path is affected. The stored outputs are not, which matches the finder's "historically clean". I checked this against live D1 with read-only queries. … |
| `src/analytics-engine.js:790` `const spread = lineSpread(game);` | points (spread.home/away/line); no moneyline read | no. Sync blobs carry no spread, and none of the damaged sports is in Phase 9. | none | not re-checked (finder: no effect) |
| `src/index.js:18609` `if (pathname.startsWith('/analytics/newspaper/') && request.` | american. Favourite is 'homeML < 0 && awayML > 0'; upset needs 'underdogML >= 150'; both sides must be typeof 'number'. | yes, for date = damaged date + 1. On a 2-way blob one side is null, so the typeof check fails and wasUpset is false. On a 3-way blob both sides are huge positives, so there is no favourite and wasUps… | none persisted (computed per request) | confirmed: Yes. Real upsets are hidden and none are invented. I checked all 211 of the 211 _targeted rows in live D1 (field-archive cc49101c, read-only SELECTs on 2026-10… |
| `src/index.js:5883` `if (debriefCtx.opening_odds_parsed) {` | american. Prints '${v > 0 ? '+' : ''}${v}', giving 'Odds: opened home X / away Y, closed ...'. | Not historically: every recap was generated at game end, and the blobs were written 2026-09-16 to 09-19, after all 8 damaged dates. Any regeneration would print 'opened home null / away +27400' into … | none affected (briefs/KV recaps predate the damage) | not re-checked (finder: no effect) |
| `src/index.js:9544` `if (_dc.opening_odds_parsed) {` | american (same '+' formatting as 5886-5891) | no. It only reads today's games, and every damaged game was already past when its blobs were written. | none | not re-checked (finder: no effect) |
| `src/index.js:9090` `SELECT home, away, sport, opening_odds FROM regular_season_g` | american/raw print | no (today only) | none | not re-checked (finder: no effect) |
| `src/index.js:7103` `if (g.opening_odds) {` | raw print 'ML ${o.moneyline.home}/${o.moneyline.away}', so american by convention | yes, if a slate backfill ran or runs for one of the 8 dates after 2026-09-16. The prompt would contain 'ML null/27400'. Whether one did is not knowable from code. | D1 briefs source='backfill' (not committed; unknown) | confirmed: The mechanism is real, but the timing makes damage unlikely and it is not yet proven either way. The finder's date description is also wrong. 1. I executed the… |
| `src/index.js:7641` `async function findGame(env, id) {` | either/agnostic (passthrough) | yes. It serves the damaged blobs verbatim. | transient KV ctx:{id} only | confirmed: Yes, as a passthrough. I ran it to check: I extracted findGame (src/index.js line 7641-7689) and called it with a mock ARCHIVE_DB row whose opening and closing blob… |
| `src/index.js:12411` `if (pathname.startsWith('/context/date/')) {` | either/agnostic (passthrough) | yes. It serves the damaged blobs verbatim for 2026-05-24, 08-08, 08-25, 08-29, 09-03, 09-05, 09-12 and 09-13. | field-laboratory data/context-2026-08-29.json (committed 2026-08-29) holds CFB_2026-08-29_emichigan_sacramentost with opening/closing null. It predates the dam… | confirmed: Yes. The core claim holds and the damage is live. The probe_relay_route GET /context/date/2026-05-09 (HTTP 200) returned the IPL game 2026-05-09-ipl-rajast-guj… |
| `src/index.js:12633` `if (pathname.startsWith('/archive/date/')) {` | either/agnostic (passthrough) | yes (verbatim) | none | confirmed: Yes. The output carries the bad blobs exactly as stored, with no further change. These routes never read odds_history, so the 211 American-unit rows do not rea… |
| `src/index.js:12727` `if (pathname === '/archive/debrief-backfill' && request.meth` | either/agnostic (copy) | Yes, if it was run for an affected date after 2026-09-16. The persisted copies would not be fixed by a blob repair. | D1 briefs brief_type='debrief' source='debrief_backfill' (unknown; not committed) | confirmed: Latent only. No persisted damage exists today. 1. **Mechanism confirmed.** For a game carrying a damaged blob, the route would copy +27400 or 'home:null' verba… |
| `src/index.js:16935` `if (pathname.startsWith('/odds/history/')) {` | either/agnostic passthrough. There is no unit field, so the response mixes decimal (_close) and American (_targeted) ro… | yes. A consumer cannot tell -345 from 2.72. | none | REFUTED: No in practice. There is only a latent contract gap. 1. The file:line is real. src/index.js line 16935 is GET /odds/history/{game_id}. It SELECTs those six price co… |
| `src/index.js:12052` `if (pathname === '/odds-story/preview') {` | american. Diff in points, threshold >= 10, prints '+'. | no. The committed fixture shows opening == closing moneyline on all 210 targeted rows (one sync JSON written to both columns), so movement is 0 and the output is '' either way. | outbox/late-close-story-suppressed-2026-09-14T22-49-11-421Z.log predates the damage | not re-checked (finder: no effect) |
| src/analytics-engine.js near line 1612 (line moved since the census) | Neither: reads spread/line/point_spread, columns odds_history does not have. The :1920 result is discarded ('void odds'… | no | none | not re-checked (finder: no effect) |
| `src/brief-freshness.js:35` `function _favoriteFlipped(oldOdds, newOdds) {` | american. Favourite flip is a change in the sign of moneyline.home. | no. Sync entries have old_value NULL, which counts as first population and is not material. A TASK 2 repair logged under an _ODDS_SOURCES source also cannot trip it: old home null fails typeof; old 2… | none | not re-checked (finder: no effect) |
| `src/index.js:16582` `if (pathname.startsWith('/changelog/') && request.method ===` | either/agnostic (passthrough) | yes. The 2026-09-16 to 09-19 odds_backfill entries carry the damaged JSON (if still retained; cleanupChangelog deletes only consumed rows older than 30 days). | D1 change_log (not committed) | REFUTED: Partly refuted. The location, the passthrough description and the MCP allow-list entry are correct. "Affected: yes" is wrong for today's output. 1. The damaged… |
| `src/index.js:16818` `if (pathname === '/d1/execute' && request.method === 'POST')` | either/agnostic (generic passthrough) | yes, as a carrier only | none | confirmed: Yes, but only as a carrier. The claim holds. The 211 American rows and the +27400 / null-home blobs never change what the handler does: the same branch runs, w… |
| `src/index.js:21729` `const ALLOWED_PREFIX = ['/squiggle', '/context/game', '/cont` | either/agnostic (passthrough, body truncated at 12000 bytes) | yes (verbatim) | none | confirmed: Yes, but only as a transport, never as an independent reader. Fixing the D1 blobs fixes its output with no code change at this line. 1. /context/game/<id>: fin… |
| `src/index.js:15898` `if (pathname === '/identity/substitution-census' && request.` | either/agnostic (presence and digest equality) | No for units. A TASK 2 rewrite changes the digest of any repaired row that has a collision twin. | none | not re-checked (finder: no effect) |
| `src/index.js:14641` `g.home_score, g.away_score, g.closing_odds,` | n/a | no | none | not re-checked (finder: no effect) |
| `scripts/census-odds-pairs.mjs:77` `for (const [side, src, game] of [['home', r.home_ml, r.openi` | Decimal, via its own decimalToAmerican copy (43-49), with an American detector 'x <= -100 \|\| x >= 100' for UNITS | Yes, and it has a coverage gap. UNITS does 'if (src == null \|\| game == null ...) continue', so a negative-American side whose blob value is null is skipped. '229 sides on 206 rows' counts only the po… | outbox/fixture-odds-pairs-2026-10-19.json, outbox/odds-stage2-wrong-pair-2026-10-19.log (UNITS at 269), outbox/odds-stage1-wrong-game-2026-10-20.log (UNITS at … | confirmed: Confirmed. The script is affected, and its UNITS section has a coverage gap. I ran it at HEAD 38f18515 over the committed fixture (776 rows: 210 _targeted, 566… |
| `scripts/probe-captured-at-provenance.mjs:96` `const bh = r.blob_home, ah = r.home_ml, ba = r.blob_away, aa` | Assumes both are the same unit ('Number(bh) === Number(ah)'). They never are for _close rows (blob American, odds_histo… | Yes on re-run: a damaged row with null home counts as 'unreadable', otherwise DIFFER. The verdict was already unit-confused before this defect. | outbox/captured-at-provenance-2026-09-15T13-40-32-852Z.log, -13-46-29-210Z.log, -13-54-44-744Z.log. All predate the first targeted apply (2026-09-16T01:24Z), s… | REFUTED: No. The claim that a re-run would be affected is refuted. Section B only takes rows where json_extract(closing_odds,'$.captured_at') <> oh.snapshot_time (line … |
| `scripts/probe-late-close-consumer-flip.mjs:134` `const mlLegacy = winnerMoneylinePrice(r, LEGACY);` | american (upset at >= 200, via odds-consumer-rules) | Yes on re-run: damaged rows where the underdog won count as +10000-class upsets in both columns. Targeted snapshots are all pre-kickoff, so no flip. | outbox/late-close-consumer-flip-2026-09-14T22-{40-34,42-02,49-00}*.log predate the damage | confirmed: Yes, on a re-run. The repair in commit 8925d63f was "generated, not applied", so D1 still holds the damaged blobs. The finder's claim holds, with three refinem… |
| `scripts/verify-staged-items.mjs:187` `identical_moneyline: JSON.stringify(o.moneyline) === JSON.st` | either/agnostic (identical_moneyline is reported, never failed) | no | none affected | not re-checked (finder: no effect) |
| `scripts/odds-coverage-census.mjs:23` `export const hasDraw = odds => {` | either/agnostic (presence) | Marginal. A negative-American draw became null and reads as 'no draw'; a positive draw (>= 10000) still reads as present. Would matter only for the 46 EFL Cup + 1 La Liga rows. | outbox/odds-coverage-census.log covers 2026-10-19/20 only, so not affected | confirmed: The location is real, the script reads the values the finder named, and the finder's conclusion of no artifact damage holds. The finder overstates the impact, … |
| `scripts/opening-odds-at-finalisation-probe.mjs:68` `const o = parseOdds(row.opening_odds)` | either/agnostic (finiteness only) | no. Sync blobs carry no spread, so they are ineligible either way. | none affected | not re-checked (finder: no effect) |
| `scripts/repair-odds-wrong-pairs.mjs:120` `id = ${g} AND ${fromRow(f, ohId)} AND json_extract(${f}, '$.` | decimal origin (WVU 9.7/1.06), exact-value guard | no. Every id it touches is a _close (decimal) row. | none affected | not re-checked (finder: no effect) |
| `scripts/check-odds-backfill-attribution.mjs:77` `ok(() => /home: decimalToAmerican\(byTeam\.home\)/.test(SRC)` | decimal (pins the sync's conversion text) | Not by data. Any TASK 1 option (b) that edits the conversion line breaks this regex and both mutation anchors. Option (a), decimal at the writer, leaves them valid. | none | not re-checked (finder: no effect) |

## jubilant-bassoon — 13 readers

<details><summary>Searches</summary>

```
Repo /home/user/jubilant-bassoon at HEAD 6284472b; relay cross-checks read in /home/user/field-relay-nba at a4208b46. I edited nothing and committed nothing. The only files written are two scratch simulations: /tmp/claude-0/-home-user/dfa35103-8193-50fb-8b54-7f960ab15595/scratchpad/sim-damaged.mjs and /tmp/claude-0/-home-user/dfa35103-8193-50fb-8b54-7f960ab15595/scratchpad/sim-mixed.mjs. They import the real src/debrief/index.ts and src/utils/odds.js under node v22.22.2 and push correct and decimalToAmerican-damaged blobs through them.

Greps over jubilant-bassoon (excluding node_modules and .git; the second set also excluding outbox and docs):
1. `grep -rn -a -E "opening_odds|closing_odds|odds_history|home_ml|away_ml|draw_ml|americanToDecimal|decimalToAmerican|opening_odds_parsed|closing_odds_parsed"`
2. `grep -rln -a -E "opening_odds|closing_odds|odds_history|home_ml|away_ml|draw_ml|over_under|moneyline|americanToDecimal|decimalToAmerican|impliedProb|_impliedPct|oddsOutcome|buildOddsStory|buildOddsMovement|odds/history|_upsetDogPrice|_isUpset|computeMarketConsensus|wasUpset"`

Inside src/legacy/field.js:
3. Identifier tally: `grep -o -E "[A-Za-z_\.\?]*odds[A-Za-z_\.\?]*"`
4. `grep -E "\bodds\b|oddsProbs|oddsData|_oddsCache|oddsKey|oddsToLambda|pHome"`. These are live Odds-API / CFL / WC readers (/cfl/odds-probs, /wc/odds-probs, wp_update SSE), not odds_history or blob readers, so they are excluded.
5. `grep -E "_ctxG\s*=|context/game|oddsOutcome|_parsed\b|moneyline"`
6. Relay-route fetch sites: `grep -E "odds/history|/archive/d1|d1-query|/d1/query|/analytics/|/context/game|/archive/sport/|/archive/date/|/archive/series/|/archive/last-meeting|/archive/tagged"`. I traced fetchArchiveDate, fetchSeriesArchive and fetchLastMeeting; their consumers read streams, series narrative and scores only.
7. `grep -E "wasUpset|completed_games|fetchNewspaper\("`
8. `grep -E "isVolatileMatchup\(|\bodds\s*:\s*\{|\.odds\s*=|odds:\s*[a-zA-Z_]"`. game.odds is never assigned client-side; isVolatileMatchup (src/utils/odds.js line 3) reads game.odds.moneyline on raw schedule games, not odds_history or blobs.
9. `grep -E "context/date|games\.regular|games\.postseason"`. The past-date slate uses /v2/games, which carries no odds.

Other files:
10. field_utils.js: toImpliedNum (American) has zero callers in field.js and index.html. Its only other user is indexreview.html, a stale May snapshot that is not built or deployed.
11. src, workers and tests: `grep -i -E "odds|moneyline|implied"`. tier-game.js and chart.js only mention odds in comments; field-betfair-relay has no odds_history or blob reads.
12. scripts, .github, odds_line_probe.js: `grep -i -E "select[^\n]{0,200}(odds|_ml)"` and `"d1 execute|/admin/d1|/d1/|query-d1|ARCHIVE_DB"`. The only hit, seed-mls-return-2026.py, seeds MLS schedule rows and touches no odds columns. scripts/odds_probe.py reads the live Odds API through the /odds proxy, not odds_history.
13. sw.js: `grep -E "odds|moneyline"` and `"field-debriefs|X-Cache-Time"`.
14. CONTRACTS.md:209-217 documents the blob moneyline as American.
15. index.html's script block is the synced copy of field.js and contains the same readers.

Relay checks (source reading, because sandbox egress to the relay returned CONNECT 403):
- `grep "/archive/upsets"`: no such route; unmatched /archive/* paths return 404 at src/index.js line 14085.
- /archive/query SQL (src/index.js line 13811-13816) selects from briefs only.
- /odds/history route (src/index.js line 16935-16960) returns `{ok, game_id, odds:[...]}`.
- findGame (src/index.js line 7672-7681) produces opening_odds_parsed.
- The newspaper wasUpset (src/index.js line 18705-18724) reads closing_odds.
- decimalToAmerican (.github/scripts/odds-backfill.js line 434-438) and the sync's JSON.stringify keep `home: null`.

Artifact scans:
- 788 recorded text rows across outbox/odds-line-probe-manifest-*.json.
- `grep -l -E "(Home|Away|moneyline|opened)[^\"]{0,40}[+][0-9]{5}|null · |\+0\"|\((0|1)% implied\)" outbox/*.json outbox/*.md`: 0 files.
- `git log --diff-filter=A -- scripts/targeted-odds-fill.mjs` (relay): first commit 59d1f38b, 2026-09-15. This was used to date the odds-story-wire artifact as pre-damage.
```
</details>

| reader | unit | affected | artifacts | verdict |
|---|---|---|---|---|
| jubilant-bassoon/src/debrief/index.ts, line 142 | american. Evidence: 'homeFav = (ml.home ?? 0) < (ml.away ?? 0)' and the price line '${favTeam} ${(favMl ?? 0) > 0 ? '+'… | yes. I ran the real module in node (scratch sim). True -345/+275 with home winning 21-10 renders '[CHALK/QUIET] \| Home -345 · Away +275'. The damaged blob {home:null, away:27400} renders '[CHALK/QUIE… | none. No committed fixture or outbox file carries a damaged blob. The deploy-gate check (.github/workflows/deploy-gate.yml line 234-237) uses hand-written American … | confirmed: Yes. All five parts of the claim hold, and the real data is slightly worse than the claim says. 1. The function and line are real. Line 142 of jubilant-bassoon… |
| jubilant-bassoon/src/debrief/index.ts, line 351 | american. Evidence: '_impliedPct(american)' at line 322 is 'american < 0 ? (-a)/(-a+100)*100 : 100/(a+100)*100', and '_… | yes. Verified with the real module in node. When the damaged home price is null, the function returns null and the layer silently disappears, which looks the same as the no-odds state. When it is +27… | odds_line_probe.js captures this text into outbox/odds-line-probe-manifest-*.json (112 files). I scanned all 788 text rows and every outbox *.json/*.md for dam… | confirmed: Yes, but the finder's example outputs are partly wrong. **Why some examples cannot happen.** The relay fixture 'outbox/fixture-odds-american-targeted-2026-10-2… |
| jubilant-bassoon/src/legacy/field.js, line 2462 | either/agnostic. It copies the parsed objects into debrief.oddsOutcome {opening, closing, homeScore, awayScore, home, a… | yes (as a carrier). Damaged values pass through unchanged to the two layers above. | none | confirmed: Yes, as a carrier, and the claim holds. 1. **Location.** jubilant-bassoon HEAD 6284472b. src/legacy/field.js line 2462 is 'function buildEnrichedGame(rawGame, sourc… |
| jubilant-bassoon/src/legacy/field.js, line 2611 | either/agnostic. It stores and serves the JSON response verbatim. | yes. It carries the damage and also persists it: a browser that already opened a damaged game keeps rendering the cached damaged blob after the D1 repair. That lasts until a SW activation happens mor… | none committed. The per-browser Cache API entries 'https://field-local/debrief/{id}' are not in git. | confirmed: Yes. I simulated the render formulas on the 211 rows in field-relay-nba outbox/fixture-odds-american-targeted-2026-10-20.json. Blob shapes: home null / away a … |
| jubilant-bassoon/src/legacy/field.js, line 11692 | american. The comment at line 11704 says 'American odds: higher positive number = bigger underdog'. renderUpsets labels… | no. It never receives a blob. The relay has no /archive/upsets route (field-relay-nba src/index.js line 14085 returns 'Archive endpoint not found' 404). The fallback /archive/query selects only from brief… | none | not re-checked (finder: no effect) |
| jubilant-bassoon/src/legacy/field.js, line 11802 | either/agnostic. The favourite is 'mlH < mlA' (ordering only), which holds in decimal, in same-sign American, and in mi… | no. /archive/query serves briefs rows only, which never carry opening_odds, so the section stays hidden. | none | not re-checked (finder: no effect) |
| jubilant-bassoon/src/legacy/field.js, line 21567 | american (in the relay producer). Evidence: 'homeFav = homeML < 0 && awayML > 0' and the underdog threshold 'underdogML… | no for current output. Today's recap date is 2026-10-19, outside the 2026-08-22..09-19 damage window, and the client cannot request another date. In history, a damaged blob gives null (typeof check f… | none (the bundle is not committed) | not re-checked (finder: no effect) |
| jubilant-bassoon/scripts/night-owl-email.js, line 147 | unclear/none. It reads data.opening.spread and data.current.spread, which the route never serves. home_ml and away_ml a… | no. It always returns null whatever the stored unit is. It also asks for tonight's pre-game ESPN ids, not the damaged past games. | none (email only) | not re-checked (finder: no effect) |
| jubilant-bassoon/odds_line_probe.js, line 314 | american (inherited from buildOddsMovement's formatting; the probe records the text verbatim). | yes, if run on a damaged slate date. The recorded text would carry '+27400 (0% implied)', and null-home games would be counted as no_odds. The scheduled 1-day step-back now lands outside the window. | outbox/odds-line-probe-manifest-*.json (112) and outbox/odds-line-probe-*.png (111). The scan found zero damage signatures in all 788 recorded text rows. | confirmed: Latent only. Nothing the probe has committed so far is affected. 1. The chain is real: D1 regular_season_games.opening_odds/closing_odds → relay findGame JSON.… |
| jubilant-bassoon/scripts/probe-odds-story-wire.mjs, line 62 | either/agnostic (equality only). Rows with a null home price are excluded by 'oh != null && ch != null'. | yes if re-run on damaged dates: null-home rows drop out of the identical/different tallies and the sample could be a damaged blob. The committed run is not affected. | outbox/odds-story-wire-20260912T010900Z.json, probed 2026-09-12T01:09Z. It predates the first commit of scripts/targeted-odds-fill.mjs (59d1f38b, 2026-09-15), … | confirmed: Confirmed, with three refinements. (1) A re-run with the default dates is NOT affected. The fixture puts all 211 damaged rows (211 distinct game_ids, each id's… |
| jubilant-bassoon/scripts/probe-context-game-odds.mjs, line 37 | either/agnostic. It checks presence only (booleans and key names) and never reads a price. | no. A damaged blob is still present and truthy. | outbox/context-game-odds-*.json (111 files). They contain only booleans and odds key names; there are no prices. | not re-checked (finder: no effect) |
| jubilant-bassoon/scripts/check-odds-story-scenario.mjs, line 23 | american (the fixtures are American prices). | no (no stored data is read) | none | not re-checked (finder: no effect) |
| jubilant-bassoon/src/debrief/index.ts, line 129 | unclear. The relay prompt formats the values as American; the client displays the prose verbatim (first 300 characters). | unclear. It is affected only if a game_recap for one of the ~206 damaged games was generated or regenerated after its damaged blob landed. Settling it needs a D1 query on briefs for those game ids wi… | none in jubilant-bassoon. Any damage would live in the field-archive briefs table, as would the relay /archive/debrief-backfill copies (brief_type 'debrief', O… | REFUTED: No, measured. The file:line is real, the data path is real, and so is the relay's American formatting. But no brief for any of the 211 damaged games was writte… |

## field-laboratory — 17 readers

<details><summary>Searches</summary>

```
Repo: /home/user/field-laboratory at 1841798, tracked files only (git ls-files; build/ and public/ are gitignored copies). Read-only: nothing was edited, committed or pushed.

1. `git ls-files -z | xargs -0 grep -a -l -i -E 'opening_odds|closing_odds|odds_history|home_ml|away_ml|draw_ml|over_under|americanToDecimal|decimalToAmerican|moneyline'` over the whole repo.
2. `grep -n -i -E` with the same patterns over src/*.fs, scripts/*.mjs|py|sh and .github/workflows/*.yml.
3. `git ls-files scripts src .github test | xargs grep -a -l -i -E 'odds|implied|impliedProb|clv|closing.?line|vig|devig'`, then each hit grepped for 'odds|implied|moneyline|devig|winprob'.
4. Outside docs/ and outbox/: `grep -a -l -i -E 'odds-story|oddsStory|/odds|odds_api|odds-api|the-odds-api|_close|_targeted|targeted-odds|odds-backfill'`.
5. `grep -n -E "\bml\b|_ml\b|\bML\b"` over src, scripts, .github and test.
6. Every tracked file (`grep -a -n -E 'odds_history|home_ml|away_ml|draw_ml|over_under|odds_backfill'`). The only odds_history reader is merge-duplicate-pairs.mjs. No lab code reads home_ml, away_ml, draw_ml or over_under by name.
7. Callers of the Desk odds functions: `grep -n -E 'winProbability|oddsStory|favouriteAgreement|impliedOfMoneyline|OpeningOdds|ClosingOdds|bestOdds|Moneyline(Home|Away|Draw)|spreadOf|totalOf|spreadPricingOf' src/*.fs`.
8. Consumers of the in-window captures: `grep -n -E 'context-2026-08-29|context-2026-09-05'` over scripts, src, .github and package.json.
9. Fixed-string scans of all 767 tracked lab files against relay outbox/fixture-odds-american-targeted-2026-10-20.json (211 of 211 _targeted rows):
   - the 211 damaged game_ids appear only in data/context-2026-08-29.json (8), data/context-2026-09-05.json (67), data/brief-join-corpus.json (29), data/brief-recency-corpus.json (25), outbox/2026-09-03-unrecognised-id-shapes.md and outbox/unrecognised-id-shapes-latest.json. None of those carries an odds value (the corpora have no opening_odds key; the captures hold null odds for every damaged id).
   - the 106 distinct damaged blob values (`\+?(27400|299900|…)` with digit boundaries) over docs, outbox, README.md, STATUS.md and data: 0 matches.

Runtime probe, not just reading: /tmp/claude-0/-home-user/dfa35103-8193-50fb-8b54-7f960ab15595/scratchpad/probe-damaged.mjs runs the local build/Desk.js (dated 2026-10-17 04:11, after the last Desk/Units/Scoreboard source commit at 10-17 00:00; Market.js is newer than Market.fs's last commit, 08-23) on synthetic damaged, true and decimal blobs. Outputs are quoted in the readers.

Cross-boundary facts confirmed by running:
- relay src/index.js line 12411 (/context/date) is SELECT * from both game tables.
- odds-backfill.js line 434 decimalToAmerican and 546-553 blob composition: no spread key.
- targeted-odds-fill.mjs first commit and first log are 2026-09-15T22:18Z.

Correction to the task context: the 211 damaged rows are not limited to 08-22..09-19. They fall on 2026-05-09 (IPL 1), 05-24 (La Liga 1), 08-08 (29), 08-25 (17), 08-29 (8), 09-03 (8), 09-05 (67), 09-12 (67) and 09-13 (13). By sport: CFB 150, EFL Cup 46, NFL 13, La Liga 1, IPL 1. By side: home null on 160 rows, away null on 32, both null on 4; 23 rows are all-positive three-way.

Checked and excluded as non-readers:
- scripts/probe-epl-substrate.mjs: counts rows by sport only.
- src/Forecast.fs, scripts/forecast-run.mjs, forecast-store.mjs: MarketImplied is never built from odds.
- src/Draw.fs: tennis odds_player1/2 from BSD, not the archive.
- units-check.mjs, wp-check.mjs, Suite.fs: fixed literals.
- outlet-scan-check, pickem-check, state-check, unnamed-check: synthetic null odds.
- data/brief-*-corpus.json: no odds keys.
- test/malformed-nested.json: a synthetic corrupt fixture.
```
</details>

| reader | unit | affected | artifacts | verdict |
|---|---|---|---|---|
| field-laboratory/src/Program.fs, line 24 | either/agnostic. It moves the payload as text and reads no price. | yes, as the path the bad data takes. Opening ?date= on any of the 9 damaged dates (2026-05-09, 05-24, 08-08, 08-25, 08-29, 09-03, 09-05, 09-12, 09-13) delivers the double-converted blobs to every rea… | none | confirmed: Yes, but only as the path the bad data takes. Program.fs's own output does not change. Both damaged shapes decode cleanly. A null home becomes None through get… |
| field-laboratory/src/Desk.fs, line 993 | american. Evidence: each side is read with Decode.int. Ran it against the compiled build: a decimal blob {home:2.35,...… | yes. A damaged value like +27400 is a valid int and decodes as Some 27400. A null side decodes as None. Nothing bounds the size, so damaged blobs read as Decoded, not Malformed, and the error stays s… | none | confirmed: Yes, for the live render. No committed artifact carries the damage. How a damaged blob reaches the decoder: decimalToAmerican (relay .github/scripts/odds-backf… |
| field-laboratory/src/Units.fs, line 88 | american. Evidence: \|ml\| < 100 returns None; negative gives m/(m+100); positive gives 100/(ml+100). | yes. 27400 is accepted as a valid price and gives implied 0.0036. The only plausibility check is \|ml\| < 100. | none (units-check.mjs / wp-check.mjs / Suite.fs test it with fixed literals only) | confirmed: Yes, but only on one of the three paths the finder named, and only for 23 games. 1. The reader is real and is reached live. Program.fs fetches the relay's /con… |
| field-laboratory/src/Desk.fs, line 1541 | american. impliedOfMoneyline, then Market.devigTwoWay / devigThreeWay. | yes. Ran it on the local build/Desk.js, which is newer than its sources. A CFB blob {home:null, away:27400} renders an empty line where the true -345/+275 gives "H 74% · A 26%". EFL Cup 13400/19400/2… | none | confirmed: Yes. I tried to refute the claim on every point and it held. I checked it against live D1 data (field-archive cc49101c, read-only SELECTs), not just synthetic … |
| field-laboratory/src/Scoreboard.fs, line 262 | american. priceText formats with sprintf "%+d / %+d" on ints, and returns "no moneyline" if either side is None. | yes. In all 211 rows opening equals closing with the same captured_at (relay fixture outbox/fixture-odds-american-targeted-2026-10-20.json), so every damaged card takes the NOT SEQUENCED branch. 188 … | none | confirmed: Yes, confirmed, but the finder's rendered text is wrong in two places. 1. The reader is real and does run on these rows. Program.fs line 24/74-77 fetches RELAY_DATE… |
| field-laboratory/src/Desk.fs, line 1364 | american. impliedOfMoneyline, and the overround threshold is computed from the two implied prices. | no. The sync blob carries no spread key (odds-backfill.js line 546-553 writes only moneyline, draw and total), so every damaged row is NotComparable whatever the unit. | none | not re-checked (finder: no effect) |
| field-laboratory/src/Desk.fs, line 1438 | american, in the Moved branch only (impliedOfMoneyline). The sequencing test does not depend on the unit. | no. In all 211 damaged rows opening equals closing with an identical captured_at, so the result is NotASequence before any price is read. | none | not re-checked (finder: no effect) |
| field-laboratory/src/StatsView.fs, line 139 | either/agnostic for these rows. Only the Moved branch uses implied terms. | no. Damaged rows read "open/close not sequenced — one snapshot written twice", the same text correct values would give. | none | not re-checked (finder: no effect) |
| field-laboratory/scripts/drift-check.mjs, line 197 | american (through Desk.favouriteAgreement / impliedOfMoneyline) | no. It reads each date only on that day. Every damaged date is 2026-09-13 or earlier, and targeted-odds-fill first ran at 2026-09-15T22:18Z, so every reading came before the damage. The damaged rows … | outbox/drift-log.md (counts only), outbox/sport-vocabulary-*.json, outbox/odds-coverage-series.json. A scan of all 767 tracked files found none of the 106 dist… | not re-checked (finder: no effect) |
| field-laboratory/scripts/odds-coverage.mjs, line 39 | either/agnostic. It counts presence only. | no. decimalToAmerican nulls a negative draw, but none of the 47 damaged three-way rows had one, so withDraw is unchanged. | outbox/odds-coverage-series.json. The 2026-08-29 and 09-05 entries were seeded from the committed captures, which predate the damage. Every later entry is date… | not re-checked (finder: no effect) |
| field-laboratory/scripts/favourite-band-census.mjs, line 309 | american. Line 49: implied = a < 0 ? -a/(-a+100) : 100/(a+100). | no. Line 314 skips any row with null mh/ma/sh/sa, and damaged blobs have no spread. The 2026-10-11 runs read windows that include 08-29 through 09-13, but their BY SPORT table lists only CFL, MLB and… | outbox/favourite-band-census-2026082[56]*.txt (taken before the damage), outbox/favourite-band-census-20261011T*.txt, outbox/favourite-band-census-latest.json.… | not re-checked (finder: no effect) |
| field-laboratory/scripts/cc-cmd-followup.mjs, line 83 | either/agnostic. It checks key presence only and never reads a price. | no. It reads only yesterday, outside the damaged dates, and presence does not change with the unit. | none (prints to the sentinel log) | not re-checked (finder: no effect) |
| field-laboratory/scripts/odds-shape-census.mjs, line 71 | either/agnostic. The signature is the key set, plus ALL NULL when every side is null. | no for what is committed. A {home:null, away:27400} moneyline gets the same {away,home} signature as a correct one. If dispatched on a damaged date, its verbatim sample could quote a damaged value wi… | outbox/odds-shape-census-20260921T023554Z.md (probed 2026-09-20 and 09-19, neither a damaged date) | not re-checked (finder: no effect) |
| field-laboratory/scripts/render-check.mjs, line 525 | either/agnostic for integers. It would catch decimal values, because they render as ODDS MALFORMED. | no. The committed captures predate the damage. It also cannot see the damage: a card with "no moneyline" or "+27400" passes all three assertions. | none committed | not re-checked (finder: no effect) |
| field-laboratory/scripts/capture-render-fixture.mjs, line 24 | either/agnostic. It copies and reads no price. | no today. The damaged games are in the captures but without odds: 8 of 8 damaged ids in data/context-2026-08-29.json and 67 of 67 in data/context-2026-09-05.json have null opening_odds and closing_od… | data/context-2026-08-29.json, data/context-2026-09-05.json (no damaged values), copied to public/data/ at build | not re-checked (finder: no effect) |
| field-laboratory/scripts/merge-duplicate-pairs.mjs, line 108 | either/agnostic. It copies and compares by equality and never reads a price. | no. It has only run for MLS and WNBA. A run on CFB, EFL Cup or NFL would carry a damaged blob across unchanged, without changing it further. | outbox/mls-merge-latest.json, outbox/wnba-merge-latest.json (2026-09-03, sports without damage) | not re-checked (finder: no effect) |
| field-laboratory/scripts/sport-vocabulary-check.mjs, line 152 | either/agnostic. The fields are dropped. | no | outbox/sport-vocabulary-*.json (contain no odds) | not re-checked (finder: no effect) |

## field-playground — 9 readers

<details><summary>Searches</summary>

```
Repo /home/user/field-playground at HEAD 6e3e41b. Read-only: nothing was edited, committed or pushed.

1) grep -rIlaiE 'opening_odds|closing_odds|odds_history|home_ml|away_ml|draw_ml|over_under|americanToDecimal|decimalToAmerican|moneyline|impliedProb|implied_prob' over the whole repo, excluding node_modules and .git. A second pass covered dist/ separately. Matching files: src/components/{DeskCard,DeskModes,DrillDown,TonightsPick}/index.jsx, src/data/schemas/context-date-games.json, scripts/probe-line-movement.mjs, vite.config.js, .github/workflows/line-movement-probe.yml, 4 docs/outbox session docs, dist/assets/index-B6W3-j60.js (untracked build output; dist/ is not in git ls-files) and committed outbox files: 130 artifact-under-test-*.html bundles, line-movement-probe-*.txt, schema-check-*.txt, cfl-scoreboard-shape-*.txt. The cfl files match ESPN scoreboard 'moneyline' shape counts, not odds_history.

2) The same pattern with -n over src scripts vite.config.js vite.config.artifact.js .github index.html public wrangler.toml.

3) grep -rnaiE 'odds|implied|favou?rite|underdog|arbitrage|lineMovement|parseOdds' over src scripts vite configs .github index.html public. The only extra hits are unrelated: impliedSide parses editorial score strings, WcBracketOdds reads Monte Carlo pChamp, Arbitrage reads PRICES.

4) grep -rnaE '\bml\b|[\x27"]ml[\x27"]' over src scripts .github vite.config.js.

5) grep -rnaiE 'americanToDecimal|decimalToAmerican|impliedProb|implied_prob|home_ml|away_ml|draw_ml|over_under|odds_history|/odds-story|/odds' over src scripts .github vite configs index.html public. Zero code hits: no file in this repo reads odds_history columns or calls a conversion helper.

6) grep -rlaE 'deskStore|pollRecordings|createDayContext|anomalyCorpus|context/date' to list every consumer of the /context/date payload, cross-checked against hits for 'odds' and 'moneyline'. Only the 4 components above and scripts/probe-line-movement.mjs read odds fields; reconcileWorker, ReplayDemo, the anomaly corpus and about 20 other scripts do not. I also searched for generic full-row dumps (Object.keys/entries/JSON.stringify of game rows) and found none that render odds.

7) grep -laE 'ML [+-]?[0-9]|ML odds|\+[0-9]{5}' over committed outbox json/txt manifests: no rendered odds values found.

Cross-boundary facts checked in field-relay-nba:
- src/index.js line 12411 /context/date is SELECT * on both game tables.
- .github/scripts/odds-backfill.js line 434 decimalToAmerican returns null for x<=1 and (x-1)*100 for x>=2. The sync writes the same blob to opening_odds and to closing_odds for past games with a measured snapshot_time.
- git log --diff-filter=A scripts/targeted-odds-fill.mjs shows 59d1f38b, 2026-09-15 22:18Z.
- node -e runs of fmtOdds, DeskModes.moneyline, fieldDelta and sameValues on the damaged shapes.
```
</details>

| reader | unit | affected | artifacts | verdict |
|---|---|---|---|---|
| field-playground/src/components/DeskCard/index.jsx, line 368 | american. fmtOdds (line 354) adds '+' to any positive number. OddsLine (line 449) prints 'ML {away} / {home}' with no c… | yes, when a viewer opens a damaged date (?d=2026-08-22..2026-09-19) and expands a CFB, EFL Cup, NFL or La Liga card. node -e on fmtOdds: {home:null, away:27400} renders 'ML +27400 / ' with the home s… | No committed rendered values. A grep of outbox/*.json and *.txt for 'ML <n>', 'ML odds' and '+NNNNN' found nothing. outbox/artifact-under-test-*.html (130 file… | confirmed: Yes, as claimed. I could not refute it. Path: GET /context/date/{date} (relay src/index.js line 12411, 'SELECT * FROM regular_season_games WHERE date = ?' and the s… |
| field-playground/src/components/DeskCard/index.jsx, line 419 | either/agnostic. fieldDelta (line 396) skips any side that is not a number and reports bv-av. MovementLine (line 488) t… | yes. A damaged opening blob compared with a separately captured closing blob reports a spurious move. node -e: fieldDelta({home:null,away:27400},{home:-340,away:270}) gives [{away, 27400 -> 270}], an… | none | REFUTED: No for lineMovement (line 419), MovementLine and TonightsPick. Yes for a different reader in the same OddsRow. 1. The file and line are real. lineMovement read… |
| field-playground/src/components/TonightsPick/index.jsx, line 68 | either/agnostic. It uses only movement?.status === 'moved' and never reads the values. | unclear and unlikely. Line 100 drops games whose gameStatus is final or final_ot. Every damaged row is dated 2026-08-22..2026-09-19, so it reaches this code only if the row still has home_score null … | none | confirmed: None, and this was measured, so it is stronger than the finder's "unclear and unlikely". The finder rested its case on the final/final_ot filter at line 100, w… |
| field-playground/src/components/DeskModes/index.jsx, line 94 | american by intent: the comment at line 84 says 'A team is the favorite if its moneyline is negative'. The comparison a… | yes, on damaged dates. The 159 rows with a null home moneyline fail the typeof check (node -e: moneyline() returns null), so a real upset disappears from the list without notice. Where both sides wer… | none | confirmed: Confirmed, with refined counts. I tried to refute it and could not. Read-only D1 SELECTs against field-archive (cc49101c), 2026-10-20, all 211 game rows that h… |
| field-playground/src/components/DrillDown/index.jsx, line 77 | american. Line 148 renders 'home {v>0?"+":""}{v} · away ...' with no conversion. | yes, only when the viewed date's top pick (ambientData.pick.ranked[0]) is a damaged game. It would render 'home · away +27400': null renders empty and null > 0 is false. | none | REFUTED: No. The claim is refuted on the "affected" part. The file:line, the fetch and the unit are all real, but a damaged game can never be the top pick. 1. The top p… |
| field-playground/scripts/probe-line-movement.mjs, line 100 | either/agnostic. sameValues (line 48) compares the two sides with JSON.stringify equality and does no arithmetic on pri… | yes, for runs whose window covered damaged dates after the damage existed. A damaged opening blob next to a differently captured closing blob counts as 'values actually differ'. How much the counts m… | Likely affected: outbox/line-movement-probe-2026-09-21T15-37-15-098Z.txt (window 09-07..09-23, 112 'differ') and outbox/line-movement-probe-2026-09-28T17-18-22… | REFUTED: No. The file and line are real, but the American-units damage cannot change any count the probe prints. The finder's mechanism is a damaged opening blob next t… |
| field-playground/scripts/schema-from-measurement.mjs, line 85 | either/agnostic. It never parses the blob or the moneyline. | no. A damaged blob is still a non-null string. | src/data/schemas/context-date-games.json (opening_odds/closing_odds as type string) and outbox/schema-check-*.txt. Neither holds a price value. | not re-checked (finder: no effect) |
| field-playground/src/data/relay.js, line 142 | either/agnostic. It does not touch the odds fields. | no by itself. It is the conduit for the affected renders above. | none | not re-checked (finder: no effect) |
| field-playground/vite.config.js, line 170 | american. This fixture is the playground's own statement of the contract. | no. It never sees real rows. | none (inline fixture) | not re-checked (finder: no effect) |

