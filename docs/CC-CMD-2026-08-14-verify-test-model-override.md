# CC-CMD — Does X-FIELD-Test-Model actually override the proxy's routing?

**Date:** 2026-08-14
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

```bash
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git log --oneline -5
```

---

## CONTEXT — an observation that cannot currently be interpreted

`scripts/jlayer-model-probe.mjs` (2026-08-14, two runs) sent
`X-FIELD-Test-Model: claude-haiku-4-5-20251001` and got back
`X-FIELD-Model: gemini-3.1-flash-lite` — the override appeared to do nothing.

**Do not treat that as a finding.** The probe cannot support it. All three calls in
each run sent an **identical body**, and the forced-haiku call returned in 29ms /
45ms versus 874–3908ms for the others. A cache hit explains the observation exactly
as well as an ignored header, and the probe has no way to separate them.

The `X-FIELD-Test-Model` request header is real — it is sent by this repo at
`src/index.js` (grep it). Whether the proxy honors it determines whether this repo
has a supported way to pin a model for any future A/B of the J-layer. Right now that
capability is **unknown**, which is worse than known-absent.

## PRE-BUILD PROBE BLOCK — read, do not assume

```bash
grep -n "X-FIELD-Test-Model" src/index.js
grep -rn "X-FIELD-Model\|X-FIELD-Gemini-Error" src/*.js
sed -n '1,40p' outbox/jlayer-model-probe-20260814T013504Z.log
```

Note the proxy worker (`field-claude-proxy`) source is **not in this repo**. Do not
claim anything about its internals that you have not observed over the wire.

## TASK 1 — Make the probe able to answer the question

Modify `scripts/jlayer-model-probe.mjs` so each call sends a **unique prompt**
(e.g. include the call label and the run timestamp in the message text). This is the
whole fix: identical bodies are what make the cache hypothesis unfalsifiable.

Add a paired call at the end: same unique prompt sent twice, once with
`X-FIELD-Test-Model: claude-haiku-4-5-20251001` and once without. Keep
`max_tokens: 32` — Rule 78, this is real inference.

Scope boundary: do NOT change `src/index.js`. This CC-CMD only measures.

## TASK 2 — Run it on a runner and read the result

```bash
# sandbox 403s *.workers.dev; dispatch archive-gap-probe.yml with
# script=jlayer-model-probe.mjs and read the committed outbox log
```

## DONE CONDITION — one of these three, stated explicitly in the outbox

With unique prompts (so cache is excluded) the paired call resolves to exactly one of:

- **A — override works:** the `X-FIELD-Test-Model` call returns
  `X-FIELD-Model: claude-haiku-4-5-20251001` while its unforced twin returns
  `gemini-3.1-flash-lite`. → Record it in CLAUDE.md's Journalism Model section as a
  supported, verified capability, with the date and method (Rule 73).
- **B — override is ignored:** both return `gemini-3.1-flash-lite` with latencies in
  the same range as the unforced calls (i.e. not a cache hit). → The header is dead
  weight in this repo. Write a follow-up CC-CMD to either remove the send sites or
  raise it against the proxy worker; do NOT silently delete them under this one.
- **C — still ambiguous:** latencies still show one call returning implausibly fast.
  → Say so plainly and state what third measurement would separate them. Do not pick
  A or B to close the ticket.

The artifact is the committed `outbox/jlayer-model-probe-*.log` showing the paired
call's two `X-FIELD-Model` values and both wall latencies. "Confirmed the override"
without those two lines quoted is a Rule 89 violation.

## TASK 3 — Outbox manifest

`outbox/cc-session-2026-08-14-test-model-override.md`: commit hash, dispatch run id,
the quoted done-condition lines, which of A/B/C, and a confidence gate.
