# Claude Code Command — Durable broadcast-chip fix: MLB GOTD auto-detection + V2 adapter streams gap

**Date:** 2026-07-16
**Repo:** jeffunglesbee-create/jubilant-bassoon (client) for TASK 1/2, jeffunglesbee-create/field-relay-nba (relay) for TASK 3. Two real, separate bugs found tonight investigating one symptom (missing ESPN chip on today's Mets @ Phillies) — fix both, in their correct repos, not just the one that explains today's specific case.

Read CLAUDE.md/STANDARDS.md first.

Write findings to docs/outbox/cc-broadcast-chip-durable-fix-2026-07-16.md (client) and outbox/broadcast-chip-durable-fix-2026-07-16.md (relay). Commit each outbox manifest with `[skip ci]`.

## CONTEXT — two real, independent gaps, not one bug

**Gap 1 (client, the one actually causing today's missing chip):** MLB cards render via `normalizeMLBGame()`/`parseBroadcasts()` — a real, rich path sourced directly from the official MLB Stats API (`source: 'mlb-stats'`), entirely separate from ESPN/the relay's V2 adapter. `parseBroadcasts` deliberately skips ESPN broadcasts (`if (name === 'ESPN' || name === 'ESPN+') continue;`), relying instead on a manually-maintained `ESPN_GOTD_SCHEDULE` object for ESPN Game-of-the-Day chips specifically. That object's real, current content stops at `2026-06-30` — over two weeks stale, nothing for July at all. Confirmed live tonight: tonight's Mets @ Phillies (7:10 PM ET, Citizens Bank Park, the only game on the day's slate, opening the second half after the All-Star break) is genuinely, nationally broadcast on ESPN — real, multi-source-confirmed, and ESPN's own API already returns it (`broadcasts: [{'market': 'national', 'names': ['ESPN']}]`, event `401816143`). The chip is missing because the schedule object was never extended into July, not because the underlying broadcast data doesn't exist.

**Gap 2 (relay, real but not the cause of today's specific symptom):** The relay's V2 adapters (feeding every non-MLB-Stats-API sport — WNBA, NBA, NHL, etc. via ESPN) never populate a `streams` field on any game object, confirmed live tonight across multiple sports. `gameNetwork()` (client-side, consolidated from 28 duplicate call sites earlier this same session) reads `g.streams[0].label` — structurally correct, but has nothing to read, for any sport using this path, because the relay never forwards ESPN's real `broadcasts`/`geoBroadcasts` data into it.

## TASK 1 — Probe (client), real prior history — do not re-discover this from scratch

**A June 6 2026 session already built real auto-detection once** — hydrating `broadcasts(all)` from `statsapi.mlb.com`, intended to fully replace `ESPN_GOTD_SCHEDULE`/`PEACOCK_GOTD_SCHEDULE`/`MLBN_SCHEDULE` with runtime lookups. **A July 2 2026 session found that auto-detection had regressed to "always returns false"** and diagnosed why: the real, distinctive GOTD signal (`'ESPN Unlmtd'` appearing explicitly in the national broadcast names) lives in `site.api.espn.com`'s scoreboard data — a different API than the one the June 6 fix actually reads (`statsapi.mlb.com`). That's the likely reason auto-detection stopped working: right concept, wrong data source.

**A real, precise wrinkle found tonight that the July 2 session's own finding doesn't fully cover:** today's real Mets @ Phillies broadcast (`site.api.espn.com`, event `401816143`) shows plain `'ESPN'` in `broadcasts[].names` — not `'ESPN Unlmtd'`. Today's game is the real second-half-opening national broadcast (confirmed via MLB.com's own coverage), which may be a genuinely different kind of ESPN national telecast than the specific streaming product July 2's `'ESPN Unlmtd'` signal was scoped to. Resolve this precisely: pull several more real, confirmed ESPN GOTD-caliber games (not just today's) and check whether the real, general signal is "any national broadcast with an ESPN-prefixed name" (broader, catches both cases) versus needing to distinguish `'ESPN Unlmtd'` specifically from plain `'ESPN'` as two different real categories (e.g., streaming-exclusive vs. standard national telecast) that may need different handling. Don't assume either shape — check real examples.

Also confirm whether `field-data-today.json`'s pipeline (referenced in `ESPN_GOTD_SCHEDULE`'s own comment as the intended auto-detection mechanism, and matching the June 6 build's actual approach) still runs at all, and if so, whether it's reading `site.api.espn.com` or still only `statsapi.mlb.com` — this may be the single, precise fix needed rather than building anything new.

## TASK 2 — Fix (client), durable not a patch

**Do not just extend `ESPN_GOTD_SCHEDULE` with July dates** — that reproduces the exact staleness this CC-CMD exists to close, and will be stale again in weeks. Based on TASK 1's real findings: if a reliable auto-detection signal exists in ESPN's live data, replace the manual schedule with real detection, closing the long-standing TODO. If the `field-data-today.json` pipeline is real and was supposed to do this but is broken, fix that pipeline instead of the static object directly. If no reliable auto-detection signal genuinely exists (confirm with real evidence, don't assume), keep the manual schedule as the correct fallback it's documented to be, but wire it into whatever real, already-running cadence (the daily update process, a cron-equivalent) would keep it durably current going forward — not left to depend on a human remembering to extend it by hand indefinitely.

## TASK 3 — Fix (relay), the separate gap

Thread ESPN's real `broadcasts`/`geoBroadcasts` fields into a `streams` field on every V2 adapter's game object output, consistently across sports (not just the one this investigation happened to start from) — reuse the same real, confirmed field names/shapes already verified live tonight. This closes the gap for every sport currently getting nothing but `gameNetwork()`'s fallback default.

## TASK 4 — Verify (both repos)

**Client:** real forced test proving today's real Mets @ Phillies game (or the real mechanism, whichever TASK 2 lands on) now produces a genuine ESPN chip. If auto-detection was built, a second real test with a real non-ESPN broadcast confirming it correctly does *not* false-positive.
**Relay:** real forced test confirming `streams` populates correctly for at least two different real sports' adapters, plus a live check against a real current game.
**Both:** `node smoke.js index.html` (client) / structural probes (relay) — baseline plus new assertions.

## DONE CONDITION

Today's real Mets @ Phillies ESPN chip renders correctly, via a mechanism that won't be stale again in two weeks without human intervention. The separate, relay-side `streams` gap is closed for every sport using the V2/ESPN path, not just MLB.

**Confidence scoring:**
- TASK 1 (20 pts): real investigation of auto-detection feasibility and the field-data-today.json pipeline's actual current state, not assumed
- TASK 2 (30 pts): genuinely durable fix — auto-detection, a repaired pipeline, or an automated-cadence-wired fallback — not a one-time date-range extension
- TASK 3 (25 pts): real, consistent `streams` population across multiple sports' V2 adapters
- TASK 4 (25 pts): real forced tests in both repos, real live verification of today's actual game

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
