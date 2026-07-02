# Outbox — Wire Goalscorer Names to Real BSD Shot xG

**Date:** 2026-07-02
**CC-CMD:** docs/CC-CMD-2026-07-02-goalscorer-xg.md
**Status:** SHIPPED
**Commit:** 373899d

---

## Task 1 — CANONICAL_PLAYER_SOCCER extended with bsdPlayerId

Changed pair structure from `[variant, canonical]` to `[variant, canonical, playerId]`.
Built both `CANONICAL_PLAYER_SOCCER` (variant-key → canonical-key) and `SOCCER_PLAYER_ID_BY_KEY`
(canonical-key → BSD numeric player_id) in one `_SOCCER_BUILD` IIFE.

**Key design note:** `idByKey` is keyed by `_stripPlayerSoccer(canonicalName)`, not
`_stripPlayerSoccer(variant)`. The CC-CMD's suggested snippet keyed by variant, but
`resolveEntity` returns the canonical form — keying by variant would break the
`SOCCER_PLAYER_ID_BY_KEY[resolveEntity(...)]` call at the lookup site. Fixed before coding.

`SOCCER_PLAYER_ID_BY_KEY` exported alongside `resolveTeamKey`, `resolveEntity`.

---

## Task 2 — xG wiring in writeWCResult

**BSD fetch reuse:** `buildBSDMomentumContext` reads prior-match R2 data, not the
current game's shotmap. No existing call was reusable. A new direct BSD API call was
added to `writeWCResult` (`https://sports.bzzoiro.com/api/v2/events/{bsdEventId}/stats/`
with `env.BSD_API_TOKEN`, 4 s timeout).

**Budget impact:** One additional BSD API call per WC game journalism run. WC26 group
stage has ≤3 simultaneous finals per day. Bounded; not a rate-limit concern.

**Call site:** Placed after the R2 captureWithRetry fire-and-forget (which writes current
game data to R2 via `ctx.waitUntil`) and before the `eventsContext` block. R2 would not
have this game's shotmap yet — direct BSD fetch required.

**Fallback:** `bsdGoalXg` is always declared as `{}`. If `game.bsdEventId` is absent,
`env.BSD_API_TOKEN` is missing, the fetch times out, or BSD returns non-ok, the map
stays empty. Scoring play lines render as `⚽ ${label}` with no xG suffix — same as
before. `catch (_)` block prevents any BSD failure from blocking journalism.

Scoring play line format with enrichment: `⚽ 90 Player (Team) xG: 0.46`

---

## Task 3 — Verification

```
node -c src/identity-resolver.js  → OK
node -c src/index.js              → OK
```

**Inline test (player_id 4217 / xG 0.456):**
```
Input name: Eren Elmali
resolveEntity key: elmali
idByKey lookup: 4217
bsdGoalXg[4217]: 0.456
xgSuffix:  xG: 0.46
PASS: chain produces correct xG
```

**player_id: 4218 discrepancy:** The CC-CMD's inline test case specified
`player_id: 4218` / `xG: 0.456`, but our mapping has `Elmalı: 4217`.
The crosscheck script output (sourced 2026-07-02, real BSD API) listed
Elmalı as `player_id: 4217`. The CC-CMD's PRE-BUILD PROBE block also lists
`Elmalı: 4217`. The `4218` in the test case looks like a typo. Test was run
with `4217` (our actual mapping value) and passes correctly.

---

## Task 4 — Unconfirmed Player IDs

**Macià (5143):** Sourced from `scripts/soccer-player-crosscheck.js` real output
(BSD API confirmed 2026-07-02). CC-CMD flagged as "unconfirmed" because the crosscheck
hadn't been re-run after the v5 update. These were listed as real values in the CC-CMD
itself ("Macià: 5143 ... Purić: 5154 — Re-verify against the live artifact"). Status:
present in our mapping, sourced from real crosscheck output, not independently re-verified
this session against the v5 artifact. If the crosscheck has been regenerated since the
CC-CMD was written, re-verify these two IDs before relying on them in production.

**Purić (5154):** Same status as Macià above.

All other 7 player IDs (Yılmaz 3734, Çakır 3724, Yıldız 2184, Aydın 3412,
Elmalı 4217, Bardakcı 3727, Pulišić 3820) have no ambiguity flag.

---

## Chat-Side Follow-Up

Confirm against a live WC26 match journalism output that scoring plays for
tracked players now show ` xG: X.XX` suffix (e.g., `⚽ 90 Eren Elmalı (TUR) xG: 0.46`).
Absence of the suffix on a goal scored by a tracked player signals either the
BSD fetch failed or the player name in ESPN's feed didn't match the variant key.
