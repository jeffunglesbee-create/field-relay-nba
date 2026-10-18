# /bsd/events/by-date pages and caches (2026-10-18)

CC-CMD: `docs/CC-CMD-2026-10-18-bsd-by-date-offset-and-cache.md`.
HEAD went from `d01f9e8` to `10916f5`.

## Task 0: probe

- **`offset` was ignored.** `?date=2026-10-10&offset=50` returned `count` 211
  with `previous` null and `next` pointing at offset 50. That is page one, so
  events 51 to 211 were unreachable.
- **Nothing was cached.** The handler called `fetch` with no cache, and every
  call reached BSD.
- **Callers, all scripts:**
  - field-laboratory `capture-lineups-fixture.mjs`;
  - this repo's `bsd-api-probe.mjs`, `bsd-avgpos-diagnose.mjs` and
    `live-route-probe.mjs`;
  - jubilant-bassoon `lab-flow-event-rows.mjs`.

  None depends on an uncached answer. The two internal World Cup fetches in
  `src/index.js` (`/api/v2/events/?date_from=…&league_id=27`) call BSD
  directly, not this route, and are untouched.

## Commits

- **`b492e58`: the route change.**
  - `offset` and `limit` are forwarded, digits only.
  - `caches.default` is used, following the `/bsd/events/live` pattern
    (`X-Cache` HIT/MISS).
  - TTL is 25 s for today and later, because they carry live status, and 300 s
    for a past day, the TTL the route already advertised.
- **The deploy for `b492e58` was red** (run 39169228526) on "No absence-collapse
  site appears beyond the baseline". My new probe script read absent headers
  with `?? ''`. I had run the ratchet locally before writing that script, not
  after.
- **`10916f5`: the probe keeps a missing header null.** The cache predicate
  refuses a null header, and its mutation is now a missing header.
  - That commit touched only `scripts/`, which is outside the deploy's path
    filter, so the deploy was dispatched on main: run 39169419458, deploy and
    verify **green**.

## Done condition, on the deployed route

Run 39169712056, `outbox/bsd-by-date-paging-latest.json`:
- **Page two is new:** offset 0 returned 50 ids and offset 50 returned 50,
  with no overlap. `previous` is set on page two.
- **Edge cache:** an identical second request reads `X-Cache: HIT`.
- **TTL:** a past day reads `max-age=300` and today reads `max-age=25`.

`scripts/check-bsd-by-date-paging.mjs --self-test`: 3/3. Each predicate holds
on a good record and is caught on its own mutation.

## Integration state

- **Relay contract:** the same response shape. `offset` and `limit` are now
  honoured, and an `X-Cache` header is added.
- **Consumers:** scripts only; no client code reads this route.
- **Status: VERIFIED** on the deployed route.
