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

---

## Addendum — prerequisite probes run; both remaining asks change shape

### Correction to this document and to commit `300fb73`

I wrote that "no writer ever filled" `scoring_version`. **That is wrong.** It is
populated on 1,234 `game_recap` rows:

```
ver=1      716   last 2026-07-15 21:25
ver=2      518   last 2026-08-12 10:02
(null)     241   last 2026-08-20 13:18
```

Some writer did stamp it and stopped after 2026-08-12. The null tail is 241 rows,
not the whole table. Ask 6a is still correct and still needed — nothing was
stamping it at the four sites I fixed, and `CURRENT_SCORING_ERA` is 3 while no
row carries 3 — but the premise as I stated it was overclaimed.

### Ask 6b — the premise does not survive measurement

```
in-progress language   n=  94   mean 184.3   min 116   max 277
reads as final         n=1381   mean 190.1   min  97   max 283
```

Finals score **higher** on average. The CC-CMD's "quality_score rewards fluency
over truth" holds for the cited 191 row — that row is real — but the metric is
**not systemically inverted**. Recalibrating weights to correct an inversion that
does not exist would be a change built on a false premise, and could degrade
scoring rather than improve it.

Ask 2 has also already removed most of 6b's motivation: in-progress briefs are no
longer labelled `game_recap` at all, so the freshness weighting 6b asked for is
largely moot for new rows.

**Recommendation: rescope 6b** from "recalibrate because the metric is inverted"
to the narrower, evidenced version — the metric fails to *penalise* in-progress
prose (94 such rows scored up to 277). That is a real but much smaller change,
and it needs a `measuredEffect` from a before/after re-score either way.

### Ask 5 — premise FALSIFIED for the sport it was written about

```
MLB    event 401816603   has_keyEvents: FALSE     payload 1082 KB
soccer event 401909622   has_keyEvents: true (12) payload  301 KB
```

The CC-CMD states "ESPN summary `keyEvents`: scoring plays, athletes involved,
field coordinates" and illustrates with "Rice's 447-ft homer in the 3rd."
**MLB summaries carry no `keyEvents` array.** Baseball play data lives elsewhere
in that payload. Ask 5 cannot be built on `keyEvents` for baseball — which is
both the CC-CMD's example sport and the archive's largest (MLB 791 of 1,452
`game_recap` rows).

Soccer does have `keyEvents` (12 entries on the probed fixture), but its `[0]`
carried no `athletesInvolved` and an empty clock. Whether later entries carry
athletes is UNMEASURED — `any_with_athletes` was only wired into the MLB code
path, so the soccer value in the manifest is "not computed", not "none found".
Stated as unknown rather than inferred.

### Cost — and a correction to my own framing

Measured: 28 games/day mean over 14 days (54, 38, 25, 13, 26 on recent days).

I framed this as ~4,800 calls/day and treated Rule 78 as a gate. That used a
per-tick model — 96 ticks/day — which is the wrong design and was never the only
option. Fetching **once per game at finalisation** is ~28 calls/day and ~8 MB.
The naive per-tick figure is 2,688 calls / 790 MB/day, which is what to avoid,
not what the feature costs.

**So cost was never the real blocker. The missing `keyEvents` array is.**

### What each ask needs now

- **Ask 5:** probe where MLB play data actually lives in the summary payload
  (`plays`?), then rescope to "event-grounded where the feed supports it,
  per-sport" — or drop baseball from the ask. Either way the CC-CMD's shape claim
  must be corrected first; building against it as written would fail on the
  largest sport.
- **Ask 6b:** rescope per above, then a before/after re-score for `measuredEffect`.

Both are laboratory-side doc corrections before they are relay-side builds.

---

## Addendum 2 — ask 5's premise HOLDS for baseball, at a different key

Runs 10 and 11 of `brief-join-premise-probe` (commits `173dc2c`, `e77564e`;
manifests `ask5-ask6-prereq-manifest-20260821T052124Z.json` and
`...T052216Z.json`). This **reverses** the conclusion in Addendum 1.

Addendum 1 said the missing `keyEvents` array was the real blocker for ask 5.
That was a finding about one key, not about the feed — and stopping there would
have been a Rule 3 class E call (declaring something impossible without
verifying). Enumerating every top-level container in a real finalized MLB
payload (event 401816603) instead of guessing:

