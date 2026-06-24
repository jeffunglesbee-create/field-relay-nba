# WC Matchup Context — KV Cache + writeWCResult Injection — 2026-06-24

## Probes

- `env.FIELD_JOURNALISM` accessible in `writeWCResult(db, game, env)`.
- `let standingsContext = '';` at index.js:1546 — `matchupContext` block
  goes immediately before it.
- `/wc/matchup/cache` did not exist.
- MCP probe allow-list has ALLOWED_EXACT containing `/wc/bracket/refresh`
  — added `/wc/matchup/cache` alongside.

## What shipped (src/index.js)

**`POST /wc/matchup/cache`** — inserted before the WC 404 fallback at L6475.
- Auth: none (KV writes are gated by the FIELD_JOURNALISM binding which
  is only available to the relay itself; client POSTs come from the
  trusted FIELD_Handoff MCP relay or jubilant-bassoon's worker).
- Body: `{home, away, note}`. All three required.
- Normalizes: `s.trim().toLowerCase().replace(/\s+/g, '_')`.
- Writes both `wc:matchup:{home}_{away}` AND `wc:matchup:{away}_{home}`
  with 24h TTL so the writeWCResult lookup hits regardless of which
  side it picks as home.
- Note value capped at 400 chars.

**`writeWCResult` matchupContext block** — inserted at L1546, between
`recomputeGroupStandings` (L1514) and the existing standings block.
Reads `wc:matchup:{homeName}_{awayName}` and prepends a `PRE-GAME
CONTEXT:` block to the prompt. Empty string on miss/error.

**Prompt array** — `matchupContext` slotted between `Date:` and
`standingsContext`:
```
RESULT: ...
Group: ...
Date: ...
<PRE-GAME CONTEXT: ...>     ← new
<GROUP STANDINGS ...>
<MATCH EVENTS ...>
```

**POST gate exception** added at L7310 so `/wc/matchup/cache` doesn't 405.

**MCP `ALLOWED_EXACT`** gains `/wc/matchup/cache` so probe_relay_route
+ chat clients can confirm the route surfaces correctly.

## Commit & deploy

- `39b6815` feat: wc matchup context — POST /wc/matchup/cache + writeWCResult injection (1 file, +54/−1)
- Deploy: workflow 28102748135 — completed/success.

## Done conditions

- [x] `POST /wc/matchup/cache` endpoint in `src/index.js`
- [x] `wc:matchup:` key written with 24h TTL, both orientations
- [x] `let matchupContext = ''` block in `writeWCResult`
- [x] `matchupContext` in prompt array before `standingsContext`
- [x] `/wc/matchup/cache` in probe allow-list (ALLOWED_EXACT) + POST gate
- [x] `node --check` passes
- [x] Deploy green (28102748135)
- [x] Outbox manifest committed

## Pair-up with client CC-CMD

Client side (`jubilant-bassoon/CC-CMD-2026-06-24-wc-matchup-client.md`)
must ship to actually populate the KV. Until that runs, this relay code
just sits idle reading non-existent keys — empty matchupContext, no
prompt change. The relay is now a no-op-safe consumer; flip the switch
client-side.

Suggested client behavior:
- In `_fetchWCTournBriefForSchedule` (or equivalent place that has
  matchupNotes for today's upcoming WC games), POST each fixture's
  matchupNote to `https://field-relay-nba.../wc/matchup/cache` with
  `{home, away, note}`. Fire-and-forget.
- 24h TTL means a single morning POST per fixture covers the same-day
  result write. No re-POST needed unless the matchupNote changes.

## Verify

After client ships:
```
# probe the new route shape (no body, expect 400):
probe_relay_route /wc/matchup/cache?test=1
# expect: 400, {ok:false, error:"missing home/away/note"} OR 405
# (GET to a POST-only route; depends on outer routing)

# Verify a written key:
# (only possible from the client or a trusted POST; no public GET endpoint)
```

End-to-end signal: the next WC final after the client ships will produce
a brief that mentions narrative setup beyond the score (e.g., "MD3
decider", "path trap active"). Check AI Gateway log for the
`PRE-GAME CONTEXT:` line in the prompt.
