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
