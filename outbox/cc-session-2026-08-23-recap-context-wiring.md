# CC session 2026-08-23 — the live recap path assembles context

## What was wrong

`match_events` shipped this morning (644d7f6) and reached zero recaps.

The source was registered correctly in `src/context-assembler.js` — id,
priority 4, budget 200, six sports, a selection rule that stays inside its
ceiling and states its own truncation, with a deploy gate
(`scripts/match-events-check.mjs`) proving all of that. Every one of those
things was true. None of them mattered, because nothing on the live
`game_recap` path ever calls `assembleContext`.

`assembleContext` appears four times in `src/index.js`:

| line | caller | writes a game_recap? |
|------|--------|----------------------|
| 6630 | GAME-BRIEF-BACKFILL | no — backfill |
| 8473 | journalism cron, SLATE brief | no — slate |
| 12789 | BACKFILL-GAME-BRIEFS | no — backfill |
| 14577 | the import | — |

The path that actually writes `game_recap_${sport}_${eventId}` is:

```
game finalizes
  -> POST /journalism/game-complete            src/index.js ~15984
  -> fetch debriefCtx from ARCHIVE_DB          (best-effort, already there)
  -> buildGameCompletePrompt({...})            ~5332
  -> JOURNALISM_QUEUE.send({type:'game-brief', prompt, gameHash})
  -> queue consumer ~18900 -> runQualityChain -> briefs row
```

No context assembly anywhere in it. `match_events` was a source with no
consumer, and so was every other registered source, for every recap the relay
has ever written.

## How it was caught

Not by reading the code. By check 4 of `scripts/verify-staged-items.mjs`, four
hours after the ask-5 commit, on its first live run:

```
recap_names_a_scoring_play: FAIL — 0/3 recap(s) name anyone who scored
```

ESPN carried 3–4 scoring plays for each of those three games. The recaps named
none of the scorers, because the prompt never received them.

That is a Rule 61 failure in the ask-5 work, and it is worth naming precisely:
the builder was verified, the selection rule was verified, the budget was
verified, the contract was verified. What was never verified is that the
assembler is called by the path that writes recaps. Four green checks on four
links of a chain that was never joined to anything.

## The fix

`src/index.js`, inside the GAME-COMPLETE block, between the debrief fetch and
the prompt build:

```js
let sportContext = '';
try {
    sportContext = await Promise.race([
        assembleContext(env, {
            sport, home, away,
            homeAbbr: '', awayAbbr: '',
            sourceId: gameId,       // feeds match_events + espn_summary
            league: sport,
            homeScore, awayScore,
        }, 600),
        new Promise(r => setTimeout(() => r(''), 8000)),
    ]);
} catch (e) {
    console.error('[GAME-COMPLETE] sport context assembly failed (non-fatal):', e.message);
}
const prompt = buildGameCompletePrompt({ sport, home, away, homeScore, awayScore, debriefCtx, sportContext });
```

`buildGameCompletePrompt` gained a `sportContext` parameter and renders it
between the debrief block and the SPORT BOUNDARY line — the same slot
`debriefCtx` already occupies, which is why that slot was the right place.

### Rule 24 — execution path contract

- **Fires:** once per game, at finalization. Not per cron tick. GameDO's
  `archived` storage flag one level up guarantees at most once per game, so
  there is no loop.
- **Cost (Rule 78):** one ESPN summary fetch per finalized game. CONTRACTS.md
  measured ~28 calls/day against a 14-day mean of 28 games/day and cleared it.
- **Bounded:** `Promise.race` with an 8s ceiling on the whole assembly, and a
  try/catch around it. Rule 5 — an archive/context source may never break a
  primary function, and the primary function here is enqueuing the brief at
  all. A context failure yields `''` and the recap is written without it.
- **gameHash:** `computeGameHash` hashes the built prompt, so adding this
  block changes the hash. That is the intended direction. The hash's own note
  in the source calls prompt-hashing *"a better cache-validity signal ... also
  captures notes, bracket-impact additions, anything that would make
  regeneration genuinely necessary."* More regeneration on a context change,
  never less.
- **`sourceId: gameId`:** `gameId` arrives in the POST body and is written
  through to `briefs.game_id`. Check 4 gates on `/^\d{6,}$/` and successfully
  fetched ESPN scoring plays for 3/3 rows, so these are real ESPN event ids —
  measured, not assumed. `buildMatchEventsContext` applies the same gate.

### Call sites not touched (Rule 69)

`buildGameCompletePrompt` has two other callers. Both were left alone:

- the declaration at ~5332,
- `/debug/gemini-model-test` at ~9253, a read-only comparison route that
  writes nothing and is currently broken for an unrelated reason
  (`gemini-3.5-flash` 500s — `docs/CC-CMD-2026-08-14-gemini-35-flash-route-500.md`).

Both omit `sportContext`, which destructures to `undefined` and renders as
`null`. No behavior change.

## The gate

`scripts/check-recap-assembles-context.mjs`, wired into `deploy.yml` after the
`match_events` selection check. Five structural assertions:

1. `buildGameCompletePrompt` takes a `sportContext` parameter
2. the prompt body renders it — checked separately, because a parameter that
   is accepted and never used reads as wired to anyone grepping the signature
3. the GAME-COMPLETE path calls `assembleContext`
4. GAME-COMPLETE passes what it assembled into the prompt
5. the assembly is bounded

It runs `--self-test` first. Each check is paired with the mutation that must
break it; the self-test applies that mutation to the real source and requires
the check to go red. Two ways to fail it: the mutation changes nothing (the
check no longer describes the code), or the check still passes with the link
cut (it is not testing what it names).

**That second mode fired on the first run.** Check 4 was
`/buildGameCompletePrompt\(\{[^}]*sportContext[^}]*\}\)/` over the whole file,
which matches the function *declaration* — a signature that names
`sportContext` whether or not any caller passes one. Cutting the argument at
the call site left the check green. It is now scoped to the GAME-COMPLETE
slice, which sits below both other call sites.

A structural check is a regex over a 19,000-line file. Nothing except a
negative control establishes that it is looking at the thing it names, and
this one was not.

## Status

- **Deploy-time:** VERIFIED. Both modes exit 0; `node --check src/index.js`
  passes.
- **End-to-end:** UNVERIFIED until a slate finalises under the deployed
  build. The detector already exists and already speaks.
  - **Verify:** `node scripts/verify-staged-items.mjs`
  - **Currently:** `recap_names_a_scoring_play: FAIL — 0/3`
  - **Unblocked by:** the next MLB/WNBA/NHL/NFL/EPL slate finalising after
    this deploy.
  - **Passes when:** that check reports PASS or PARTIAL with at least one
    grounded recap. A recap written before this deploy cannot flip it — the
    check windows on `COALESCE(updated_at, created_at) > T_MATCH_EVENTS`, so
    only rows written after the deploy count.

## Files

- `src/index.js` — `buildGameCompletePrompt` signature + body; GAME-COMPLETE
  assembly block
- `scripts/check-recap-assembles-context.mjs` — new
- `.github/workflows/deploy.yml` — new gate step
