# The queue item said raise it. It had not been read in 39 days.

## Result

```
threshold   0 -> proxyCalls 1, score 126, layers ""
threshold 110 -> proxyCalls 1, score 126, layers ""
threshold 240 -> proxyCalls 1, score 126, layers ""
threshold 999 -> proxyCalls 1, score 126, layers ""
```

Four floors, one stub proxy, deliberately weak prose. A floor of 999 accepted a
score of 126 without a single retry. `scoreThreshold` was read by nothing.

The queue item was "raise `scoreThreshold` 110 → 196". Executing it as written
would have changed nothing — era 4's mistake exactly: new numbers written into a
table the scorer does not consult.

122 lines deleted, 60 added (all comment). Behaviour after deletion is
byte-identical: same score, same retry count, same text.

## It was not never-wired. It was un-wired.

Drive's `getQualityTarget() Fallback Table Fix — 2026-07-09` quotes the read
when it was live:

```
git show de57ae1:src/journalism-quality.js
-> const THRESHOLD = opts.scoreThreshold || 175;  // 245-scale relay ceiling
```

`git log -S "opts.scoreThreshold"` names the commit that removed it:

```
6aed3bb  2026-07-16  fix: replace scoreProse's Dim1/Dim2/Dim4 fact-stacking bias,
                     replace 3b's numeric retry-accept gate with a qualitative voice judge

-  const THRESHOLD = opts.scoreThreshold || 240;
-  if (score < THRESHOLD && retries < maxRetries) {
```

**The removal was right.** The composite that gate ran on scored this repo's own
labeled anti-exemplar 214/300 and its real Exemplar A 136/300. Layer 3b asks a
qualitative voice judge now. What the commit did not do was remove the producer,
the transport, or the call sites.

## The ledger recorded half of it

`6aed3bb` **is** era 2's boundary commit:

```
era 2   from: 2026-07-16T01:36:49Z   deploy: 6aed3bb
change: "Dim 1 redefined per-sentence; Dim 4 clamped to [0,1] (was unbounded)"
commit: 2026-07-16T01:35:21Z
```

The `change` field records the scoring half. The retry-gate removal is named in
the commit's own subject line and absent from the era record. The mechanism
built specifically to make scoring changes non-silent logged one of that
commit's two changes.

Era 2's entry is amended rather than rewritten, and states the general rule: an
era entry must record what a commit did to the **retry path**, not only to the
score. A scoring change and a gating change are both changes to what quality
means.

## Three joints, none connected

| joint | state at HEAD~1 | disposition |
|---|---|---|
| `getQualityTarget(sport)` | 0 call sites since written 2026-06-17 — its own comment said so | deleted |
| `loadQualityCalibration` + per-isolate cache + live-D1 percentile fallback | fed only that function | deleted |
| `scoreThreshold:` at call sites | passed, never destructured | deleted, 10 sites |

**Kept:** Phase 8 in `analytics-engine.js` still computes the snapshot and writes
`field:quality_calibration`. That producer has real consumers —
`/analytics/quality_feedback/{date}` serves it, `/health` reports it. Deleting
the whole block would have taken an observability signal about a running cron
along with a retry floor nobody ran.

`/health`'s value is relabelled `unloaded|analytics-cron|d1-live` →
`unavailable|absent|fresh|stale`. "d1-live" named the fallback path this session
deleted, and a label outliving its mechanism is the same defect one layer up. No
client reads the field (grepped jubilant-bassoon).

## The guard found three call sites I missed

I grepped seven. The guard found ten — `12853`, `12973`, `19203` pass the key
through a variable rather than a literal number, and my grep pattern didn't see
them. That is the argument for the guard existing rather than for grepping more
carefully next time.

`scripts/check-opts-keys-are-read.mjs` — every key passed in an options literal
must be read by its callee.

- Its self-test **replays the exact 2026-07-16 defect**: injects
  `scoreThreshold` into a real call site and requires the check to go red.
- It blanks comments and template-literal bodies length-preservingly before any
  brace scan, so a `{` in prose cannot desynchronise the matcher, with an
  assertion that a stray brace changes nothing **and** that unread keys are
  still caught in that state — a checker that goes quiet under tricky input is
  worse than none.
- It fails loudly when it cannot locate a callee's options parameter, rather
  than reporting zero findings.

## The recurring shape, seventh instance

A value whose name and measurement disagree.

| where | the value | what it actually measured |
|---|---|---|
| `docs/history-boundary.txt` | a commit sha | a commit its own push had rebased away |
| `stale-data-sentinel.js` | `entries` | computed, then read by nothing |
| `verify-staged-items.mjs` | `written_at` | when the row last moved, not when its text was written |
| `SCALE` | declared weights | 49 points from the implementation's ceilings |
| `UNREACHABLE_DIMS` | a list of dims | strings naming nothing after a rename |
| `nonzero_rows_per_dim` | reachability | read as if it were effect |
| **`scoreThreshold`** | **a retry floor** | **nothing, for 39 days** |

The first six were values. This one is a whole subsystem — producer, transport
and consumer — where only the consumer was removed.

## Still open (Rule 74)

**Should a sport-calibrated retry bar exist at all?** The p25 method was sound;
what broke was the composite it gated. Layer 3b's voice judge is currently
uncalibrated per sport.
- Unblocks on: evidence that judge accept-rates differ materially by sport.
- Verify: per-sport `layers_fired` containing `3b` over a `rescore-quality-6b`
  corpus — the field exists, nothing aggregates it yet.
- Reads as: flat across sports → no calibration needed, and this deletion is
  final. Materially different → rebuild against the judge, not the composite.

Not a carry-forward from this task: it is a new question this measurement
raised, and it is not blocking anything today.

## Files

- `src/index.js` — 10 call sites, `scoreFloor`, 3 queue writes + 1 consumer
  read, `getQualityTarget`, `loadQualityCalibration`, both cache globals;
  `/health` relabelled
- `src/journalism-quality.js` — era 2's `change` amended
- `scripts/check-opts-keys-are-read.mjs` — new deploy gate
- `.github/workflows/deploy.yml` — the gate
