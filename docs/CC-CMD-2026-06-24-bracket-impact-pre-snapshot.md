# CC-CMD: Bracket Impact — Pre-Snapshot Write + Dual-Key findBracketImpact
**Date:** 2026-06-24  
**Repo:** field-relay-nba  
**Rule 87:** Self-completing.

---

## CONTEXT

`[BRACKET IMPACT]` never fires in WC brief prompts despite the infrastructure
being present. Root cause: BracketDO Step 10 writes only ONE snapshot per result
(the post-result projections). `findBracketImpact` queries `WHERE triggered_by = ?`
and expects two rows per team (earlier = before, later = after). With only one row,
`impact[team].after` is never set → entries always empty → block never appended.

Fix: write a second snapshot from `this.prevSnapshot` (already tracked in DO storage,
rotated at Step 5 BEFORE Step 10 runs) with `triggered_by = 'pre:{key}'`. Update
`findBracketImpact` to query both keys separately and diff them.

Confirmed via hypothetical test (test:can_sui_hypothetical): when two rows exist
per team, `findBracketImpact` correctly produces state transitions + pChamp delta.

---

## PROBE BLOCK

1. Confirm `this.prevSnapshot` is set at Step 10 in `src/bracket-do.js`.
   Read Step 5 (snapshot rotation, ~L332): `this.prevSnapshot = this.currentSnapshot`.
   Confirm this runs BEFORE Step 10 (~L401). `this.prevSnapshot` is therefore
   the projections from BEFORE the current game result was applied.

2. Confirm Step 10 currently writes only ONE `fetch('/archive/bracket-snapshot')`
   call. No `pre:` key written.

3. Confirm `findBracketImpact` in `src/context-assembler.js` (~L445) currently
   runs ONE query (`WHERE triggered_by = ?`) and uses first/second row ordering
   for before/after. Confirm this pattern produces empty `after` fields when only
   one row exists per team.

4. Confirm `node --check src/bracket-do.js` and `node --check src/context-assembler.js`
   pass before any edits.

---

## TASK 1 — BracketDO Step 10: write pre-snapshot from `this.prevSnapshot`

Find the Step 10 block in `src/bracket-do.js`. It currently looks like:

```javascript
        if (newSnapshot.teams?.length > 0) {
            const today = new Date().toISOString().slice(0, 10);
            const triggeredBy = triggerResult
                ? `${triggerResult.home}_${triggerResult.away}_${today}`.replace(/\s+/g, '_').slice(0, 120)
                : 'scheduled';
            this.ctx.waitUntil(
                fetch(`${RELAY_BASE}/archive/bracket-snapshot`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                        triggered_by: triggeredBy,
                        date:         today,
                        teams:        newSnapshot.teams.map(t => ({
                            name:   t.name,
                            pR32:   t.pR32   ?? null,
                            ...
                        })),
                    }),
                }).catch(...)
            );
        }
```

Replace with:

```javascript
        // 10. Write projection snapshots to D1 for calibration/replay.
        // Two writes per result: 'pre:{key}' = projections BEFORE this result
        // (this.prevSnapshot, already rotated at Step 5); '{key}' = projections
        // AFTER. findBracketImpact diffs the two to compute pChamp deltas.
        if (newSnapshot.teams?.length > 0) {
            const today = new Date().toISOString().slice(0, 10);
            const triggeredBy = triggerResult
                ? `${triggerResult.home}_${triggerResult.away}_${today}`.replace(/\s+/g, '_').slice(0, 120)
                : 'scheduled';
            const _mapTeams = snap => (snap.teams || []).map(t => ({
                name:   t.name,
                pR32:   t.pR32   ?? null,
                pR16:   t.pR16   ?? null,
                pQF:    t.pQF    ?? null,
                pSF:    t.pSF    ?? null,
                pFinal: t.pFinal ?? null,
                pChamp: t.pChamp ?? null,
            }));
            // Pre: projections BEFORE this result (this.prevSnapshot set at Step 5)
            if (this.prevSnapshot?.teams?.length > 0) {
                this.ctx.waitUntil(
                    fetch(`${RELAY_BASE}/archive/bracket-snapshot`, {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({
                            triggered_by: `pre:${triggeredBy}`,
                            date:         today,
                            teams:        _mapTeams(this.prevSnapshot),
                        }),
                    }).catch(e => console.warn('[BracketDO] pre-snapshot write failed:', e.message))
                );
            }
            // Post: projections AFTER this result
            this.ctx.waitUntil(
                fetch(`${RELAY_BASE}/archive/bracket-snapshot`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                        triggered_by: triggeredBy,
                        date:         today,
                        teams:        _mapTeams(newSnapshot),
                    }),
                }).catch(e => console.warn('[BracketDO] post-snapshot write failed:', e.message))
            );
        }
```

