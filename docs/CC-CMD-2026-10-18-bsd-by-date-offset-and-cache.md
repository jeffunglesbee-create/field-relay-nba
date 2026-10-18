# Claude Code Command — `/bsd/events/by-date` cannot page, and nothing caches it

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba
**Confidence gate:** >= 95 before any commit
**Filed:** 2026-10-18 by CC, from field-laboratory's metrics-tab work (Rule 87.4)
**Status:** DONE 2026-10-18. `b492e58` + `10916f5`, deploy run 39169419458, done condition verified by run 39169712056. Session doc: `outbox/cc-session-2026-10-18-bsd-by-date.md`.

## Measured 2026-10-18

- **`offset` is ignored.** `/bsd/events/by-date?date=2026-10-10&offset=50`
  returned `count` 211 with `previous` null and `next` pointing at `offset=50`.
  That is page one. The handler builds the BSD query from `date`, `league_id`
  and `season` only.
- **Nothing is cached.** The handler calls `fetch` with no `cf` cache options,
  so every request reaches BSD. Its response header `Cache-Control: max-age=300`
  is for the client.
- **Consequence:** on a day with more than 50 events, events 51 and later are
  unreachable through the relay, unless the caller narrows the query with
  `league_id`. Bundesliga 213708 on 2026-10-10 (211 events) was found only that
  way.

## Tasks

0. Probe: hit the route for 2026-10-10 with `offset=0` and `offset=50` and
   compare the ids returned. Grep for every caller of `/bsd/events/by-date`.
1. Pass `offset` and `limit` through to BSD. The `next` link already names
   them.
2. Cache the BSD fetch at the edge, following the pattern this file uses for
   the other BSD read routes (Rule 78: grep it, replicate it exactly).

## Done condition

`offset=50` returns ids disjoint from `offset=0`, with `previous` non-null. A
second identical request within the TTL is served from cache, shown by
`cf-cache-status: HIT` or by the route's own cache header.