| kb | key | shape |
|----|-----|-------|
| 538 | `plays` | array, 655 |
| 191 | `boxscore` | object |
| 129 | `rosters` | array, 2 |
| 29 | `playsMap` | object, 655 |
| 16 | `atBats` | object, 85 |
| 6 | `winprobability` | array, 85 |

Baseball's event data is in **`plays`**, with fields `id, sequenceNumber, type,
text, awayScore, homeScore, period, scoringPlay, scoreValue, team, wallclock,
atBatId, summaryType, pitchCount, resultCount, outs`.

`plays[0]` is `"Top of the 1st inning"` — a period marker, and exactly what made
the soccer `keyEvents` read look empty two runs earlier. Reading element [0] a
third time would have produced a third wrong answer. Filtering to
`scoringPlay: true` instead — 11 of 655, all 11 carrying `text`:

- `"Walker homered to center (407 feet), Wetherholt scored and Herrera scored."` (period 3, scoreValue 3)
- `"McLain homered to left (360 feet), Hayes scored, Stewart scored and Bleday scored."` (period 6, scoreValue 4)
- `"Bleday singled to right, Rodríguez scored, Stewart to second, Hayes to third."` (period 6, scoreValue 1)

That is precisely the ask's promise — its own example was "Rice's 447-ft homer".
Named athletes, the distance detail, and a period. A `participants` field is
present on every scoring play as well.

### Corrected position on ask 5

The ask is **buildable for baseball**, and neither stated blocker survives:

1. **Cost** — not a blocker. Once-per-finalization is ~28 calls/day (Addendum 1).
   Payload is the real consideration: 1,082 KB per MLB summary, of which `plays`
   is 538 KB. ~30 MB/day at 28 games. Rule 78 still requires the fetch replicate
   the existing `cacheEverything` + TTL pattern, but there is no quota risk here.
2. **Shape** — not a blocker. The CC-CMD names the wrong key, not a missing
   capability.

**The correction the laboratory doc needs is one line, not a rescope:** the event
source is per-sport — `keyEvents` for soccer, `plays` filtered on `scoringPlay`
for baseball. "Drop baseball from the ask" is off the table; it was based on my
own incomplete probe, and I am flagging that rather than letting Addendum 1 stand.

Unverified and NOT to be assumed (Rule 73): whether soccer's `keyEvents` carries
usable prose (the earlier run found `any_with_athletes` not computed and an empty
clock on element [0] — same element-[0] trap, so it needs the same verbatim
re-read before any soccer claim); and whether NFL/NBA/NHL summaries use `plays`,
`keyEvents`, or a third key. Each is one probe.

---

## Addendum 3 — soccer `keyEvents`, every item read verbatim

Runs 12–13 (`d9a0a60`, `e21429c`; manifests `...T054737Z.json`,
`...T054834Z.json`). This corrects a defect in my own probe.

### The earlier "no athletes attached" reading was a probe bug

The field is **`participants`**, not `athletesInvolved`. The earlier run computed
`any_with_athletes` off `athletesInvolved` only and reported nothing. That was a
false negative manufactured by the probe. **8 of 12 items carry named
participants.** Full field union across items:

`clock, id, participants, period, scoringPlay, shootout, shortText, source, team, text, type, wallclock`

### Fixture A — event 401909622, Inter Turku 0-0 FC Copenhagen (12 items)

| i | type | clock | text |
|---|------|-------|------|
| 0 | Kickoff | `""` | *(none)* |
| 1 | Halftime | 45'+1' | First Half ends, Inter Turku 0, FC Copenhagen 0. |
| 2 | Start 2nd Half | 45' | Second Half begins Inter Turku 0, FC Copenhagen 0. |
| 3–10 | Substitution ×8 | 70'–90'+3' | e.g. "Substitution, Inter Turku. Yeboah Amankwah replaces Juuso Hämäläinen because of an injury." |
| 11 | End Regular Time | 90'+3' | Second Half ends, Inter Turku 0, FC Copenhagen 0. |

**This fixture finished 0-0.** `scoringPlay` is false on all 12 items. It
therefore says nothing about goal events — the only item type ask 5 needs.
Concluding "soccer keyEvents lack scoring detail" from it would be the
element-[0] error repeated at fixture scale, so a scoring fixture was probed
separately.

Note `clock` on item 0 is the empty string, not null — that is what the first
run reported as "empty clock". Every other item has a real clock. A single
period-marker element, again.

### Fixture B — event 401910985, Shamrock Rovers 1-1 KuPS (scoring items)

```
type: "Goal"  clock: 49'  scoringPlay: true
text: "Goal! Shamrock Rovers 1, KuPS 0. Enda Stevens (Shamrock Rovers)
       right footed shot from the centre of the box to the centre of the goal."
