# Outbox — Relay Gap Sweep + Public Solution Research

**Date:** 2026-07-03
**CC-CMD:** docs/CC-CMD-2026-07-03-gap-sweep-relay.md
**Status:** RESEARCH COMPLETE — no code changes this session (research/documentation task)

---

## Pre-Build Probe Results

```
grep -c "fetch(" src/*.js
```

| File | fetch() calls |
|------|--------------|
| src/index.js | 122 |
| src/context-assembler.js | 7 |
| src/bracket-do.js | 7 |
| src/analytics-engine.js | 4 |
| src/ambient-do.js | 6 |
| src/game-do.js | 4 |
| src/mlb-savant-r2.js | 5 |
| others | 10 |
| **Total** | **165** |

Upstream API surface confirmed large. Distinct API domains: ESPN (3 subdomains), BSD, Squiggle, MLB Stats API, NHLE, CFL, The Odds API, Ball Don't Lie, Fantasy PL, Football-data.org, MLS Soccer Stats, MoneyPuck, NBA CDN, WHOOP, and others (passthrough-only).

---

## Task 1: Field-Name Mismatch Sweep

### F1 — ESPN `comp.details[i].team?.displayName` always null
**Severity: MEDIUM**
- **File:** `src/index.js` — `adaptESPNWCSoccer` line 1310
- **What code assumes:** `d.team?.displayName` on competition details entries returns a team name string
- **What live API returns:** Every `comp.details[i].team` is `null` for WC26 games (linked `$ref` object, not inline). Optional chaining silently swallows this.
- **Impact:** `matchEvents[i].team` is always null for every soccer match event. Journalism model never gets team attribution from this field.

### F2 — WC26 knockout round detection broken: `comp.notes[0].headline` returns advancement text
**Severity: HIGH**
- **File:** `src/index.js` — `adaptESPNWCSoccer` line 1332, `writeWCResult` line 1658
- **What code assumes:** `comp.notes[0].headline` contains a round label like "Round of 16"
- **What live API returns (Australia 1-1 Egypt, confirmed via MCP probe):** `"Egypt advance 4-2 on penalties"` — advancement text, not a round identifier
- **Impact:** `extractWCPhase("Egypt advance 4-2 on penalties")` returns null. `writeWCResult` checks `!groupId && !wcPhase` and returns early. **All WC26 knockout-stage game results are silently skipped — never written to WC2026_DB.** The fix is to read `comp.type?.text` (used correctly in `buildGameLine` at line 4138) in `adaptESPNWCSoccer`, which does carry the round label.

### F3 — NHLE three-star `s.teamAbbrev` shape uncertain
**Severity: LOW**
- **File:** `src/index.js` line 3337
- **What code assumes:** `s.teamAbbrev` is a flat string (e.g. `"COL"`)
- **What live API may return:** In NHLE landing endpoint, some `abbrev`-style fields are nested `{default: "COL"}`. Cannot confirm off-season.
- **Impact:** If nested, `s.teamAbbrev || ''` produces `[object Object]` in NHL game brief three-star footnotes. Low-stakes — NHL off-season now; verify at first live game.

### F4 — BSD club-format shotmap field name uncertain (triple fallback)
**Severity: LOW**
- **File:** `src/context-assembler.js` line 748
- **What code tries:** `_sm?.shots || _sm?.results || _sm?.statistics || []`
- **Real field name unknown:** WC26 uses primary `shotmap` path (confirmed working). Club format (EPL, MLS, La Liga, etc.) falls back to this triple-try pattern. If none of `shots/results/statistics` is the real field, club-game xG is always empty.
- **Impact:** Affects only club soccer `buildBSDMomentumContext` fallback path. No confirmed break — flagged as unverified assumption.

### F5 — `_captureClosingOdds` uses three undefined variables: `today`, `nH`, `nA`
**Severity: HIGH** (confirmed dead code)
- **File:** `src/ambient-do.js` lines 775, 778
- **Root cause:** `today` is a local variable in `_poll()` (line 320) — not passed to `_captureClosingOdds`. `nH` and `nA` are not defined anywhere. `r.id.includes(nH)` throws `ReferenceError: nH is not defined`, caught by `try/catch`, logged as warning, silently continues.
- **Impact:** The Odds API closing odds fetch succeeds, but the D1 `UPDATE` to write `closing_odds` to either archive table **never fires**. This feature has been dead since shipping. Also confirmed independently by Task 2 sweep (A3).

---

## Task 2: Broadcast/Relay Field-Completeness Sweep

### AmbientDO (`src/ambient-do.js`)

