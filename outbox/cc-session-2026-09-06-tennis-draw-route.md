# CC session — /bsd/tennis/draw, and the anomaly that was never an anomaly

2026-09-06, continuing `cc-session-2026-09-06-tennis-and-the-dead-durable-objects.md`.

## Commits

```
fd25196  probe: what a BSD tennis draw row carries on the list endpoint
27860a6  fix: the shape probe filtered on a parameter BSD drops, and did not check
31f37e2  feat: /bsd/tennis/draw — one edition's bracket, joined by winner identity
101623b  feat: refuse a player twice in one round, and verify against three editions
932e44e  probe: why a player appears in two first-round rows
d924d14  fix: a cancelled row is not a match in the draw, and that is the whole anomaly
```

Deploys 912, 913, 914 — all SUCCESS. 188 routes mapped, 186 with a declared
source.

## Done condition (Rule 87)

`verify-tennis-draw`, against the deployed route, **30/30**:

```
135/2025  64 31 16 8 4 2 1   123 edges, all re-derived, champion Carlos Alcaraz
                             Round of 64 declared off-canonical
 77/2026  64 32 16 8 4 2 1   126 edges, all re-derived, champion Mirra Andreeva
 14/2026  64 32 16 8 4 2 1   126 edges, all re-derived, champion Carlos Alcaraz
```

Plus three guards: no tournament → 400, non-numeric tournament → 400,
two-digit season → 400.

Coverage is printed where the result is read (Rule 91): **three editions of
fourteen grand-slam ids in a census of 636 tournaments. The other 633 are
unchecked and the output says so.**

## The defect I committed while writing a probe

The shape probe filtered on `tournament_id`. The answer had been measured hours
earlier and was sitting in this repo's own outbox:

```
filter_tournament      200  400 rows  allSameTournament=true
filter_tournament_id   200  366 rows  allSameTournament=false
filter_tournament_ids  200  366 rows  allSameTournament=false
```

`tournament_id` is accepted and silently dropped — the same behaviour the
`by-date` route exists to work around for four date spellings. **All eight slam
ids returned the same 363 rows**, and the probe reported `halves=false` for
every one of them as a property of the draws. It also matched `/US Open/i`
against an unordered list and landed on **US Open, Boys** (id 144), then printed
Jessica Pegula as its sample player — which is the tell a loose match leaves.

Written from memory rather than read from the artifact, in a probe whose entire
purpose was to stop exactly that. The fix adds an assertion: every row must
carry the requested tournament id or the probe exits 1.

## The anomaly that was never an anomaly

The player-twice guard — added because field-laboratory's F# model of this same
draw showed the ambiguity check was subsumed by it — refused **two of the three
editions** verify-tennis-draw checks.

Two readings fit and they called for opposite fixes, so the question was
measured before the fix was written
(`scripts/bsd-tennis-duplicate-rows.mjs`, five editions):

| edition | player | rows |
|---|---|---|
| 135/2025 | Collignon | 8430 finished v Galan · 8423 **cancelled** v Djere |
| 14/2026 | de Minaur | 23552 finished v McDonald · 23169 **cancelled** v Berrettini |
| 14/2026 | Faria | 23534 finished v Blockx · 23127 **cancelled** v Cazaux |
| 76/2026 | Wawrinka | 35362 finished v De Jong · 34978 **cancelled** v Fils |
| 76/2026 | Van Assche | 35464 finished v Gaubas · 35129 **cancelled** v Kypson |
| 15/2026 | Baptiste | 23613 finished v Townsend · 23208 **cancelled** v Vondrousova |

**Six of six have exactly one cancelled row. Zero have two live rows.**

The shape is identical every time and it names itself: the player keeps their
slot and the **opponent** changes. That is a withdrawal — the original opponent
pulled out, a lucky loser came in — and BSD keeps both rows.

So the 65- and 66-row first rounds this session had been calling an unexplained
ladder anomaly for six hours were never that. They are 64 matches plus the
fixtures that were replaced. Excluding cancelled rows puts every edition at
**127 main-draw matches**, which is exactly what a 128 draw holds.

US Open Men 2025 lands on 126: its Round of 64 serves 31 rows where 32 exist,
and that one is a row BSD genuinely does not have. It stays an anomaly. Writing
32 into the expected ladder to make the table tidy would be the smoothing this
route was built to refuse.

