# field-laboratory summary — closing-odds capture + archive-seed coverage

**Date:** 2026-08-21 · **Repo touched:** field-relay-nba
**Covers:** `CC-CMD-2026-08-21-closing-odds-capture`,
`CC-CMD-2026-08-21-archive-seed-coverage`
**Session doc:** `field-relay-nba/outbox/cc-session-2026-08-21-brief-data-quality-asks-3-4-6.md`
(Addendum 9)

Headline: **both CC-CMDs asked for work that was already done.** One had a real
defect behind it in a different layer — fixed. The other has no defect at all.
Neither should be built as written.

---

## 1. `closing-odds-capture` — the hook is landed AND firing

The ask is to "land (or re-activate)" the pre→live hook. Probed from HEAD first:

| the ask assumes | actual state |
|-----------------|--------------|
| hook needs landing | `_captureClosingOdds` at `src/ambient-do.js:718` |
| hook needs wiring | called from `pendingStarts`, `src/ambient-do.js:498–500` |
| dedupe needs adding | `_gameStarts` Set, `src/ambient-do.js:394–397` |
| carry-forward: add `closing_odds_capture` to `_ODDS_SOURCES` | already present, `src/brief-freshness.js:12` |

**And it fires — 18 captures, 2026-07-04 → 2026-08-21 19:03:03.** That last
timestamp is the Betis v Real Sociedad card on the live desk
(`19:03:03.474Z`); Arsenal v Coventry's `19:01:36.023Z` is another. The hook has
been working the whole time `OddsStory.Moved` has been dormant.

### The real defect (FIXED — relay commit `887c843`)

`.github/scripts/odds-backfill.js` wrote a single historical snapshot into
**both** `opening_odds` and `closing_odds`, for every game it touched — including
games that had not kicked off. `_captureClosingOdds` updates
`WHERE closing_odds IS NULL`, so the batch won that race permanently and the
kickoff capture could never land.

That is precisely what the desk renders on WNBA today:

```
open/close NOT SEQUENCED (2026-08-21T10:00:54.720Z vs 2026-08-21T10:00:37.956Z)
```

One snapshot in two columns, "closing" stamped 17 seconds *before* "opening".
`OddsStory` was right to refuse it.

**Fixed with a date gate, not a deletion.** For a game already played there is no
kickoff left to capture and writing one snapshot to both columns is still the
correct behaviour, so that is preserved. For today and later, `closing_odds`
stays NULL and the hook owns it. Guarded by
`scripts/check-closing-odds-not-prefilled.mjs` (negative-tested: restoring the
literal `['opening_odds','closing_odds']` loop fails by name), now gating every
relay deploy.

### A SECOND defect the desk exposed — and a correction to my first read

Seeing "one snapshot" on the Arsenal and Betis cards, I reported that their
`closing_odds` was NULL and the hook had not fired. **Both halves were wrong.**
Measured state, 2026-08-21:

| sport | rows | has_open | has_close |
|-------|------|----------|-----------|
| MLB | 15 | 15 | 15 |
| WNBA | 3 | 3 | 3 |
| Ligue 1 | 1 | 1 | 1 |
| **EPL** | 1 | **0** | **1** |
| **La Liga** | 1 | **0** | **1** |
| NFL | 3 | 0 | 0 |
| golf | 1 | 0 | 0 |

EPL and La Liga carry the **closing** line and no **opening** one — the mirror
image of my assumption. So `Moved` is blocked two independent ways:

- **MLB / WNBA** — was defect 1. Now unblocked: opening from the `odds_api` poll
  (~10:00), closing from the hook at kickoff. That is a genuine sequence.
- **EPL / La Liga** — blocked by a missing **opening** capture, which the fix
  above does nothing about. Deliberately not patched blind: it needs its own
  probe into why `odds_api` opening writes cover MLB, WNBA and Ligue 1 but not
  those two.

### What the laboratory doc should say instead

The ask should be **withdrawn and re-filed** as two things:

