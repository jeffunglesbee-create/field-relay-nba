# D1 reads behind the BSD join corrections of 2026-11-07

Read 2026-11-07 between 12:05Z and 13:05Z with the Cloudflare D1 query tool (read-only) against `field-archive`
(`cc49101c-0569-4d41-8e7a-be139cde4f26`). These are the figures the CC-CMD `docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md`
(Corrections under Status, Residual R1) cites. **Coverage (Rule 91):** table `regular_season_games` only; `postseason_games` was not read.
The BSD sports are `MLS, EPL, La Liga, Serie A, Bundesliga, Ligue 1`. Window: game dates from 2026-10-24 (15 days) unless a query says otherwise.

## 1. When were soccer rows created? (R1 a, a second batch)

```sql
SELECT substr(created_at,12,2) AS hh, COUNT(*) AS n, MIN(substr(created_at,1,10)) AS first_day, MAX(substr(created_at,1,10)) AS last_day
FROM regular_season_games
WHERE sport IN ('MLS','EPL','La Liga','Serie A','Bundesliga','Ligue 1')
  AND created_at >= '2026-10-24' AND date >= '2026-10-24' AND created_at >= substr(date,1,10)
GROUP BY hh ORDER BY hh
```

Result: one row, `hh = 10`, `n = 184`, first_day 2026-10-24, last_day 2026-11-07. **184 of 184 were created in UTC hour 10.** The filter
`created_at >= substr(date,1,10)` keeps rows created on or after their own game date, so it excludes the seeded rows of query 3 on purpose;
rows created earlier than their date by some other writer are not counted here. Minutes within the hour were not grouped; the days looked at
(2026-11-06, 11-07) show 10:00:29Z to 10:00:49Z.

## 2. What did the scheduled pass write on 2026-11-07?

```sql
SELECT source, substr(ts,1,16) AS minute, COUNT(*) AS n FROM change_log WHERE ts >= '2026-11-07T09:00:00' GROUP BY 1,2 ORDER BY 2,1
```
Result at 12:11Z: one row, `odds_api`, `2026-11-07T10:01`, 107. No `bsd_game_join` row.

```sql
SELECT substr(c.ts,1,16) AS minute, r.sport, r.date, COUNT(*) AS n FROM change_log c LEFT JOIN regular_season_games r ON r.id = c.game_id
WHERE c.source='bsd_game_join' AND c.ts >= '2026-11-06T22:00:00' GROUP BY 1,2,3 ORDER BY 1
```
Result: five rows, all `2026-11-07T00:30`, one each for Bundesliga, EPL, La Liga, Ligue 1, Serie A, game date 2026-11-06. Nothing later until the admin-route
pass at 12:24Z (`outbox/probe-bsd-join-today-2026-11-07T12-24-33-411Z.json`).

## 3. Unjoined rows that are old (R1 b, rows BSD does not match)

```sql
SELECT date, sport, COUNT(*) AS unjoined, MIN(created_at) AS created_min FROM regular_season_games
WHERE sport IN ('MLS','EPL','La Liga','Serie A','Bundesliga','Ligue 1') AND bsd_event_id IS NULL AND date >= '2026-10-24'
GROUP BY date, sport ORDER BY date
```
Result at 13:00Z:

| date | sport | unjoined | created_min |
|---|---|---|---|
| 2026-10-24 | MLS | 1 | 2026-06-30 17:13:22 |
| 2026-10-31 | MLS | 3 | 2026-06-30 17:13:21 |
| 2026-11-05 | MLS | 1 | 2026-07-06 13:49:45 |
| 2026-11-07 | Ligue 1 | 1 | 2026-11-07 10:00:39 (Auxerre v Paris FC; joined at 12:59Z after the alias, `outbox/probe-bsd-join-today-2026-11-07T12-59-07-433Z.json`) |

The first three are unjoined rows months old. Why BSD has no event for them was not read (a moved or cancelled fixture is the likely cause, UNVERIFIED).

## 4. 2026-11-07, joined or not

At 12:11Z: all 34 rows created 10:00Z unjoined (19 big-five, 15 MLS), 8 MLS rows seeded 2026-06-30 already carrying ids 5408 to 5415.
After the admin-route pass at 12:24Z: 41 of 42; after the alias and a second pass at 12:59Z: 42 of 42 (`outbox/probe-bsd-join-today-*.json`, both).

## 5. The markers (KV, not D1)

`outbox/probe-bsd-join-markers-2026-11-07T12-29-26-048Z.json`: 10 keys under `bsd-join`, each with its value and expiry.
`bsd-join:2026-11-07:2026-11-07` holds `{"written":0,"pending":0}` and expires 2026-11-08T12:45:30Z, 36 h after 00:45:30Z of the same day.
