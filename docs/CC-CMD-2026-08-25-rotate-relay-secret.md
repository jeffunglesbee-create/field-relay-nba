# CC-CMD-2026-08-25-rotate-relay-secret

**Filed:** 2026-08-25.
**Status:** OPEN — **steps 1 and 2 DONE 2026-10-13; step 3 is one dispatch.**
Run `.github/workflows/rotate-relay-secret.yml` with `confirm=ROTATE`. It needs
no credentials from a person: the runner generates the value, writes it
everywhere, proves it live and rolls back on any failure. A session's dispatch
of it was refused by the session's permission policy (secret-store write), so
the owner presses the button. Steps 4 and 5 follow its log. See
"2026-10-13 — what was done" at the end.

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
breakage risk: the gate then at line 3997 of `src/index.js` was

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
line 3997 of `src/index.js` as "the auth check". Parsed from HEAD 2026-08-25 — the same
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
   one, so nothing breaks mid-flight. `src/index.js` (27),
   `src/analytics-engine.js` (1), `workers/field-claude-proxy` (1), ~40
   `scripts/*.mjs`, 6 workflows — **115 sites here, and 9 more in
   jubilant-bassoon**, four of which are live code:
   `workers/field-claude-proxy/src/index.js:105` (an auth comparison),
   `retry_telemetry_probe.js:37`, `scripts/seed-mls-return-2026.py:17` and
   `scripts/seed-mls-tournaments-2026.py:21` (all POSTing to `/d1/execute`).
   Both repos must land before step 3, or rotation breaks whichever lags.

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


---

## 2026-10-13 — what was done

Session doc: `outbox/cc-session-2026-10-13-rotate-relay-secret.md`.

**A premise of this document was false, and step 1 as written would have been
an outage.** Step 1 makes every gate fail closed on an unset
`env.RELAY_SHARED_SECRET`. `scripts/worker-secret-names.sh` read the binding
**ABSENT on both Workers** (field-relay-nba 20 secrets, field-claude-proxy 4).
Nothing had noticed because every gate compared the literal and the two sites
that read the binding fell back to it. Both bindings were written first, at
06:36Z, from the Actions secret, which every passing gated CI call proves equal
to the literal; then re-read as PRESENT.

| step | state | commit / run |
|---|---|---|
| 1a bindings on both Workers | **DONE** | `199c02c`; sync runs 38357628677, 38357634319; re-read 38357685164 |
| 1b relay src + proxy read the binding, fail closed | **DONE, verified live** | `28203a2`; deploy 38358536700; probe 38358907878: 5/5 |
| 1c 44 scripts, 24 workflows | **DONE** | `17b966d` |
| siblings get the secret | **DONE** | `8329fc6`; distribute run 38359407131 |
| two probes that grepped source for the literal | **DONE** | `1e196d5` |
| 1d jubilant-bassoon's live code | **DONE** | jb `0dc9a6fd` |
| 2 retire `bootstrap-relay-secret.yml` | **DONE** | `d214ef1` |
| 3 rotate | **ONE DISPATCH** — `rotate-relay-secret.yml`, confirm=ROTATE | `7771486` |
| 4 redact docs/ and outbox/ | after 3 | 33 lines here, 4 in jubilant-bassoon |
| 5 ratchet to 0, new hash at 0 | after 3 | the rotation log prints the new value's SHA-256 |

**Two defects caught before they shipped:**
- `src/analytics-engine.js`'s `callProxy` is module-level and had no `env` in
  scope. ESLint `no-undef` flagged it; shipped, it would have thrown on every
  analytics proxy call. It now takes `env` from its six callers.
- `odds-budget-latency.yml` and `d1-returning-probe.yml` extracted the gate
  value from `src/index.js` with a grep, exactly as bootstrap did. With no
  literal left they would have stopped at "found 0". They read the Actions
  secret now.

**Guards added:** `check-relay-secret-gates.mjs` (in guards.yml; the helper run
on 7 cases, no literal gate or fallback; 5/5 mutations),
`probe-relay-secret-gates.sh` (the live done condition, free: the proxy half
uses an empty body, refused only after its relay check passes),
`worker-secret-names.sh` (8/8, 4/4 mutations), `rotate-relay-secret.sh` (6/6 dry-run paths, 6/6
mutations). `check-courier-sync-uses-secrets.mjs` follows the sync into the
shared script.

**The done condition, when step 3 runs:** the rotation log ends `ROTATED`, its
probe shows the new value accepted by both gates and the OLD value refused by
both (401 and 403), and `node scripts/check-exposed-secrets.mjs` reads
`RELAY_SHARED_SECRET: at most 0` after step 5.

## 2026-10-14 — step 1c was not complete; it is now

Two misses, both found by the daily read's dead-cron watch rather than by any
check on the conversion itself:

| miss | how it showed | fixed |
|---|---|---|
| `verify-pending-checks.yml`: the JavaScript `process.env.RELAY_SHARED_SECRET` written inside a Python heredoc | `NameError: name 'process' is not defined`, five scheduled runs red from 2026-10-13T14:00Z | `41dfb4b` |
| five scripts shipped as base64 blobs (`deploy.yml` verify job x4, `rule90-staleness-monitor.yml` x1) still sent the old literal | invisible: the ratchet hashed each blob as one token. Found by decoding every blob and matching the manifest hash | `84b3a40` |

The second would have broken on the rotation itself: all five would have been
refused the moment the old value stopped being current. They are verified live
on the Actions secret: deploy 38620645051's verify steps green (bridge probe
`PASS: brief_text populated for espn:401915415`), and rule90 run 38620611419
reading D1 (`RELAY_SHARED_SECRET: ***`, red for its usual `rule-98` reason).

`check-exposed-secrets.mjs` now decodes base64 in both repos (`84b3a40`,
jubilant-bassoon `d991edb9`); restoring the five literals reads 38 > 33. Every
base64 blob in all four repos was checked against every hash in all three
manifests: 12 blobs, 0 carriers after the fix. field-laboratory's own checker
(`scripts/exposed-secret-check.mjs`, a different implementation) does NOT
decode base64; it had 0 base64 carriers on 2026-10-14.

Step 3 (the dispatch) is unchanged and still the owner's. Nothing above
blocks it now.