#### A1 — Soccer `periodNum`/`periodLabel` absent from SSE `score` events [BUG]
- `adaptESPNWCSoccer` never emits `periodNum` or `periodLabel` (all other sport adapters do). AmbientDO reads `game.periodNum` → `undefined` for all 7 soccer sports. Every SSE `score` event for soccer carries `period: undefined`. The `scoreChanged` period-comparison is always `undefined === undefined` → never triggers on half-time transition alone.

#### A2 — `_estimateLateness` always returns 0 for soccer [BUG]
- `_fetchLiveOdds()` calls `_estimateLateness(sport, matched.period)` where `matched.period` is `undefined` for soccer (A1). Function returns 0 when `!period`. The urgency formula `(peakCollapse*4 + recentDelta*3 + closeness*2 + lateness*1)` has `lateness=0` for every soccer game regardless of minute. A 90th-minute winner scores the same lateness urgency as a 5th-minute opener.

#### A3 — `_captureClosingOdds` dead code [BUG — same as F5 above]
- Duplicate confirmed by both sweep passes.

#### A4 — `bsdEventId` not forwarded in SSE `score` events [GAP]
- AmbientDO never reads `game.bsdEventId` despite `/v2/games` enriching it for live soccer. Clients receiving `score` events cannot initiate BSD WebSocket subscription from the event alone — requires a separate lookup.

#### A5 — `home.abbr`/`away.abbr` absent from SSE events [GAP]
- `_poll()` reads only `game.home?.name`, not `game.home?.abbr`. Abbreviations never reach SSE consumers.

#### A6 — `frame.coordinates.slice(-1)[0]` assumes array [GAP]
- `_bsdOnFrame` at line 901: `coords: frame.coordinates?.slice(-1)[0] || null`. If BSD sends `coordinates` as a single `{x,y}` object (single ball position per frame), `.slice` is undefined → caught silently → `coords: null` on every `bsd:ball` SSE event. Ball position would be silently dropped.

### GameDO (`src/game-do.js`)

#### G1 — WNBA/AFL `state='post'` never triggers archive hook [BUG]
- `adaptESPNBasketball` (used for WNBA and AFL) emits `state: 'post'` for completed games; all other adapters emit `state: 'final'`. GameDO `_poll()` checks `facts.state === 'final'`. The auto-archive POST and journalism dispatch POST never fire for any WNBA or AFL game.

#### G2 — Soccer `period` always `null` in `facts` broadcast [BUG]
- Same root as A1 (`adaptESPNWCSoccer` emits no `periodNum`). `_fetchFacts()` gets `period: null` for all soccer sports. `_sameFacts()` comparison `a.period === b.period` is always `null === null` — period changes never trigger a WebSocket broadcast on their own.

#### G3 — `situation` never in `facts` broadcast [GAP]
- `_fetchFacts()` never reads `match.situation`. No MLB at-bat state (balls/strikes/outs/runners), no soccer elapsed minute, no basketball possession in any WebSocket `facts` message. Highest-impact missing field for MLB live clients.

#### G4 — `linescores` never in `facts` broadcast [GAP]
- All adapters produce `linescores: {home:[...], away:[...]}`. GameDO ignores it. No per-quarter (NBA), per-period (NHL), or per-inning (MLB) score breakdown available via WebSocket.

#### G5 — Soccer `matchEvents` never forwarded via GameDO WebSocket [GAP]
- `adaptESPNWCSoccer` produces `matchEvents` with goals, cards, substitutions. `_fetchFacts()` never reads this. WC26 goal events, yellow/red cards absent from all GameDO WebSocket messages.

#### G6 — `home.abbr`/`away.abbr` not in `facts` broadcast [GAP]
- `_fetchFacts()` reads `match?.home?.name` but not `match?.home?.abbr`. Team abbreviations never reach WebSocket clients.

### BracketDO (`src/bracket-do.js`)

#### B1 — `bracket:updated` omits `snapshot` despite header spec [BUG]
- Header comment (line 38) documents `{ type: 'bracket:updated', delta, snapshot, trigger }`. Actual broadcast at lines 372–378 and in `_recomputeLiveAndBroadcast` (lines 535–541) omits `snapshot`. Clients receiving an update see only the delta (top-10 movers by shift ≥ 0.5pp) — teams outside the delta threshold are not reflected without a follow-up `/bracket/state` REST poll.

#### B2 — `snapshot:live` not exposed via `/bracket/state` REST [GAP]
- `_recomputeLiveAndBroadcast` saves provisional live projections to `storage.put('snapshot:live', ...)`. `/bracket/state` GET handler reads only `this.currentSnapshot`, not `snapshot:live`. REST pollers (fallback from WebSocket) never see live provisional WC bracket projections.

---

## Task 3: Documentation Staleness Sweep

### HIGHEST PRIORITY — would mislead any CC session using these as navigation anchors