shortText: "Enda Stevens Goal"   participants: [Enda Stevens]

type: "Goal"  clock: 85'  scoringPlay: true
text: "Goal! Shamrock Rovers 1, KuPS 1. Piotr Parzyszek (KuPS) right footed
       shot from the centre of the box to the centre of the goal.
       Assisted by Clinton Antwi."
shortText: "Piotr Parzyszek Goal"   participants: [Piotr Parzyszek]
```

Slug resolution: `uefa.europa.conf_qual` returned 200 on the first attempt.

### What this settles for ask 5

Soccer carries the same grade of material as baseball: named scorer, shot type,
location on the pitch, running scoreline, and a match clock — parallel to MLB's
`"Walker homered to center (407 feet)"`.

**`text` is the richest field and the one to generate from. `participants` is
not sufficient**: it lists only the scorer, while the assisting player appears
in `text` alone ("Assisted by Clinton Antwi"). A generator reading
`participants` would silently drop assists.

`role` came back null for both participants. My accessor read `p.type?.text ??
p.type`; that is a statement about that path, NOT evidence that no role marker
exists elsewhere on the object. Anything depending on scorer-vs-assist
structured roles needs its own probe (Rule 73).

### Per-sport event source — the corrected contract

| sport | key | filter | prose field |
|-------|-----|--------|-------------|
| soccer | `keyEvents` | `scoringPlay === true` | `text` |
| MLB | `plays` | `scoringPlay === true` | `text` |
| NFL/NBA/NHL | UNVERIFIED | — | — |

Still unverified: NFL, NBA and NHL summaries. One probe each, same method.

---

## Addendum 4 — scorer vs assist: structure resolved (18 goals, 6 fixtures)

Run 14 (`553f425`; manifest `ask5-ask6-prereq-manifest-20260821T055209Z.json`).
Participant objects dumped RAW with no field selection, so a role marker under
any name would have surfaced.

### There is no role field

Every participant entry across all 18 goals has exactly one key:

```json
{"athlete": {"id": "218122", "displayName": "Enes Ünal"}}
```

No `type`, no `role`, no ordinal, no `athlete.position` — nothing. My earlier
null on `p.type` was not a wrong path; the field genuinely does not exist.
**Role is positional: `participants[0]` is the scorer, `participants[1]` is the
assister.** Confirmed scorer-at-index-0 on 18/18, including the own goal
(401910986 55', which correctly lists the own-scorer alone).

### But structured assists are only ~57% covered, and it varies by FIXTURE

| | goals | participants=2 | participants=1 |
|---|---|---|---|
| text says "Assisted by" | 14 | **8** | **6** |
| no assist in text | 4 | 0 | 4 |

The 6 misses are not scattered — they cluster by fixture. Every goal in
401909634 (5 of them) and the assisted goals in 401910985 and 401909635 carry
only the scorer, while 401909826, 401910989 and 401910986 attach both on every
goal. So this is **per-fixture feed coverage, not a per-goal property** — a
sample of one fixture would have given either 100% or 0% and both would have
been wrong.

Examples of the miss:

```
participants: [Michele Sego]                       ← assister absent from structure
text: "...Michele Sego (Hajduk Split) right footed shot ...
       Assisted by Abdoulie Sanyang."              ← assister present in prose
```

### Confirms the Addendum 3 call, with a number

`text` is the field to generate from. A generator reading `participants` would
drop the assist on **6 of 14 assisted goals (43%)**. `text` carried it on 14/14.

Secondary reason to prefer `text`: the structured `displayName` and the name in
`text` disagree — `"Dali"` vs `"Dalisson De Almeida"`, `"Serge-Philippe
Raux-Yao"` vs `"Serge Raux Yao"`, and `"Jeh "` with a trailing space. `text` uses
the form a reader expects.

