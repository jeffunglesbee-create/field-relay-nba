# CC session — the ambiguous key count, 2026-09-13

Rule 67. Scope: resolve the `ambiguous_key_count == 0` condition left OPEN by
`CC-CMD-2026-09-13-team-key-sport-blind`'s close-out.

HEAD `e20e1ad` → `02e388f`. Deploy runs 950 (success).

## The count was never measuring code

Read, not assumed — all 11 keys from the live census:

| key | claimant A | claimant B |
|---|---|---|
| `richmond` | AFL Richmond, 16 rows | CFB Richmond, 1 |
| `sanfranciscogiants` | MLB Giants, 77 | NFL Giants, 4 |
| `stlouiscardinals` | MLB Cardinals, 77 | NFL Cardinals, 4 |
| `texasrangers` | MLB Rangers, 79 | Rangers (UEFA quali), 2 |
| `charlottefc` `coloradorapids` `fccincinnati` `houstondynamofc` `intermiamicf` `minnesotaunitedfc` | MLS, 43–52 each | the CFB programme of that name, 2 each |
| `newyorkliberty` | WNBA, 35 | CFB Liberty, 2 |

Every one is a fact about how sport names teams. **No edit to this repo makes it
zero.** Only sport-qualifying every join key would, and that rewrites every join
in the system. The third unmeetable done condition found today — and the first
whose blocker is the world rather than a deliberate design choice.

## And it was inert for a reason unrelated to the alias table

A cross-sport key can only do harm if a row is offered another sport's payload.
All three writers were read at HEAD and none does:

| writer | scoping |
|---|---|
| `snapshotCronOdds` | `SELECT … WHERE date = ? AND sport = ?` |
| `runOddsBackfillForDate` | buckets rows through `archiveSportToOddsKey`, fetches once per bucket |
| `/archive/game` | `archiveSportToOddsKey(sport)` for that one game |

So the guarantee never rested on this morning's resolver fix either. It rested on
three SELECT and dispatch shapes that a fourth writer could quietly fail to copy,
and nothing was holding them.

`scripts/check-odds-writers-sport-scoped.mjs` now does, in CI. Stated against the
**data path**, not vocabulary: the payload a join reads must come from a
`fetchSportOdds*` call whose sport argument is a variable derived from a row's own
sport — never a literal, never a constant. 13 assertions, 6 mutations, all caught.

**A keyword search would have passed on this file.** The census comment fifty
lines above one join site names both scoping shapes in prose. Comments are
stripped and the rule reads the call.

## Two defects in the measuring apparatus, both caught by mutation

**M1 reported `ANCHOR occurs 2 times` and mutated nothing.** The one-line SQL
anchor is a substring of the `/identity/mismatches` copy at a deeper indent.
Re-anchored on two lines. The same near-miss is why the SQL assertion is pinned
to `snapshotCronOdds`'s own body rather than counted file-wide — a file-wide
count lets a read-only diagnostic satisfy a writer's condition.

**Three mutations came back NOT CAUGHT from one cause.** Adding the collision
condition broke the isolation of the fixture testing absence: with both new
fields missing from one fixture, collapsing either one's absence to zero left the
other open, `all_done` still False, and the check still green. P3, P6 and P7 all
walked through. Split into `REACH_ABSENT` and `COLLISION_ABSENT`, each satisfying
the other condition so the missing field alone decides. P7 was the same shape
smaller — anchored on the first line of a two-line f-string, it left the count
still printed.

Final: 7 fixtures, 3 conditions, 7 mutations, 7 caught.

## Division of labour, which is the actual resolution

- **CI measures the source.** Writer scoping is a property of `src/index.js`:
  free, deterministic, cannot drift between runs. A six-hourly probe of
  production was the wrong instrument for it.
- **The watch measures the archive** — only what a live call can answer.

The 11 keys stay printed as a readout. The real hazard of demoting a number is
that it stops being printed at all, after which a twelfth arrives unnoticed. P7
exists to keep it visible.

## The new condition, and what it found on its first run

Cross-sport ambiguity cannot reach a join. **Within one slate there was no such
protection and nothing had ever asked.** `same_slate_pair_collisions`: two rows
in one `(table, date, sport)` whose `${hk}|${ak}` key is identical are
indistinguishable to `byPair.get` before any payload is consulted.

`outbox/identity-ambiguity-watch-20260913T214253Z.json`:

```
coverage:    scanned 3237 of 3237 rows across 2 tables
DONE  hullcity claimed by one family                   -> one family
DONE  no substituted name reaches another sport's club -> 0 failing of 123 probed
OPEN  no two rows on one slate share a join key        -> 197 collision(s);
      checked 3024 distinct join keys across 625 slates
```

**197, and every one is the same real game stored twice.** Four producers minting
four id schemes into the same tables; 35 rows carry a `FIFA World Cup 2026_` id
with `sport = MLS`, a second bug underneath the first. Filed as
`docs/CC-CMD-2026-09-13-archive-duplicate-rows.md` with the full classification.

**No false facts.** 68 collisions have odds on both rows; both name the same two
teams, so the line is right for both. **No extra Odds credit** — both writers
fetch once per `(sport, date)` outside the row loop, so a duplicate is an extra
UPDATE, never an extra call.

It does cost: every archive count is inflated by 6.1%, including coverage
denominators quoted earlier in this session; a slate is served twice; and the
join cannot tell the two rows apart — nor could it tell apart a genuine MLB
doubleheader. None of the 197 is one, which is why the condition is a count to
investigate rather than a count to zero by deletion reflex.

## Commits

| commit | what |
|---|---|
| `e20e1ad` | writer-scoping gate + `same_slate_pair_collisions` in the census |
| `44038dd` | watch restated: the archive's question, not the source's |
| `02e388f` | the 197 duplicates, filed as their own CC-CMD |

## Residual

**One, and it is filed rather than deferred.** The dedup needs D1 deletes, which
require explicit owner approval and are not authorised by anything written today.
`same_slate_pair_collisions` stays OPEN at 197 until then — honestly open, on a
named and actionable finding, which is the whole difference from the condition it
replaced.
