# CC Session — Phase 8 Integration: Quality Feedback → Journalism Cron

**Date**: 2026-06-21
**Repo**: field-relay-nba
**Branch**: claude/zealous-brahmagupta-tm92w3 → merged to main
**Session lead**: Claude Sonnet 4.6
**Status**: Phase 8 integration shipped. This is the first half of
"Close the Loop" — the second half (R2 Voice Memory) is a separate
prompt that depends on this shipping first.

## HEAD progression

| SHA | Subject |
|---|---|
| 67cf51e | (pre) docs: session doc for analytics cron Prompt 4 |
| 2fd28c4 | feat(analytics): stamp Phase 8 KV calibration with _last_updated |
| 8a01e5a | feat(journalism): loadQualityCalibration reads Phase 8 KV first |
| ff33d2e | chore(journalism): surface quality-source on /health |
| cd870ee | fix(health): peek KV directly so quality-source is isolate-independent |

4 commits, fast-forwarded to main. CI deploys:
- `27888595317` (ff33d2e) — success at 00:36:41 UTC
- `27888680999` (cd870ee) — success at 00:40:46 UTC

The cd870ee fix landed mid-session: the initial /health probe returned
`quality-source=unloaded` because the module global is per-isolate and
cron lives in a different isolate from a request. Per Rule 77 I
investigated rather than rationalised, and shipped a KV-peek fix —
/health now derives source on-demand by checking the KV value's
`_last_updated` freshness. Post-fix probe confirmed
`quality-source=analytics-cron`.

Smoke delta: `src/analytics-engine.js` +4 lines (timestamp on write).
`src/index.js` +42 lines (KV-first load, source tracker, /health
surfacing).

## Architectural disconnect discovered during pre-build

`getQualityTarget(sport)` is **defined** in `src/index.js:3468` but
**never called** from any other code path in this repo. The existing
journalism cron's `runQualityChain` calls hardcode `scoreThreshold:
90` (live path) or `scoreThreshold: 130` (backfill path).

This is a pre-existing wiring gap, NOT something introduced by this
session. Per the user spec's scope boundary ("Do NOT modify quality
scoring (scoreProse, quality chain)"), the call sites were left
untouched. The integration wires the KV path **into the function**
so when consumers (current or future) call `getQualityTarget(sport)`,
they get the Phase 8 KV value. Documented as a carry-forward below.

The observability path is therefore at LOAD time (logged from
`loadQualityCalibration`, which IS called every cron tick at
`handleJournalismCycle:4660`) rather than at READ time. The
`/health` endpoint also reports the last-load source.

## Per-commit summary

### 2fd28c4 — Phase 8 timestamp

Single mutation in `runPhase8QualityFeedback`: adds
`calibration._last_updated = new Date().toISOString()` before the
KV put. Per-sport entries (p25/p50/p75/count/min/max/sufficient/
snapshot_date) are untouched; the new field sits at the calibration
root next to the sport keys.

### 8a01e5a — KV-first load path

Restructures `loadQualityCalibration(env)` to try KV first, fall
back to D1 percentile computation second. Existing D1 logic is
copied verbatim — only its position changes.

```
Primary:  env.FIELD_JOURNALISM.get('field:quality_calibration', 'json')
           + isCalibrationFresh() gate (36h ceiling on _last_updated)
Fallback: existing D1 percentile query (unchanged)
```

Tracking globals:
- `_qualityCalibration` — same map shape, populated from either source
- `_qualityCalibrationSource` — 'analytics-cron' | 'd1-live' | null

Console log fires on every load:
```
[QUALITY] calibration source=analytics-cron sports=4 updated=...
[QUALITY] calibration source=d1-live sports=2
```

Compatibility: the Phase 8 KV value shape includes per-sport
{p25,p50,p75,count,min,max,sufficient,snapshot_date} — a superset of
the four fields the D1 fallback produces. `getQualityTarget(sport)`
reads `[sport].p25` and `[sport].count >= 5` — both work unchanged.
The meta `_last_updated` is stripped before assignment so per-sport
iteration doesn't accidentally treat it as a sport entry.

### ff33d2e — /health source surfacing

Appends `, quality-source=<source>` to the plaintext `/health`
roster. Reports `unloaded` until the first `loadQualityCalibration`
call on this isolate, then `analytics-cron` (KV fresh) or `d1-live`
(KV stale/missing).

Plain-text format preserved — single-line comma-separated, consumers
that grep'd the feature string still parse cleanly.

## End-to-end verification

### Pre-verification — Phase 8 KV gets timestamped
`GET /analytics/run?date=2026-06-19` (after DELETE of stale runs row):
```
{ok:true, target:'2026-06-19', processed:[{features:8, ms:15727}]}
```
Phase 8 fired inside this run and wrote `field:quality_calibration`
with `_last_updated`.

### /health surfacing
First probe after deploy (no cron tick yet):
```
GET /health
→ RELAY OK — ... + analytics-cron, quality-source=unloaded
```
`unloaded` is correct — `loadQualityCalibration` only runs from
`handleJournalismCycle`, which fires on `*/5` and `*/15` cron ticks.
A fresh isolate will report `unloaded` until the first tick warms it.

### Post-fix verification — `/health` flips to analytics-cron
After deploying cd870ee:
```
GET /health
→ RELAY OK — ... + analytics-cron, quality-source=analytics-cron
```
The `/health` peek correctly reads Phase 8's KV value, validates
`_last_updated` is fresh (<36h), and reports `analytics-cron`.

If KV is deleted/expired, the same endpoint would report `d1-live`
(or `unloaded` if FIELD_JOURNALISM is unbound) — the fallback chain
is observable end-to-end.

### Regression — `/journalism/generate` still produces briefs
Deploy `27888680999` ran `STRUCTURAL 6 — WOW 6 /journalism/generate
e2e` as part of CI and passed. The journalism quality chain still
generates prose end-to-end; no regression from the
loadQualityCalibration restructure.

### Phase 8 KV value confirmed via /analytics/quality_feedback
```
GET /analytics/quality_feedback/2026-06-19
→ adjustments: [{sport:'NBA', threshold_p25:190, samples:2,
                 sufficient:false}], sports:2, total_samples:2
