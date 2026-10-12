# Claude Code Command — the third odds key, which no ratchet could see

**Date:** 2026-10-12
**Repos:** field-relay-nba and jubilant-bassoon (literals); field-laboratory (tripwire only)
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** A (defect) — a live credential in plaintext, and a guard that could not see it
**Status:** DONE 2026-10-12 for everything automatable. **One step is the owner's
and is NOT done: rotating the key at the provider.**

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
5. ❌ **The owner rotates the Starter-plan key at The Odds API and sets the new
   value in the Cloudflare `ODDS_API_KEY_FALLBACK` binding.** Until then the
   value in git history is live. There is no GitHub Actions copy of this one —
   only the Cloudflare binding — so unlike 2026-09-15 it is a single-store
   rotation.