| Doc | Reference | Status | Reality |
|-----|-----------|--------|---------|
| CLAUDE.md | `~5600 lines` (index.js) | STALE | Actual: 12,836 lines |
| CLAUDE.md | `handleJournalismCycle (~line 2893)` | STALE | Actual: line 5402 |
| CLAUDE.md | `Route section starts at line ~3329` | STALE | Line 3329 is inside NHL NHLE fetch helper; actual fetch handler: line 6511 |
| CLAUDE.md | `Archive routes at line ~3835` | STALE | Line 3835 is inside SPORT_CONFIG; actual /archive/ block: line 7671 |

All four CLAUDE.md line anchors are off by 2,500–7,000 lines. Any CC session following these as "where to look" will read the wrong code before editing.

| Doc | Reference | Status | Reality |
|-----|-----------|--------|---------|
| CC-CMD-2026-06-21-context-assembler.md | "Read docs/ADR-002-CONTEXT.md" | STALE | File does not exist anywhere in this repo |

### HIGH PRIORITY — function name mismatches

| Doc | Reference | Status | Reality |
|-----|-----------|--------|---------|
| CONTRACTS.md | `consumeSharedOddsCredit(env, units)` | STALE | Actual names: `consumeOddsCredit` (index.js line 4500), `_consumeAmbientOddsCredit` (ambient-do.js line 965). Neither matches the documented name. |
| brief-archive-spec.md | Code samples use `corsHeaders` | STALE | Module-level variable is `CORS`. Samples would produce ReferenceError if copied verbatim. |

### MEDIUM PRIORITY — schema divergence

| Doc | Reference | Status | Reality |
|-----|-----------|--------|---------|
| brief-archive-spec.md | `regular_season_games` / `postseason_games` column list | STALE | Missing `espn_event_id` (added CC-CMD-2026-06-23) |
| brief-archive-spec.md | Cron write spec | STALE | Missing `quality_score` and `context_hash` columns now present in cron INSERT |
| CC-CMD-relay-compound.md | `/archive/venues` endpoint (Task 1) | STALE | Never implemented |
| CC-CMD-relay-compound.md | `/archive/quality-correlation` endpoint (Task 4) | STALE | Never implemented |
| CC-CMD-2026-06-21-context-assembler.md | "assembleContext replaces buildFinalsContextBlock + buildWCTeamContextBlock" | SUSPECT | Both old functions still called at index.js lines 5910, 6232. Replacement was partial — they coexist. |

### LOW PRIORITY — line number drift in historical spec docs

| Doc | Reference | Status | Reality |
|-----|-----------|--------|---------|
| CC-CMD-relay-2-event-pipeline.md | "/archive/* routes at ~line 3835" | STALE | Actual: 7671 |
| CC-CMD-2026-06-21-identity-resolver.md | `snapshotCronOdds` at "~line 3930" | STALE | Actual: 4564 |

---

## Task 4: Public Solution Research

### Gap-class 1: ESPN API field-name mismatches

**`pseudo-r/Public-ESPN-API`** — Comprehensive, actively-maintained documentation of all ESPN API endpoints for 20+ sports including soccer (17 sports, 139 leagues, 370 v2 endpoints). Documents `comp.type.text` values and competition-type structure. **Real match** — speaks FIELD's actual data source. Would confirm correct field names for WC26 knockout round detection (F2) and competition detail shapes (F1).

**`mikelaferriere/espn-api`** — TypeScript wrapper for ESPN public API with type definitions for scoreboard and summary endpoints. Partial match — NFL/NBA-focused but establishes typed response shapes. Useful for catching field-name drift at build time.

**`gist.github.com/akeaswaran`** — ESPN hidden API documentation including `competitions[0]` shape, linescores, situation fields. Reference document, not a tool.

**Match quality for F2 (knockout round):** `pseudo-r/Public-ESPN-API/docs/sports/soccer.md` directly documents soccer competition types and is the right source to confirm `comp.type.text` values for WC knockout stages.

### Gap-class 1: NHLE field shapes

**`jakubsvobodacz/nhl-api-client`** — Full TypeScript types for `api-web.nhle.com` including the landing (gamecenter) endpoint. **Real match** — same API FIELD uses. Would confirm definitively whether `threeStars[i].teamAbbrev` is a string or `{default: string}` object (F3).

**`Zmalski/NHL-API-Reference`** — Unofficial reference for all NHLE endpoints with documented response shapes. Real match.

### Gap-class 2: Closing odds dead code (`_captureClosingOdds` / F5/A3)

**`the-odds-api/samples-nodejs`** — Official Node.js samples from The Odds API including `ClosingLinesAnyMarket.gs` — a literal template for fetching and matching closing lines to historical games. **Real match** (same API). Demonstrates the correct pattern for matching game rows by team name + date — directly relevant to fixing the `nH`/`nA`/`today` undefined variable bug.

