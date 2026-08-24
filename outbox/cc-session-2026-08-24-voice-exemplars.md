# Why every brief kept getting contaminated

## The answer

**Sport content here is universal by DEFAULT and scoped by EXCEPTION.** Every
addition reaches every sport until somebody remembers to gate it — and forgetting
is silent. No error, no failing test, and the brief still reads plausibly.

Four instances of that one shape, all found in a single day:

| where | the default that leaked |
|---|---|
| `proseStyleFor` | a rule reached every sport unless added to `SPORT_SCOPED_RULES` |
| `proseStyleFor` | a rule's **example** reached every sport even when the rule was scoped |
| `voiceRegisterFor` | a sport with no segment of its own received **all** of them |
| `detectSportClass` | a sport it didn't recognise took the same path as the slate |

The last two were live on **905 of 1322 finalized games — 68.5%** — for as long
as those functions have existed.

## Fixed: exemplars H, I, J

```
MLB    ABCDEFG -> H      830 finalized games
NFL    ABCDEFG -> I       32
CFL    ABCDEFG -> I       13   (also unclassified until now)
golf   ABCDEFG -> J       30
```

Each teaches its sport's own hazard, not just its vocabulary:

- **baseball** — a number the box score is worst at explaining
- **football** — the phase of the game no recap will mention
- **golf** — `thru` means the round is unfinished; `E` is a real score

**Figures are `##`, unlike A–G.** Those carry real numbers (23.2, 26, 34, −2.5)
and those numbers are precisely the literals layer 2f exists to catch the model
mining. Three more exemplars in that style would have added ~15 new mineable
figures to fix a contamination problem.

Checked mechanically, not by eye: no banned journalism phrase, no wire-copy
construction, no digit outside a `##` or a word-count annotation.

## The detector already existed, pointed the wrong way

`checkSportVocab` finds wrong-sport vocabulary and has only ever run on **output**,
as layer 2b. Run on the **prompt** it reports `"inning"` and `"period"` for five
of seven sports — both false positives. It's a substring matcher, and `period` is
matching the name of the **TIME-PERIOD ANCHORING** rule.

A guard at that precision gets ignored, which is the same as not existing. Same
lesson as this morning's first static guard: 27 hits for one defect.

**League names are the precise marker.** `NBA` cannot appear in a soccer prompt
for an innocent reason, and it is exactly what the live defect said:

> "Everton maintains a 107.7 DRTG, best in the NBA, despite playing soccer"

Zero false positives across ten sports.

## It went red on all ten, and my first probe of the same idea was wrong

An ad-hoc version said "clean" for every sport. That probe was broken — its `\b`
was eaten by shell escaping, so it matched nothing. The real guard found two
genuine sources:

**1. `LEAGUE BOUNDARIES` — a legitimate exception.** It names every league
*because it is the rule forbidding cross-league mixing*. The file already records
why it must not be scoped: removing it from a soccer prompt "would delete the
guardrail, not the contamination." Exempt **by line prefix, not by token**, so a
second rule quietly naming the NBA still fires.

**2. The universal anti-exemplar — real.** Its *figures* were neutralised on
2026-08-23; its **entities** were not. Golden Knights, Hurricanes, Pavel
Dorofeyev, Steven Matz — sitting in a universal segment every sport receives, and
the measured mining source for `"37 goals this season"`. Neutralised now under
this session's own rule: a forbidden example must be non-instantiable.

## One check, every source

This is the point. Not one guard per source written after each incident — one
assertion across all of them, so a **new context source is covered the day it is
added** rather than after its own incident.

## Also: a range the content outgrew

`voice-register-scope-check` matched `/Exemplar [A-G]/` — a hard-coded
enumeration. Adding H, I and J made it report MLB as seeing **no** exemplar. The
letter set is now derived from the segments rather than restated.

Same shape as `UNREACHABLE_DIMS` naming a key SCALE no longer had, and as
`DIM_TO_SCALE` mapping `matchupDepth`. Third instance today of *a list of names
that stops resolving when the thing it names moves*.

## Files

- `src/journalism-quality.js` — exemplars H/I/J, CFL classified, anti-exemplar
  entities neutralised
- `scripts/check-no-foreign-league-in-prompt.mjs` — new deploy gate
- `scripts/voice-register-scope-check.mjs` — 23 → 38, letter set derived
- `.github/workflows/deploy.yml` — the gate

## Still open

**Tennis (`atp`/`wta`) has no class and no exemplar**, so it still takes the
keep-everything path. Not live exposure: no ATP or WTA rows appear among the
1,322 finalized games.

- Unblocks on: the first finalized tennis brief.
- Verify: `detectSportClass('atp')` returns a class, and
  `check-no-foreign-league-in-prompt` lists `atp` among its sports.

---

## Addendum — tennis, 2026-08-24

Closed the residual named above. **Three pieces, because fewer is a half-fix.**

| piece | why it was required |
|---|---|
| classifier | `atp`, `wta`, `tennis` → class `tennis` |
| **Exemplar K** | a class with **no** exemplar takes `voiceRegisterFor`'s keep-everything fallback — classified in name, contaminated in fact |
| **vocabulary** | `SPORT_VOCAB_VIOLATIONS.tennis` did not exist, so `checkSportVocab` returned `[]` and layer 2b enforced nothing on tennis |

Adding the classifier alone would have reproduced golf's exact state: looks
handled, still receives basketball and hockey exemplars.

### The vocabulary entry carries the real information

A tennis match has no innings, quarters, periods or downs — and **no clock**.
"Late in the fourth" and "with a minute left" are impossible, not merely wrong.
`overtime` is the sharp one: a tied set goes to a **tiebreak**, and a deciding set
may run on indefinitely where none is played.

Verified firing:

```
checkSportVocab("Alcaraz scored a touchdown in the fourth quarter of overtime.", "atp")
-> ["quarter", "fourth quarter", "touchdown", "overtime"]
```

### Guards extended, not left behind

- `check-no-foreign-league-in-prompt` covers `atp`/`wta` and knows `ATP`/`WTA` as
  league tokens
- `voice-register-scope-check` gains the K cases and asserts the no-clock rule
  directly — 38 → 45

Exemplar K checked mechanically like H/I/J: no banned phrase, no wire-copy
construction, no digit outside a `##` or a word-count annotation, zero new
mineable literals.

### Every briefed sport now has a class and its own exemplar

```
EPL / MLS / La Liga   soccer      D, E
NBA / WNBA            basketball  A, B, F
NHL                   hockey      C, G
MLB                   baseball    H
NFL / CFL             football    I
golf                  golf        J
atp / wta             tennis      K
```

No sport takes the keep-everything fallback any more. The fallback still exists
for the mixed-sport slate, which is what it was for.
