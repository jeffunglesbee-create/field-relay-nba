# CC session — 2026-10-12 — the third odds key

**Document:** `docs/CC-CMD-2026-10-12-starter-key-exposure.md` — DONE for
everything automatable. One step is the owner's and is open.

## What triggered it

The user asked when the odds key was rotated. Browsing the session said it never
was; the repo said 2026-09-15. Both were answering about different keys.

## There are three, and every document calls all three "the Odds API key"

| key | state |
|---|---|
| Exhausted free-tier | Removed from source 2026-08-25 (`0607526`), ratchet 0, still in git history. Dead. |
| **Live 20K-plan** | **Rotated by the owner 2026-09-15.** Never a literal anywhere. |
| **Starter-plan** (`env.ODDS_API_KEY_FALLBACK`) | **Six plaintext copies, two repos, until today. Never rotated.** |

## The measurement

Hashing every 32-hex token in all four repos. The value was never read.

```
before:  field-relay-nba 1   jubilant-bassoon 5   field-laboratory 0   field-playground 0   = 6
after:   0  0  0  0  = 0
```

One distinct value, sha256 `06e2d4f3752f87d3…`.

## Why no gate saw it

**A ratchet only knows the hashes it is given.** Both repos' scanners printed
`PASS ODDS_API_KEY (exhausted free tier): at most 0 occurrence(s)` on every run
while six copies of a different odds key sat in tracked files. The scanner was
not wrong — nobody had written the line.

Two near-misses:

1. The 2026-08-25 redaction pass replaced the free-tier key on lines **adjacent**
   to these in `jubilant-bassoon/outbox/cc-odds-audit-results.md` and left these
   standing. It chased one known value rather than credential-shaped tokens.
2. `jubilant-bassoon/.coderabbit.yaml:26` was a review instruction reading *"never
   hardcode the Starter key (&lt;the key&gt;)"*. Same shape as commit `26c2507`,
   which shipped the literal-secret guard with the real key in its own fixture.

## Both gates proven able to fail, separately

The two checkers are **different programs** — `sha256 9ed9c5c4…` vs `3893e783…` —
so one repo's mutation does not transfer.

| repo | how it was proven |
|---|---|
| field-relay-nba | entry added at 0 **with all six literals still present** → red, named the file and count, exit 1 → then redacted → green |
| jubilant-bassoon | a **throwaway** `deadbeef`-style token planted in a temp file, its hash declared at 0 → red, exit 1, named the file → both removed |

The second used a throwaway deliberately: proving the detection path does not
require rewriting a credential into the tree. The probe also found its token in
`scripts/check-no-literal-secret-writes.mjs`, which uses the same string as its
own fixture — three occurrences found, which is the scanner reaching everywhere
it claims to.

## The 2026-09-15 rotation, written down because nothing else did

No `cc-session-2026-09-15-*.md` exists — the outbox has 09-14 and 09-16. The
rotation lived only in a workflow header, two probe scripts and two probe logs.
Reconstructed into the CC-CMD from those artifacts:

```
17:23Z  /odds/v4/sports -> 200, 86 sports   pre-rotation
19:16Z  GitHub Actions copy GOOD            run 35012664679
20:10Z  /odds/v4/sports -> 401              run 35017969042
20:22:30Z  probe: vendor 401, /health 200   worker secret still old
20:26:20Z  probe: vendor 200                worker secret good
```

~70 minutes with the two stores out of step, ~16 of observed worker-side 401.
`src/index.js`'s key comment named **one** store; it now names both, with the
probe as step 3.

## Verified

| thing | state |
|---|---|
| 6 → 0 literals, by hash, four repos | **VERIFIED** |
| relay gate red then green on the real literals | **VERIFIED** — exit 1, then 0 |
| jubilant-bassoon gate red on a declared hash | **VERIFIED** — throwaway, exit 1 |
| all three manifests carry the hash | **VERIFIED** |
| CI | **VERIFIED** — relay `8811a38` guards + deploy success; jubilant-bassoon `6380d41` smoke + both viewport audits success; field-laboratory `1571220` guards success |
| **the key rotated at the provider** | **NOT DONE — the owner's step** |

## Manifest

| | |
|---|---|
| relay: declare + redact + CC-CMD | `c1f9bf8` → pushed as `8811a38` |
| relay: the comment names both stores | `944c269` |
| jubilant-bassoon: declare + redact 5 | `6380d41a` |
| field-laboratory: tripwire entry | `1571220` |
| credits spent | **0** |

**Residual, and it is the only one:** the value is in git history in both repos
and history was not rewritten. Redaction stopped it spreading; rotation is what
ends it, and there is no GitHub Actions copy of this key — only the Cloudflare
`ODDS_API_KEY_FALLBACK` binding — so unlike 2026-09-15 it is a single-store
rotation.

**Noted, not acted on:** `field-playground/wrangler.toml` contains a 32-hex
literal that is not any of the three odds keys and is in no manifest. Different
credential, different question, and field-playground has neither a manifest nor
a checker.
