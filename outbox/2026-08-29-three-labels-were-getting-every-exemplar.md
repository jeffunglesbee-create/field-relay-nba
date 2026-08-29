# Three seeded labels were getting every sport's voice exemplars

**2026-08-29** · `src/journalism-quality.js`,
`scripts/check-seeded-labels-classify.mjs`, `.github/workflows/deploy.yml`

## The question nobody had asked about CFB

CFB was seeded on 2026-08-27, its first slate landed 2026-08-29, and the label,
the rows, the rank chain and the volume were all measured. **Nothing asked what
consumed the label.**

```
detectSportClass('CFB')  ->  null
```

The branch it should have matched:

```js
if (s.includes('nfl') || s.includes('football') || s.includes('cfl')) return 'football';
```

`'cfb'` contains none of the three. `NFL`, `CFL` and `College Football` all
classify; **the one string the archive actually serves does not** — and I chose
that string, in the commit that declared it before any row landed.

## Null is not "no exemplars". It is all of them.

`voiceRegisterFor`:

```js
const keep = cls && scoped.some(s => s.sport === cls)
  ? seg => seg.sport === null || seg.sport === cls
  : () => true            // EVERY segment
```

An unclassified sport receives basketball, hockey, soccer, football, tennis and
golf exemplars at once, **while looking classified from outside**. The file
records this twice in its own comments — CFL before 2026-08-24 ("received
basketball and hockey exemplars in every brief") and golf ("how golf came to
receive basketball and hockey exemplars while looking classified").

## The census found three, not one

Running the classifier over all 22 seeded labels:

```
22 seeded labels; 3 classify to null:
    EFL Cup
    EFL Trophy
    CFB
```

**`'efl cup'` does not contain `'epl'`.** One transposed letter, and two soccer
competitions have been writing briefs against every sport's exemplars for weeks
— through every review those competitions have had. CFB made three.

## The fix, and the exemplar decision

`cfb` → **football, sharing Exemplar I (NFL)**, not a new exemplar of its own.

An exemplar governs **register** — connective prose, numbers subordinated into
claims — not subject matter. The CFL line directly above makes the weaker
version of this argument and was accepted: *"Canadian football is not American
football, but it is far closer to it than to either of those."* CFB is the same
code of football as the exemplar it borrows, so the case is strictly stronger.

CFB's real differences from the NFL — polls, conference races, 130 teams, blowout
margins — are **content**, and content is scoped by `SPORT_VOCAB_VIOLATIONS` and
the prose-style rules, not by a second voice exemplar. A CFB-specific exemplar
would also be a SCALE change needing its own scoring era, and nothing measured
says one is needed.

`efl` → **soccer**. No judgement required; they are association football, and
they were only ever null because of the spelling.

## The automation: the connection that did not exist

`LEAGUES` in `src/index.js` declares a label. `detectSportClass` has to
recognise it. **Nothing connected those two**, so a new competition was one
table edit away from silently un-scoping its own briefs — which is exactly what
happened, five times now.

`scripts/check-seeded-labels-classify.mjs` parses the seed table and asserts
every label classifies to something. It deliberately asserts **nothing about
which class** — that is a judgement, and a linter guessing it would be worse
than none. It asserts only that the judgement was made.

Blocking in `deploy.yml`. Seven self-tests, including all three of today's
labels as regression fixtures and the EPL/EFL near-miss that hid the bug. Its
non-vacuity assertion runs first: a parser matching nothing would report zero
unclassified labels and read as a clean table.

## What is still not asked

- **Peak volume.** 8 games measured on opening day; a September Saturday is 80,
  against a shared daily odds ceiling that now includes
  `cfb: 'americanfootball_ncaaf'`. Measurable 2026-09-05.
- **`groups=80` remains unappended**, and was only ever re-verified on dates with
  0 or 8 games. Week 1 Saturday is when FCS games exist to be excluded.
