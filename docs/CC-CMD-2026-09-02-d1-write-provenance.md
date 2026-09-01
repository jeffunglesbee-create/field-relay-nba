# CC-CMD-2026-09-02-d1-write-provenance

**Filed from:** field-laboratory.
**Ask to:** field-relay-nba — the D1 write paths.
**Relationship:** `CC-CMD-2026-09-01-mls-dual-writer-duplicate` Task 2, split out
per Rule 87 (4). That CC-CMD's Task 1 is DONE and eliminated explanation (2);
this one answers what Task 1 could not reach from outside.
**Status:** OPEN.

## What Task 1 established, and what it could not

A live writer INSERTs dash-scheme MLS rows (`2026-08-30-mls-stl-dal`) **the day
after the game they cover** — measured twice, a month apart, most recently
2026-08-31. `created_at` moving means an INSERT, not an update of a seeded row.

`grep` across `src/`, `.github/scripts/` and `scripts/` finds **no code that
constructs a dash-separated id**, so the writer is external to this repo by
elimination. Which door it comes through is not observable from outside, and
Task 1 deliberately refused to infer it from the id shape.

## Probe block (Rule 87 §1) — read from HEAD, not memory

| fact | HEAD |
|---|---|
| the analytics binding | `JQ_ANALYTICS` → dataset `field_jq_analytics`, `wrangler.toml:138-140` |
| the established call shape | `env.JQ_ANALYTICS.writeDataPoint({ indexes, blobs, doubles })`, `src/index.js:8660`, inside `try { if (env.JQ_ANALYTICS) … }` |
| the arbitrary-SQL route | `pathname === '/d1/execute' && request.method === 'POST'`, `src/index.js:14061` |
| its method-gate exemption | `src/index.js:12533` |

`/d1/execute` was at `14023` when the sibling CC-CMD was written and is at
`14061` now. The sha moved; the route did not. **Re-read both line numbers
before editing** — this table is a measurement with a date on it, not a fact.

## The central requirement: a positive control, first

"No log entries in 48 hours" and "the logging never worked" produce **identical
output**. That is the defect this project keeps finding, and a provenance probe
is the easiest possible place to commit it: the thing being watched fires about
once a day, at an unpredictable time, so a silent instrument looks exactly like
a quiet system for as long as anyone is willing to wait.

**So the control comes first and gates everything after it.** A write issued
deliberately through each instrumented path must produce exactly one entry
naming that path. Until that passes, no observation window has started and a
null result means nothing.

## Instrument every non-SELECT path, not only `/d1/execute`

`/d1/execute` is the leading candidate and is **not** the whole surface.
`ARCHIVE_DB.prepare` appears 191 times in `src/index.js`; a single-line regex
finds only one non-SELECT among them because the statements are multi-line
template literals, so **the write-path enumeration is a task here, not a
premise**.

If only the suspected door is watched, a null result cannot distinguish "nothing
wrote" from "it came through a door nobody was watching" — which is the same
two-states-collapsed failure as above, one level up.

## Security constraints — non-negotiable

1. **Never log the credential.** `/d1/execute` is gated by a value carried in the
   request. Do not log that header, any header whose name matches
   `/auth|secret|token|key/i`, or the raw header bag.
2. **Never log statement text.** Log the leading verb and the target table,
   parsed out — never the SQL, which can carry row data.
3. **Never log a full IP.** `cf-connecting-ip` identifies a person or a machine;
   the ASN and country answer "which system" without that. If an operator later
   needs the IP, they have Cloudflare's own logs.
4. **Do not open a public issue** naming the auth weakness on `/d1/execute`. This
   repo is public. The finding belongs in this document and in the outbox.

## The change

At each write path, one guarded call following the `8660` convention:

```js
try {
  if (env.JQ_ANALYTICS) {
    env.JQ_ANALYTICS.writeDataPoint({
      indexes: ['d1-write'],
      blobs: [route, verb, table, ua.slice(0, 64), country, String(asn)],
      doubles: [1],
    });
  }
} catch (_) { /* Rule 5: telemetry must never break a primary function */ }
```

Wrapped and swallowing, because an archive or telemetry failure must never break
journalism, score fan-out or MCP.

### Scope boundary (Rule 69)

Add the call and the helper that derives `verb`/`table` from a statement. Change
no route's behaviour, no response shape, no binding in `wrangler.toml`, and no
existing `writeDataPoint` call.

## Done condition (Rule 87 §2, Rule 89) — three states, not two

**Gate — the control.** POST one harmless statement through each instrumented
path and assert **exactly one** entry per path, carrying that route's name.
Artifact: the query output, pasted verbatim. If any path is silent, **STOP**:
the instrument is broken and nothing downstream means anything.

**Then, one of three outcomes, and the middle one is not a pass:**

| outcome | reading |
|---|---|
| an entry for a dash-scheme INSERT, with UA/ASN | Task 2 answered — the caller is named |
| control passes, no dash entry in 48h spanning ≥1 day-after-game window | **NOT OBSERVED.** Neither a pass nor a failure. Extend the window or widen the enumeration; do not close. |
| control fails | the instrument is broken. Fix it; the window has not started. |

"48 hours" is chosen because the two observed writes landed the day after a
game, and the window must contain at least one such day. A window with no game
in it proves nothing and must not be counted.

## Reading the data needs a credential this session does not hold

The Analytics Engine SQL API is account-scoped. Writing the data is in scope
here; **querying it is the operator's step**, and this is stated rather than
discovered later:

- **Staged:** the caller's identity.
- **Blocked by:** an account-scoped AE read, which no session credential covers.
- **Unblocked when:** an operator queries `field_jq_analytics` for
  `index1 = 'd1-write'` over the window.
- **Verify:** the control entries appear first; a dash-scheme INSERT entry names
  a UA and ASN.

Everything the session can do — the instrumentation, the control write, the
control assertion — happens inside the session (Rule 87 §3). Nothing here is a
carry-forward disguised as a dependency.

## Tasks

1. **Enumerate** every path that can issue a non-SELECT against `ARCHIVE_DB` or
   any D1 binding. Multi-line template literals defeat a single-line grep;
   confirm the count by reading, and record it. This is a task because 191
   `prepare` calls is not an enumeration.
2. Add the provenance call to every one of them, under the security constraints.
3. Deploy, then run the control against each path and paste the query output.
4. **Only if the control passes**, open the 48-hour window and report one of the
   three outcomes above. Do not report a null result without the control output
   beside it.
5. Outbox manifest last: commit hash, deploy run id, control output verbatim,
   window outcome, and the enumeration from Task 1.

## What this does NOT do

It does not fix the duplicates. The 51 MLS pairs remain, and the numeric-id key
(`d253209`) does not merge them because one row of each pair carries no
`source_id`. A single upsert key both writers can agree on is the sibling
CC-CMD's Task 3, and it cannot be designed until the second writer has a name.
