# Claude Code Command — the third odds key, which no ratchet could see

**Date:** 2026-10-12
**Repos:** field-relay-nba and jubilant-bassoon (literals); field-laboratory (tripwire only)
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** A (defect) — a live credential in plaintext, and a guard that could not see it
**Status:** **DONE** — exposure and rotation both. The rotation was REOPENED at
02:27Z when the probe found `env.ODDS_API_KEY_FALLBACK` **NOT SET**, the same
half-landed shape as 2026-09-15. The owner set it the same day; at 18:12Z the
probe read **VALID** (500 remaining) and the binding read **SECRET**, so it
survives deploys. See CLOSED below.

## There are three odds keys, and the project's own documents call all three
## "the Odds API key"

| key | state |
|---|---|
| Exhausted free-tier | Removed from source 2026-08-25 (`0607526`). Ratchet 0. Still in git history — not rewritten. Dead, so rotation buys nothing. |
| **Live 20K-plan** | **Rotated by the owner 2026-09-15.** Never a literal in any repo. |
| **Starter-plan** (`env.ODDS_API_KEY_FALLBACK`) | **Six plaintext copies across two repos until today. Never rotated.** |

Conflating them is why this survived. The carried-forward note *"The Odds API
key is still in git history in four repos; rotate at the provider"* is true of
the first and the third and false of the second, and it was repeated unchanged
for three weeks.

## The measurement

Hashing every 32-hex token in all four repos, 2026-10-12:

```
field-relay-nba   1  docs/CC-CMD-2026-06-16-odds-quota-audit.md
jubilant-bassoon  5  .coderabbit.yaml x1
                     docs/CC-CMD-2026-06-16-odds-quota-audit.md x1
                     outbox/cc-odds-audit-results.md x3
field-laboratory  0
field-playground  0
                  -
                  6  one distinct value, sha256 06e2d4f3752f87d3…
```

The value was never read to establish this — only hashed.

## Why no gate saw it

**A ratchet only knows the hashes it is given.** `check-exposed-secrets.mjs`
printed `PASS ODDS_API_KEY (exhausted free tier): at most 0 occurrence(s)` on
every run, in both repos, while six copies of a *different* odds key sat in
tracked files. Nobody had written the line, so the scanner was not wrong — it
was never asked.

Two near-misses worth keeping:

1. **The 2026-08-25 redaction pass walked past it.** In
   `jubilant-bassoon/outbox/cc-odds-audit-results.md` it replaced the free-tier
   key with `<redacted 2026-08-25 …>` on lines *adjacent* to these, and left
   these standing — because it was chasing one known value rather than scanning
   for credential-shaped tokens.
2. **`jubilant-bassoon/.coderabbit.yaml:26`** was a review instruction reading
   *"never hardcode the Starter key (&lt;the key&gt;)"*. An instruction against
   hardcoding a credential, with the credential in it. Structurally the same as
   commit `26c2507`, which shipped the literal-secret guard with the real
   exhausted key pasted twice into its own self-test fixture.

## What was done

1. **Declared** `06e2d4f3752f87d3…` at max **0** in
   `field-relay-nba/docs/exposed-secrets.sha256` and
   `jubilant-bassoon/docs/exposed-secrets.sha256`, and added it to
   `field-laboratory/docs/exposed-secrets.sha256`'s tripwire list (that file has
   no numeric max and no checker — it is a known-exposure list, by its own
   header).
2. **Mutation first, per Rule 90.** The relay entry was added at 0 **while all
   six literals were still present**, and the gate went red naming the file and
   count, exit 1. Only then were the literals redacted. A ratchet entry that has
   only ever passed proves nothing.
3. **Redacted all six** to `<redacted 2026-10-12 — see docs/exposed-secrets.sha256>`,
   following the 2026-08-25 convention. Both gates now pass at 0.
4. **Rewrote the key comment in `src/index.js`** to name **both stores** and the
   2026-09-15 sequencing, because naming one store is the defect that produced
   that day's outage.

