# CC-CMD: Add tier ordering to the now-live Field's Pick ranking

**Date:** 2026-07-07 (v3 — v1's flat sort is live and deployed, `1b3c16f`;
this is a surgical upgrade on top of it, not a redo)
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## WHY THIS DOC EXISTS

The prior CC-CMD (`fields-pick-tiered-ranking.md`, v2) was written to
supersede v1 before execution — but v1 was executed and deployed
anyway (commit `1b3c16f`, confirmed live via `session_health`). Almost
certainly a dispatch mixup: the older v1 one-liner and the corrected v2
one-liner were both presented in consecutive turns, and the older one
got used. Not being reverted — v1's ranked-array plumbing (sort,
top-5, additive to both response branches, exactly one AI call) is
correct and already live. This CC-CMD adds tier logic **on top of**
that real code, matching its actual current shape exactly, rather than
re-deriving a rebuild that assumes the old single-winner code still
exists.

**The underlying design reasoning is unchanged from v2** — a generic
score-only sort is product-generic; FIELD's own `fieldGameTier()`
already establishes that stakes should outrank raw closeness. That
reasoning didn't stop being true because the wrong doc executed first.

## PROBE BLOCK
```bash
sed -n '578,596p' src/analytics-engine.js
grep -n "const SPORT_CONFIG" src/index.js
```
Confirm both match exactly — the live `scored`/`best`/`ranked`
construction, and `SPORT_CONFIG`'s current location (still local to the
push-heartbeat handler, not yet hoisted).

## TASK 1 — Hoist `SPORT_CONFIG`, extend with WNBA/WC26

Identical to v2's Task 1: move `SPORT_CONFIG` (`src/index.js:~3935`)
to module scope, exported. Confirm the push-heartbeat gate still works
identically after the hoist. Add, explicitly disclosed as reuse not
new invention:
```javascript
{sport:'WNBA', path:'basketball/wnba', minPeriod:3, maxMargin:10}, // reuses NBA's exact thresholds
{sport:'WC26', path:'soccer/fifa.world', minPeriod:2, maxMargin:2}, // reuses EPL's exact thresholds
```
Confirm WC26's real ESPN path against existing usage elsewhere in this
file before hardcoding it.

## TASK 2 — Insert tier computation into the exact live code

Replace the exact current block:
```javascript
const scored = candidates
    .map(g => ({ game: g, ...scoreCandidatePick(g) }))
    .sort((a, b) => b.score - a.score);
```
with:
```javascript
function computeTier(g, cfg) {
    const round = (g.round || '').toLowerCase();
    if (round.includes('final') || round.includes('elimination')) return 0;
    if (g.went_to_ot === 1) return 1;
    if (cfg) {
        const period = parseInt(g.period) || 1;
        const margin = Math.abs((g.homeScore||0) - (g.awayScore||0));
        if (period >= cfg.minPeriod && margin <= cfg.maxMargin) return 1;
    }
    return 2;
}
const scored = candidates
    .map(g => {
        const cfg = SPORT_CONFIG.find(c => c.sport === (g.sport||'').toUpperCase());
        return { game: g, tier: computeTier(g, cfg), ...scoreCandidatePick(g) };
    })
    .sort((a, b) => a.tier - b.tier || b.score - a.score);
```
Everything after this line (`best = scored[0]`, the `ranked` mapping,
both response branches) stays exactly as it is now — only add `tier:
s.tier` to the `ranked` entry mapping so it's visible in the output for
verification. `scoreCandidatePick()` itself remains untouched.

**Candidates from the live-fallback path** (not yet archive-seeded,
lacking `round`/`went_to_ot`) will naturally fall to Tier 2 via the
function above — correct, not a bug; do not special-case them further.

## TASK 3 — Verification

- `node --check src/analytics-engine.js` and `src/index.js`.
- Trigger a real run, report the actual `ranked` array including each
  entry's `tier`. Confirm the live push-heartbeat gate still behaves
  identically post-hoist.
- If a real elimination/OT game exists in today's or a near-future
  day's real data, confirm it ranks above a same-or-higher-raw-score
  non-tier-0/1 game — report the real comparison. If none exists today,
  say so honestly rather than fabricating a confirming example.
- Confirm exactly one AI call per run, unchanged from what's already live.

## DONE CONDITIONS
- [ ] Probe block confirms exact live code before editing
- [ ] SPORT_CONFIG hoisted and exported, push gate unaffected
- [ ] WNBA/WC26 added, disclosed as reuse, WC26 path confirmed not guessed
- [ ] Tier computation inserted exactly as specified, comparator updated
- [ ] `tier` added to the `ranked` output for visibility
- [ ] Real run confirms tier precedence where a real example exists, or honestly reports none did
- [ ] Outbox explicitly notes this corrects a dispatch mixup, not a design change

## CONFIDENCE SCORING TABLE
+20  SPORT_CONFIG hoisted correctly, push gate unaffected
+15  WNBA/WC26 additions correct, WC26 path confirmed
+30  Tier computation and comparator correct, inserted into the exact live code shown above
+20  Real run verification, tier precedence demonstrated or honestly unconfirmed
+15  Outbox correctly explains this is a mixup-correction, not a fresh redesign

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-07-fields-pick-tier-upgrade.md. This
is v3 -- v1's flat ranked-array code (1b3c16f) is already live, this
adds tier ordering on top of it exactly as shown, not a rebuild. Hoist
SPORT_CONFIG (confirm push gate unaffected), add WNBA/WC26 (confirm
WC26's real path, don't guess it), insert the tier computation into the
exact current scored/sort line, add tier to the ranked output. Verify
with a real run. Do not commit unless confidence >= 95. If score < 95,
report verbatim and stop.