**The guard stays.** It is now unreachable on these five editions, and that is
the point — it fired, it was investigated rather than loosened, and what it
found was a real defect in how this route read the vendor's rows.

## Two guards, and the one the F# type deleted

field-laboratory's `Draw.fs` was given an `AmbiguousEdge` case for the condition
this route returns 409 on. Its suite row **could not be given an input that
reached it**: a winner can only appear in two next-round matches if that player
appears twice in that round, and the player-twice law refuses first. The case
was deleted there.

The reverse does not hold, which is why the relay carries both. Two unplayed
first-round rows sharing a player produce no edge at all — the join sees nothing
and returns a clean-looking draw with one player in two simultaneous matches.

## Residual

Nothing deferred. Three `/bsd` routes remain unprobed from the earlier session
(`events/season`, `r2/list`, `tennis/matches/{id}`); coverage is now 14 of 17
with the three draw probes added.

---

## Every tier, and the two ends of a bracket

**Coverage: 637 of 637 tournaments read, untruncated.** 35 editions across all
eight categories the client admits, plus all seven named team events.

**34 of 35 assembled. Zero interior holes. Zero edge-rule violations.**

Draw sizes the model held on: **128, 96, 56, 32, 30, 28, 26.**

```
grand_slam    R128=64 R64=32 R32=16 R16=8 QF=4 SF=2 F=1
masters_1000  R128=32 R64=32 ...          96 draw
wta_1000      R64=24  R32=16 ...          56 draw  (Doha, Dubai)
atp_500       R32=16  R16=8  ...          32 draw
wta_500       R32=12  R16=8  ...          28 draw
```

`atp_1000` holds **zero** tournaments — a dead entry in the client's
`TENNIS_TIERS`. Harmless, and the weekly run reports it every time.

### Two exemptions, both measured, both at an edge

| edge | the false claim it removed | evidence |
|---|---|---|
| entry round | "R128 holds 32 where 64 make a full round" | 9 of 10 Masters flagged, 0 missing a match |
| innermost round of a live draw | "QF holds 1 where 4 make a full round" | US Open Women 2026, 3 unplayed |

Everything between them stays checked, which is the point: US Open Men 2025's
`R64=31` and Toronto 2025's `R32=15` are interior, real, and still reported.

### The one 409, and why it stays

**Antalya 3 (id 53), 2026.** Rus lost her Round of 32 on 2026-03-10 and is
scheduled in another Round of 32 on 03-14. Two events four days apart under one
tournament id — Antalya runs back-to-back weeks — and the main draw reads 36
rows where a 32-draw holds 31.

Neither proposed cause fit: not a withdrawal pair (two of three duplicates have
two live rows), not two calendar years. The season partition is the year of
`match_date` and a match row carries no season field. The refusal is correct;
the payload now names the cause.

### Team events: two shapes

```
WITH a knockout      209 ATP Finals · 4 Next Gen Finals · 204 WTA Finals  (SF=2 F=1)
                     391 United Cup                                       (QF=4 SF=2 F=1)
WITHOUT              446 Davis Cup · 509 BJK Cup · 508 BJK Cup Group I    (0 main-draw)
```

The Cups are ties — no bracket exists. The Finals' round-robin group stage
carries a **blank** round name and is counted under `roundsOutsideMainDraw`; a
round-robin is not a round, and what renders is the knockout it feeds.

### The automated follow-up that could not live in either repo alone

The client's admit/exclude lists are literals in `field.js`. A vendor that starts
serving a Davis Cup knockout, or stops serving the ATP Finals semi-finals, makes
the client wrong in a way nothing in the client can notice.

`tennis-tier-ladders` now checks both directions weekly against the deployed
route and **exits 1** on either — an excluded event that gains a draw (a bracket
nobody can reach) or an admitted one that loses it (a tab offering an empty
bracket). First run: **21/21 read, 21 held, zero drift.**

### One apparatus defect, mine

The reader printed `interior rounds at their size: 20 of 27` on a run where
nothing failed — the team-event loop read seven editions and never incremented
the counter. **A count only some of its subjects can move is not a count.**