**Verification:** grep `bracket-do.js` for `pre:${triggeredBy}` → must appear once.

---

## TASK 2 — findBracketImpact: dual-key query

Replace the entire `findBracketImpact` function in `src/context-assembler.js`:

```javascript
async function findBracketImpact(env, triggeredBy) {
    if (!env?.ARCHIVE_DB || !triggeredBy) return {};
    try {
        // Dual-key pattern: 'pre:{key}' = before-result snapshot,
        // '{key}' = after-result snapshot. Written by BracketDO Step 10.
        const [preRows, postRows] = await Promise.all([
            env.ARCHIVE_DB.prepare(
                `SELECT team, champion_prob, r32_prob FROM bracket_snapshots
                 WHERE triggered_by = ? ORDER BY team`
            ).bind(`pre:${triggeredBy}`).all(),
            env.ARCHIVE_DB.prepare(
                `SELECT team, champion_prob, r32_prob FROM bracket_snapshots
                 WHERE triggered_by = ? ORDER BY team`
            ).bind(triggeredBy).all(),
        ]);

        const impact = {};
        for (const row of (preRows.results || [])) {
            impact[row.team] = { before: row.champion_prob, r32Before: row.r32_prob };
        }
        for (const row of (postRows.results || [])) {
            if (impact[row.team]) {
                impact[row.team].after    = row.champion_prob;
                impact[row.team].r32After = row.r32_prob;
            }
        }
        for (const [, d] of Object.entries(impact)) {
            if (d.before != null && d.after != null) {
                d.change      = Math.round((d.after - d.before) * 1000) / 1000;
                d.stateBefore = advancementState(d.r32Before ?? 0);
                d.stateAfter  = advancementState(d.r32After  ?? 0);
            }
        }
        return impact;
    } catch (_) { return {}; }
}
```

**Verification:** grep `context-assembler.js` for `pre:\${triggeredBy}` → must appear.
grep for `Promise.all` in `findBracketImpact` → must appear.

---

## TASK 3 — `node --check` + commit + deploy

```
node --check src/bracket-do.js
node --check src/context-assembler.js
```

Commit:
```
fix: bracket impact — pre-snapshot write + dual-key findBracketImpact

Root cause: BracketDO Step 10 wrote only the post-result snapshot.
findBracketImpact expected 2 rows per team (before/after) to compute
pChamp delta, but found only 1 → [BRACKET IMPACT] block never fired
in any WC brief prompt.

Fix:
- BracketDO Step 10: write this.prevSnapshot (pre-result) with
  triggered_by='pre:{key}' + post-result snapshot with '{key}'.
  prevSnapshot is available because Step 5 rotates BEFORE Step 10.
- findBracketImpact: dual-key query — parallel fetch of pre:{key}
  and {key}, then diff. No single-query ordering dependency.

Next result that fires BracketDO will produce two D1 rows per team
and [BRACKET IMPACT] will appear in the journalism prompt for the
first time.
```

Push. Deploy.

---

## TASK 4 — Outbox manifest without [skip ci]. Push.

---

## DONE CONDITIONS

- [ ] `pre:${triggeredBy}` in BracketDO Step 10
- [ ] `_mapTeams` helper used for both writes
- [ ] `Promise.all` in `findBracketImpact` querying both keys
- [ ] `node --check` passes both files
- [ ] Deploy green
- [ ] Outbox manifest pushed (no [skip ci] — drive-upload auto-fires)