1. ~~Land the hook~~ → **done long ago**; the doc's premise is stale. Its
   carry-forward #1 (`_ODDS_SOURCES`) is also already done.
2. **New ask:** capture `opening_odds` for EPL and La Liga. That is the actual
   remaining blocker for `Moved` on the marquee competitions.

Carry-forwards #2 (team-name aliasing) and #3 (non-AmbientDO sports) survive
unchanged.

### Verification, staged with unblock criteria (Rule 74)

**Staged:** that the fix yields a real sequence.
**Blocked by:** needs one MLB/WNBA pre→live transition after the `887c843` deploy.
**Verify:** `closing_odds.captured_at > opening_odds.captured_at`, and the desk
renders `ML X → Y (home ±N.N implied)` instead of `NOT SEQUENCED`.
**Unblocked when:** tomorrow's slate runs.

---

## 2. `archive-seed-coverage` ask 3 — DO NOT BUILD

Ask 3 asks to seed EPL "like the UEFA fix", with a stated deadline of the opener.
**The premise fails two independent ways.**

**EPL is already in the seed table** — `src/index.js:7587`,
`{sport:'soccer', league:'eng.1', label:'EPL'}`, sitting between MLS and La Liga
and predating this session. The row the ask asks for exists. The UEFA fix worked
because those six rows were genuinely absent; this is not that.

**EPL is already seeded, and the "gap" is game-day seeding.**
`/context/date` across five days:

| date | total | sports |
|------|-------|--------|
| 08-19 | 53 | MLS 30, MLB 15, WNBA 2, La Liga 1, EFL Trophy 1, UCL Qual 4 |
| 08-20 | 62 | MLS 8, MLB 9, WNBA 3, NFL 2, UEL Qual 12, UECL Qual 24, … |
| **08-21** | 25 | MLB 15, WNBA 3, **EPL 1**, La Liga 1, Ligue 1 1, NFL 3, golf 1 |
| 08-22 | 15 | **MLS 15** |
| 08-23 | 9 | **MLS 9** |

MLB — indisputably seeded and playing — is present **3/3 past days and 0/2 future
days**, exactly like EPL. Only MLS pre-seeds ahead, which the ask's own table
already states ("MLB … seeded ~10:00 local on the day"). A future-dated query
returning only MLS is the system working.

**And the desk proves it end to end:** Arsenal v Coventry 3–0 Final rendered under
`EPL · 1`, with venue, arc and drama sparkline. The opener was carried.

The ask read a future date, saw the one competition that pre-seeds, and concluded
the rest were missing — the same shape as the `/context/date` truncation error
that produced two wrong flags in the brief-data-quality doc.

### What survives

**Asks 1 and 2 are the valuable part** and should stay: a declared seed manifest,
and a check that fails when a configured competition with fixtures is absent.
That is what would have answered this in one CI run.

**But ask 2's artifact as written encodes the false positive permanently.** "On
2026-08-22 the check flags EPL" would fire every day on every competition that
has not yet reached its seeding tick. It must be written against the **game-day
model**: compare on a date that has already passed its tick, not on a future one.

---

## 3. State of the relay-directed stack

| CC-CMD | status |
|--------|--------|
| brief-data-quality | asks 1, 2, 3, 4a, 4b, 6a shipped; 5 specified; 6b needs rescope |
| uefa-club-competitions | shipped earlier today |
| archive-seed-coverage | **ask 3 withdrawn (no defect)**; asks 1–2 valid, artifact needs rewording |
| closing-odds-capture | **defect fixed**; ask itself stale; new ask needed for EPL/La Liga opening capture |
| fpl-event-grounding-epl | **next** — not started |

Five relay-directed CC-CMDs, and three of them turned out to describe work
already done. The pattern worth noting on the laboratory side: these docs are
filed from what `/context/date` and the desk *render*, which is a correct place
to notice a symptom and an unreliable place to infer a cause. Every one of the
three would have been caught by a HEAD probe before filing — `grep` for the
function the ask says to write, and check whether a table already has the row.
EOF