```
Adjustments still degraded (only 2 NBA briefs with quality_score in
30d window — Prompt 3 carry-forward), but the row + the KV value
both write cleanly.

## Failure modes (all silent per Rule 5)

| Failure | Behavior |
|---|---|
| FIELD_JOURNALISM not bound | KV branch skipped, D1 fallback runs |
| KV `field:quality_calibration` empty | falls to D1 |
| `_last_updated` missing or > 36h | `isCalibrationFresh()` rejects, falls to D1 |
| KV `.get()` throws | caught, logged once, falls to D1 |
| KV value malformed (non-object) | `isCalibrationFresh()` rejects, falls to D1 |
| D1 ARCHIVE_DB not bound | calibration stays whatever it last was (could be null) |
| D1 query throws | silent catch, calibration stays null, hardcoded fallback in getQualityTarget |

No new failure modes introduced. The existing "calibration failure
never blocks journalism" invariant is preserved end-to-end.

## Carry-forwards

1. **getQualityTarget is unwired**: the live and backfill journalism
   paths still pass hardcoded `scoreThreshold: 90` / `scoreThreshold:
   130` to `runQualityChain`. Out of scope for this prompt (the spec
   said "DO NOT modify quality scoring"). To complete the loop,
   replace those literals with `getQualityTarget(sport)` and confirm
   the chain still produces prose. A 5-line change in a future prompt.

2. **Quality data is sparse**: per Prompt 3 carry-forward, only 2 NBA
   briefs in 30d carry quality_score. Phase 8 + this integration both
   degrade gracefully today, but the integration won't produce
   noticeably different threshold behavior until quality_score is
   backfilled on the cron journalism path.

3. **Sport name casing**: `briefs.sport` mixes 'NBA' vs 'nba' (Prompt
   3 carry-forward). KV path inherits whatever Phase 8 writes; D1
   fallback inherits whatever the live SELECT returns. Both routes
   will mismatch downstream `getQualityTarget(sport)` consumers if
   the caller passes a different casing. Recommend `LOWER(sport)`
   normalization at write OR at read; both sources would benefit.

4. **R2 Voice Memory** is the next prompt — second half of
   "Close the Loop". Should depend on this commit landing.

5. **`/health` is plaintext**: any consumer that parses by token list
   will still work; a consumer that parses by index of `=` (e.g.
   `health.split(',')[-1]`) will now find `quality-source=...`. No
   known consumer parses positionally.

6. **CI flake**: the `STRUCTURAL 6 — WOW 6 /journalism/generate e2e`
   curl 20s timeout flake is still present in the repo's deploy
   workflow. Today's deploy of `ff33d2e` passed cleanly, but the
   flake recurs intermittently. Pending raise to 45s — out of scope.

## Files touched

- `src/analytics-engine.js` (+4 lines, _last_updated stamp)
- `src/index.js` (+42 lines, KV-first load + source surfacing)
- `outbox/cc-session-phase8-integration.md` (this doc)

## Rules touched

- **Rule 62 (follow existing conventions)**: D1 fallback path is the
  pre-existing `loadQualityCalibration` body, preserved character-
  for-character. Only positioning + a new outer try changed.
- **Rule 5 (archive failure must not break primaries)**: every new
  KV access is try/caught; failure logs once and falls through to
  the unchanged D1 path. The journalism cron never throws because
  of calibration.
- **Rule 71 (CONTEXT-A)**: investigated `getQualityTarget` call
  sites BEFORE writing wiring — discovered the abstraction is
  defined-but-unused, surfaced honestly instead of pretending the
  function was wired.
- **Rule 77 (NO-RATIONALIZE-A)**: didn't paper over the unwired-
  function discovery; documented it as carry-forward #1.
- **Rule 47 / ADR-002 (RELAY-IS-DUMB)**: no editorial logic added —
  just changes the SOURCE of the percentile threshold.
