# field-laboratory summary — the odds join, and team identity

**Date:** 2026-08-21 · **Repo touched:** field-relay-nba
**Follows:** `outbox/lab-summary-2026-08-21-odds-and-seed.md`
**Commits:** `887c843`, `e4ad440`, `0faf37f`, `bb04fc8`
**Bearing on:** `CC-CMD-2026-08-21-closing-odds-capture` (its carry-forward #2)

Short version: `OddsStory.Moved` was dormant for two reasons, not one. The first
is fixed. The second turned out to be a **missing La Liga alias section** — the
odds join has been silently dropping most soccer for months, and nobody had a
number for it until today.

---

## 1. What the desk was showing, and why

Two distinct failures, visible as two different card states:

| card state | competition | cause |
|------------|-------------|-------|
| `open/close NOT SEQUENCED` | WNBA | the backfill wrote one snapshot into BOTH odds columns |
| `one snapshot` | EPL, La Liga | the **opening** line never matched, so only the kickoff capture landed |

The second is the interesting one, and it is not an EPL problem. Opening-odds
coverage, **past dates only** (the honest denominator):

| sport | played rows | with opening | rate |
|-------|-------------|--------------|------|
| MLB | 807 | 704 | **87.2%** |
| WNBA | 183 | 138 | **75.4%** |
| MLS | 222 | 108 | 48.6% |
| **EPL** | 26 | 6 | **23.1%** |
| **La Liga** | 17 | 2 | **11.8%** |

**Root cause, read from source rather than inferred:** the join keys on
`resolveTeamKey(home)|resolveTeamKey(away)` from both sides.
`src/identity-resolver.js` had alias sections for WC/International, EPL, MLS,
WNBA, MLB, NBA and Ligue 1 — and **none at all for La Liga**. A club stored one
way in D1 and another by the feed never matches, and the row keeps a NULL
opening line for good.

### A correction to my own earlier number

I reported MLS as "the volume case" at 20% (108/548). **That was wrong.** The 548
included **326 future fixtures**, which legitimately have no opening line yet —
MLS is the one competition pre-seeded months ahead. Past dates only, MLS is
48.6%. The real gaps are La Liga and EPL.

---

## 2. What shipped

**a. The backfill no longer pre-fills `closing_odds` for unplayed games**
(`887c843`). It wrote one historical snapshot into both columns, so
`_captureClosingOdds`'s `WHERE closing_odds IS NULL` was false forever for any
game not yet kicked off. Fixed with a date gate, not a deletion — for a game
already played, one-snapshot-to-both is still correct.

**b. A La Liga alias section** (`e4ad440`). Every variant **read from D1**, not
remembered. D1 stores four clubs under two spellings each — `Betis`/`Real Betis`,
`Atlético`/`Atlético Madrid`, `Español`/`Espanyol`, `Rayo`/`Rayo Vallecano` — so
this fixes an internal inconsistency as well as the feed join.

**c. Spanish short-form convention** (`0faf37f`). Unqualified **"Real" means Real
Madrid**; Betis and Real Sociedad go by **"Betis"** and **"Sociedad"**. The table
had neither `Sociedad` nor `Real`, so Real Sociedad's actual short form did not
resolve at all.

**d. All three 2026-27 promoted clubs** (`0faf37f`) — Coventry City, Ipswich
Town, Hull City, with short forms and nicknames (Sky Blues, Tractor
Boys/Tractors, Tigers). **Ipswich and Hull have no D1 rows yet**, so these landed
*before* their first fixture rather than after the first orphaned row — the
opposite of how Coventry was caught.

**e. Spanish nicknames** (`bb04fc8`) — Los Blancos, Heliopolitanos, Txuri-Urdin.

Both article and bare forms are listed for every nickname, because `_strip()`
removes non-alphanumerics but **keeps the article**: `the Tigers` and `Tigers`
are different keys. `Txuri-Urdin` is the exception and needed only one entry —
`_strip()` drops the hyphen, so the spaced spelling already resolves. That is
asserted in the guard, not left to a comment.

---

## 3. The guard, and why this one matters more than most

`scripts/check-team-identity-collisions.mjs` — 7th deploy gate. 26 alias pairs,
24 distinct clubs → 24 distinct keys.

**A missing alias is a miss; a collision is a corruption.** The join is
`byPair.get(resolveTeamKey(home) + '|' + resolveTeamKey(away))`, so two clubs
sharing a key attach one club's line to another club's game — silently, and it
looks entirely plausible on the card.

The tempting fix for `Betis → Real Betis` is to strip a leading "Real". Under the
actual convention that is worse than it first appears: **Real Sociedad's short
form drops the "Real", while bare "Real" belongs to a third club.** A stripping
rule points the wrong way in two directions at once — and Real Betis and Real
Sociedad played each other on 2026-08-21, so it would have had a live opportunity
to swap them that day.

Negative-tested three ways: aliasing Real Sociedad onto Real Betis, pointing bare
`Real` at Betis, and pointing `Heliopolitanos` at Real Madrid each fail the check
**by club name**.

---

## 4. Open, and relevant to the FPL ask

**`La Real`.** Real Sociedad is also commonly *La Real*. Deliberately **not**
added: it is the one form actively dangerous under this convention, because any
future article-stripping turns `La Real` → `Real` → **Real Madrid**. If the feeds
use it, it needs an explicit entry *plus* a guard assertion that it never
resolves to Real Madrid. Flagged for a decision rather than silently included.

**The Odds API's own spellings remain unread.** Reading them needs the API key,
which is exposed in two workflow files and must be rotated first. Listing every
observed spelling against one canonical is what makes the current fix safe
without them: whichever form the feed sends resolves, and an unlisted spelling is
a miss, never a mismatch. But the coverage rate cannot be confirmed to have
improved until a soccer slate runs post-deploy.

**Two alias tables now exist, and this is a Rule 60 question for the FPL ask.**
`CC-CMD-2026-08-21-fpl-event-grounding-epl` says to "reuse" the client's
`FPL_SHORT_NAME_MAP` (Spurs → Tottenham Hotspur, Wolves → Wolverhampton) for the
FPL→game join. That is a **second** club-alias table, in the other repo, for the
same clubs this one now covers. Reusing it as-is means two tables that can
disagree — exactly the divergence `CONTRACTS.md` exists to prevent, and the same
shape as the 173-line drift found earlier today.

**Recommendation before FPL builds:** the relay owns team identity (Rule 60), so
the FPL join should resolve through `resolveTeamKey` like every other join, and
`FPL_SHORT_NAME_MAP` should be treated as a source of *variants to add here* —
not as a parallel resolver. If any FPL spelling is missing, it belongs in
`identity-resolver.js` where the collision guard covers it.

---

## 5. Verification, staged (Rule 74)

**Staged:** that the alias fix raises soccer opening-odds coverage.
**Blocked by:** needs a soccer slate to run after the `bb04fc8` deploy.
**Verify:** on the next La Liga or EPL matchday, `opening_odds IS NOT NULL` for
the fixtures, and the desk renders `ML X → Y` rather than `one snapshot`.
**Unblocked when:** the next matchday's ~10:00 tick runs.

Separately staged from `887c843`: the next completed MLB/WNBA pre→live transition
should give `closing.captured_at > opening.captured_at` rather than
`NOT SEQUENCED`.
