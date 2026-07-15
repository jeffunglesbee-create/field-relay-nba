# Claude Code Command — Wire UCL/Europa/Conference qualifying rounds (both sources already support it)

**Date:** 2026-07-15
**Repo:** jeffunglesbee-create/field-relay-nba (sole — `V2_LEAGUES` and the soccer adapter live here)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/european-qualifying-2026-07-15.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

FIELD has zero coverage of UCL/Europa League/Conference League qualifying rounds today — not a data-source gap, a config gap. Both real sources already have everything needed, confirmed live tonight, not assumed:

- **ESPN**: distinct, real, live slugs exist — `uefa.champions_qual`, `uefa.europa_qual`, `uefa.europa.conf_qual` — confirmed via direct fetch, real matches returned (10/6/1 events respectively on 2026-07-14).
- **BSD**: qualifying rounds are already included under the *same* `league_id` already wired for each main tournament (7 for UCL, 8 for Europa/Conference) — confirmed via a real, live CI-as-proxy probe against `sports.bzzoiro.com` directly with the real token: match objects carry `"round_name":"Qualification Round 2"` under `league_id:7`, same teams ESPN showed. **No new BSD competition ID is needed** — this is not a second integration, it's the same one already firing.
- **Football-Data.org**: does not cover Europa/Conference League at all, main tournament or qualifying — genuinely no help here, not in scope to fix.

`V2_LEAGUES` currently has no `_qual` variants — `grep -n "'ucl':\|'europa':\|'conference':" src/index.js` will show the real current entries to extend, not replace.

**Reuse, don't reinvent, two things that already exist for exactly this:**
1. `SOCCER_LEAGUE_LABELS` (added tonight, fixing the league-mislabel bug where every soccer competition was hardcoded to "FIFA World Cup") — the correct place to add real labels for the new qualifying entries, following the exact same pattern.
2. The round-label feature (`game.round`/`game.series`, client-rendered via `buildRoundBadge` — confirmed generic, value-agnostic, no per-string branching) — BSD's own `round_name` field ("Qualification Round 2") should flow straight through this already-built pipeline without new client work, if threaded correctly on the relay side.

## TASK 0 — Probe

```bash
grep -n "'ucl':\|'europa':\|'conference':" src/index.js
grep -n "SOCCER_LEAGUE_LABELS" src/index.js
```
Read the real, current UCL/Europa/Conference `V2_LEAGUES` entries and `SOCCER_LEAGUE_LABELS` in full before extending either. Re-verify the three ESPN qualifying slugs and the BSD lid-reuse finding live, fresh — don't trust this doc's citations alone, per this repo's own CHALLENGE-A convention (both are easy to re-check quickly and cheaply).

## TASK 1 — Add the qualifying entries

Add three new `V2_LEAGUES` entries (naming convention: match the existing style, e.g. `uclqual`/`europaqual`/`conferencequal` or whatever this file's real existing naming pattern suggests — confirm via TASK 0, don't guess) using the confirmed real ESPN slugs, and the **same** `bsdLeagueId` as each entry's main-tournament counterpart (7/8/8) — this is the one place a shared ID across two `V2_LEAGUES` entries is correct and intentional, not a bug, since BSD genuinely doesn't distinguish qualifying from main tournament at the API level.

Add matching entries to `SOCCER_LEAGUE_LABELS` with real, human-readable labels ("UEFA Champions League Qualifying", not left to fall back to the raw sportKey) — following tonight's own established fix pattern exactly.

## TASK 2 — Verify

- `node --check src/index.js`: clean.
- Real live test: `/v2/games?sport=uclqual&date=...` (or whichever real key TASK 1 lands on) returns real qualifying fixtures, correctly labeled, not falling back to a generic/wrong league name.
- Confirm `game.round` correctly carries BSD's real `round_name` value when available, and that this flows through to the client's existing `buildRoundBadge` without needing any client-side change — verify via reading `buildRoundBadge`'s real current source, confirming it's still genuinely value-agnostic (don't just cite tonight's earlier finding, re-confirm it holds for this specific new data).
- Confirm zero effect on the existing main-tournament entries — this is purely additive.

## DONE CONDITION

UCL/Europa League/Conference League qualifying rounds are real, queryable `V2_LEAGUES` entries with correct labels, sharing BSD's existing league_id with their main-tournament counterparts rather than requiring new BSD wiring. Round names flow through the existing, unmodified round-label display pipeline. Verified against real live data from both sources, not asserted from this document's own citations.

**Confidence scoring:**
- TASK 0 (25 pts): reads the real current V2_LEAGUES/SOCCER_LEAGUE_LABELS entries, re-verifies both the ESPN slugs and the BSD lid-reuse finding live rather than trusting this doc alone
- TASK 1 (40 pts): three new entries correctly added with real slugs and the intentionally-shared bsdLeagueId, real labels added following tonight's established fix pattern exactly
- TASK 2 (35 pts): real live verification of at least one qualifying competition's data, round-label pass-through confirmed via direct source re-read, non-regression on main tournaments confirmed

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
