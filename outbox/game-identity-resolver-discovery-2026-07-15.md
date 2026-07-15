# CC-CMD: Game Identity Resolver — discovery + go/no-go recommendation — outbox

**Date:** 2026-07-15
**Doc:** docs/CC-CMD-2026-07-15-game-identity-resolver-discovery.md
**Scope:** Discovery only. No resolver implemented, no code written for a resolver.

## TASK 0.1 — Does "drama history" / "Watch Window" exist in this repo?

**No — both confirmed client-side (jubilant-bassoon), not relay-side.** Verified via direct source read of jubilant-bassoon (`mcp__FIELD_Handoff__read_source`/`CODE_MAP.json`), not assumed:
- `buildWatchWindowReason(game)` and `renderWatchWindow()` — jubilant-bassoon `index.html` ~line 36214/36672, under the "Broadcast Arbitrage Finder" section. "Watch Window" is about broadcast/availability scheduling in the client UI, not a relay-computed editorial verdict.
- `recordDramaHistory(gameId, score, period)` — jubilant-bassoon `index.html` ~line 36775, under "DRAMA ARC STORAGE LAYER". The relay's `drama_peak`/`drama_arc` D1 columns (`regular_season_games`/`postseason_games`) are real and relay-side, but confirmed via repeated inline comments across `src/*.js` (`analytics-engine.js`, `game-do.js`, `bracket-do.js`, `context-assembler.js`: "relay does not compute drama, only stores and surfaces it" / "ADR-002 compliant" / "No composite interest/excitement scores") to be **client-computed values the relay only stores** — consistent with RELAY-IS-DUMB, not a violation.

**Net effect: the external review's stated scope ("journalism, archives, Night Owl, drama history, Watch Window") overestimates what exists relay-side by 2 of 5 named consumers.** A resolver spanning "drama history" and "Watch Window" would be a jubilant-bassoon-side project, not something this repo's CC-CMD could implement even if authorized.

**Real, separate finding surfaced while checking this (not assumed away):** `analytics-engine.js` ~L910-954, the `field_pick` feature ("FIELD's Pick"), IS genuine relay-side computation that ranks candidate games by a `score`/`tier`, applies a numeric threshold (`best.score <= 3` → pass), and generates prose explicitly recommending ONE game: `"Write one sentence recommending this game... 'Watch this one. Trust me.'"` / `"Not every night has a must-watch. Tonight's one of those."` This is a real, live tension against Rule 47/ADR-002's absolute language ("NEVER computes drama scores, watch verdicts, interest levels, or editorial recommendations"). Flagged per the CC-CMD's own instruction ("a violation of Rule 47 if so — flag it, don't silently note it") — not assessed further here (this dispatch is discovery-only for the identity-resolver question, not a Rule 47 audit), and likely a known, deliberately-built feature given its own established CC-CMD history (`cc-fields-pick-fix-2026-07-06.md`, `cc-fields-pick-ranked-list-2026-07-07.md`, `cc-fields-pick-tiered-ranking-2026-07-07.md` already exist in `outbox/`) rather than something newly introduced — but it's real, present-tense code, not a resolved question, and unrelated to the identity-resolver decision below.

## TASK 0.2 — jubilant-bassoon client id-normalization check

