# CC session — Task 0 disproved the matcher, and found a worse defect underneath

**Date:** 2026-09-13 UTC · **Repo:** field-relay-nba · `main` (`bab6b2f`), deploy 934
**CC-CMD:** `2026-09-11-odds-identity-join-cfb` — **Task 0 done, Tasks 1-5 BLOCKED**
**Second CC-CMD filed:** `2026-09-13-team-key-sport-blind`

---

## What Task 0 was for, and what it did

The CC-CMD prescribed a matcher shape and then said, in the same document:

> *"Do not write the matcher against the five pairs in this document — they are a
> sample, and this repo's rule is that a copy is almost always locally true."*

Probed `/identity/mismatches?date=2026-09-12&sports=CFB` — a real Saturday, 80
games against 24 vendor events, 0 matched. The sample did not survive.

## Finding 1 — six D1 rows carry another sport's team

```
Liberty     (CFB Flames)      -> newyorkliberty     (WNBA)
Minnesota   (Golden Gophers)  -> minnesotaunitedfc  (MLS)
Colorado    (Buffaloes)       -> coloradorapids     (MLS)
Houston     (Cougars)         -> houstondynamofc    (MLS)
Cincinnati  (Bearcats)        -> fccincinnati       (MLS)
Charlotte   (49ers)           -> charlottefc        (MLS)
```

`resolveTeamKey`'s alias map is **sport-blind**: a college named for a city
resolves to that city's professional club.

**These keys are written into D1.** The archive asserts a college football game
was played by the Colorado Rapids. An unmatched row is a missing fact; a
substituted key is a false one. This is the worse of the two.

**It blocks the matcher rather than sitting beside it.** A matcher that
"succeeds" on `coloradorapids|weberst` writes MLS odds onto a college football
game — worse than the zero coverage it replaces, and the exact failure the
CC-CMD's own gate section warns about.

## Finding 2 — the prescribed rule fails on 35 of 80 rows

The rule was: *every D1 token must appear in the vendor's token list, in order,
starting at its first token.*

35 of 80 rows carry an ESPN abbreviation: `C Michigan`, `W Michigan`,
`N Illinois`, `GA Southern`, `Jax State`, `UT Martin`, `N Dakota St`, `ETSU`,
`MTSU`, `App State`, `Western KY`, `Miami OH`. **`cmichigan` is not a prefix of
`centralmichiganchippewas`.** The five-pair sample happened to contain only
mascot-suffix and `st`→`state` cases, which the rule does handle.

## What shipped

The census, in the endpoint anyone debugging this join already calls — because
the count was invisible there: an unmatched row reads as a naming difference
whatever the cause.

Verified live after deploy 934:

```json
"key_substituted": 6,
[ {"name":"Liberty","key":"newyorkliberty"}, … ]
```

`San José St → sanjosest` is correctly **not** flagged. Accent-folded before
comparing, so the check separates a rendering artifact from a substitution —
without the fold it would flag every diacritic and mean nothing.

`resolveTeamKey` is called with **one** argument, exactly as the join calls it.
Passing a `sport` would imply the resolver is sport-aware, and its not being
sport-aware is the entire finding.

`key_substituted` is `[]` when checked and none, absent when not checked, never
null-for-both (Rule 99).

## Why the matcher was not built — the confidence gate

Two reasons, and the first is sufficient:

1. Matching a key that is wrong is meaningless, and six of eighty are wrong.
2. The prescribed rule is disproven by the data it was meant to run on. Writing
   it anyway would be writing against the sample the CC-CMD warned about, one
   document later.

Filed as `CC-CMD-2026-09-13-team-key-sport-blind` with its Task 0 stating that
**six is a lower bound** — one sport, one day, found by a check that did not
exist this morning — and NFL/NBA/NHL share city names with MLS sides too.

## Explicitly not decided here

**Backfilling the D1 rows already written.** Task 1 of the new CC-CMD produces
the count by sport so the decision can be made; it does not make it. A live
mutation of archive rows is authorised case by case by the user and is never
wired to a cron by a session.
