# `/archive/query` gains `updated_at` — 2026-08-23

## The defect this unblocks, which is in the other repo

`field-laboratory`'s `scripts/cc-cmd-followup.mjs` tracks
`CC-CMD-2026-08-22-brief-sport-contamination` with a cessation predicate: it
scans the briefs `/archive/query?sport=EPL&limit=40` returns and reports
`still generating` until **every** one is clean.

There is no baseline in it. So a single EPL brief written before the fixes
deployed — and never regenerated since — pins that ask at "still generating"
**permanently**, and the fix it measures can never be observed no matter how many
clean briefs are written afterwards.

This is the same error the relay's own `verify-staged-items.mjs` made three
separate times on 2026-08-22, each corrected by adding a deploy baseline: *a fix
cannot be judged by rows it never touched.*

## Why `created_at` could not fix it, and `updated_at` can

The obvious repair is to gate on the timestamp already projected. It does not
work, and this repo already knows why — `src/index.js:5438`:

> Three of the ten INSERT sites are `ON CONFLICT(id) DO UPDATE`, so a brief can
> be rewritten in place any number of times while `created_at` keeps its original
> value forever. Measured directly: `game_recap_epl_401879321` carried a
> fabricated "37 goals this season" at 19:09, and was clean at 21:14 with a
> different length — genuinely regenerated after the Layer 2f fix deployed, and
> completely invisible to a `created_at` filter, which still read 18:30:53.

Gating on `created_at` would therefore **discard exactly the rewrites that prove
the fix** — the failure that note was written about. `updated_at` was added to
the table on 2026-08-22 for this reason; it was simply never added to this
route's projection.

## The change

One column, additive:

```sql
SELECT id, date, brief_type, sport, game_id, brief_text, model,
       quality_score, word_count, source, created_at, updated_at
FROM briefs ...
```

No existing consumer moves — nothing is renamed or removed. Rule 60: the relay
owns the response contract, so the field belongs here rather than being
reconstructed client-side from a second query.

## Verified vs staged

- **VERIFIED:** `node --check src/index.js`, and the column exists on `briefs`
  (added 2026-08-22, populated by the `briefs_set_updated_at` trigger).
- **STAGED:** that laboratory's predicate now discriminates. Blocked by this
  deploy plus one sentinel run. Unblocks on the next `drift-sentinel` run after
  it. Verify: the follow-up line for `brief-sport-contamination` reports a count
  of post-baseline briefs rather than a bare `still gen`.

## Cross-repo (Rule 70)

Relay deploys first, laboratory reads second. The laboratory half —
baseline-gated predicate, `COALESCE(updated_at, created_at)` semantics, and
`null` rather than a silent ungated scan when the field is absent — ships in
`field-laboratory` in the same session.
