# Gating extended to the STYLE lines — and golf was the worst-contaminated sport

Authorised separately from `CC-CMD-2026-08-23-prompt-numeral-mining`, whose scope
boundary read *"Do NOT touch `proseStyleFor` gating."*

## Result

| sport | before | after |
|---|---|---|
| EPL | 5 foreign figures | **0** |
| **golf** | **all 6** | **0** |
| CFL, tennis | all 6 | 0 |
| NFL | 5 foreign | 0 |
| NBA / WNBA | 6 | 4, all basketball |
| NHL | 6 | 1, its own |
| MLB | 6 | 1, its own |
| slate (no sport) | 6 | 6 — it covers many sports at once |

## Three problems, one of them not gating at all

### 1. `CITE ANALYTICS` named four sports in one string

A soccer prompt was told to cite `[PP/PK]` and shown a hockey penalty-kill
figure. The comment above `SPORT_SCOPED_RULES` had already flagged this —
*"spans four sports in one string… and needs splitting before it can be scoped"*
— as a carry-forward. Split into hockey / baseball / soccer rules, each tagged.
Carry-forward closed.

### 2. Three rules are universal in lesson, basketball in example

`specificity over metaphor`, `numbers over adjectives` and `TIME-PERIOD
ANCHORING` teach something every sport needs. Scoping the **rule** would delete
that lesson to remove a figure — the same mistake the file already avoids for
LEAGUE BOUNDARIES ("removing it from a soccer prompt would delete the guardrail,
not the contamination").

So the **example clause** is scoped instead. Matching sport keeps the rule
intact; every other sport gets the rule minus that clause. Pure subtraction — no
sport-specific exemplar is authored, which the parent CC-CMD rules out as content
invention and a separate decision.

**Each example carries its own sport, not the rule.** The first version scoped
TIME-PERIOD ANCHORING's two examples together, and **baseball lost its own
correct example** in order to remove basketball's. A rule is not the right unit.

### 3. Golf was the worst-contaminated sport in the system

`detectSportClass` has no branch for golf, CFL or tennis. A **named** sport it
doesn't recognise fell into the same path as the mixed-sport slate and received
every sport-scoped rule and every example — a golf prompt carried all six
figures, including `"107.7 DRTG, best in the NBA"`, while EPL carried five.

Nobody had looked, because the ask was framed around EPL.

**Fixed as a default, not three branches.** Adding golf, CFL and tennis to the
classifier would have closed those three and left the next unrecognised sport
maximally contaminated — the whack-a-mole this session spent the day replacing.
An *absent* sport is the slate and keeps everything; a *named* sport the
classifier doesn't know now gets universal rules only. **Safe by default.**

## And it broke layer 2f, exactly as that layer predicted

The subtraction's own comment:

> *"Per-rule subtraction is subset-proof: it holds for the full block and for any
> gated variant of it."*

True while gating only **dropped** whole rules. Shortening a rule makes it a
non-member of `PROSE_STYLE_RULES`, so it survived subtraction, stayed in what 2f
treats as game context, and **2f went silent on `##` in the same commit that
reduced the leaks** — the precise failure that paragraph was written about, after
it happened once before. The assertion that caught it exists for that reason.

Fixed at the invariant, not the test. `styleRuleVariants()` enumerates what
`proseStyleFor` can actually emit — full text plus any combination of dropped
example clauses, at most four per rule — and the subtraction walks that, longest
first so a short variant cannot orphan a clause.

**The new assertion ties the two together:** every line `proseStyleFor` emits, for
every sport including the slate, must be a known variant. Drift there un-blinds
2f silently, which is the worst failure mode in this file.

## Both scoping tables throw at import

A drop string that matches nothing removes nothing and reads as fixed. Each
scoped example is asserted present verbatim in its rule at module load — the
same defect class as `UNREACHABLE_DIMS` naming a key SCALE no longer had.

## Files

- `src/journalism-quality.js` — `CITE ANALYTICS` split three ways,
  `SPORT_SCOPED_EXAMPLES`, `styleRuleVariants()`, named-but-unknown sport path
- `scripts/prose-style-scope-check.mjs` — 24 → 34 assertions

## Verify

```js
PROMPT_EXAMPLE_LITERALS.filter(l => l !== '##' && proseStyleFor('EPL').includes(l))
// -> []   (was 5)
PROMPT_EXAMPLE_LITERALS.filter(l => l !== '##' && proseStyleFor('golf').includes(l))
// -> []   (was 6)
```

## Still open

**A new sport is now safe but silent.** A named sport the classifier doesn't know
gets universal rules only — correct, but it also means golf never receives a
golf-appropriate analytics rule, because none exists. Writing one is content
authoring, which the parent CC-CMD rules out and this authorisation did not
extend to.

- Unblocks on: a decision to author sport-specific style rules.
- Verify: `proseStyleFor('golf').includes('CITE GOLF ANALYTICS')`.
- Reads as: absent → golf briefs still cite no golf-specific figure by
  instruction, and depend on the context block alone.
