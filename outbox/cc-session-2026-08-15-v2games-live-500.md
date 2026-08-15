# CC session — /v2/games 500 (CF 1101) when any non-soccer game is live

**Date:** 2026-08-15
**Repo:** field-relay-nba (sole)
**Branch:** main — confirmed `git branch --show-current` = main
**Commit:** `f949456`
**Deploy:** deploy.yml — success. Route verified 200 post-deploy.

## Symptom (found via jubilant-bassoon's NFL EPA live probe)

`/v2/games?sport=nfl&date=2026-08-14` → HTTP 500, body `error code: 1101`
(CF "Worker threw an exception"), while `date=2026-08-13` (completed games)
and `date=2026-08-15` (upcoming) both returned 200. The discriminator: 08-14
had **live** games. Browser saw it as a CORS error (a thrown Worker exception
returns no CORS headers), which broke NFL card loading client-side.

## Root cause

The WC26/soccer live win-probability loop in the `/v2/games` handler
(`for (const g of games) { if (g.state!=='live'||!g.situation) continue; ... }`)
ran for EVERY live game, with no sport gate. `computeLiveWP` is a soccer
Poisson/Dixon-Coles model; `computeAdvancementProb` is WC-only. For football
(NFL/CFB) `g.round` is the numeric ESPN week (e.g. 2), and
`extractWCGroup(g.round,...)` does `(round||'').match(...)` → `(2).match(...)`
→ TypeError, thrown OUTSIDE the inner try/catch → propagates → CF 1101.
Reproduced locally: `(2||'').match is not a function`.

## Fix (`f949456`)

Gate the loop to the soccer/else-branch adapter by excluding the non-soccer
adapters:
`if (['baseball','football','basketball','australian-football'].includes(cfg.espnSport)) continue;`
Soccer's own `cfg.espnSport` is undefined (defaults to 'soccer'), so an
exclude-list is the robust test, mirroring the adapter dispatch at ~4008.
This (a) stops the crash for football/CFB and (b) stops the loop inventing a
bogus soccer-model `winProb` on non-soccer live games (Rule 1). computeLiveWP's
inputs are all soccer-only (SOT/stoppage/manAdvantage/shootout → all default to
0/false), so no non-soccer sport legitimately consumed its output.

## Done-condition artifact

Post-deploy `probe_relay_route /v2/games?sport=nfl&date=2026-08-14` → **200**,
3 games (Broncos@Falcons 27-7 F, etc.). And jubilant-bassoon's live EPA probe
went from FAIL/INCONCLUSIVE to **PASS** (epaChipsOnNFLCards:4) once this
deployed — the client half was already correct; this unblocked it.

## Blast radius / follow-up (Rule 69)

The gate also stops the loop for MLB/basketball/AFL live games, which were
previously running the soccer WP model and setting a meaningless `g.winProb`.
That was invalid data (MLB WP is Savant client-side; others have their own
resolvers), so removing it is a correctness improvement, not a regression.
No non-soccer consumer of v2 `g.winProb` was found. Flagged here for the record.

## Rule compliance
- **Rule 77** — investigated to the exact throwing line + reproduced, not rationalized.
- **Rule 47/Rule 1** — removes bogus cross-sport computed WP; soccer WP unchanged.
- **Rule 39** — mapped the block's consumers (winProb/advancementProb/GAME_DO crunch) before gating.
- **Rule 66** — `node --check` clean; deploy verified; route re-probed 200.
