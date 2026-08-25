# CC-CMD-2026-08-25-rotate-relay-secret

**Filed:** 2026-08-25.
**Status:** OPEN. Steps 1, 2, 4 and 5 are automatable. **Step 3 — the rotation
itself — needs a human with Cloudflare and GitHub credentials.**

Corrected 2026-08-25 after checking HEAD: an earlier version of this document
claimed the Actions secret still had to be created and named one auth gate.
Both were wrong. See "What is ALREADY done" below.

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

**This reasoning was WRONG and is kept only to be corrected.** It said: removing
the literals without rotating first buys nothing. The value is in git
history either way, so the exposure is unchanged, and the change carries real
breakage risk: `src/index.js:3997` is

```js
request?.headers.get('X-FIELD-Relay') === '<literal>'
```

If that becomes `=== env.RELAY_SHARED_SECRET` and the binding is unset, the
comparison is against `undefined` and every relay self-call starts sending an
empty secret. There is an order, and getting it wrong is worse than waiting.

## What is ALREADY done — corrected 2026-08-25, after checking the repo

The first version of this document was written from a session summary rather
than from HEAD, and got two things wrong. Both are corrected here.

**The distribution problem is solved.** Relay `d540e99` (2026-08-24) built it:

- `.github/workflows/bootstrap-relay-secret.yml` writes `RELAY_SHARED_SECRET`
  into this repository's own Actions secrets.
- `deploy.yml`'s BOOTSTRAP step forwards it to field-laboratory.
- `.github/workflows/sync-secret-to-worker.yml` pushes a GH Actions secret to
  the Cloudflare Worker binding — the path to the worker already exists and does
  not need building.
- field-laboratory's `sport-vocabulary-check.mjs` already reads
  `process.env.RELAY_SHARED_SECRET` **with no fallback.**

So "add it as a GitHub Actions secret" is not a step. It is done.

**There are ELEVEN inbound gates, not one.** The first version named
`src/index.js:3997` as "the auth check". Parsed from HEAD 2026-08-25 — the same
mistake as this session's other CC-CMD, which said "21 of 22 entries" from an
estimate:

```
3997   === '<literal>'      (the only === form)
13496  !== '<literal>'
13944  14734  14758  14778  14807  14833   !==
15012  15076   !== , via request.headers.get()
```

Plus ~13 OUTBOUND self-call headers, 3 comments, and one site (9282) that
already reads `env.RELAY_SHARED_SECRET || '<literal>'`.

## THE ORDERING HAZARD, and it reverses the obvious order

`bootstrap-relay-secret.yml` derives the secret **from `src/index.js`**:

```bash
mapfile -t FOUND < <(grep -ao "X-FIELD-Relay') !== '[^']*'" src/index.js \
  | sed "s/.*!== '//; s/'$//" | sort -u)
```

It requires exactly one distinct literal, which is good discipline — and it
means **rotating in Cloudflare first and then dispatching bootstrap would
overwrite the new Actions secret with the OLD source literal.**

That is the same shape as `.github/workflows/update-odds-key.yml`, deleted on
2026-08-25 for doing exactly this to `ODDS_API_KEY`: a workflow that writes a
credential from a repo literal, under a name that says it is installing the
current one.

It is dispatch-only, so it will not fire on its own. It is still a loaded gun
pointed at the rotation this document exists to sequence.

## The order

1. **Replace the literals in source FIRST**, while the value is still the live
   one, so nothing breaks mid-flight. `src/index.js` (27), `src/analytics-engine.js`
   (1), `workers/field-claude-proxy` (1), ~40 `scripts/*.mjs`, 6 workflows.

   - The eleven inbound gates read `env.RELAY_SHARED_SECRET` and must **fail
     closed** when the binding is unset. An unset binding otherwise turns
     `header !== undefined` into a gate that rejects everyone (safe) — but
     `3997`'s `===` form turns into `undefined === undefined` for a caller
     sending no header at all, which is open. That one line is the one that
     matters.
   - Scripts use `process.env.RELAY_SHARED_SECRET` **with no default**, the way
     `sport-vocabulary-check.mjs` already does.
   - Workflows use `${{ secrets.RELAY_SHARED_SECRET }}` with no `||` fallback.

2. **Retire `bootstrap-relay-secret.yml`.** After step 1 there is no literal in
   `src/index.js` for it to extract, so it is dead — and leaving a workflow that
   writes a credential from source is the pattern just deleted for the Odds key.

3. **Rotate.** Generate a new value. Set the GitHub Actions secret, then
   dispatch `sync-secret-to-worker.yml` with `RELAY_SHARED_SECRET` to push it to
   the Worker binding. **This step is a human's — it needs credentials no
   session holds, and the new value must never be typed into a chat or a file.**

4. **docs/ and outbox/.** Redact, do not rewrite history. These are historical
   records and the value in them is dead once step 3 lands.

5. **Lower the ratchet to 0** in `docs/exposed-secrets.sha256`, in the same
   commit as step 4, and add the NEW value's hash at 0 so it can never be
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


---

## Correction to this document's own premise

The paragraph above ("Why the code was NOT changed") argued for rotate-first.
Checking `bootstrap-relay-secret.yml` reversed it: that workflow extracts the
secret from `src/index.js`, so rotating before the source is cleaned leaves a
dispatchable job that reinstalls the old value.

Source-first is also the safer half on its own merits. While the value is
unchanged, replacing a literal with a binding that holds the same value is a
no-op at runtime — every gate and every self-call keeps working, and the change
can be verified against a live relay before anything rotates. Rotate-first makes
every one of those 114 sites wrong simultaneously.
