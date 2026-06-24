# CC-CMD: WC Brief — Group Standings Context in writeWCResult Prompt
**Date:** 2026-06-24  
**Repo:** field-relay-nba  
**Rule 87:** Self-completing. All probes, edits, verification, and outbox manifest run inside this session.
**DEADLINE:** Before 3 PM ET (19:00 UTC) — Group B MD3 kicks off then.

---

## CONTEXT

`writeWCResult` builds the journalism prompt with RESULT + MATCH EVENTS but no
group standings. The model must infer advancement implications from score alone.
This produced "puts them in the driver's seat" (Colombia brief) without knowing
Colombia was already through, and risks similar hallucinations tonight on MD3
where advancement narrative is the entire story.

The fix: query `wc_group WHERE group_id = ?` inside `writeWCResult` and inject
a GROUP STANDINGS block before the RESULT line.

---

## PROBE BLOCK

1. Confirm `env.WC2026_DB` is accessible inside `writeWCResult`. Search for
   `WC2026_DB` near `writeWCResult` — it already uses `env.WC2026_DB` for
   `INSERT OR IGNORE INTO wc_results` and `recomputeGroupStandings`. Confirm
   the binding name.

2. Read the full prompt array in `writeWCResult`. Confirm it currently has:
   - `RESULT: ${homeName} ${homeScore} - ${awayScore} ${awayName}`
   - `Group: ${groupId}`
   - `Date: ${matchDate}`
   - `eventsContext`
   - No standings block yet.

3. Confirm `groupId` is in scope at prompt construction time.

---

## TASK 1 — Query group standings inside writeWCResult

After `await recomputeGroupStandings(env.WC2026_DB, groupId)` and before the
prompt array is built, add a standings fetch:

```javascript
        // Fetch group standings for journalism context
        let standingsContext = '';
        try {
            const { results: gRows } = await env.WC2026_DB.prepare(
                `SELECT team, won, drawn, lost, gd, points
                 FROM wc_group WHERE group_id = ?
                 ORDER BY points DESC, gd DESC, gf DESC`
            ).bind(groupId).all();
            if (gRows && gRows.length) {
                const standingsLines = gRows.map((r, i) =>
                    `  ${i + 1}. ${r.team}: ${r.points}pts (${r.won}W ${r.drawn}D ${r.lost}L, GD${r.gd >= 0 ? '+' : ''}${r.gd})`
                ).join('\n');
                standingsContext = `\n\nGROUP ${groupId} STANDINGS (after this result):\n${standingsLines}`;
            }
        } catch (_) { /* non-blocking — standings context is additive */ }
```

Note: `recomputeGroupStandings` runs before this block, so the standings
already include today's result when queried. The model sees the POST-result
table, not pre-result.

---

## TASK 2 — Inject standings into the prompt array

Find the prompt array. Replace:

```javascript
            `RESULT: ${homeName} ${homeScore} - ${awayScore} ${awayName}`,
            `Group: ${groupId}`,
            `Date: ${matchDate}`,
            eventsContext,
```

With:

```javascript
            `RESULT: ${homeName} ${homeScore} - ${awayScore} ${awayName}`,
            `Group: ${groupId}`,
            `Date: ${matchDate}`,
            standingsContext,
            eventsContext,
```

That's a one-line addition. `standingsContext` is an empty string when the
query fails, so it degrades gracefully.

---

## TASK 3 — node --check + commit + deploy

```
node --check src/index.js
```

Commit:
```
fix: inject group standings into writeWCResult journalism prompt

Adds GROUP STANDINGS block (post-result table) to the WC game-brief prompt.
Model now knows what each result means for advancement — e.g., "Switzerland
through as group winners" vs "Scotland eliminated" — rather than inferring
from score alone.

Standings are fetched after recomputeGroupStandings so the table already
reflects today's result. Failure is non-blocking (standingsContext defaults
to empty string).
```

Push. Deploy must succeed before 19:00 UTC.

---

## TASK 4 — Outbox manifest

Write `outbox/cc-wc-brief-standings-context-2026-06-24.md`. Commit [skip ci].

---

## DONE CONDITIONS

- [ ] `standingsContext` variable declared with D1 query in `writeWCResult`
- [ ] `standingsContext` appears in prompt array between Date and eventsContext
- [ ] `node --check src/index.js` passes
- [ ] Deploy green before 19:00 UTC
- [ ] Outbox manifest committed [skip ci]
