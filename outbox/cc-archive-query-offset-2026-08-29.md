# /archive/query could not be paged, and nothing said the page was short

**Date:** 2026-08-29
**Scope:** `src/index.js` — `/archive/query` handler only.

## The failure

`/archive/query` clamps `limit` to 50 (`Math.min(50, …)`) and had no `offset`.
Two consumers send a larger limit and receive 50 without being told:

- `field-laboratory/scripts/brief-join-capture.mjs:74` — `limit=100`
- `field-laboratory/scripts/jq-density-census.mjs:94` — `limit=100`

A capture run on 2026-08-29 over 2026-08-23..29 returned **exactly 50 briefs on
six of the seven dates**. Every per-type count taken from it — `game_recap` 192,
`game_live` 59, `bracket_delta` 1 — is a floor, not a total, and nothing in the
response distinguished a complete day from a truncated one. A 50-row response
was byte-identical whether the day held 50 briefs or 300.

The clamp is not the defect. The absence of a way past it, combined with a
response that could not report its own truncation, is.

## The change

Three additions, all additive — every existing consumer reads `results` and
passes its own limit, so none of them move:

| | |
|---|---|
| `offset` | query param, non-negative, default 0 |
| `total` | `COUNT(*)` under the **same** WHERE clause |
| `hasMore` | `offset + results.length < total` |

`hasMore` is explicit rather than left to the caller. `count === limit` is the
arithmetic a consumer would have to remember, and the capture that prompted this
did not do it for seven days running.

### The ORDER BY change is load-bearing

```sql
ORDER BY date DESC, created_at DESC, id ASC
```

`(date, created_at)` is not unique — the captured window holds 50 briefs sharing
one date, and `created_at` is second-granular. Without a total order, SQLite may
return tied rows in a different order on each page, and a pager then duplicates
some rows and skips others. Adding `id ASC` affects only rows that already tie,
so no consumer's ordering changes; it makes the previously-arbitrary tiebreak
deterministic, which is what paging requires.

## Cost

One extra D1 read per request. No cron calls this route — its callers are
jubilant-bassoon's archive panels (`field.js` 649, 11088, and the upset-loader
fallback) and field-laboratory's probe scripts, all request-scoped.

## Done condition

```
curl -s "$RELAY/archive/query?date=2026-08-29&limit=50&offset=0" \
  | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
      console.assert(typeof d.total === "number", "no total");
      console.assert(d.offset === 0, "no offset echo");
      console.log(d.count, "of", d.total, "hasMore", d.hasMore)'
```

The route is correct when `total` exceeds `count` on a date that has more than
50 briefs and `hasMore` is `true`, and when paging with `offset=50` returns rows
whose ids do not appear in the first page.
