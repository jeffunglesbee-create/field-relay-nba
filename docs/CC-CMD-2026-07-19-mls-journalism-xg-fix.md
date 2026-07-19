# CC-CMD — Extend /soccer/xg to MLS (usa.1), replace stale FBref pipeline for journalism

**Date:** 2026-07-19
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5

---

## CONTEXT — real, directly verified findings

Real, confirmed problems with the current FBref pipeline for MLS journalism
context, found via direct source inspection:

- `mls: { compId: '22', season: '2025', ... }` in the FBref fetch config
  (~L11808) — hardcoded to last year's season, genuinely stale now.
- FBref hides tables inside HTML comments specifically to defeat scrapers,
  requires a special `Referer` header, and per the code's own comments,
  blocks GitHub Actions IPs with HTTP 403 — a real, adversarial, fragile
  source, not a stable API.
- The relay's own comments (~L13930) already document that FBref was
  replaced for WC2026/premium leagues specifically because "Opta licence
  lost Jan 2026; GH-Actions IP-blocked anyway" — the same real problem
  MLS has now.

**Real, directly verified replacement path — confirmed working tonight, not
assumed:** `/soccer/xg` (the already-built, already-proven ESPN Core API +
summary pattern used for WC2026/premium leagues) genuinely has real xG data
available for MLS too — confirmed via a direct probe of
`site.api.espn.com/.../usa.1/summary?event={a real, recent, completed MLS
game}`, which genuinely contains xG/expectedGoals data.

**Real, separate confirmation, not part of this fix's scope:** the broader
"season-form" context (record, goals, standings) already has a working,
non-FBref source — `stats-api.mlssoccer.com`, confirmed live again tonight.
This CC-CMD only needs to close the xG-specific gap.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
grep -n "if (pathname === '/soccer/xg')" src/index.js
grep -n "buildSoccerXGContext" src/index.js
# Confirm the real, current league-gating logic inside /soccer/xg, if any
```

Confirm the real, current `/soccer/xg` implementation's exact structure
before extending it — this doc's own earlier reading (L13929-13970) may not
reflect the full, real function if it's changed since.

---

## TASK 1 — Confirm /soccer/xg genuinely has no MLS-specific exclusion

Read the real, full `/soccer/xg` handler. Confirm whether it's already
league-agnostic (accepts any `league` param, including `usa.1`) or whether
it has any real, explicit allowlist/exclusion that would need updating to
include `usa.1`.

## TASK 2 — If needed, add usa.1 to any real league allowlist

Only if TASK 1 finds a real, explicit restriction — don't add code that
isn't needed if the route is already genuinely league-agnostic.

## TASK 3 — Wire journalism context to use /soccer/xg for MLS instead of FBref

Find the real, current call site(s) where MLS journalism context assembly
reads from the FBref-sourced data (likely via `sportContextBlock` or
similar, per the `buildSoccerXGContext` reference found tonight). Confirm
whether `buildSoccerXGContext`'s own real, existing gate (mentioned in a
prior session's own fix: "was xG-only, now falls back to match stats") is
already MLS-compatible, or needs its own real update to route MLS through
`/soccer/xg` instead of the FBref R2 read.

**Real, explicit scope boundary: do not remove the FBref pipeline for other
sports (WC2026 already uses /soccer/xg; EPL/La Liga/Serie A/Bundesliga/
Ligue 1 configs in the FBref fetch list are out of scope for this CC-CMD —
confirm whether any of those already also use /soccer/xg or are still
FBref-dependent, and leave them exactly as currently configured either
way.**

## TASK 4 — Real, direct verification

```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/soccer/xg?league=usa.1&event={a real, recent, completed MLS event ID}"
```

Confirm real xG data returns, not `_hasXG:false` — using a real, actual
completed MLS game ID (find one via a real, direct ESPN scoreboard check,
don't guess).

## TASK 5 — Real, honest handling if MLS journalism still needs FBref for something xG doesn't cover

If the real, current MLS journalism prompt pulls any other real field from
the FBref squad-stats JSON beyond xG (check the real, current
`buildSoccerXGContext`/journalism assembly code for this), report this
honestly as a real, separate remaining gap — don't silently drop that data
or force it through `/soccer/xg` if it genuinely doesn't provide it.

---

## DONE CONDITION

MLS journalism context genuinely sources xG data from the real, proven
`/soccer/xg` route instead of the stale, fragile FBref pipeline — verified
via a real, direct probe against a real, completed MLS game. Any real,
remaining gap (non-xG FBref fields MLS journalism might still need) is
honestly reported, not silently dropped or force-fit.

**Confidence scoring:**
- TASK 1 (15 pts): real confirmation of /soccer/xg's real current structure
- TASK 2 (10 pts): real fix applied only if genuinely needed
- TASK 3 (40 pts): real wiring of MLS journalism context to the proven route
- TASK 4 (25 pts): real, direct verification against a real completed MLS game
- TASK 5 (10 pts): honest reporting of any real, remaining non-xG gap

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
