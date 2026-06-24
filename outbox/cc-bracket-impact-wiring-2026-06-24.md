# bracket_impact Debrief Wiring — Phase 4 — 2026-06-24

## 4 surgical edits

1. **`src/context-assembler.js` export block** — added `findBracketImpact` + `advancementState` to the named exports so they can be imported elsewhere.
2. **`src/index.js` line 67** — extended the import to pull `findBracketImpact` alongside `assembleContext`.
3. **`src/index.js` writeWCResult enqueue (L1588–1599)** — added `bracketTriggeredBy` field to the `JOURNALISM_QUEUE.send` body. Key format `{home}_{away}_{date}` with spaces→`_`, 120-char cap. Matches BracketDO's snapshot hook key format exactly.
4. **`src/index.js` queue consumer game-brief handler (L11094)** — new `let jobPrompt = job.prompt`. When `job.sport === 'wc26'` and `bracketTriggeredBy` is present, `findBracketImpact` is called and any non-zero deltas (≥0.002) get appended as a `[BRACKET IMPACT]` block with state transitions. Both `callProxy` and `runQualityChain` swapped from `job.prompt` → `jobPrompt`.

## Side fix (latent ReferenceError)

While reading writeWCResult to wire Task 3, found that the existing enqueue
referenced undeclared `home`, `away`, and `gameId` variables — the function
scope only has `homeName`, `awayName`, `game.id`. Every WC final was throwing
ReferenceError inside the catch and silently failing to enqueue. Replaced
with the real variables in scope. **The WC game-brief pipeline begins
firing for the first time with this commit.**

## Commit & deploy

- `ddf6527` fix: bracket_impact debrief wiring — findBracketImpact exported + wired to WC queue consumer (2 files, +35/−7)
- Deploy: workflow 28071986491 — completed/success.

## Done conditions

- [x] `findBracketImpact` in context-assembler.js export block (4 occurrences total: comment + def + builder use + export)
- [x] `findBracketImpact` in index.js (2 occurrences: import + consumer call)
- [x] `bracketTriggeredBy` in writeWCResult enqueue (1) + queue consumer if-guard + call (2) — 3 total occurrences (spec said 2 — extra is the consumer's `if (… && job.bracketTriggeredBy …)` guard before the call, intentional)
- [x] `jobPrompt` used in queue consumer (4 occurrences: decl + assign + 2 uses)
- [x] `callProxy(job.prompt)` → 1 remaining match at L11228 (different handler — `journalism` jobs, NOT game-brief). Out of Task 4 scope per "queue consumer game-brief handler" spec wording. Left intentional.
- [x] `node --check` both files pass
- [x] Deploy green (28071986491)
- [x] Outbox manifest committed

## Why `[BRACKET IMPACT]` won't appear yet on `/journalism/context-probe`

The `bracket_impact` CONTEXT_SOURCE matches on `game.triggeredBy/gameId/id`,
none of which `context-probe` currently passes (it sends `eventId`). The
context-probe wiring is separate from the queue-consumer wiring — the latter
is what this CC-CMD targets. The block populates on real WC brief generation,
not the probe.

## When `[BRACKET IMPACT]` will first fire end-to-end

1. A live WC game goes final.
2. `writeWCResult` (now fixed) enqueues a `game-brief` job carrying
   `bracketTriggeredBy = "{home}_{away}_{date}"`.
3. BracketDO recomputes the bracket and calls
   `/archive/bracket-snapshot` with the same `{home}_{away}_{date}` as
   `triggered_by`, writing 48 team rows (pre + post).
4. The queue consumer picks up the job. `findBracketImpact(env,
   bracketTriggeredBy)` returns the per-team `{before, after, change,
   stateBefore, stateAfter}` map.
5. The 6 most-moved teams get appended as `[BRACKET IMPACT]` lines
   before the prompt hits Claude.

The race condition (snapshot write fires async after the queue send) is
handled by the `Object.entries(impact)` returning empty when the rows
aren't there yet — silent degrade, brief still generates. Subsequent
re-runs of the same brief would populate as the snapshots accumulate.

## grep verification outputs

```
findBracketImpact in context-assembler.js : 4 matches
findBracketImpact in index.js             : 2 matches  (import + consumer call)
bracketTriggeredBy in index.js            : 3 matches  (enqueue + if-guard + call)
jobPrompt in index.js                     : 4 matches  (decl + assign + 2 uses)
callProxy(job.prompt) in index.js         : 1 match    (L11228, journalism handler — out of scope)
```

## Verify commands

```
# Once a WC game finishes and BracketDO writes pre/post snapshots:
probe_relay_route /archive/bracket-replay?triggered_by={home}_{away}_{date}
# expect ≥48 rows for that trigger window

# Verify the WC brief contains [BRACKET IMPACT] (look in FIELD_JOURNALISM KV):
# (no relay endpoint surfaces the brief prose directly; check the next
#  /briefs/spot-check or AI Gateway log)
```
