# Claude Code Command — Tiered pre-game brief generation (cost-conscious gameBriefs coverage)

**Date:** 2026-07-18
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5.

---

## CONTEXT

Real, confirmed gap: `gameBriefs[]` is empty for most games not because of a bug, but because pre-game briefs are only currently generated for J2 series-preview/stakes contexts. The Debrief's "FIELD Was Watching" layer degrades gracefully with no brief (Phase 3b's null-guard design) — so this isn't broken, just thin coverage.

**Real, cost-conscious recommendation (this CC-CMD's actual design):** don't generate a pre-game brief for every game. Generate one only for games that clear an existing, already-computed significance bar — reusing `fieldTierRank`/`fieldTierLabel` (jubilant-bassoon, `src/utils/tier.js`, extracted earlier tonight) rather than inventing a new classification. This keeps volume naturally low (most games are routine, most routine games stay uncovered — correctly) while ensuring the games people actually care about get real pre-game context.

**Real cost math to keep in mind while implementing:** Gemini Flash-Lite is the confirmed production model (per tonight's own head-to-head — cheaper and better than the 3.5 alternative tested). A short (2-3 sentence) pre-game brief per qualifying game, once per game (not regenerated), at MUST/WATCH tier volume only (a real minority of any day's slate), is a small, bounded cost — not the unbounded cost of covering every game across every sport.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
grep -n "function.*archiveBrief\|/archive/brief" src/index.js | head -5
```

Confirm the real, current `/archive/brief` write path (relay-side) before building a new generation trigger — reuse it, don't duplicate.

Client-side (jubilant-bassoon, read-only reference — do NOT edit that repo in this CC-CMD):
```bash
# For reference only, confirm fieldTierRank's real current tier values
```

---

## TASK 1 — Real confirmation of the tier signal's real, current values

Since `fieldTierRank`/`fieldTierLabel` live in the client repo (`jubilant-bassoon`), and this CC-CMD is relay-only, confirm how tier classification data reaches the relay — likely via the game object already including tier info when journalism generation requests happen, or the relay needs its own equivalent significance check using already-available relay-side signals (final score margin isn't available pre-game; use whatever real, pre-game signal actually exists relay-side — odds-implied competitiveness, rivalry/division-game flags, playoff implications, national broadcast flag — confirm what's real and available before assuming client-side tier data is directly accessible here).

**If tier data genuinely isn't available relay-side pre-game:** design an equivalent, relay-native "worth a pre-game brief" check using real, confirmed available signals (national broadcast, playoff/elimination context, close-odds competitiveness) rather than assuming client logic can be ported directly.

## TASK 2 — Wire selective pre-game brief generation

For games meeting the real, confirmed significance bar from TASK 1, at a real, sensible point in the existing pipeline (likely alongside the existing J2/stakes brief generation path — reuse that trigger mechanism rather than building a new one), generate and write a real, short pre-game brief via the existing journalism/prompt infrastructure.

**Real, explicit volume guard:** confirm this doesn't fire for every game — a real, live check of a full day's slate should show generation limited to the real minority that clears the bar, not all games.

## TASK 3 — Real verification

Real probe: confirm a real, current-slate MUST/WATCH-tier (or relay-equivalent) game gets a real, new pre-game brief written, and confirm a real routine/low-tier game does NOT — both outcomes need to be verified, not just the positive case.

---

## DONE CONDITION

Pre-game briefs generate selectively for real, significant games only (confirmed via a real signal, not invented), with a real, demonstrated volume guard (some games get one, most don't) — verified via real probes for both the positive and negative case.

**Confidence scoring:**
- TASK 1 (35 pts): real, honest determination of what significance signal is actually available and appropriate relay-side
- TASK 2 (35 pts): real, selective wiring reusing existing infrastructure
- TASK 3 (30 pts): real verification of both positive (significant game gets brief) and negative (routine game doesn't) cases

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
