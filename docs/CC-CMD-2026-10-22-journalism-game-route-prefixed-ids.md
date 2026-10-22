# Claude Code Command — /journalism/game/{id} never finds the brief of an NHL, NBA or WC game the client asks for by its prefixed id

**Date:** 2026-10-22
**Repo:** field-relay-nba (consumer in jubilant-bassoon)
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** B (a consumer that always reads null)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** the adversarial review of the coverage-gaps fix
(`docs/CC-CMD-2026-10-22-ambient-capture-coverage-gaps.md`), Rule 87.4. It
predates that fix, which does not change it.

---

## What was measured (2026-10-22, about 19:05Z)

- The relay route (`src/index.js`, `if (pathname.startsWith('/journalism/game/'))`)
  builds its key as `brief:game:` + the path with every character outside
  `[a-zA-Z0-9_:-]` removed. It does not decode the path, and does not apply
  `stripKVIdPrefix`.
- Every writer of that KV key applies `stripKVIdPrefix`, so a V2 NHL brief for
  `nhl:2026020153` is stored at `brief:game:2026020153`.
- The client asks with the prefixed id, URL-encoded:
  `/journalism/game/${encodeURIComponent(gId)}` for NBA and NHL (jubilant-bassoon
  `src/legacy/field.js`, the `_nbaRelayBase` and `_nhlRelayBase` fetches) and
  for WC (`_wcRelayBase`).
- Through the relay self-probe:
  - `/journalism/game/nhl%3A2026020153` returns `{"brief":null}`. The `%` is
    stripped, so the key read is `brief:game:nhl3A2026020153`.
  - `/journalism/game/2026020153` returns the brief (650 bytes, Senators v
    Panthers).
  - D1 `briefs` holds `game_id = 'nhl:2026020153'`, so the brief exists.
- So these client fetches have read null since at least 2026-10-22. The
  briefs still reach the client by another path: the D1 copy read through
  `/context/game/{id}` (the review's refuters, three of three).

## TASK 0

1. List every client caller of `/journalism/game/` and the id form each sends
   (the four fetches above, plus `espnEventId` at the bottom of `field.js`).
2. For one recent NBA, NHL and WC id each, probe the route with the encoded
   prefixed id, the raw prefixed id and the bare id. Record the three answers.
3. Decide what the client does with the brief from this route, and whether it
   also has it from `/context/game`. If it does, the fix may be to stop the
   duplicate fetch instead.

## TASK 1 — the relay owns the contract (Rule 60)

- In the route: `decodeURIComponent` the segment, then `stripKVIdPrefix`, then
  the character filter. No client change is needed for that.
- A check that runs the real route for `nhl%3A<id>`, `nhl:<id>` and `<id>`
  against a fake KV holding `brief:game:<id>`: red before, green after, with a
  mutation that removes the strip.

## Done condition (Rule 90 artifacts)

1. TASK 0's three outputs committed here.
2. After deploy, `/journalism/game/nhl%3A<a recent NHL id>` returns a brief
   whose `sport` is `nhl` (relay self-probe output committed).
