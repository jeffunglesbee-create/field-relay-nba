# CC Session — journalism-brief-history
**Date:** 2026-07-26/27
**Repo:** field-relay-nba
**HEAD at close:** cff1477

---

## Trigger

User-reported (screenshot, jubilant-bassoon client): `/journalism/brief/history`
returns 403 "Path not allowed" — genuinely not allowlisted (not a false
negative). The Journalism tab was stuck showing only the single latest brief,
with no way to browse past ones.

---

## Root cause

`/journalism/brief` (src/index.js, pre-existing) only ever reads
`FIELD_JOURNALISM` KV key `journalism:{dateKey}`, written by
`handleJournalismCycle` with `expirationTtl: 86400` (24h). KV can never hold
more than ~1 day of slate briefs by design — there was no route capable of
serving history because there was no durable multi-day read path wired up.

The durable copy already existed and needed no new write path: the same
cron tick (`handleJournalismCycle` step 6b) archives every slate brief to
`ARCHIVE_DB.briefs` (`brief_type='slate'`) — the exact table/columns
`findBriefs()` already reads for its `priorBrief` lookup (src/index.js
~line 6373-6385, `WHERE brief_type = 'slate' AND date < ?`).

---

## What shipped (commit `cff1477`)

New route in `src/index.js`, placed immediately before the existing
`/journalism/tonight' || '/journalism/brief'` block (order matters —
`/journalism/brief/history` must be checked before any prefix match on
`/journalism/brief`):

```
GET /journalism/brief/history?limit=N   (default 14, clamped 1-30)
```

Query:
```sql
SELECT date, brief_text, quality_score, word_count, model, source, created_at
FROM briefs WHERE brief_type = 'slate'
ORDER BY date DESC, created_at DESC LIMIT ?
```

Response shape:
```json
{
  "ok": true,
  "count": 3,
  "briefs": [
    {
      "date": "2026-07-26",
      "brief": "...",
      "proseScore": 124,
      "wordCount": 130,
      "model": "gemini-3.1-flash-lite",
      "source": "cron",
      "generatedAt": "2026-07-26 10:01:05"
    }
  ]
}
```

No new storage, no new write path, no new binding. Read-only against an
already-populated table. `Cache-Control: public,max-age=300`.

**Field-naming note (Rule 60):** `generatedAt` here is a SQLite UTC string
(`YYYY-MM-DD HH:MM:SS`, from `created_at DEFAULT (datetime('now'))`) — NOT
epoch milliseconds like `/journalism/brief`'s `generatedAt` (`Date.now()`).
Client consumers must parse accordingly; flagging so this isn't silently
assumed to be the same format as the KV-backed sibling route.

---

## Verification (live, verbatim)

```
$ probe_relay_route /journalism/brief/history?limit=3
HTTP 200, application/json, 3690 bytes
{"ok":true,"count":3,"briefs":[
  {"date":"2026-07-26","brief":"Jackson Koivun leads the 3M Open...","proseScore":139,"wordCount":195,"model":null,"source":"client","generatedAt":"2026-07-26 14:39:16"},
  {"date":"2026-07-26","brief":"Jackson Koivun claimed the 3M Open title...","proseScore":124,"wordCount":130,"model":"gemini-3.1-flash-lite","source":"cron","generatedAt":"2026-07-26 10:01:05"},
  {"date":"2026-07-25","brief":"Jackson Koivun leads the 3M Open at -20...","proseScore":108,"wordCount":209,"model":"gemini-3.1-flash-lite","source":"cron","generatedAt":"2026-07-25 10:01:14"}
]}
```

Real archived data returned, newest first, across two distinct dates —
this IS the done condition (a specific curl response with real content),
not a "looks right" claim.

**Deploy job:** success (structural probes + `Deploy to Cloudflare Workers`
step all green). The `verify` job failed only on the pre-existing Rule-90
staleness gate (rule-90 through rule-96 entries >14 days UNEXERCISED) —
same failure as every run since before this session, unrelated to this
change.

---

## Integration status (Rule 65)

- **RELAY CONTRACT:** `GET /journalism/brief/history?limit=N` → `{ok, count, briefs:[{date, brief, proseScore, wordCount, model, source, generatedAt}]}`. `generatedAt` is a SQLite datetime string, not epoch ms.
- **CLIENT CONSUMER:** UNTESTED — jubilant-bassoon does not yet call this endpoint. The Journalism tab UI change (wire up history browsing, fetch this route, render a list/paginator) is client-side work, out of scope for this relay-only session.
- **STATUS:** Relay side VERIFIED (live curl above). Client side STAGED.

**STAGED unblock criteria (Rule 74):** blocked by no client CC-CMD yet
written for jubilant-bassoon. Unblocks when a CC-CMD is authored there to
consume `/journalism/brief/history` in the Journalism tab. Verify with:
`curl https://field-relay-nba.jeffunglesbee.workers.dev/journalism/brief/history?limit=5`
and confirm the client renders a paginated/browsable list matching the
`briefs` array length.

---

## Carry-forwards

- Client-side CC-CMD (jubilant-bassoon) to wire the Journalism tab to this new endpoint — not written this session (relay-only scope).
- Rule-90/91/92/93/94/95/96 staleness gate — separate session, still pre-existing.
