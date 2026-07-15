# Claude Code Command — brief:game:{id} KV namespace has 5+ distinct id-shape conventions

**Date:** 2026-07-15
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull; git log --oneline -5.

Write findings to outbox/brief-game-kv-id-convention-2026-07-15.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

A tree-sitter structural audit of every `env.FIELD_JOURNALISM.{get,put,delete,list}(...)` call site in `src/*.js` (112 real calls found, run 2026-07-15) surfaced that the `brief:game:{id}` KV namespace — read and written from at least 8 distinct call sites — has **no single id-shape convention**. Each sport/path builds its own format, and the public read route echoes whatever a caller passes with zero normalization:

| Source | `id` shape | Call site (re-probe against current HEAD before trusting) |
|---|---|---|
| WC26 (`writeWCResult`) | `espn:{id}` | `src/index.js:2339` (`eventId: game.id`), `game.id` built by the ESPN-WC adapter |
| NHL (`enqueueNHLBriefs`, inside `/v2/games`) | `nhl:{id}` | `src/index.js:3798` (`eventId: g.id`), `g.id` from `adaptNhle` (`src/index.js:~1081`, `` id: `nhl:${g.id}` ``) |
| NBA (inside `/v2/games`) | `nba:{gameId}` | `src/index.js:3923` (`eventId: g.id`), `g.id` from `adaptNbaCDN` (`src/index.js:~1136`, `` id: `nba:${g.gameId}` ``) |
| Golf (per-round recap) | `golf_{eventId}_R{roundNum}` | `src/index.js:6927` — different separator style entirely (underscore-composite, round baked into the id) |
| Generic ESPN-scoreboard loop (MLB/WNBA per the nearby comment) | bare, unprefixed `ev.id` | `src/index.js:7326` (`const eventId = ev.id`), used at `src/index.js:7333` and enqueued at `src/index.js:7403` |
| `/journalism/game-complete` (POST, fired by GameDO on state:final) | bare `gameId`, exactly whatever GameDO's POST body sends — format not controlled or validated by this route at all | `src/index.js:12779` (`eventId: gameId`, destructured from `body` at `src/index.js:12742`) |

The **read side is a pure echo, zero normalization**: `GET /journalism/game/{eventId}` (`src/index.js:~12857`, `` env.FIELD_JOURNALISM.get(`brief:game:${eventId}`) ``) strips only non-alphanumeric/`:_-` characters from the URL segment and looks up exactly that string. A client requesting the "wrong" shape for a given sport gets a false `{brief:null}` even when a real, valid brief already exists under a differently-shaped key for the same game — the same class of bug (`espn:` prefix mismatch) already found and fixed once this session in the `briefs` D1 table, now confirmed to also exist, unaddressed, at the KV layer.

**Not yet checked, and out of scope for this CC-CMD's context section — verify live in TASK 0:** whether `CONTRACTS.md` documents this KV/route shape at all. A grep at dispatch time found zero matches for `brief:game` or `journalism/game` in `CONTRACTS.md` — meaning if the client (jubilant-bassoon) actually depends on this route, the contract is currently undocumented, a real gap against this repo's own rule ("If you add or change a field in a producer, update CONTRACTS.md").

## TASK 0 — Probe

1. Re-confirm every line number above against current HEAD via fresh `grep -n "brief:game:\|adaptNhle\|adaptNbaCDN" src/index.js` — this doc's own numbers may already be stale.
2. Find every remaining `brief:game:*` reader not listed above (the audit found a prefix-scan `list({prefix:'brief:game:'})` at two sites — `/journalism/game-lines` and `sweepKVBriefs` — confirm whether either of these assumes a specific id shape when parsing the scanned keys, since `sweepKVBriefs`'s own id-parsing convention was the exact root cause of the false-negative found earlier this session).
3. Check `CONTRACTS.md` directly (not assumed from the dispatch-time grep) for whether `/journalism/game/{eventId}` or the `brief:game:` KV shape is documented as a client-facing contract, and if so what id format the client is told to send.
4. If reachable, check jubilant-bassoon's client code (or ask the user if it's out of session scope) for what id format each sport's card-renderer actually sends to `/journalism/game/{eventId}` today — this determines whether the current per-sport write-side formats are already correct-by-luck (client already knows to match each sport's shape) or are a live, unnoticed bug.

## TASK 1 — Fix

**Decide, don't default:** two real options, pick one and justify it live against what TASK 0.4 finds — don't assume the "obviously correct" one without checking, since changing an established write-side id format risks the same `ON CONFLICT`/KV-key-identity fragility that the WC26 sport-label fix (`CC-CMD-2026-07-15-wc-label-fragmentation`) had to work around.

- **Option A — normalize at write time.** Pick one canonical id shape (e.g. `{sport}:{rawId}` for every path, matching the WC26/NHL/NBA pattern already used by 3 of the 6 write sites) and migrate the 3 outliers (golf, the generic multi-sport loop, `/journalism/game-complete`) to match. Higher blast radius — touches more call sites — but fixes the problem at the source (Rule 60: relay owns the contract) and makes future generic code (like this session's WC26 sweep, or `/journalism/game-lines`'s prefix scan) safe by default.
- **Option B — resilient read-side lookup.** Make `GET /journalism/game/{eventId}` try the raw id AND the plausible sport-prefixed variants (bounded — Rule 76 caps fallback chains at 2 levels, so this must be a single bounded lookup, not an open-ended guess loop) before returning `{brief:null}`. Lower blast radius, but leaves the underlying inconsistency in place for any other current or future reader of this KV namespace.

Whichever is chosen, do not touch `golf_{eventId}_R{roundNum}`'s *shape* without confirming Golf's client-side reader actually expects a plain sport-prefixed id — its round-suffix is functionally load-bearing (distinguishes R1/R2/R3/R4 recaps for the same event as different KV entries, not just an id-format quirk), so an Option A migration must decide explicitly whether to preserve that distinction under a normalized shape, not silently drop it.

## TASK 2 — Verify

- `node --check src/index.js`: clean.
- Forced-condition test per write-site format (mirroring the id-construction logic exactly, not simulated loosely) confirming the chosen fix produces a lookup-consistent id for all 6 write sites.
- Real live check: for at least 2 different sports with a currently-cached `brief:game:*` KV entry, confirm `GET /journalism/game/{eventId}` returns the real brief (not `{brief:null}`) using whatever id shape the actual client is confirmed (TASK 0.4) to send.
- If `CONTRACTS.md` was found to be missing this contract (TASK 0.3), add it — id shape per sport, the route's exact behavior on miss, and which write sites populate it.

## DONE CONDITION

A client requesting a game's brief via `/journalism/game/{eventId}` gets the real, already-generated brief for that game regardless of which of the 6 write-side sources produced it, verified live for at least 2 sports. The chosen fix (normalize vs. resilient-lookup) is deliberately picked and justified against real evidence of what the client currently sends, not assumed. `CONTRACTS.md` documents this contract if it didn't already.

**Confidence scoring:**
- TASK 0 (30 pts): every write/read site re-confirmed at current HEAD; correctly determines whether `CONTRACTS.md` already covers this (and if the client's actual id format per sport was checked, not assumed)
- TASK 1 (40 pts): deliberate, justified choice between Option A/B; Golf's round-suffix distinction explicitly preserved or explicitly and correctly dropped, not silently lost; no `wrangler.toml` changes
- TASK 2 (30 pts): real forced tests per write-site format; real live confirmation for at least 2 sports; `CONTRACTS.md` updated if it was missing this contract

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