**Use `participants[0].athlete.id` if a stable scorer identifier is ever needed
for joins** — that is what the structure is good for. It is not a substitute for
the prose.

### Unprobed, noted not assumed

Soccer summaries also carry a **`commentary` array (20 entries vs `keyEvents`'
12)** — larger than the container examined here, and its shape is UNVERIFIED.
Out of scope for this probe (Rule 69); flagged because "keyEvents is the soccer
container" is exactly the kind of claim that was already wrong once this session
for baseball.

---

## Addendum 5 — `commentary`, and what it reveals about the assist gap

Run 15 (`da1277d`; manifest `ask5-ask6-prereq-manifest-20260821T055421Z.json`).

### Shape

Four fields, total: `sequence`, `time`, `text`, `play`.

```json
{"sequence":5,"time":{"value":2940,"displayValue":"49'"},
 "text":"Goal! Shamrock Rovers 1, KuPS 0. Enda Stevens (Shamrock Rovers)
         right footed shot from the centre of the box to the centre of the goal.",
 "play":{"id":"51178987","type":{"id":"70","text":"Goal","type":"goal"}, ...}}
```

`text` is present on every item. `play` appears only on key moments and embeds a
keyEvents-shaped object. Items without `play` are the connective material
keyEvents omits — `"Lineups are announced and players are warming up."`,
`"Fourth official has announced 1 minutes of added time."`

### Coverage is NOT uniform — it splits into two tiers

| event | commentary | keyEvents | scoring items |
|-------|-----------|-----------|---------------|
| 401910985 | **20** | 12 | 2 |
| 401909635 | **27** | 19 | 2 |
| 401909634 | **29** | 21 | 4 |
| 401910989 | **109** | 20 | 2 |
| 401909826 | **111** | 21 | 4 |
| 401910986 | **112** | 19 | 3 |

Three fixtures carry ~20–29 items; three carry ~109–112. `keyEvents` stays flat
at 12–21 across both, so the variance is specific to `commentary`.

### This is the same tier that governs the assist gap

Cross-referencing Addendum 4 against the counts above — same six fixtures, same
manifest:

| event | commentary | assisted goals | with 2 participants |
|-------|-----------|----------------|---------------------|
| 401910985 | 20 | 1 | **0** |
| 401909635 | 27 | 1 | **0** |
| 401909634 | 29 | 4 | **0** |
| 401910989 | 109 | 1 | **1** |
| 401909826 | 111 | 4 | **4** |
| 401910986 | 112 | 3 | **3** |

A clean split, no overlap: **the sparse tier structures 0 of 6 assists; the rich
tier structures 8 of 8.** The "43% of assists missing" figure from Addendum 4 is
not random per-goal dropout — it is three fixtures served at a lower feed tier,
and `commentary.length` is a usable proxy for which tier a fixture got.

### What this changes for ask 5: nothing, and that is the finding

`commentary` is not a better source than `keyEvents` filtered on `scoringPlay`:

- The goal prose is **identical** in both — same string, verbatim.
- It is larger where it matters least (32 KB vs the whole 301 KB payload) and
  sparse on exactly the fixtures where structure is already thin.
- Its extra items are lineups, added-time announcements and period markers —
  nothing a recap needs.

So the per-sport contract stands unchanged: soccer → `keyEvents` where
`scoringPlay === true`, read `text`. Baseball → `plays` where `scoringPlay ===
true`, read `text`.

`commentary` earns one narrow use: **`commentary.length` distinguishes a
rich-tier fixture from a sparse one**, which is the only reliable way found so
far to know in advance whether `participants[1]` will be populated. Worth
recording only if something later needs structured assists.

### Not verified

Whether every `keyEvents` item also appears in `commentary`. The goal items
match verbatim in the fixtures examined, but no per-item set comparison was run,
so "commentary is a superset" is UNVERIFIED and should not be relied on.

---

## Addendum 6 — set comparison: the containers OVERLAP, neither is a superset

