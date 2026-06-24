# CC-CMD: bracket_impact Debrief Wiring — Phase 4
**Date:** 2026-06-24  
**Repo:** field-relay-nba  
**Rule 87:** Self-completing. All probes, edits, verification, and outbox manifest run inside this session.

---

## CONTEXT

`findBracketImpact(env, triggeredBy)` and `advancementState()` exist in
`src/context-assembler.js` but are not exported. The WC game-brief queue
consumer builds prompts from a static string and never calls `assembleContext`,
so the `bracket_impact` CONTEXT_SOURCE never fires for WC briefs.

The fix is four targeted edits — no new functions, no new endpoints.

---

## PROBE BLOCK — read before writing anything

1. Read `src/context-assembler.js` export block (~line 577). Confirm:
   - `findBracketImpact` is NOT exported
   - `advancementState` is NOT exported
   - `assembleContext`, `r2Json`, `resolveAbbr`, and builders ARE exported

2. Read `src/index.js` line 67. Confirm:
   ```javascript
   import { assembleContext } from './context-assembler.js';
   ```
   Note exact import shape — we're adding to it.

3. In `writeWCResult` (~line 1501), read the full JOURNALISM_QUEUE.send call.
   Confirm:
   - `homeName` and `awayName` are already `wcFixName`-normalized
   - `matchDate` is `(game.start || '').slice(0, 10)` — same format as
     BracketDO's `today` (`new Date().toISOString().slice(0, 10)`)
   - The send body has: `type`, `prompt`, `eventId`, `max_tokens`, `sport`,
     `home`, `away`, `homeScore`, `awayScore`, `enqueuedAt`
   - `bracketTriggeredBy` is NOT present yet

4. Read the queue consumer `game-brief` block (~line 11094). Confirm:
   - It assigns `let prompt = job.prompt` (or reads `job.prompt` directly)
   - It calls `callProxy(job.prompt)` for the first Claude call
   - There is no existing bracket impact logic

5. Confirm `bracket_snapshots` table exists:
   Query `SELECT COUNT(*) FROM bracket_snapshots` via D1 MCP — must return > 0.
   This confirms Phase 1 data is available to read.

---

## TASK 1 — Export `findBracketImpact` and `advancementState`

In `src/context-assembler.js`, find the export block:

```javascript
export {
    assembleContext,
    r2Json,
    resolveAbbr,
    // Builders + helpers exported so the test surface can exercise them
    // independently without a full assembler run.
    buildSavantContext,
    buildNHLSeriesContext,
    buildNBAClutchContext,
    buildSoccerXGContext,
    buildESPNSummaryContext,
};
```

Replace with:

```javascript
export {
    assembleContext,
    r2Json,
    resolveAbbr,
    findBracketImpact,
    advancementState,
    // Builders + helpers exported so the test surface can exercise them
    // independently without a full assembler run.
    buildSavantContext,
    buildNHLSeriesContext,
    buildNBAClutchContext,
    buildSoccerXGContext,
    buildESPNSummaryContext,
};
```

**Verification:** grep `context-assembler.js` for `findBracketImpact` in the
export block — must appear.

---

## TASK 2 — Add `findBracketImpact` to the import in `index.js`

Find line ~67:

```javascript
import { assembleContext } from './context-assembler.js';
```

Replace with:

```javascript
import { assembleContext, findBracketImpact } from './context-assembler.js';
```

**Verification:** grep `index.js` for the import line — must include
`findBracketImpact`.

---

## TASK 3 — Add `bracketTriggeredBy` to the WC queue message

In `writeWCResult`, find the `JOURNALISM_QUEUE.send` call. The body currently
ends with `enqueuedAt: Date.now()`. 

Find the exact send body:

```javascript
            await env.JOURNALISM_QUEUE.send({
                type: 'game-brief',
                prompt,
                eventId: gameId,
                max_tokens: 300,
                sport: 'wc26',
                home: home,
                away: away,
                homeScore,
                awayScore,
                enqueuedAt: Date.now(),
            });
```

Note: CC must read the actual field names — `home` may be `homeName` or `home`.
Adapt the following to match what CC finds:

Add `bracketTriggeredBy` as a new field, using the same key format BracketDO
uses in its snapshot hook (`${home}_${away}_${matchDate}` with spaces replaced):

```javascript
            await env.JOURNALISM_QUEUE.send({
                type: 'game-brief',
                prompt,
                eventId: gameId,
                max_tokens: 300,
                sport: 'wc26',
                home: home,
                away: away,
                homeScore,
                awayScore,
                bracketTriggeredBy: `${home}_${away}_${matchDate}`.replace(/\s+/g, '_').slice(0, 120),
                enqueuedAt: Date.now(),
            });
```

Where `home`, `away`, `matchDate` are the same variables already in scope.
Use the exact variable names CC finds — do NOT rename.

**Verification:** grep `index.js` for `bracketTriggeredBy` — must appear exactly
twice (the send here, and the consumer below after Task 4).

