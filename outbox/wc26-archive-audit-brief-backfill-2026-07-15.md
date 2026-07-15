# Session doc: tree-sitter archive audit, WC26 table backfill, missing-brief investigation and fix

**Date:** 2026-07-15
**Scope:** Follow-up to `wc-label-fragmentation-2026-07-15.md` (commit `5c58518`, outbox `16fa766`). No relay code changed in this session — this is a data-audit, data-repair, and investigation session.
**HEAD at start:** `16fa766`
**Branch:** `main` (confirmed via `git branch --show-current` throughout)

## What was asked, in order

1. Confirm tree-sitter availability, then use it (not grep) to do a structural audit of every `ARCHIVE_DB` write path.
2. "Yes, backfill both tables the same way" — backfill `regular_season_games`/`postseason_games.sport` using the same normalization the prior CC-CMD applied to `briefs.sport`.
3. "Have briefs been missed or currently not working?" — evidence-based coverage check, not assumption.
4. "Dig around" — root-cause the gap once found.
5. "Approved. Go ahead" — execute live regeneration for the missing briefs.
6. "Re-check process structure" — investigate the queue/pipeline architecture rather than blind-retry a stuck game.

## 1. Tree-sitter archive-path audit

Built `/tmp/.../scratchpad/archive_audit.py` using `tree_sitter` + `tree_sitter_javascript` (Python bindings, confirmed available in this sandbox). It parses every `src/*.js` file into a real AST and structurally finds:
- every `pathname === '/archive/...'` / `pathname.startsWith('/archive/...')` route guard
- every `ARCHIVE_DB.prepare(...)` call, its SQL verb, target table, and enclosing function/route (via an upward AST walk, not regex-over-text)
- every internal `fetch(...)` call whose URL literal contains `/archive/`

Two bugs in the tool itself were found and fixed by re-reading its own "unresolved" output and noticing it looked wrong (Rule 77 discipline applied to my own tooling, not just relay code):
- `enclosing_context` originally special-cased only `/archive/*` route guards, so calls nested under an unrelated route fell back to "function fetch()" with no useful context. Generalized to match any `pathname` route guard.
- `extract_sql_table` missed `INSERT OR REPLACE INTO` / `INSERT OR IGNORE INTO`, dumping real `analytics_runs`/`analytics_output`/`briefs` writes into the "unresolved dynamic SQL" bucket. Fixed the regex to `(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)`.

**Output:** 19 distinct `/archive/*` routes, 206 `ARCHIVE_DB.prepare()` calls, categorized by table and write-op. Full output saved at `/tmp/.../scratchpad/archive_audit_output.txt` (session-local, not committed — ephemeral analysis artifact, not a relay change).

**Finding that mattered:** the prior WC26 label-fragmentation fix (`5c58518`) normalized `briefs.sport` but never touched `regular_season_games.sport` / `postseason_games.sport`, even though `/archive/game`'s canonicalization fix (added in that same commit) already normalizes the column going forward for new writes — historical rows in those two tables were never backfilled the way `briefs` was.

## 2. Backfill of `regular_season_games` / `postseason_games`