Run 16 (`23883a0`; manifest `ask5-ask6-prereq-manifest-20260821T055808Z.json`).
Joined on event id (`keyEvents[].id` vs `commentary[].play.id`), not on text —
text equality would beg the question and would also pair two identically-worded
substitutions.

**`is_superset: false` on all 6 fixtures.** Addendum 5's caution was correct;
had it been asserted, it would have been wrong.

| event | keyEvents | commentary (with play) | missing from commentary | extra in commentary |
|-------|-----------|------------------------|-------------------------|---------------------|
| 401910985 | 12 | 20 (4) | **8** | 0 |
| 401909634 | 21 | 29 (11) | **10** | 0 |
| 401909826 | 21 | 111 (32) | 1 | **12** |
| 401909635 | 19 | 27 (9) | **10** | 0 |
| 401910989 | 20 | 109 (27) | 3 | **10** |
| 401910986 | 19 | 112 (28) | 1 | **10** |

Both directions miss, so the relationship is **overlap**, not containment.

### What each side holds exclusively

**Only in `keyEvents`** — substitutions and period markers:
`"Piotr Parzyszek (KuPS Kuopio) Substitution at 58'"`, plus `Kickoff`,
`Halftime`, `End Delay`, `End Regular Time` (these carry `text: null`).
The sparse-tier fixtures lose 8–10 items this way, all substitutions.

**Only in `commentary`** — near-miss and incident events, which `keyEvents` has
no representation of at all:
```
[Shot Off Target] "Attempt missed. Martín Satriano (Getafe) right footed shot
                   from outside the box is too high. Assisted by Ramón Terrats."
[Shot Hit Woodwork] ...
[Foul] ...
```
These appear only in the rich tier (10–12 per fixture); the sparse tier has zero.

### Goals are in both — verified, not assumed

**0 goal items missing from commentary across all 6 fixtures.** The exclusions
are entirely substitutions, period markers, and near-misses. So the ask-5 read
path is unaffected either way: goal prose is reachable and verbatim-identical
through both containers.

### One duplicate id found

401910989: `commentary_with_play: 27` but `commentary_distinct_play_ids: 26` — a
repeated play id. Reporting raw and distinct counts separately was what caught
it; a single count would have shown 27 items of "coverage" from 26 events.

### Net effect on ask 5: still unchanged, plus one real option

The contract stands: soccer → `keyEvents` where `scoringPlay === true`, read
`text`. Nothing here displaces it.

But the set comparison surfaced something the count comparison could not:
`commentary` carries **`Shot Off Target` / `Shot Hit Woodwork` / `Foul` events
that `keyEvents` does not contain at all** — the near-misses that make a recap
read like a match rather than a scoreline. That is a genuine enrichment option
for ask 5, available only on rich-tier fixtures (detectable in advance via
`commentary.length`, per Addendum 5).

Flagging it as an option, **not** adopting it: it widens ask 5's scope beyond
what the CC-CMD specifies, and Rule 69 puts that in its own prompt.

---

## Addendum 7 — all five sports measured; two decisions ADOPTED

Runs 17–19 (`40d8403`, `99aa4eb`, `81d5739`; manifest
`ask5-ask6-prereq-manifest-20260821T131941Z.json`). Contract adopted in
CONTRACTS.md (`23504b3` relay, `7b140102` client).

### (A) Five sports, three different containers

| sport | container | scoring items/game | sample |
|-------|-----------|--------------------|--------|
| soccer | `keyEvents` | 2–4 | "Goal! …Enda Stevens…right footed shot from the centre of the box" |
| MLB | `plays` | 11 | "Walker homered to center (407 feet)…" |
| NBA | `plays` | **119** | "Paolo Banchero makes driving layup (Anthony Black assists)" |
| NHL | `plays` | 8 | "Cole Caufield Goal (22) Wrist Shot, assists: Noah Dobson (21)" |
| NFL | `scoringPlays` | 8 | "Woody Marks 20 Yd Run (Ka'imi Fairbairn Kick)" |

`keyEvents` is absent for four of five. `plays` is absent for soccer and NFL.
Three independent containers across five sports — which is why "one probe each"
was the right call rather than extrapolating from soccer and baseball.

**NBA is the trap:** 119 scoring plays per game against 8 for NFL and NHL. A
generator that concatenates scoring items yields a paragraph for four sports and
an unusable wall for basketball. Recorded in the contract.