---

## TASK 4 — Append bracket impact to WC brief prompt in queue consumer

In the queue consumer `game-brief` handler (~line 11094), find where the prompt
is first used for the Claude call. It will look like:

```javascript
            const initial = await callProxy(job.prompt);
```

Before this line, add the bracket impact lookup for WC games:

```javascript
            // Append bracket impact context for WC game briefs.
            // findBracketImpact reads bracket_snapshots written by BracketDO
            // after each result — pre/post pChamp delta for teams in this game.
            // The snapshot is written async after writeWCResult fires, so it may
            // not exist yet on first attempt; the .catch path returns {} silently.
            let jobPrompt = job.prompt;
            if (job.sport === 'wc26' && job.bracketTriggeredBy && env.ARCHIVE_DB) {
                try {
                    const impact = await findBracketImpact(env, job.bracketTriggeredBy);
                    const entries = Object.entries(impact)
                        .filter(([, d]) => d.change != null && Math.abs(d.change) >= 0.002)
                        .sort(([, a], [, b]) => Math.abs(b.change) - Math.abs(a.change))
                        .slice(0, 6);
                    if (entries.length) {
                        const lines = entries.map(([team, d]) => {
                            const arrow = d.change > 0 ? '↑' : '↓';
                            const pct   = Math.round(Math.abs(d.change) * 100);
                            const state = d.stateBefore !== d.stateAfter
                                ? `${d.stateBefore} → ${d.stateAfter}`
                                : d.stateAfter;
                            return `${team}: ${state} ${arrow}${pct}%`;
                        });
                        jobPrompt = jobPrompt + `\n\n[BRACKET IMPACT]\n${lines.join('\n')}`;
                    }
                } catch (_) { /* bracket impact is additive — never block brief generation */ }
            }
            const initial = await callProxy(jobPrompt);
```

**Critical:** Replace `callProxy(job.prompt)` with `callProxy(jobPrompt)` so the
enriched prompt is used. All subsequent callProxy calls in the quality chain use
`jobPrompt` as the base — update those references too if `job.prompt` appears
again in the handler (check carefully).

**Verification:** 
- grep `index.js` for `bracketTriggeredBy` — must appear exactly twice
- grep `index.js` for `jobPrompt` — must appear inside the queue consumer block
- grep `index.js` for `callProxy(job.prompt)` — must return 0 matches (all replaced)

---

## TASK 5 — `node --check` both files

```
node --check src/context-assembler.js
node --check src/index.js
```

Both must pass with no errors.

---

## TASK 6 — Commit + deploy

```
fix: bracket_impact debrief wiring — findBracketImpact exported + wired to WC queue consumer

- Export findBracketImpact + advancementState from context-assembler.js
- Add findBracketImpact to index.js top-level import
- writeWCResult: add bracketTriggeredBy to WC game-brief queue message
  Key format matches BracketDO snapshot hook: {home}_{away}_{date}
- Queue consumer: append [BRACKET IMPACT] block to WC brief prompt when
  bracket_snapshots has pre/post rows for this game (silent if not yet written)

Closes carry-forward: bracket_impact CONTEXT_SOURCE now populates for WC briefs.
```

Push. Deploy must succeed.

---

## TASK 7 — Verify

After deploy, probe `/journalism/context-probe?sport=wc26`. The `[BRACKET IMPACT]`
block will not appear yet because the current `bracket_snapshots` only has the
`scheduled` baseline — pre/post rows require a new game result to trigger
BracketDO. This is correct. The wiring is complete; population is data-dependent.

To confirm the wiring is correct without a live result, check:
- `grep "bracketTriggeredBy" src/index.js` — 2 matches (send + consumer)
- `grep "findBracketImpact" src/index.js` — 2 matches (import + consumer call)
- `grep "findBracketImpact" src/context-assembler.js` — 2 matches (def + export)

---

## TASK 8 — Outbox manifest

Write `outbox/cc-bracket-impact-wiring-2026-06-24.md` with:
- 4 edits listed (export, import, send, consumer)
- Why [BRACKET IMPACT] won't show on context-probe yet (data-dependent, not a bug)
- When it will first fire: next WC game that goes final → BracketDO recomputes →
  snapshot written with `triggered_by = "Team1_Team2_YYYY-MM-DD"` → next brief
  generated for that game reads it
- Commit hash + deploy status
- grep verification outputs

Commit `[skip ci]` and push.

---

## DONE CONDITIONS

- [ ] `findBracketImpact` appears in context-assembler.js export block
- [ ] `findBracketImpact` in index.js import line 67
- [ ] `bracketTriggeredBy` in writeWCResult queue send
- [ ] `jobPrompt` variable used in queue consumer, `callProxy(job.prompt)` → 0 matches
- [ ] `node --check` both files pass
- [ ] Deploy green
- [ ] Outbox manifest committed [skip ci]