## The 2026-09-15 rotation, reconstructed — because nothing else records it

Not a new measurement: this is what the committed artifacts already show,
written down here because no document carried it. There is no
`cc-session-2026-09-15-*.md`; the outbox has 09-14 and 09-16 and nothing for the
rotation day. Rule 67 asks for a session doc; this is three weeks late.

```
17:23Z  /odds/v4/sports -> 200, 86 sports      pre-rotation, healthy
19:16Z  GitHub Actions copy GOOD               run 35012664679, quota remaining 39534
20:10Z  /odds/v4/sports -> 401                 run 35017969042
20:22:30Z  probe: vendor 401, /health 200      Cloudflare secret still pre-rotation
20:26:20Z  probe: vendor 200                   Cloudflare secret good
```

Sources: `scripts/probe-relay-odds-key-live.mjs`,
`.github/workflows/relay-odds-key-live.yml`,
`outbox/relay-odds-key-live-20260915T202230Z.log`,
`outbox/relay-odds-key-live-20260915T202620Z.log`.

**~70 minutes with the two stores out of step; ~16 minutes of observed
worker-side 401.** Everything on `env.ODDS_API_KEY` was failing — AmbientDO
in-play capture, the WP resolver, closing-odds capture — while the nightly
backfill ran fine on the GitHub copy. Found by probe, not by anyone noticing.
The probe log's own verdict refuses to over-claim: *"a transient 401 and a fixed
one look identical from one green probe."*

## Stop conditions

- **Do not treat redaction as rotation.** The value is in git history in both
  repos and history was not rewritten. `field-laboratory`'s own manifest says
  it: *"Rotation is the only thing that ends it."*
- Do not rewrite git history to remove it. That breaks every clone and the
  repos have already decided against it twice.
- Do not lower either ratchet below 0 or add an exception for a docs file. A
  credential in a document is a credential.

## Done conditions

1. ✅ The hash declared in all three manifests, at 0 where there is a checker.
2. ✅ The gate proven able to fail on this hash — red with the literals present,
   green after redaction.
3. ✅ Zero occurrences across all four repos, by hash.
4. ✅ The source comment names both stores and the probe step.
5. ⚠️ **PARTLY.** The owner rotated the key at The Odds API on 2026-10-12 —
   that is done and it is what killed the exposed value. **The Cloudflare
   `ODDS_API_KEY_FALLBACK` binding is NOT set**, measured by run `38195821834`,
   so the new key is not reachable by the worker and the fallback path is a
   no-op. Single store —
   there is no GitHub Actions copy of this key — so unlike 2026-09-15 there was
   no second store to fall out of step. The value in both repos' git history is
   now dead, which is the only thing that ever ended it.

## THE ROTATION IS UNVERIFIED, and nothing in this repo can verify it

Stated plainly rather than closed over. `scripts/probe-relay-odds-key-live.mjs`
tests `env.ODDS_API_KEY` through `/odds/v4/sports`. **No script, workflow or
route touches `ODDS_API_KEY_FALLBACK` at all** — measured 2026-10-12:
`grep -rln ODDS_API_KEY_FALLBACK scripts/ .github/workflows/` returns nothing.

That is the same shape as the 2026-09-15 incident: a store nobody probed. There
it was the GitHub copy; here it is the fallback binding. The fallback only
engages when the primary returns 401 or 429, so it cannot be exercised
incidentally — it will first be used in anger, on the day the primary is
exhausted, which is the worst day to discover a bad value.

Two ways to close it, neither taken without approval:

1. **A fallback probe, 1-2 credits.** One vendor call using the fallback key,
   reporting status and `x-requests-remaining` only. A fresh Starter key should
   read near 500. This is the instrument that should have existed since the
   fallback was written.
2. **The dead-value check, 0 credits.** Send the PRE-rotation value and require
   a 401. A 401 is not billed, and it proves the rotation took effect at the
   provider rather than merely that a binding was set. Rejected for now: it
   needs a pipeline that reads a credential out of git history into a runner,
   and a credential that must never be printed is a poor thing to build a
   workflow around when option 1 answers the same question without it.

