# Identity Resolver — Centralized Team-Name Matching (2026-06-21)

## Pre-build probes — D1-derived

### Missing-opening_odds counts
```
MLB                47
WNBA               34
EPL                20
AFL                16   (no Odds API coverage — expected)
La Liga            10
MLS                 8
golf                6   (no Odds API coverage — expected)
FIFA World Cup 26   5
CFL                 2   (no Odds API coverage — expected)
IPL                 2   (no Odds API coverage — expected)
Ligue 1             2
```

Total addressable (sports with Odds API coverage): EPL 20 + WNBA 34 +
MLB 47 + MLS 8 + La Liga 10 + Ligue 1 2 + WC 5 = **126 games**.

### Observed mismatch patterns (D1 SELECT vs Odds-API canonical)

**EPL** — punctuation / long-form:
- `Brighton & Hove Albion` ↔ `Brighton and Hove Albion`
- `AFC Bournemouth` ↔ `Bournemouth`
- `Sunderland AFC` ↔ `Sunderland`
- `Wolverhampton Wanderers` ↔ `Wolves` / `Wolverhampton`
- `Nottingham Forest` ↔ `Nott'm Forest`
- `Newcastle United` ↔ `Newcastle`
- `Manchester United` ↔ `Man United`
- `Manchester City` ↔ `Man City`
- `West Ham United` ↔ `West Ham`

**WNBA** — D1 mixes short (mascot only) and long forms:
- `Aces` ↔ `Las Vegas Aces`
- `Sun` ↔ `Connecticut Sun`
- `Liberty` ↔ `New York Liberty`
- `Lynx` ↔ `Minnesota Lynx`
- `Storm` ↔ `Seattle Storm`
- `Fever` ↔ `Indiana Fever`
- `Sky` ↔ `Chicago Sky`
- `Sparks` ↔ `Los Angeles Sparks`
- `Mercury` ↔ `Phoenix Mercury`
- `Dream` ↔ `Atlanta Dream`
- `Mystics` ↔ `Washington Mystics`
- `Wings` ↔ `Dallas Wings`
- `Valkyries` ↔ `Golden State Valkyries`
- `Fire` ↔ `Portland Fire`
- `Tempo` ↔ `Toronto Tempo`

**MLB** — same short-vs-long pattern + relocated Athletics:
- `Athletics` (now Sacramento) ↔ `Oakland Athletics` (Odds API legacy)
- `Astros` ↔ `Houston Astros`
- `Guardians` ↔ `Cleveland Guardians`
- `Braves` ↔ `Atlanta Braves`
- `Brewers` ↔ `Milwaukee Brewers`

**MLS** — FC/SC suffixes + LA/LAFC ambiguity:
- `Inter Miami CF` ↔ `Inter Miami`
- `LA Galaxy` ↔ `Los Angeles Galaxy`
- `LAFC` ↔ `Los Angeles FC`
- `NYCFC` ↔ `New York City FC`
- `Charlotte FC` ↔ `Charlotte`
- `Austin FC` ↔ `Austin`
- `St. Louis City SC` ↔ `St Louis City`
- `Nashville SC` ↔ `Nashville`
- `FC Cincinnati` ↔ `Cincinnati`

**La Liga** — primarily diacritics (NFD strip alone handles most):
- `Alavés` → `Alaves`
- `Español` → `Espanol`
- `Atlético Madrid` ↔ `Atletico Madrid` (NFD-handled)

**Ligue 1**:
- `Paris Saint-Germain` ↔ `PSG`

**WC / International** (migrated from existing teamNameMatch):
- `USA` ↔ `United States`
- `Turkey` ↔ `Türkiye`
- `Czech Republic` ↔ `Czechia`
- `DR Congo` ↔ `Congo DR`
- `Ivory Coast` ↔ `Côte d'Ivoire`
- `South Korea` ↔ `Korea Republic`

## Design

Single export `resolveTeamKey(name) → string` returns a CANONICAL
strip-form key. Both `Aces` and `Las Vegas Aces` map to
`lasvegasaces`. The same canonical key on both sides of the
`byPair.get/.set` produces a clean hash lookup.

Process:
1. NFD-normalize + strip diacritics → lowercase
2. Strip non-alphanumeric → `stripForm`
3. Look up `CANONICAL[stripForm]` → return canonical strip-form
4. Fallback: return `stripForm` itself (no alias known)

The `CANONICAL` map is forward-only: every known variant strip-form
points to the canonical strip-form. The canonical is its own key in
the map (idempotent — `resolveTeamKey('Las Vegas Aces')` returns
`lasvegasaces` whether or not the alias path triggers).

## What ships

1. `src/identity-resolver.js` (new): `resolveTeamKey(name)` + the
   `CANONICAL` alias map.
2. `src/index.js`:
   - Import `resolveTeamKey`.
   - Replace `_normTeam` in `snapshotCronOdds` (L3937, L3950) and
     `runOddsBackfillForDate` (L4056, L4065). The L5282/L5287 odds-
     annotation lookups (cron prompt) are NOT touched — they
     symmetrically use `_normTeam` on both sides, so changing one
     side without the other would break it (out of spec scope).
   - Refactor `teamNameMatch` to use `resolveTeamKey` (inline
     ALIASES becomes a thin shell over the centralized map).
   - Add `GET /identity/mismatches?sports=...` diagnostic endpoint.
3. `src/ambient-do.js`: replace the NFD/substring matching block in
   `_captureClosingOdds` with `resolveTeamKey`. Behaviorally
   equivalent for canonical names; cleaner for aliases.

## Expected impact

Once the next `snapshotCronOdds` cron tick runs after deploy:
- All 34 WNBA games with short-mascot names should match.
- All 20 EPL games with punctuation/long-form mismatches should match.
- ~30+ MLB games with short-name entries should match.
- Diacritic-only La Liga teams already get matched by NFD strip.

Net: ~80-100 additional games get opening_odds populated on the next
snapshot tick. The remaining ~30 may need additional aliases — the
new `/identity/mismatches` endpoint surfaces them.

## Carry-forwards

1. The L5282/L5287 odds-annotation lookup in the cron prompt path
   still uses `_normTeam`. Symmetric (both sides use same function)
   so it works, but it's inconsistent with the rest. Convert in a
   follow-up if the cron-time annotation rate drops in the new
   metrics.
2. `/identity/mismatches` costs 1 Odds-API credit per sport probed
   (capped at 5 sports per call). Don't add to any cron — manual
   diagnostic only.
3. Historical backfill of the 152 missing rows is explicitly OUT of
   scope per spec (historical Odds API costs 10×). The resolver
   catches future games only.
4. NBA/NHL aliases are minimal in the migrated set — most NBA/NHL
   D1 rows already match the Odds API. Add if mismatches surface
   via `/identity/mismatches`.
