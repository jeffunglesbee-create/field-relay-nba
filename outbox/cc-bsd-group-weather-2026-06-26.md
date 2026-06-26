# BSD group_name + Weather Enrichment — 2026-06-26

## Commit

- `2a66e0a` feat(wc): BSD group_name + weather enrichment in ESPN WC branch
- Deploy: workflow 28212074241 — deployed at 01:53:27Z, `/deploy/verify match=true` at 01:54:06Z

## Two patches shipped

**TASK 1 — ESPN WC branch BSD enrichment**
Inserted at `handleV2Games` ESPN branch immediately after `const games = espnGames;`.
Fetches `https://sports.bzzoiro.com/api/v2/events/?date={YYYY-MM-DD}&league_id=27` once
per request (4s timeout, non-blocking). NFD-normalized + alphanumeric-only + 8-char prefix
name match on `home_team` OR `away_team`. When a match is found:
- `game.round` ← BSD `group_name` ("Group I", "Group H", etc.) — lets `extractWCGroup()`
  hit its regex primary path instead of the `_WC_TEAM_GROUP` name-lookup fallback.
- `game.weather` ← BSD `{code, description, wind_speed, temperature_c}` — preserved on
  the game object for journalism consumption.

**TASK 2 — `writeWCResult` weatherContext**
New IIFE builds a single-line `Conditions:` string from `game.weather`, surfaced only when
meaningful (non-clear/non-unknown description, temperature ≥32°C or ≤5°C, wind ≥25 km/h).
Empty string when weather is benign or absent → no prompt noise. Appended after
`eventsContext` in the prompt array.

## Live verification (`/v2/games?sport=wc26&date=2026-06-26`)

5 of 6 games enriched on the first deploy:

| Game | round | weather |
|------|-------|---------|
| Norway vs France | `Group I` | rain, 19°C, 15.1 km/h |
| Senegal vs Iraq | `Group I` | (null desc), 22°C, 5.2 km/h |
| Uruguay vs Spain | `Group H` | rain, 22°C, 5.6 km/h |
| Egypt vs Iran | `Group G` | unknown, 18°C, 14.5 km/h |
| NZ vs Belgium | `Group G` | clear, 18°C, 4.7 km/h |
| Cape Verde vs Saudi Arabia | `""` | (none) — no BSD match |

The Cape Verde miss is a team-name normalization edge case (BSD likely uses "Cape Verde Islands"
or similar non-prefix variation). The 8-char-prefix normalization (`capeverd`) didn't hit.
Graceful degradation: round defaults to '' (falls back to `_WC_TEAM_GROUP` lookup),
weather is undefined (weatherContext returns ''). Not in scope to chase per Rule 69.

## Bundle verification (Rule 77)

`workers_get_worker_code` grep at 01:54:06Z:
- `group_name`: 2 hits ✓
- `weatherContext`: 2 hits ✓
- `game.weather`: 1 hit ✓ (minified code consolidates access)

## Done conditions

- [x] `node --check src/index.js` clean
- [x] `grep group_name`: 2 (BSD hit detection + assignment)
- [x] `grep weatherContext`: 2 (IIFE def + prompt entry)
- [x] `grep game.weather`: 2 (enrichment write + weatherContext read)
- [x] Bundle verified via `workers_get_worker_code`
- [x] Live response confirms 5/6 games carry `round: "Group X"` + `weather: {...}`
- [x] `/deploy/verify match=true` at 01:54:06Z

## Activation gates (natural runtime)

- **journalism brief**: Next time a WC game finalizes, `writeWCResult` will build
  `weatherContext` from `game.weather`. Verify by reading the brief text after a game
  with non-benign weather goes final — expect `Conditions: rain, 32°C, 28 km/h` style line
  in the LLM context (LLM may or may not surface it verbatim — that's the LLM's call).
- **D1 group resolution**: `writeWCResult` calls `extractWCGroup(game.round, homeName, awayName)`.
  With `round: "Group I"` set, the regex path `/Group ([A-L])/i` hits — no name-lookup
  fallback needed. Reduces edge cases where `_WC_TEAM_GROUP` lookup might miss.

## Compliance

- **Rule 47**: Enrichment is field assignment from BSD response. No editorial computation.
- **Rule 69**: Only `src/index.js`. Two scoped patches.
- **Rule 76**: Both fields have one fallback level (BSD miss → existing behavior). No
  cascade.
- **Rule 80**: `env.BSD_API_TOKEN` lives on the worker. Zero credentials in agent context.
- **Rule 5**: BSD fetch wrapped in `try/catch`; failure leaves game objects unchanged.
  Cannot break `handleV2Games` D1 writes or response.

## Out of scope (per CC-CMD scope boundary)

- `adaptESPNWCSoccer` unchanged — round still set to '' at adapt time; enrichment runs after.
- `extractWCGroup` and `_WC_TEAM_GROUP` unchanged — fallback path still valid for non-BSD games.
- `runBSDEndgameCapture` not touched (was fixed in 4b9ea318 per CC-CMD context).
- Client repo not touched — weather surfaces only in the LLM prompt, not on the wire to
  jubilant-bassoon.
- Drama scoring not modified — weather → drama is client-side `weatherDramaModifier`.