Until one runs, "rotated" rests on the owner's report, which is the correct
basis for an action only they can take — but it is not a measurement, and this
document does not record it as one.

## THE PROBE'S FIRST RUN — BINDING-ABSENT

Option 1 was built and it cost nothing, not the 1-2 credits estimated:
`check-odds-calls-guarded` caught the new call site and told me why a
`/v4/sports` call needs an `ODDS-FREE` note — the sports list is not billed,
which is why the primary-key probe already used it for validity.

`GET /debug/odds-fallback-key` (CI-gated, in the worker because the key is a
Cloudflare binding with no GitHub copy), run `38195821834`, 2026-10-12T02:27Z:

```
HTTP 200
key_present         : false
route verdict       : binding-absent
vendor status       : (no vendor call)
x-requests-remaining: (absent)

verdict: BINDING-ABSENT
```

**`env.ODDS_API_KEY_FALLBACK` is not set in the running worker.** No vendor call
was made, so this cost nothing at all.

### What that means, stated carefully

- The rotation reached **the provider** and **not the binding**. The same
  two-store half-landing as 2026-09-15, except there the lagging store caught up
  in 16 minutes and here it is simply empty.
- **The 401/429 retry cannot fire and has not been able to.** `_oddsFallbackKey`
  returns null; `oddsFetchWithFallback` retries only when the binding is set; and
  `ambient-do.js`'s `useFallback` is a truthiness check on the same value. With
  the binding unset the whole fallback path is a no-op.
- **When the primary hits its 20,000-credit month, there is no fallback.** The
  Starter plan's 500 credits are not reachable from the worker.
- **How long it has been unset is NOT established by this probe.** It says the
  binding is empty now. Whether the rotation emptied it or it was never set is a
  different question, and nothing on file answers it — which is itself the cost
  of the binding having had no probe until today.

BINDING-ABSENT was made its own verdict on purpose (Rule 99): an unset binding
and an invalid key look identical from the outside and have different fixes. The
probe exits non-zero on it, and the run is red.

### What closes it

The owner sets `ODDS_API_KEY_FALLBACK` in Cloudflare (Workers >
field-relay-nba > Settings > Variables, or `wrangler secret put
ODDS_API_KEY_FALLBACK`) to the key rotated on 2026-10-12, then the probe is
re-dispatched and must read `VALID` with an `x-requests-remaining` near 500.

## CLOSED — 2026-10-12T18:12Z

Two readings, because one could not tell the two dashboard types apart.

Run `38288967181` (18:09Z) and run `38289284222` (18:12Z), verbatim from
`outbox/odds-fallback-key-2026-10-12T18-12.log`:

```
  key_present        : true
  route verdict      : valid
  vendor status      : 200
  x-requests-remaining: 500
  x-requests-used    : 0
  x-requests-last    : 0
  verdict: VALID

=== binding type  utc=2026-10-12T18:12:01Z ===
  secrets listed     : 19
  control FIELD_MCP_SECRET : 1
  verdict: SECRET
```

**Why the second reading exists.** VALID proves the worker can read the key
now. It does not prove the key will still be there after the next deploy. A
dashboard variable of type Text and one of type Secret reach the worker under
the same name; `wrangler.toml` has no `keep_vars`, so `wrangler deploy` would
erase a Text one. A green VALID over a Text variable would have been this
morning's half-landed state again, deferred to the next push to `src/`.
`scripts/check-odds-fallback-binding-type.sh` reads names and types (never
values) from the Workers secrets API. Its control is `FIELD_MCP_SECRET`, put by
`deploy.yml` on every deploy and so a Secret by construction. Self-test 8/8,
five mutations caught 5/5. The fifth survived until a fixture with
`success:false` beside a full list was added.

**What this still does not prove**, and the probe's own COVERAGE line says so:
the 401/429 retry end to end. That needs the primary to fail, which nothing
here arranges, and arranging it would mean spending or breaking the live key.