**`odds-api-io/odds-api-node`** — Official Node.js SDK for Odds API v4. Provides structured type definitions for the market/outcome shapes already correctly parsed by FIELD's fetch code — the parse is right, only the D1 write is broken.

**No public match for the silent try/catch suppression pattern itself.** This is an ESLint configuration gap: adding `eslint` with `no-undef` rule to the CI pipeline would have caught `nH`, `nA`, `today` as ReferenceError risks at lint time. Existing CI runs `node -c` (syntax only), not ESLint — this class of bug passes `node -c` cleanly.

### Gap-class 3: Documentation staleness

**`jbrockSTL/doc-drift`** — LLM-powered doc drift detection on every PR via GitHub Actions. Detects changed functions/classes from staged diffs, semantic-searches related Markdown docs, uses AI to flag mismatches. **Generic tool** — no match against FIELD's specific doc structure. Would catch future drift; doesn't resolve current backlog.

**`ifiokjr/mdt`** — Template-based markdown sync ("write it once, sync it everywhere"). Requires docs to be written with template tags. **Generic tool, high setup cost** for a repo where docs are prose CC-CMDs and spec files, not structured templates.

**No real match found for automated line-number anchor validation** (the highest-priority staleness class here — CLAUDE.md line numbers). This is a maintenance process gap, not a tool gap.

### Gap-class 4: Broadcast completeness (Durable Objects SSE/WebSocket field gaps)

**No public match found.** No open-source tool was identified that validates field completeness between a Cloudflare Durable Object SSE producer and a browser consumer. This gap class requires either: (a) a typed contract for the broadcast payload shape and a TypeScript compile check against it, or (b) a runtime schema validator like Zod on both producer and consumer sides. Neither approach has a ready-made public tool specific to Cloudflare DOs.

### Gap-class 4: `adaptESPNWCSoccer` missing `periodNum`/`periodLabel` (A1, G2)

**`pseudo-r/Public-ESPN-API`** again — documents ESPN soccer scoreboard competition fields including `status.period` and `status.displayClock`, confirming which ESPN field maps to `periodNum` for soccer. Same repo as the F2 match.

---

## Instance Count by Gap Class

| Gap class | Confirmed instances | Public repo match | Match quality |
|-----------|--------------------|--------------------|---------------|
| 1: Field-name mismatch (API response vs code assumption) | 5 (F1–F5) | Yes | `pseudo-r/Public-ESPN-API`, `jakubsvobodacz/nhl-api-client` — real matches against same APIs |
| 2: Silently dropped fields in relay/broadcast | 14 (A1–A6, G1–G6, B1–B2) | Partial | No DO-specific broadcast tool; typed payload contracts (TypeScript/Zod) are the standard approach |
| 3: Stale documentation naming superseded or wrong code | 10 findings across 7 docs | Generic only | `jbrockSTL/doc-drift` — not specific to this repo's doc structure |
| 4: Config drift with no detection (eslint / dead code silent catch) | 1 confirmed (F5/A3) + systemic (no ESLint in CI) | Yes | `the-odds-api/samples-nodejs` for fixing the specific bug; ESLint `no-undef` for the systemic gap class |

---

## Highest-Priority Findings for Follow-Up (ranked by real product impact)

1. **F2 / WC26 knockout D1 writes never fire** — all WC26 elimination-round results silently missing from WC2026_DB. Fix: `adaptESPNWCSoccer` should read `comp.type?.text` (already used correctly in `buildGameLine`) as the round identifier, with `comp.notes[0].headline` as fallback.

2. **G1 / WNBA+AFL auto-archive and journalism never fire** — `adaptESPNBasketball` emits `state:'post'`; archive hook checks `==='final'`. Fix: normalize to `'final'` in adapter, or update the hook check to accept `'post'`.

3. **F5/A3 / `_captureClosingOdds` is dead code** — `today`, `nH`, `nA` undefined. Closing odds have never been written to ARCHIVE_DB since shipping. Fix: pass `today` as parameter; derive `nH`/`nA` from `resolveTeamKey(home)` / `resolveTeamKey(away)` (already available in ambient-do.js scope).

4. **A1+G2 / Soccer `periodNum`/`periodLabel` missing from all adapters** — `adaptESPNWCSoccer` must emit these for SSE and WebSocket period-change detection to function for any of the 7 soccer sports.

5. **B1 / `bracket:updated` missing `snapshot`** — clients only see top-10 movers, must re-poll REST to get full updated state.

6. **CLAUDE.md line numbers** — all four anchors are off by 2,500–7,000 lines. Any CC session using them navigates to wrong code.