#### A self-correction on the NBA/NHL "no data" result

The first attempt reported `no finalized row with an espn_event_id` for both and
I nearly recorded that as the answer. It is a fact about **this D1 table in
August**, not about the ESPN feed — both leagues are out of season. Reporting it
as a limit would have left the contract two sports short for no real reason.

The scoreboard fallback then returned nothing for 2026-06-07, and that result
carried no attempt log — the same shape of finding corrected three times already
this session. Rewritten to try several dates and record each one's status and
event count. Mid-January returned 9 NBA and 10 NHL events immediately; early June
had simply fallen past the end of both postseasons.

### (B) Near-miss enrichment — ADOPTED, ~60% availability

Widened from 6 to 20 fixtures:

- **12 rich-tier:** 98–129 commentary items, 5–16 near-misses each
- **8 sparse-tier:** 18–29 items, **0** near-misses each
- Clean bimodal split — nothing sampled lands between 29 and 98, so
  `commentary.length >= 60` identifies a rich fixture before parsing.

60% is a majority, so this is worth the code. Adopted in CONTRACTS.md: recaps use
near-miss items where present and degrade to goals-only where not. Same tier
governs `participants[1]` (sparse 0/6 assists structured, rich 8/8).

### Also adopted

- **Generate from `text`, not `participants`** — assister structurally present on
  8 of 14 assisted goals, in `text` 14/14.
- **Fetch at finalization, not per tick** — ~28 calls/day vs 2,688 / 790 MB.

### Divergence caught while syncing

The client's `CONTRACTS.md` was **173 lines behind** the relay's before this sync
— stale since 2026-06-30 while the relay copy kept growing. Verified no client
content was lost (the sync commit deleted exactly one line, the `Last synced`
header). Both copies now identical; client smoke 985 passed, 0 failed.

This is precisely the failure CONTRACTS.md exists to prevent, happening to
CONTRACTS.md itself. Worth a periodic identity check between the two copies.

---

## Addendum 8 — CONTRACTS.md identity check, in CI

`00556d9` (relay), `9f175643` (client).

CONTRACTS.md has always opened with "This file must be identical in
jubilant-bassoon AND field-relay-nba." Nothing enforced it, and Addendum 7 found
the client copy 173 lines behind, stale since 2026-06-30.

### Design

`.github/workflows/contracts-identity-check.yml` in **both** repos. Each checks
out both copies and diffs them. On mismatch it prints the unified diff, the
differing `## ` section headings, and each copy's line count and sha256 — so the
output says *which side is behind*, not merely that they disagree.

**Both halves are required.** A workflow only sees its own repo's pushes, so the
relay copy catches relay-side edits and the client copy catches client-side ones.
Together they cover every change to either file.

**No `schedule:`.** It fires on pushes touching `CONTRACTS.md` — the only event
that can create divergence. A cron would burn runs on days nobody edited it,
which is the waste pattern documented in
jubilant-bassoon `outbox/cc-session-2026-08-16-scheduled-workflow-audit.md`.

**Auth differs by direction, and that was measured, not assumed.** The relay side
uses the `checkout` + `repository:` + `RELAY_GH_PAT` pattern already established
by `deploy-health-protocol.yml`. The client side has no equivalent secret — but
`field-relay-nba` is public (verified 2026-08-21 via the repos API,
`"visibility": "public"`), so an unauthenticated checkout succeeds. The workflow
records that if the relay ever goes private, the fix is to add a read-scoped PAT,
**not** to delete the step.

### Verification artifact (Rule 89)

Dispatched both, both `conclusion: success`:
- relay run `32489615730`
- client run `32489622308`

Green on identical files only proves the happy path, so the comparison logic was
negative-tested against all three cases:

| case | result |
|------|--------|
| identical (792 lines, sha `74d010c8` both sides) | exit 0, "PASS: identical." |
| client missing the ESPN section (792 vs 718 lines) | **exit 1**, named `## ESPN per-sport event source (summary endpoint)` |
| client file absent | **exit 1**, `client/CONTRACTS.md does not exist` |

The third case matters: a missing file must fail loudly rather than compare as
"no diff," which is how this class of check usually rots.
