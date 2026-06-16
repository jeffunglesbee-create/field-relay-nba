# Odds Layer — Schema Migration (2026-06-16)

D1 field-archive (cc49101c-0569-4d41-8e7a-be139cde4f26).

## Applied via Cloudflare MCP D1 query

```sql
ALTER TABLE regular_season_games ADD COLUMN opening_odds TEXT;
ALTER TABLE regular_season_games ADD COLUMN closing_odds TEXT;
ALTER TABLE postseason_games     ADD COLUMN opening_odds TEXT;
ALTER TABLE postseason_games     ADD COLUMN closing_odds TEXT;
```

Verification: `SELECT opening_odds, closing_odds FROM regular_season_games LIMIT 1;` returns `null/null` — columns present and unpopulated.

## JSON shape stored in opening_odds / closing_odds

```json
{
  "spread":    {"home": -3.5, "away": 3.5},
  "total":     {"over": 211.5, "under": 211.5},
  "moneyline": {"home": -180, "away": 155},
  "source":    "draftkings",
  "captured_at": "2026-06-15T20:00:00Z"
}
```

No index — odds columns read alongside game rows, never queried independently.

## Source

docs/CC-CMD-relay-3-odds-layer.md, COMMIT 1.
