# CC-CMD-2026-09-13 — `resolveTeamKey` resolves a college to a pro club

Second CC-CMD from `CC-CMD-2026-09-11-odds-identity-join-cfb`, filed per Rule
87.4. That one's Task 0 was to probe a real Saturday slate before writing the
matcher. It found this instead, and this must be fixed **first**: matching a key
that is wrong is meaningless.

## Measured live, `/identity/mismatches?date=2026-09-12&sports=CFB`

80 CFB rows, 24 vendor events, 0 matched, and:

```json
"key_substituted": 6,
[ {"name":"Liberty",    "key":"newyorkliberty"},
  {"name":"Minnesota",  "key":"minnesotaunitedfc"},
  {"name":"Colorado",   "key":"coloradorapids"},
  {"name":"Houston",    "key":"houstondynamofc"},
  {"name":"Cincinnati", "key":"fccincinnati"},
  {"name":"Charlotte",  "key":"charlottefc"} ]
```

`resolveTeamKey`'s alias map is **sport-blind**. A college named for a city
resolves to that city's professional club — five MLS sides and one WNBA side.

**These keys are written into D1.** The archive therefore asserts a college
football game was played by the Colorado Rapids. That is DO NOT INVENT at the
source, and strictly worse than the join it breaks: an unmatched row is a
missing fact, a substituted key is a false one.

`San José St → sanjosest` is correctly NOT flagged — accent folding, not
substitution. The distinction is the check's whole job.

## Why this blocks the matcher

The parent CC-CMD's remaining work is a pair matcher. Six of eighty pairs have a
side whose key names a different team in a different sport. A matcher that
"succeeds" on `coloradorapids|weberst` would write MLS odds onto a college
football game — a worse outcome than the zero coverage it replaced, and the
exact failure the parent CC-CMD's own gate section warns about.

## Tasks

0. **Probe the blast radius, not just CFB.** `resolveTeamKey` is imported in
   `src/index.js:105` and used by the odds join, the archive writers and
   `wp-resolver.js`. Run `/identity/mismatches` across every sport in
   `ARCHIVE_SPORT_TO_ODDS_KEY` and record `key_substituted` per sport. **The
   artifact is a committed response per sport**, with the totals. Six in one CFB
   slate is a lower bound on one day of one sport; NFL (`Houston Texans` vs
   `Houston Dynamo`), NBA and NHL share city names with MLS sides too.

1. **Count the rows already written.** `SELECT sport, home, away FROM
   regular_season_games` where a resolved key is not derived from its own name.
   **The artifact is that count by sport.** It decides whether this is a
   forward-only fix or also a backfill — and the backfill is a live D1 mutation,
   which is the user's call, not this CC-CMD's (see "Out of scope").

2. **Make the resolver sport-aware, or make the alias map refuse to guess.**
   Two candidate shapes, and the choice needs Task 0's numbers:
   - thread `sport` through `resolveTeamKey` and scope `CANONICAL_TEAM` by it;
   - or drop the bare city aliases so `Colorado` resolves to `colorado` and only
     an exact full-name alias (`Colorado Rapids`) maps to the club.
   The second is smaller and cannot mis-scope, but changes keys for MLS rows
   that currently resolve via the short form — which is why Task 0 comes first.
   **Do not add a fallback chain (Rule 76).**

3. **Read every caller before changing it (Rule 71, Rule 13).** `resolveTeamKey`
   is a shared identity function. List every call site and what each does with
   the key — a changed key silently re-partitions anything that groups by it.

4. **Mutation (Rule 90).** A city name that is both a college and a pro club
   must resolve differently per sport, and the check must go red if it does not.
   `Colorado` under CFB and `Colorado` under MLS is the enumerated pair.

5. **Done condition.** `/identity/mismatches` reports `key_substituted: 0` for
   every sport probed in Task 0, with the committed responses as the artifact.

6. **Outbox manifest** per Rule 67.

## Out of scope

- **Backfilling existing D1 rows.** A live mutation of archive rows is
  authorised case by case by the user and never wired to a cron by a session.
  Task 1 produces the count so that decision can be made; it does not make it.
- The pair matcher itself. That is the parent CC-CMD, and it resumes once
  `key_substituted` is 0.

## Not claimed

That six is the total. It is six in one sport on one day, found by a check that
did not exist this morning. Task 0 exists because the number is a lower bound.