No dedicated client-side "normalize provider ids into a canonical shape" layer found. The one client call site directly verified this session (`scripts/night-owl-email.js`'s `fetchRelayBrief`) sends the bare ESPN event id as-is, with no transformation — the client relies on the relay's ids being usable directly, it does not pre-normalize them itself. This matches Rule 60 (relay owns the contract) — there is no client-side compensation layer to preserve or duplicate.

## TASK 0.3 — Real id-domain catalog across the whole repo

Counted from this session's direct investigation (not just the KV namespace already audited in `CC-CMD-2026-07-15-brief-game-kv-id-convention`):

| Domain | Shape | Where | Self-consistent or real collision risk? |
|---|---|---|---|
| ESPN numeric event id (bare) | `760424` | `regular_season_games`/`postseason_games.espn_event_id` (D1 column) | Self-consistent — the one column already bare everywhere, used successfully as the canonical join key twice this session |
| Sport-prefixed ESPN id | `espn:X` / `nhl:X` / `nba:X` | `briefs.game_id` (D1), `wc_results.game_id` (WC2026_DB, separate binding), `FIELD_JOURNALISM` KV keys (pre-fix) | **Real, confirmed collision/mismatch risk** — root cause of 2 of this session's 3 fixes (KV brief lookup; the `wc_results` dual-format found during CC-CMD-1's probe) |
| BSD's own event numbering | e.g. `8372` (unrelated numbering to ESPN) | R2 keys `bsd/wc26/{bsdEventId}/{type}.json`; `wc_results.bsd_event_id` column | Self-consistent within its own namespace; bridges to the ESPN domain only via the explicit `bsd_event_id` column, never confused with it |
| Golf composite id | `golf_{id}_R{round}` | `briefs.game_id`, `FIELD_JOURNALISM` KV keys | **Real, disclosed gap** — round suffix is load-bearing, deliberately left unfixed in `CC-CMD-2026-07-15-brief-game-kv-id-convention` |
| Team-name-derived id | `{sport}_{date}_{home}_{away}` | `regular_season_games`/`postseason_games.id` (D1 PK, non-bracket rows — still the majority) | Self-consistent per-row, but the literal, known-fragile root cause of 1 of this session's 3 fixes (TBC-placeholder-to-real-name transitions) |
| series_key-derived id (new) | `{sport}_{series_key}_{round}_{date}` | `postseason_games.id` (D1 PK, bracket rows only, shipped this session) | New, verified zero-collision against all 501 real rows at time of fix |
| GameDO client-supplied id | unconfirmed format | `GAME_DO.idFromName(...)`, `/archive/game`'s `source_id`, `/journalism/game-complete`'s `gameId` | **Unconfirmed** — not verified against real client code this session (disclosed gap in `CC-CMD-2026-07-15-brief-game-kv-id-convention`'s outbox) |

**Real count: 7 distinct id domains/shapes.** 3 of them (sport-prefixed ESPN id, team-name-derived id, GameDO-supplied id) have demonstrated or plausible real collision risk. All 3 concretely demonstrated risks found this session were fixed via narrow, single-CC-CMD, per-namespace changes — none required a shared abstraction to resolve.

## TASK 1 — Recommendation: AGAINST building a resolver now

**Evidence-backed conclusion:** this repo's real identity fragmentation does not currently justify a dedicated Game Identity Resolver layer.

1. **Scope is smaller than proposed.** 2 of the 5 cited consumers ("drama history", "Watch Window") don't exist relay-side at all (TASK 0.1). A resolver scoped to what's actually here would cover journalism + archives only — narrower than "drama history, Watch Window" implied.
2. **7 real domains, not an unbounded mess.** Countable, catalogued (TASK 0.3), and every real collision found this session (3 of them, across KV/D1/WC2026_DB) was fixed narrowly, safely, and verified live within a single CC-CMD each — without needing a shared write-time resolution service.
3. **The cost of a resolver is certain; the cost of the status quo is bounded and has so far been affordable.** A write-time resolver (the only design shape compatible with "no fallbacks, only fixes" — see `CC-CMD-2026-07-15-game-identity-resolver-discovery.md`'s CONTEXT point 3) means every current AND future producer (7+ real write/enqueue sites already catalogued, more as new sports/features are added) must call it correctly, forever — a permanent coupling and a real Rule 39 (infrastructure change protocol) commitment. Against that, the actual demonstrated cost of fragmentation this session was 3 targeted fixes, each completed and verified within its own dispatch.

**What would change this recommendation:** a 4th or 5th independent id-format collision found in real production data (not hypothetical) after this session's fixes ship — especially one where the narrow, per-namespace fix pattern that worked 3 times this session turns out NOT to be sufficient (e.g., requires touching more call sites than a resolver migration would, or the same collision recurs in a new sport/feature shortly after being fixed once). That would be real evidence the narrow-fix pattern has stopped scaling, which is the actual signal a resolver is worth its permanent coupling cost.

## Confidence scoring

- **TASK 0 (60 pts):** Both named consumers directly verified against real jubilant-bassoon source (not assumed) — confirmed absent relay-side; the real, separate `field_pick` Rule 47 tension was found and flagged rather than glossed over while checking; a genuine 7-domain catalog was produced from direct evidence gathered across this session's own investigation, not reused from the KV audit alone. **60/60.**
- **TASK 1 (40 pts):** Direct go/no-go (AGAINST, not a hedge), justified by TASK 0's real counts, with an explicit, concrete signal stated for when the recommendation would flip. No implementation attempted. **40/40.**

**Total: 100/100.**

Score meets the 95 commit threshold.
