# CC-CMD-2026-08-02-shared-schedule-ai-cache-relay

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-02-shared-schedule-ai-cache-relay.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## The real gap

`jubilant-bassoon`'s `fetchDateSchedule(iso)` calls `CLAUDE_PROXY_URL`
directly for any date not covered by the free ESPN fixtures sweep
(tennis, rugby, cricket, and NFL/CFB until today's separate fix). Its
own cache (`getCached`/`setCached`) uses `sessionStorage` — confirmed
directly, per-browser-tab only, never shared across users. Every
different visitor to the same date pays for a fresh, full-price AI
call, even seconds after another visitor already generated the exact
same result.

This relay already proves the fix pattern works: `v2:golf:scoreboard:
r3:{date}` is a real, globally-shared KV cache keyed by date alone
(`handleESPNGolfScoreboard`, confirmed in current source). This
CC-CMD applies the same shape to the AI schedule path.

## Task 1 — Re-verify from HEAD before writing anything (Rule 87)

- Read `fetchDateSchedule`'s real, current prompt text and schema in
  jubilant-bassoon fresh (pull that repo, don't work from this doc's
  memory of it) — the relay's new route must send the exact same
  prompt, not a re-derived approximation. A different prompt could
  produce a different, worse, or differently-shaped result than what
  the client currently gets.
- Confirm the real current model/max_tokens (`claude-haiku-4-5-20251001`,
  800 tokens per this doc's reading of HEAD at write time — re-verify).
- Confirm `FIELD_JOURNALISM` KV is the right namespace to reuse (matching
  golf's own pattern) rather than a new one.

## Task 2 — New relay route, real shared cache

Add a route (e.g. `GET /schedule/ai-fallback?date=YYYY-MM-DD`):
- Check `schedule:ai:{date}` in `FIELD_JOURNALISM` KV first. Cache hit
  → return immediately, zero AI call.
- Cache miss → call the AI proxy itself, server-to-server (same
  `X-FIELD-Relay` auth pattern this relay already uses elsewhere for
  server-to-server proxy calls — reuse the existing pattern, don't
  invent a new auth path), using the exact real prompt/schema from
  Task 1.
- On success, cache the real result with a real, reasoned TTL — a
  past or near-term date's schedule is stable once real games are
  confirmed; consider whether TTL should differ for a far-future date
  that might still be provisional (state the real reasoning, don't
  pick a number arbitrarily).
- On AI failure, return the same `{ok:false, reason}` contract the
  client's existing `fetchDateSchedule` already expects (re-verify
  this exact shape from HEAD, per Task 1) — the client-side migration
  in the paired CC-CMD depends on this contract matching exactly.

## Task 3 — Smoke + real verification

- Real verification: call the new route twice for the same real date
  — confirm the second call is genuinely cached (fast, no new AI
  spend) the same way the LaLiga/Bundesliga caching work proved this
  pattern earlier today (real timing evidence, not assumed).
- Confirm this repo's real current quality gate passes.

---

## Explicitly NOT in scope

- Do not touch `handleESPNGolfScoreboard` or any other existing cache.
- Do not modify jubilant-bassoon — that's the separate, dependent
  CC-CMD, which needs this route live first.

---

## Outbox

`outbox/cc-session-2026-08-02-shared-schedule-ai-cache-relay.md`: the
real route shipped, and real before/after timing proof of a genuine
cache hit on the second call for the same date.
