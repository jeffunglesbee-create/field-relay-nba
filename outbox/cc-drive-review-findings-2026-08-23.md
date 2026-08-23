# What the August Drive docs say that the code does not — 2026-08-23

Read after shipping a duplicate FPL builder. These are the findings that outlast
that mistake.

## 1. Two Drive docs disagree about the FPL join, and the disagreement bit the build

**2026-08-21**, *"FPL prerequisite resolved, one team-identity table"*: the
FPL→game join must resolve through `resolveTeamKey` in `identity-resolver.js`.
Reusing a second table would mean *"two independent alias tables, in two repos,
for the same clubs — the divergence CONTRACTS.md exists to prevent."* It closed
the last gap (`Spurs`) and states **Coventry, Ipswich and Hull all resolvable as
of today**.

**2026-08-22**, the shipped builder: uses `_FPL_SHORT_TO_ESPN_ABBR`, *"a scoped
closed dictionary, never the cross-sport resolveTeamKey, where FPL's Sunderland
short code `SUN` resolves to the WNBA Connecticut Sun."*

**Both are right, about different key spaces.** `resolveTeamKey` resolves club
NAMES — `Man Utd` → `Manchester United`. It carries no three-letter codes at all
(verified: no `SUN` entry). FPL's `short_name` is a code, and codes collide
across sports where names do not. Names go to the resolver; codes need the
scoped table.

**The trap that follows, and it fired.** The 08-21 doc's "Coventry, Ipswich and
Hull all resolvable" is true of the resolver and was false of the dictionary the
builder actually reads. All three were missing from `_FPL_SHORT_TO_ESPN_ABBR`
until today, so every Coventry, Hull and Ipswich fixture got no events and no
table for the whole of GW1 — silently, because an empty context source looks
exactly like one with nothing to say.

A prerequisite marked resolved was resolved in the wrong table. Recorded here so
the next session reads "resolvable" as "in which table?".

## 2. A watch item from 2026-08-13 is resolvable now, and it passed

*JQ provenance pass* left this: era-scoped calibration would activate once era 3
held 5 scored briefs per type, *"expected within hours"*, and — **"if it has NOT
flipped after a day of journalism crons, that means era 3 briefs are not being
scored at all — a different and more serious problem."*

Ten days later, nobody had looked. `/quality/report?days=7` today:

```
threshold_source: "brief_type_p25(n=23,era3)"
threshold_source: "brief_type_p25(n=92,era3)"
threshold_source: "brief_type_p25(n=263,era3)"
threshold_source: "brief_type_p25(n=83,era3)"
```

**Era-scoped, era 3, real sample sizes.** It flipped, and the more serious
problem it warned about did not happen. Closing a ten-day-old watch costs one
endpoint read; leaving it open costs the next session the same read plus the
doubt.

## 3. Ask 5's real spec is not the CC-CMD's spec, and is not built

`CC-CMD-2026-08-20-brief-data-quality` scopes ask 5 on ESPN `keyEvents`.
Measured 2026-08-21: **`keyEvents` does not exist for MLB, NBA, NHL or NFL.**

| sport | container | filter |
|---|---|---|
| soccer | `keyEvents` | `scoringPlay === true` |
| MLB / NBA / NHL | `plays` | `scoringPlay === true` |
| NFL | `scoringPlays` | all items |

At HEAD, `scoringPlays` appears nowhere in the relay, so the NFL container is
unbuilt and ask 5 is genuinely open. Two constraints the CC-CMD does not carry:

- **NBA is 119 scoring items per game** against NFL 8, NHL 8, soccer 2–4, MLB 11.
  Concatenation gives four usable paragraphs and one unusable wall. NBA needs
  selection, not enumeration.
- **Generate from `text`, not the structured participant fields.** Soccer
  `participants[]` has no role field — role is positional — and the assister is
  structurally present on 8 of 14 assisted goals while `text` carried 14/14.

## 4. Ask 6b's premise is falsified and the rescope is different work

The CC-CMD says the quality metric is **inverted**. Measured: in-progress
language n=94 mean **184.3**, reads-as-final n=1381 mean **190.1**. Finals score
*higher*. The metric is not pointed the wrong way — it fails to penalise
in-progress prose strongly enough, a 5.8-point gap where these should be far
apart.

That is a weighting change requiring a before/after re-score to produce a real
`measuredEffect` for a `SCORING_ERAS` entry. It is not the sign flip the ask
describes.

Same shape as the Dim 2 cliff I filed and withdrew today: a metric claim that
looks obvious, measures differently, and needs a controlled comparison before it
becomes work.

## 5. Two laboratory edits that two sessions have now flagged as un-pushable

*"the staged items are now one dispatch away"* lists them under *what this does
not cover*: **the two CC-CMDs' own text.** `closing-odds-capture` should be
withdrawn and re-filed as an *opening*-capture ask, and the FPL ask should drop
"not wired yet" and its goal-minute example.

Both are still uncorrected. The FPL ask's stale "not wired yet" is a direct
cause of the duplicate build this session: it read as open work.
