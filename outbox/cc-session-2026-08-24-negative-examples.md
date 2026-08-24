# The rule against cross-window comparisons taught one by printing it

Closes the residual `CC-CMD-2026-08-23-prompt-numeral-mining` named for itself.

## The leak was the instruction quoting itself

The measured EPL brief:

> "Spurs' 3 shots this match trail Brentford's 37 goals this season"

That sentence was not invented. It is **verbatim** the counter-example inside
ONE WINDOW PER COMPARISON — the rule shipped 2026-08-23 to stop exactly this:

```
"Spurs' 3 shots this match trail Brentford's 37 goals this season" is not a
comparison — it sets one match against one season...
```

The model copied the broken sentence out of the rule written to prevent it. And
because it carried real club names and a real-looking figure, the copy read as
plausible EPL prose rather than obvious garbage. TIME-PERIOD ANCHORING one line
above does the same: it forbids `"25.0 points"`, `"26.0 PPG"` and `"37 goals"`
by printing all three.

## The ask pointed at a file that was already fixed

Drive doc *"Prompt numeral mining closed — 2026-08-23"*
(`1KvP8HhHB8rMhqCyB6lffMIeSldIOZq5b`) records that session converting 20 figures
in `FIELD_VOICE_REGISTER`'s universal segments to `##`. Measured at HEAD, those
segments carry no mineable figure at all — which is why the CC-CMD's Task, aimed
squarely at them, had nothing left to do.

**Its own closing section is the ask I actually executed:**

> *"The style block's own examples ("29.0 PPG", "93.5% penalty kill", "48
> minutes") remain real figures... Whether they deserve the same treatment is a
> separate question and is not answered here."*

The CC-CMD's inherited counts were stale twice over. It states 15 of 16 tracked
literals survive into a gated EPL prompt; measured, **11 of 17 — and 10 of the 11
came from `proseStyleFor`.**

## Worse than the ask assumed, in one specific way

The voice register's figures sit in a block labelled **AVOID THIS**. The style
block's sit in blocks the model is told to emulate. A number in a "write like
this" example is a different exposure from one in an anti-exemplar.

But the measured harm came from neither: it came from the **negative constructs
inside the positive block** — the forbidden list, the rejected half of
`write "X" not "Y"`, and the counter-example. Those are what shipped fixed.

| | before | after |
|---|---|---|
| tracked literals reaching an EPL prompt | 11 of 17 | **6 of 17** |
| of those, mineable figures | 10 | **5, all positive exemplars** |

Positive exemplars keep their figures. They are tracked by 2f, and their
cross-sport contamination is the **gating** question the CC-CMD puts explicitly
out of scope.

## `##`, not a new token

Rule 62. The voice register established the convention on 2026-08-23 and `'##'`
is **already** in `PROMPT_EXAMPLE_LITERALS`, so a copied placeholder is caught
with no new entry:

```
promptExampleLeaks(styleBlock, "Arsenal took ## shots this match and won.")
-> ["##"]
```

Real clubs became "the home side" / "the away side" — prose that teaches the
rule, names nobody, and cannot be mined as a statistic. Not square brackets:
`[DRAMA TREND]`, `[CHAMPION]` and `[FEATURED STAT]` are live tags the prompt
instructs the model to read.

**4 insertions, 4 deletions. Every one a substitution; no line removed.**

## The falling assertion count needed a line to stay meaningful

`prose-style-scope-check` builds assertions by looping over the literals it finds
in a gated prompt. Removing five literals removed four assertions — **with 0
failed**, which is indistinguishable from coverage quietly disappearing.

`voice-register-scope-check` already carried a compensating assertion for exactly
this reason, added by the 2026-08-23 session. `proseStyleFor` had no mirror.
Added: *no forbidden example in any sport's style block may carry a real figure.*
23 → 24.

**One correction while there.** That file's comment read "it dropped from 34 to
30 assertions". Neither figure matches the session that made the change (its
outbox records 33/33) nor a measurement at HEAD (33). Rewritten to describe the
mechanism instead of restating a count that drifts every time the literal list
moves — the same defect the assertion below it exists to catch, one layer up.

## The durable rule

**A string a prompt tells the model NOT to write must be non-instantiable.** No
real club, no real player, no figure that could pass for this game's statistic.

`scripts/check-negative-examples-are-not-instantiable.mjs` extracts forbidden
examples from three constructs and fails any that carries a digit run outside a
`#` placeholder. Its self-test replays the real pre-fix sentence and requires it
red, and asserts the `##` form passes — an unsatisfiable rule is not a rule.

**It caught one more nobody had noticed, in all six sports:**

```
- STYLE: active voice. "Wembanyama blocked 3 shots" not "3 shots were blocked."
```

92 forbidden examples now checked across six sports, none instantiable.

## Files

- `src/journalism-quality.js` — 4 substitutions in `FIELD_PROSE_STYLE`
- `scripts/check-negative-examples-are-not-instantiable.mjs` — new deploy gate
- `scripts/prose-style-scope-check.mjs` — the mirror assertion, 23 → 24
- `scripts/voice-register-scope-check.mjs` — stale count corrected
- `.github/workflows/deploy.yml` — the gate

## Still open, and now stated precisely

The five positive exemplars reaching an EPL prompt — `29.0 PPG`, `28.2 PPG`,
`5-for-6`, `93.5% penalty kill`, `48 minutes` — are NBA, MLB and NHL figures in a
soccer prompt. That is cross-sport contamination in a block the model is told to
emulate, and it is a **gating** question: `proseStyleFor` already gates the CITE
NBA ANALYTICS example, so the machinery exists.

- Blocked by: the CC-CMD's scope boundary, "do NOT touch `proseStyleFor` gating".
- Unblocks on: an explicit decision to extend gating to the STYLE lines.
- Verify: `PROMPT_EXAMPLE_LITERALS.filter(l => proseStyleFor('EPL').includes(l))`
  returns `['##']` alone.
