# CC-CMD — /context/game caches a partial answer for five minutes

**Date:** 2026-10-20
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** CC, from the adversarial review of jubilant-bassoon
`docs/CC-CMD-2026-10-20-debrief-cache-outlives-archive-repair.md` (Rule 87.4:
found there; this repo owns it).

---

## What was read (2026-10-20, `src/index.js` at `7829082c`)

In the `/context/game/{id}` handler, `findGame` and the four fan-out lookups
(`findBriefs`, `findSeries`, `findEnrichment`, `findBracketDelta`) are each
settled. A rejection becomes `null` for that section plus an `_errors` entry
(`_errors.push({ source: 'game', ... })` and so on). The response is still
`ok: true` with HTTP 200.

That body is then cached like any other:

- `env.FIELD_JOURNALISM.put(cacheKey, body, { expirationTtl: isFinal ? 300 : 60 })`,
  with no condition on `_errors`;
- `'Cache-Control': \`public,max-age=${isFinal ? 300 : 60}\``.

So one transient D1 failure on a final game's briefs is served from KV to every
client for 300 s, and each browser keeps it for up to another 300 s. A failure
of `findGame` gives `game: null`, so `isFinal` is false and the window is 60 s.

**The client side is handled.** jubilant-bassoon now treats a body carrying
`_errors` as a partial answer. It never persists one to the field-debriefs
Cache API, and never lets one replace a cached copy. A browser with nothing
cached still renders it for that session. The relay's KV copy still decides
what every other cold reader sees.

**Not measured:** how often `_errors` occurs. Nothing counts it today.

## TASK 0 — premises, one command each (Rule 100)

1. Read the handler and confirm the put and the header are unconditional at
   current HEAD (`git log --oneline -5` first, Rule 79).
2. Is anything else reading `ctx:{id}` from KV and relying on partial bodies
   being cached? `grep -n "ctx:" src/*.js`.
3. A count: add nothing yet. Read the worker's own logs or Analytics Engine for
   `[CONTEXT-GAME]` lines over 7 days, if they exist, and record the rate.

## TASK 1 — do not cache a partial answer (owner decision on the window)

- (a) Skip the KV put when `_errors` is non-empty, and send `Cache-Control:
  no-store` on such a response.
- (b) Cache it, but for at most 10 s, so a burst of readers during an outage
  does not hammer D1.

Proof: a test of the handler with a rejecting `findBriefs`. It asserts no KV
put under (a), or a TTL of at most 10 under (b), plus the header. Red at HEAD,
green after, with a Rule 90 mutation.

## Done condition (Rule 89 artifacts)

1. TASK 0's outputs committed.
2. The handler test red before and green after, with its mutation, in a
   committed log.
3. One green Deploy RELAY Worker run, and a self-probe of one final game's
   `/context/game` showing the unchanged 200 body for the healthy case.

## FORBIDDEN

- No change to the response body's fields (Rule 60 and Rule 70: jubilant-bassoon
  reads `_errors` as the partial marker).