Live D1 query for the same fragmented-variant pattern used in the prior backfill:
```sql
UPDATE regular_season_games SET sport = 'FIFA World Cup'
WHERE LOWER(sport) = 'wc26' OR LOWER(sport) LIKE 'fifa world cup%';
UPDATE postseason_games SET sport = 'FIFA World Cup'
WHERE LOWER(sport) = 'wc26' OR LOWER(sport) LIKE 'fifa world cup%';
```
Executed live per explicit user approval ("Yes, backfill both tables the same way"). Result: **101 rows updated in `regular_season_games`, 0 in `postseason_games`** (WC26 knockout rows apparently already used the canonical label or hadn't been written into that table yet). Re-verified post-backfill: no residual fragmented variants in either table. Confirmed the live in-progress England vs Argentina row was untouched (same id, `home_score` still `NULL`).

Same id-collision safety reasoning as the prior fix applied here too: `sport` is not part of any table's primary key in either table, so this UPDATE carries no conflict risk — it only affects the `sport` display column, not row identity.

## 3. Brief-coverage investigation ("Have briefs been missed?")

Ran a real join between finalized WC26 games (from `regular_season_games`, `state`/score-derived final rows) and `briefs` (matching on `game_id`, accounting for the `espn:` prefix quirk described below) rather than assuming coverage was complete. Found **8 finalized WC26 games with no corresponding brief row**, all clustered in the tournament's opening week (2026-06-11 through 2026-06-19):

| ESPN event id | Matchup | Date |
|---|---|---|
| 760414 | (opening week) | 2026-06-11–19 |
| 760418 | | |
| 760422 | | |
| 760424 | | |
| 760427 | | |
| 760429 | Saudi Arabia vs Uruguay | 2026-06-15 |
| 760434 | | |
| 760435 | | |

## 4. Root cause ("Dig around")

Initial hypothesis (archive infrastructure "didn't exist yet" for early-June dates) was **disproven**: all June 11–19 games, both covered and uncovered, shared the same July-5 `created_at` batch stamp on their `regular_season_games` rows — meaning the game rows themselves were backfilled uniformly; the gap was specific to brief generation, not archival plumbing.

Traced the real mechanism: `writeWCResult(db, game, env, ctx)` (`src/index.js` line 2037) is the function that enqueues a WC26 game-brief job onto `JOURNALISM_QUEUE`. It is called from exactly 2 sites, both inside the `/v2/games?sport=wc26` ESPN-adapter route (~line 3693/3695), gated by `if (env.WC2026_DB) { const finals = games.filter(g => g.state === 'final'); ... }`, fired via `ctx.waitUntil(Promise.allSettled(finals.map(...)))`.

**This means brief generation is request-triggered, not cron-scheduled** — it only fires when someone actually requests `/v2/games?sport=wc26&date=X` for a date containing final games. For the 8 missing games, nothing had requested that route for those specific dates since the games went final, so no job was ever enqueued. This is a real, structural explanation, not a code bug in `writeWCResult` itself.

Also confirmed via `wrangler.toml` lines 150-157: `JOURNALISM_QUEUE` consumer config is `max_batch_size=5, max_batch_timeout=30, max_retries=3`, **no dead-letter queue**. After 3 failed delivery attempts a message is acked and silently dropped (`if (msg.attempts >= 3) { msg.ack(); } else { msg.retry(); }`) — meaning any transient failure in enqueue processing leaves zero forensic trail. This became directly relevant to the 760429 investigation below.

## 5. Fix — live regeneration ("Approved. Go ahead")

Re-triggered `/v2/games?sport=wc26&date=X` for the 5 distinct dates spanning the 8 missing games, using the real, existing, unmodified pipeline (no workaround code written).

**Round 1** (~21:08–21:10 UTC): 7 of 8 games generated successfully.

**Verification bug in my own check, caught and corrected:** my first pass queried `briefs` with an exact match (`game_id IN ('760424','760429','760435')`) and got zero rows for 3 games, so I concluded all 3 had failed. This was wrong. WC26 ESPN-adapted games carry a prefixed id (`game.id = "espn:760424"`, not bare `"760424"`); that prefix flows through into `job.eventId` and is bound directly as `briefs.game_id` by the queue consumer's own direct write (`source: 'cron'`). Separately, `sweepKVBriefs`'s KV-key parsing (`key.name.replace('brief:game:', '').split(':')`) incidentally strips the `espn:` prefix when it later copies the same brief from KV into `briefs` a second time (`source: 'kv_sweep'`) — so one successful generation produces **two** rows with different `game_id` shapes for the same game. My exact-match query only ever matched the `kv_sweep` shape and missed the `cron` shape entirely, producing a false "still missing" result for 2 games that had actually already succeeded. Caught by directly inspecting a raw ESPN-adapted game object and re-querying with `LIKE '%760424%'` instead of exact match — consistent with Rule 77 (investigate the actual object, don't trust your own query's negative result at face value).

**Round 2** (~21:16–21:20 UTC): retried the 3 apparent stragglers; 2 of them (760424, 760435) turned out to already be covered from round 1 once the `LIKE`-based check was used. Only **760429** (Saudi Arabia vs Uruguay, 2026-06-15) was a genuine repeat failure.

**Investigated 760429 structurally** before retrying blindly (per Rule 42 — don't just retry, look for what's different): compared `_WC_TEAM_GROUP` completeness, round-string format, and team-name cleanliness against its successful same-date sibling 760427. Found no structural difference — consistent with a transient failure in one of `writeWCResult`'s individually-try/caught external calls (BSD fetch, ESPN summary fallback, matchup/standings lookup), not a deterministic code bug, and consistent with the no-DLQ architecture leaving no trace of what actually failed.

**Round 3** (~21:20–21:25 UTC): re-triggered `/v2/games?sport=wc26&date=2026-06-15` a third time. 760429 succeeded (`created_at: 2026-07-15 21:20:53` for the `cron`-sourced write, `21:25:45` for the `kv_sweep` copy).

**Final verification** (`LIKE`-based, all 8 ids in one query): all 8 games now have both a `cron`-sourced row (`espn:{id}` game_id) and a `kv_sweep`-sourced row (bare `{id}` game_id) — **16 rows total, 8/8 games covered.**

```
760414  game_recap_760414_2026-07-15        kv_sweep  21:10:36   |  espn:760414  game_recap_wc26_espn:760414  cron  21:08:27
760418  game_recap_760418_2026-07-15        kv_sweep  21:10:37   |  espn:760418  game_recap_wc26_espn:760418  cron  21:08:33
760422  game_recap_760422_2026-07-15        kv_sweep  21:10:41   |  espn:760422  game_recap_wc26_espn:760422  cron  21:08:53
760424  game_recap_760424_2026-07-15        kv_sweep  21:20:42   |  espn:760424  game_recap_wc26_espn:760424  cron  21:16:58
760427  game_recap_760427_2026-07-15        kv_sweep  21:10:43   |  espn:760427  game_recap_wc26_espn:760427  cron  21:09:03
760429  game_recap_760429_2026-07-15        kv_sweep  21:25:45   |  espn:760429  game_recap_wc26_espn:760429  cron  21:20:53
760434  game_recap_760434_2026-07-15        kv_sweep  21:10:47   |  espn:760434  game_recap_wc26_espn:760434  cron  21:09:33
760435  game_recap_760435_2026-07-15        kv_sweep  21:20:49   |  espn:760435  game_recap_wc26_espn:760435  cron  21:16:39
```

## 6. Disclosed cost tradeoff (Rule 78 — API-COST-A)

Because KV caches for the affected dates had already expired (`expirationTtl: 3600`, 1 hour), every retriggered date redundantly regenerated LLM briefs for **all** final games on that date, not just the missing one — this hit several already-covered sibling games across the 5 initial dates, plus repeat hits on the 3-then-1 dates retried in rounds 2 and 3. This was an accepted, explicitly-disclosed tradeoff of using the real, existing pipeline (per Rule 60 — no bespoke workaround written) rather than a targeted single-game trigger, which does not exist as a route.

## 7. Environment note (not a relay finding, recorded for continuity)

Direct Bash-tool `curl` calls to `field-relay-nba.jeffunglesbee.workers.dev` fail in this sandbox (`exit 56, CONNECT tunnel failed, response 403` — proxy-blocked for this host). All D1/API interaction this session went through `mcp__FIELD_Handoff__browser_navigate` + `browser_extract` (mode: evaluate, using `fetch()` inside the browser context), with a fresh session minted via `/health` immediately before each real query (sessions go stale unpredictably). A first attempt at polling via a Monitor-wrapped bash `curl` loop silently returned empty results for its full runtime for this reason; stopped and replaced with `sleep`-only timer Monitors plus manual `browser_extract` checks.

## Outcome summary

- No relay code changed this session (`git status` clean against `16fa766`, no new commits).
- `regular_season_games`: 101 rows backfilled to canonical `'FIFA World Cup'`. `postseason_games`: 0 rows needed it.
- Brief coverage gap: 8 finalized WC26 games found missing briefs; root cause identified (request-triggered generation, no cron sweep for stale dates, no DLQ); all 8 now confirmed covered via the real pipeline, no workaround code.
- One real bug in my own verification methodology found and corrected (the `espn:` id-prefix mismatch between `cron` and `kv_sweep` brief sources) — documented here so a future session doesn't repeat the same false-negative.

## Residual / carry-forward (Rule 87 disclosure)

None requested by the user beyond this report. Two structural observations are noted for awareness only, not actioned without a separate CC-CMD:
- `JOURNALISM_QUEUE` has no dead-letter queue — any individual message failure after 3 retries is currently unrecoverable except by knowing to re-trigger the source route manually, as done here.
- WC26 brief generation has no cron/sweep fallback for games that go final while no client happens to request that date's `/v2/games` route — this session's fix was reactive (found via manual audit), not preventive.
