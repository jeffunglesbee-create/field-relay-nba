# CC Session — 2026-08-21 — brief-data-quality asks 3, 4, 6a

**Serves:** `docs/CC-CMD-2026-08-20-brief-data-quality.md` rev 3 (field-laboratory).
**Deploy:** relay run on `300fb73`, success. Four guards now gate every deploy
(steps 7–10) ahead of the Cloudflare step.

## Ask 3 — three live writers, all found by evidence not inference

The row `id` shapes named the code paths. That beat reading 13 briefs INSERT
sites, and it was the difference between a guess and a diagnosis.

| writer | defect | rows | last live |
| -- | -- | -- | -- |
| client `epl_match` | `'EPL'` hardcoded for all soccer | 10 | 2026-08-21 |
| relay `pre_game` | `label.toLowerCase()` on an already-correct label | ~145 | 2026-08-20 10:01 |
| client `night_owl` | `inferSport()` DISPLAY output used as a key | 303 | 2026-08-20 21:23 |

**Why `pre_game` stayed invisible:** the id kept the right casing — it is built
from the game row id, not from `label` — so the row read fine:
`id: pre_game_MLB_2026-08-20_whitesox_braves`, `sport: mlb`. It only disappears
when you filter on sport. Second site with this exact defect;
`CC-CMD-2026-07-15` fixed the same lowercasing at `kv_capture`. A bug class
recurring at a new site is what justifies a guard over another one-off fix.

**The `night_owl` find is the one that mattered.** `inferSport()` is a display
formatter emitting `"Baseball (MLB)"`, `"Australian Football (AFL)"`, and
`"UEFA Conference League"` — the *exact string* that had to be UPDATEd out of
`regular_season_games` on 2026-08-20. **That row was the symptom; this is the
generator.** Yesterday's data fix alone would have been undone by the next write.

`inferSport` itself deliberately unchanged — it feeds section headings, so
rewriting it alters the UI (Rule 69). The defect is using a display function's
output as a key, not the function.

**`football` (21) = FIFA World Cup**, proven by content (Mexico at the Azteca,
"Group E decider"), written by `kv_sweep`, dead since 2026-06-26. Mappable with
evidence — a migration item, not a gate.

## Ask 4 — the ordinal id, both halves

`game._id` is `'g' + (++_gid)`, a **render-order ordinal** assigned in
`buildDateSchedule` as a DOM card key. Every `archiveBrief` call site passed it:
535 rows keyed `g1`/`g2`/`g16` that join to nothing.

- **4b client (`7eb5d388`)** — `_briefGameId(game)` returns a real external id or
  **null**, never the ordinal. A `gNN` is *worse* than null: null is visibly
  absent, `gNN` looks real and is silently unjoinable. 13 call sites routed
  through it.
- **4a relay (`e8e66f8`)** — `/archive/brief` now rejects `^g\d+$` with a 400 that
  names the fix. Safe to enforce only *because* the client half shipped first;
  enforcing earlier would have turned a bad write into a dropped brief.

**Reject rather than normalize — deliberately the opposite of the `sport`
handling on the line directly above it.** That line *can* normalize: a WC26
variant carries enough information to recover the canonical label. An ordinal
carries none — `g16` cannot be turned back into an event id by any means.
Silently nulling it would keep the prose and hide a contract violation.

**Rule 76 disclosed, not hidden:** `_briefGameId` probes four fields
(`espnId`/`sourceId`/`eventId`/`espn_event_id`) because client game objects have
no single canonical id. Rule 76 caps chains at 2 and says 3+ means the CONTRACT
is broken. It is — the relay owns the game shape (Rule 60) and guarantees no id
field. The helper concentrates that breakage at ONE documented boundary instead
of 12 copies, and makes the real fix a single-place change. It is recorded as a
known contract defect, not papered over.

## Ask 6a — scoring_version stamped

The column existed (`ALTER TABLE ~L5457`) and so did `SCORING_ERAS` /
`CURRENT_SCORING_ERA`. No writer ever filled it, so `/quality/coverage` had to
DERIVE the era from a row's date and flag it `ambiguous` (~L12981). Now stamped
at the four sites where the relay itself scores: queue consumer, `kv_capture`,
`kv_sweep`, `kv_repair`. **Not** stamped where `quality_score` is
client-supplied — we did not grade it and must not claim to have.

**Arity verified mechanically, because I got it wrong mid-change.** A script
counts placeholders vs bind arguments across every `INSERT INTO briefs`
(ignoring template literals) and compares `HEAD` to the working tree: all 10
sites read equal both before and after, so no regression. An earlier
column-count heuristic reported four false positives — placeholders-vs-bindargs
is the comparison that predicts runtime, and comparing against HEAD is what
proves absence of regression.

## NOT done — two builds, each with a real prerequisite

Neither is declined; both have a gate that should not be walked past.

**Ask 6b — recalibrate `quality_score`.** `SCORING_ERAS` records a
`measuredEffect` for every entry, computed from real data ("Dim 4 floored 91.2%
-> 7.9%; mean contribution 0.35 -> 9.89 of 16 pts, n=592"). Changing weights
without that number means inventing it (Rule 2) or filing an era entry that lies
by omission. **Unblocked by:** a re-scoring pass over the 2026-08-19 slate
producing the before/after distribution. Then the weight change is one commit
plus its era entry.

**Ask 5 — event-grounded recaps.** Generating from `keyEvents`/`incidents` means
an ESPN summary fetch **per game** inside a `*/15` cron over ~50 games: ~4,800
extra calls/day. Rule 78 exists for exactly this ("June 16 CC session wrote two
Odds API fetch helpers without cacheEverything, exhausting 19,999/20,000 credits
in one session"). Also a prompt-structure change, gated behind reading
`journalism-quality.js`. **Unblocked by:** one `keyEvents` shape probe plus a
measured call-volume count, so the caching/TTL and finals-only scoping decisions
are made on numbers.

## Residual data decisions (authorisation required, all live-D1 mutations)

- ~601 rows across 20 non-conforming `sport` values. Safe mappings now known
  (`mlb`->`MLB`, `Baseball (MLB)`->`MLB`, `football`->`FIFA World Cup`).
  Genuinely ambiguous: `CFL – 2026 Season · Week 7`, `NBA Playoffs`.
- 535 rows with `gNN` game_ids — unrecoverable by construction; deletion or
  null-out is a judgement call.
- 41 genuinely mislabelled `game_recap` rows (ask 2's residue).
