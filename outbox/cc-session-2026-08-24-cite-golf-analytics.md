# CITE GOLF ANALYTICS — and a fix I made, measured, then reverted

## The rule

```
- CITE GOLF ANALYTICS: if [GOLF CONTEXT] appears in the game data, cite the
  leaderboard verbatim — the position, the to-par score WITH its sign, and the
  holes completed. Write "leads at -## through ##" rather than "holds a
  commanding lead". "E" is even par, a real score and not a missing value. A
  player shown "thru" a number has NOT finished the round: never present that
  score as final.
```

**Every figure it names was read from source, not from golf knowledge.**

| claim | where it came from |
|---|---|
| the block is `[GOLF CONTEXT]` | `golf_leaderboard` builder, `context-assembler.js:1783` |
| rows are `pos. name toPar (thru N)` | same builder, lines 1776-1782 |
| `E` is a rendered score, not a gap | `src/index.js`: `p.toPar != null ? String(p.toPar) : 'E'` |

A rule citing a tag the data never emits instructs the model to invent one —
which is how the golf layer failed in June. `thru` is the golf shape of the
defect Dim 11 exists to catch: a round in progress presented as a result.

**No new mineable figure.** The example uses `##`, not `-17`. Every positive
exemplar in this file carrying a real number is a literal the model has been
*measured* mining; a rule written today has no reason to add another. Asserted.

`detectSportClass` learns golf — required for a golf-scoped rule to reach golf.
`checkSportVocab` returns `[]` for a class with no `SPORT_VOCAB_VIOLATIONS`
entry, so that path is unaffected.

## The fix I made, measured, and reverted

`voiceRegisterFor` carries the same fallback `proseStyleFor` had — *no segment
for this sport → keep everything* — and it is live:

```
NBA    basketball, basketball, basketball
NHL    hockey, hockey
EPL    soccer, soccer, soccer
MLB    basketball, basketball, hockey, soccer, soccer, soccer, basketball, hockey
NFL    basketball, basketball, hockey, soccer, soccer, soccer, basketball, hockey
golf   basketball, basketball, hockey, soccer, soccer, soccer, basketball, hockey
CFL    basketball, basketball, hockey, soccer, soccer, soccer, basketball, hockey
```

MLB is **830 of 1322** finalized games in the archive. The biggest sport in the
system is the most contaminated.

I applied the identical fix — *a named sport keeps the universal segments and
nobody else's* — and **it was wrong.** It left MLB and NFL with **zero**
exemplars, caught by that file's own assertion.

The two functions hold different kinds of content:

| | scoped items are | dropping them costs |
|---|---|---|
| `proseStyleFor` | **rules** for one sport — `CITE NBA ANALYTICS` means nothing to MLB | nothing |
| `voiceRegisterFor` | **exemplars** teaching a universal thing — what the FIELD voice sounds like — through a sport-specific instance | the lesson itself |

A brief with no exemplar has no model of the voice at all. "Same defect, same
fix" was the wrong read, and the assertion that caught it was written by an
earlier session for exactly this reason.

**The contamination stands as a measured, named trade** rather than being fixed
into a worse state. Both functions now carry the distinction in their comments.

## Why the assertion count moved again

`voice-register-scope-check` 28 → 23. Five literals left the gated EPL prompt
when STYLE gating shipped, so five per-literal assertions no longer run —
the same legitimate dynamic that file already documents, and the mirror
assertion added to `prose-style-scope-check` covers the style side.

`prose-style-scope-check` 34 → 44.

## Files

- `src/journalism-quality.js` — the rule, `detectSportClass` golf branch,
  `voiceRegisterFor`'s reverted change recorded as a comment
- `scripts/prose-style-scope-check.mjs` — 10 new assertions on the rule's
  contract

## Still open

**MLB, NFL, golf and CFL receive every other sport's voice exemplars.** Measured
above, unfixed on purpose.

- Blocked by: the fix requires an exemplar per uncovered sport. That is content
  authoring, not a predicate change.
- Unblocks on: a decision to author them — four exemplars, one per sport.
- Verify: `VOICE_REGISTER_SEGMENTS.filter(s => s.sport === 'baseball').length > 0`,
  then `voiceRegisterFor('MLB')` should carry baseball segments only.
- Reads as: until then, an MLB brief is shown basketball and hockey voice
  exemplars, and layer 2f is what catches a figure lifted from them.
