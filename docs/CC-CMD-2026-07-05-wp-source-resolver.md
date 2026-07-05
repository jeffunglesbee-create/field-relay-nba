# CC-CMD: WP source resolver — incorporate all confirmed sources, add CFB, wire into pick ledger

**Date:** 2026-07-05
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Scope:** New resolver function in `src/index.js`, one new odds-key mapping entry, wired to `pickLedger`'s `pick_resolved` handling in `src/user-do.js`.
**Depends on:** `CC-CMD-2026-07-05-pick-ledger-backend.md` (pickLedger must exist first).

## Real sources confirmed this session, per sport — nothing here is assumed

- **MLB**: ESPN native `winprobability[]` (confirmed, 67 real entries) + Baseball Savant (MLB-only, no relay hop). Label: "Statistical probability" (model-derived).
- **WNBA/NBA**: ESPN native `winprobability[]` (confirmed, 409 real entries). Label: "Statistical probability."
- **AFL**: Kali `/predictions` (`homeWinPct`/`awayWinPct`, real, already-injected via `buildAFLJournalismContext`) OR Squiggle `/tips` `confidence` field (confirmed real, 71.93 observed against a real completed game, consistent with actual result). Label: "Statistical probability" (both are model/tipping-derived, not raw market odds).
- **Soccer/WC**: FIELD's own `computeLiveWP()` — confirmed genuinely live, already writing `g.winProb` onto served game objects (not dormant). Label: "Statistical probability."
- **CFL**: real live `markets` field on the CFL scoreboard (`home`/`away` moneyline values, confirmed real and populated) — convert via the existing `noVigProb()` function. Label: "Market estimate."
- **NHL, MLS, EPL, NFL**: already mapped in `ARCHIVE_SPORT_TO_ODDS_KEY` (`icehockey_nhl`, `soccer_usa_mls`, `soccer_epl`, `americanfootball_nfl`) — real, already-integrated Odds API keys. Convert via `noVigProb()`. Label: "Market estimate."
- **CFB**: Odds API confirmed to support `americanfootball_ncaaf` as a real, active sport key — FIELD's own mapping table just doesn't have this entry yet. Add it, then treat identically to NHL/MLS/EPL/NFL. Label: "Market estimate."

**No source found and none proposed here**: none currently missing across the sports checked this session — every sport now has at least one real, confirmed path.

**Target time:** ~45 min

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95.

## PROBE BLOCK
```bash
grep -n "ARCHIVE_SPORT_TO_ODDS_KEY" src/index.js -A 20
grep -n "function noVigProb" src/index.js -A 8
grep -n "pickLedger\|pick_resolved" src/user-do.js
```
Re-confirm the odds-key table, the no-vig function, and pickLedger's
current shape (from the prior CC-CMD) before building the resolver.

## TASK 1 — Add the missing CFB mapping

Add `cfb: 'americanfootball_ncaaf'` to `ARCHIVE_SPORT_TO_ODDS_KEY`. One line.

## TASK 2 — Build resolveWinProbability(sport, gameId, ...)

A single function that, given a sport and game identifiers, returns
`{ probability, source, label }` by trying the real, confirmed source(s)
for that sport in the order listed above (e.g., MLB tries ESPN native
first, falls back to Savant only if that fails). For odds-derived
sports, call the existing Odds API integration + `noVigProb()` — do not
duplicate that logic, call what already exists. Return `label` as
exactly "Market estimate" or "Statistical probability" per the mapping
above — no other label strings.

## TASK 3 — Wire into pick_resolved

When `/user/event` receives a `pick_resolved` event, if
`revealedProbability`/`probabilitySource` aren't already provided by the
caller, call `resolveWinProbability()` server-side to fill them in
before storing. This keeps the correct-source logic in one place rather
than trusting each caller to get it right.

## TASK 4 — Verify against real games, one per resolved source type

For at least one real game per distinct source (ESPN native, Kali/
Squiggle, FIELD's own soccer WP, and one odds-derived sport), confirm
`resolveWinProbability()` returns a real, sensible probability with the
correct label — not synthetic test cases.

## SCOPE BOUNDARY

DO:
- Add exactly the one CFB mapping entry
- Build the resolver reusing existing sources/functions, not duplicating them
- Use only the two label strings specified, nothing else
- Verify against real games per source type

DO NOT:
- Invent a new WP computation for any sport — every sport already has a real, confirmed source now
- Touch the pickLedger's cumulative-stats logic from the prior CC-CMD
- Add any per-sport special-case labels beyond "Market estimate" / "Statistical probability"

## DONE CONDITIONS
- [ ] Probe block re-run, all three prerequisites re-confirmed
- [ ] CFB mapping added
- [ ] resolveWinProbability() built, correctly routes each sport to its confirmed real source
- [ ] Wired into pick_resolved as a server-side fallback fill
- [ ] Verified against real games across at least 4 distinct source types
- [ ] Outbox manifest written

## CONFIDENCE SCORING TABLE
+15  CFB mapping added correctly
+35  Resolver correctly routes every sport to its real, confirmed source, reusing existing functions
+20  Correctly wired into pick_resolved
+30  Verified against real games across multiple source types, not synthetic

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-05-wp-source-resolver.md. Requires
the pick-ledger-backend CC-CMD to already be done. Add cfb:
'americanfootball_ncaaf' to ARCHIVE_SPORT_TO_ODDS_KEY. Build
resolveWinProbability(sport, ...) routing each sport to its real,
already-confirmed source this session (ESPN native for MLB/WNBA/NBA,
Kali or Squiggle for AFL, FIELD's own computeLiveWP for soccer, Odds
API + noVigProb for CFL/NHL/MLS/EPL/NFL/CFB) -- reuse existing
functions, don't duplicate. Label strictly as "Market estimate" or
"Statistical probability", nothing else. Wire as a server-side fallback
into pick_resolved. Verify against real games per source type. Do not
commit unless confidence ≥ 95. If score < 95 report verbatim and stop.
