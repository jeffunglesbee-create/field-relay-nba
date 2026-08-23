# Prompt numeral mining closed — 2026-08-23

**Ask:** `field-laboratory/docs/CC-CMD-2026-08-23-prompt-numeral-mining.md`
**Branch:** main

## What was still generating the leak

The three commits earlier today (`2ed34c7`, `9bf12b0`, `812bb5c`) sport-gated the
style block and the voice exemplars. They did not touch the register's UNIVERSAL
segments — the anti-exemplar and the six numbers-in-prose patterns — which reach
every brief in every sport by design and carried real-looking figures:

```
"… the 39-26-17 Golden Knights face the 53-22-7 Hurricanes. Pavel Dorofeyev
 enters with 37 goals this season, while Seth Jarvis has 32 goals this season.
 In MLB, 4-2 Steven Matz with a 4.67 ERA meets 0-7 Jack Flaherty with a 5.81 ERA…"
```

That paragraph is labelled **AVOID THIS**. The measured EPL brief —
"Spurs' 3 shots this match trail Brentford's 37 goals this season" — took its
number from it. The model mined the block that exists to be rejected.

## The change

Twenty figures replaced with placeholders across the anti-exemplar, all six
PATTERN pairs, and the FORBIDDEN wire-copy-signature line: `##` for counts,
`#.##` for rates, `##.#` for per-game averages, `##-##-##` for records.

Nothing was deleted. 14 lines modified, 0 removed; the register is still 115
lines across 11 segments, with all six patterns, all six wire/FIELD pairs, and
the anti-exemplar's ten bullets intact. Both blocks teach FORM, and the form is
what survives — "SUBJECT + carries + NUMBER + this season" reads exactly as
badly with `#.##` in it.

## Why a placeholder and not deletion

The FORBIDDEN section already states the construction abstractly. The prose
version exists so the model recognises the TEXTURE, not for its digits. Removing
the sentences would have cost the texture; removing only the digits does not.

## The constraint that decided the format

A placeholder is only safe if copying it is detectable — otherwise the fix
trades a plausible fabrication for an invisible one. `##` is now a tracked entry
in `PROMPT_EXAMPLE_LITERALS`, and every placeholder shape contains it, so one
entry catches a copy of any of them. It sits in the instructions, instructions
are subtracted before 2f's context search, so it reports with no new machinery.

Not square brackets: `[DRAMA TREND]`, `[CHAMPION]` and `[FEATURED STAT]` are
live tags the prompt instructs the model to read, and a placeholder shaped like
one would collide with them.

## Done conditions, as written in the CC-CMD

| # | condition | result |
|---|---|---|
| 1 | zero tracked literals in universal segments | **0** |
| 2 | `voice-register-scope-check.mjs` still passes | **33/33** |
| 3 | a copied placeholder is reported by `promptExampleLeaks` | **PASS**, committed as an assertion |
| 4 | diff shows only numerals changed, no lines removed | 14 modified, 0 removed |

**Condition 2 needs stating precisely: it passes 33/33, not the 34/34 the CC-CMD
predicted.** The check builds its assertion list from the literals that actually
survive into a gated prompt, and four of them left the register, so four
assertions went with them. That is the fix working, but a falling count is
exactly how coverage erodes unnoticed, so the drop is now anchored by an
explicit assertion — "no tracked literal survives in the universal segments" —
that fails if anyone puts a figure back.

`prose-style-scope-check` 23/23 and `cross-window-check` 24/24 unchanged.

## Not in scope, and still true

The style block's own examples ("29.0 PPG", "93.5% penalty kill", "48 minutes")
remain real figures. The CC-CMD scoped this ask to the voice register, and those
are already sport-gated by `2ed34c7` plus caught by 2f. Whether they deserve the
same treatment is a separate question and is not answered here.
