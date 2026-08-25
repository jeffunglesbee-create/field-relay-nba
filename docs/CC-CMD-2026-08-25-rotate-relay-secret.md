# CC-CMD-2026-08-25-rotate-relay-secret

**Filed:** 2026-08-25.
**Status:** OPEN — **the first step needs a human and cannot be automated from a
session.** Everything after it can.

## The measurement

`scripts/check-exposed-secrets.mjs`, first run 2026-08-25:

```
RELAY_SHARED_SECRET  114 occurrences across 70 files
  src/index.js                  27   (incl. the auth check at :3997)
  ~40 scripts/*.mjs              1 each
  6 workflows                    1–2 each
  ~20 docs/ and outbox/ files    1–6 each
  src/analytics-engine.js        1
  workers/field-claude-proxy     1
```

**This is worse than what was on record.** The exposure was described as "27 in
`src/index.js`, 1 in `analytics-engine.js`, 5 workflows, 8 docs" — a figure from
grepping `src/`. The scripts were never counted, and they are the part that
matters most: each reaches a credentialled write path — `POST /d1/execute` among
them — with the secret compiled in rather than read from the environment. The
credential travels with a clone of this repository.

## Why the code was NOT changed in the session that found this

Removing the literals without rotating first buys nothing. The value is in git
history either way, so the exposure is unchanged, and the change carries real
breakage risk: `src/index.js:3997` is

```js
request?.headers.get('X-FIELD-Relay') === '<literal>'
```

If that becomes `=== env.RELAY_SHARED_SECRET` and the binding is unset, the
comparison is against `undefined` and every relay self-call starts sending an
empty secret. There is an order, and getting it wrong is worse than waiting.

## The order

1. **Rotate.** Generate a new value. Set it on the worker:
   Cloudflare dashboard → Workers → `field-relay-nba` → Settings → Variables →
   `RELAY_SHARED_SECRET`, or `wrangler secret put RELAY_SHARED_SECRET`.
   **This step is a human's — it needs dashboard credentials no session holds,
   and the new value must never be typed into a chat or a file.**

2. **Add it as a GitHub Actions secret**, same name, so the six workflows and
   the ~40 scripts can read it.

3. **`src/index.js`, `src/analytics-engine.js`, `workers/field-claude-proxy`.**
   Replace all 29 literals with `env.RELAY_SHARED_SECRET`. The auth check at
   :3997 must ALSO refuse a request when the binding is unset — otherwise an
   unset binding turns the gate into `undefined === undefined` for a caller that
   sends no header at all. That is the one line where a missing config must fail
   closed, not open.

4. **The ~40 scripts.** `process.env.RELAY_SHARED_SECRET`, **with no default.**
   Copy the reasoning field-laboratory's `sport-vocabulary-check.mjs` already
   states verbatim: a default makes an unset secret indistinguishable from a set
   one until the relay rejects the request, and that rejection reads as "the
   probe failed" rather than "the credential is missing".

5. **The 6 workflows.** `${{ secrets.RELAY_SHARED_SECRET }}`, no `||` fallback —
   the same defect just removed from `odds-backfill.yml` for the Odds key.

6. **docs/ and outbox/.** Redact, do not rewrite history. These are historical
   records and the value in them is dead once step 1 lands.

7. **Lower the ratchet to 0** in `docs/exposed-secrets.sha256`, in the same
   commit as step 6, and add the NEW value's hash at 0 so it can never be
   committed.

## Done condition

Not "deploy succeeded". After step 7:

```
node scripts/check-exposed-secrets.mjs      # RELAY_SHARED_SECRET: at most 0
```

and a credentialled probe still works with the new value:

```
POST /d1/execute  {"sql":"SELECT 1 AS ok"}   # 200, results [{ok:1}]
```

and the OLD value is rejected:

```
POST /d1/execute with the old X-FIELD-Relay  # 401, not 200
```

All three outputs in the outbox manifest, verbatim. The third is the one that
proves the rotation actually happened rather than a second valid secret being
added beside the first.

## Note on the Odds API key

Handled separately and already done — `docs/exposed-secrets.sha256` line 1, count
0. `.github/workflows/update-odds-key.yml` was **deleted**: its only job was
`wrangler secret put ODDS_API_KEY` from a repo literal, under a step named "Set
ODDS_API_KEY to 20K plan key" that echoed "✅ ODDS_API_KEY updated to 20K plan
key" — while writing the exhausted free-tier key. One `workflow_dispatch` would
have replaced the working production key with a dead one and reported success.
