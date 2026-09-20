# Whoop is out of the relay

**Asked for:** "Whoop tokens aren't part of field" → "Rip out whoop entirely."
**Secret rotated by the owner before any of this landed.**

## What was there

| | |
|---|---|
| routes | 3 — `/whoop/callback`, `/whoop/fetch`, `/whoop/tokens` |
| lines in `src/index.js` | 22 referencing Whoop, inside a 143-line block |
| references in jubilant-bassoon | **0** |
| named in CLAUDE.md or CONTRACTS.md | **no** |
| `[vars]` entries | `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET` |
| D1 table | `whoop_tokens`, in the `DB` binding |

## The cost was not the dead code

**A live OAuth client secret was in `[vars]` in `wrangler.toml`** — tracked, in
a repo GitHub reports as `"private": false`, from the commit that added the
feature. `[vars]` also means it deployed as a plaintext environment variable
rather than a Cloudflare secret. `check-exposed-secrets.mjs` passed the whole
time; its ratchet did not know that credential existed.

**It was the only consumer of the `DB` binding.** `env.DB` had four references
in the entire worker and all four were Whoop. That made `DB` look like a live
database with real usage, and `CC-CMD-2026-09-18` told a session to put the odds
budget in it on that basis. Task 1 corrected that earlier today for other
reasons; this is the reason underneath it.

**Nothing was watching.** Forty-odd guards in this repo ask whether the code is
CORRECT. None asked whether it BELONGS.

## What was removed

- `src/index.js`: the 143-line block at 11289-11431. Parse verified by
  constructing a `vm.SourceTextModule`, which parses without linking imports.
  21523 → 21380 lines.
- `wrangler.toml`: both `[vars]` entries.
- `src/route-provenance.js`: regenerated; the 3 `/whoop/*` entries are gone.
- `outbox/provenance-census-latest.json`: re-run, so the manifest gate passes.

## The generator bug this UNCOVERED — and did not fix

`route-provenance.js` attributed `api.prod.whoop.com` as an upstream to **four
sports routes**:

    /cfl/odds-probs    /odds    /pl/    /wc/odds-probs

Those routes never contacted Whoop. The provenance module stamps
`X-FIELD-Source` from this file, so four live routes were telling callers a
fitness API was one of their data sources.

**CORRECTION 2026-09-20: the mechanism below is wrong.** This entry said the
generator "attributes hosts across route boundaries" and called it the same
family as `CC-CMD-2026-09-13`'s brace-balance defect. It is neither. Measured by
tracing the generator: `BASES` is a flat name→URL map with no notion of scope,
`const base = 'https://api.prod.whoop.com/developer/v1'` sat inside the Whoop
block, and `base` is declared thirteen other times in `src/` as an ordinary
local — so every route with its own `base` resolved to Whoop's host. A name
collision, not a boundary. Fixed by letting a local declaration shadow the
global constant; it also corrected `/mcp`, which claimed
`stat-job-watcher.jeffunglesbee.workers.dev` for the same reason. A SECOND
mechanism does exist and is still unfixed — see
`outbox/2026-09-20-provenance-name-collision.md`. The original text follows.

**Tested rather than assumed.** The pre-removal `src/index.js` was restored into
a scratch copy and `build-route-provenance.mjs` re-run against it: all four
entries came back. So the generator attributes hosts across route boundaries —
it is not stale data, it is a live defect, and it is the same family as
`docs/CC-CMD-2026-09-13-route-scan-brace-balance-defeated.md`.

**Removing Whoop made it unobservable, not absent.** No `whoop.com` string is
left to be mis-attributed, so the four entries now read correctly. The next
adjacent block with a distinctive hostname will bleed the same way, and nothing
will notice.

Reproduction, for whoever takes it:

    git show 36878b9:src/index.js > /tmp/idx.js   # last commit with Whoop
    cp /tmp/idx.js src/index.js
    node scripts/build-route-provenance.mjs
    grep '"/pl/":' src/route-provenance.js        # names api.prod.whoop.com

Not fixed here. The ask was to remove Whoop, and a generator rewrite is its own
commit with its own mutations (Rule 69).

## The guard

`scripts/check-no-foreign-domain.mjs`, in `guards.yml`. A **declared list**, not
a classifier: a human adds a host when it is ruled out of scope, with the date
and the reason. It cannot tell a sports vendor from a fitness one and does not
try — a guessing version would fire on every third-party sports API the relay
legitimately calls, and would be deleted within a week.

It scans `src/*.js` **and `wrangler.toml`**, because the expensive part of this
instance was in the config, not the code.

Self-test 8/8. An empty scan returns `nothing-scanned` and fails, rather than
reading as a clean tree.

**It found a reference my own sweep missed.** `git grep -il whoop` piped to
`head -20` returned exactly 20 lines, and I read a truncated list as complete —
`src/route-provenance.js` was line 21. The check caught it on its first live
run.

## Left alone, deliberately

- **The `DB` binding.** Now zero references. CLAUDE.md forbids changing
  wrangler.toml bindings without approval, so it stays, with its comment
  corrected — it previously read "WC + health tokens", naming the Whoop usage.
  Its `database_id` is identical to `WC2026_DB`'s, so removing it loses nothing.
  Owner's call.
- **The `whoop_tokens` table in D1.** ~~Still there, now unreferenced.~~
  **CORRECTED 2026-09-20 — "still there" was never measured.** It was written as
  a fact and it was an assumption: no `CREATE TABLE whoop_tokens` exists in any
  commit (the table was made out of band, if at all), and no session had ever
  queried it. Rule 100's question — which command would refute this — had a
  cheap answer nobody spent.
  It is now probed weekly by `scripts/probe-whoop-tokens.mjs`, riding
  `timetravel-window-watch.yml`. Measured state as of 2026-09-20:
  **`no-d1-scope`** — `CLOUDFLARE_API_TOKEN` verifies and cannot list this
  account's D1 databases (`Authentication error [code: 10000]`), the same
  refusal that has blocked the Time Travel window question since 2026-09-07.
  So the table's existence is still unknown, but it is now unknown *and
  watched*, with the one human action that unblocks it named: mint a token
  with D1:Read. Three of the four outcomes then close this item with no owner
  decision at all — absent means nothing to drop, empty means the drop removes
  no data, and only `holds-rows` is genuinely a live-D1-mutation call.
- **`HANDOFF.md:701`**, which mentions WHOOP in a historical measurement. That
  is a record of what was true then.

## Verification

| what | result |
|---|---|
| `src/index.js` parses | `vm.SourceTextModule` constructed |
| whoop references in `src/` | 0 |
| `env.DB` references | 0 |
| `check-no-foreign-domain --self-test` | 8/8 |
| `check-route-provenance` | PASS — 187 routes, 185 with a declared source |
| `check-exposed-secrets` | PASS |
| `check-no-literal-secret-writes` | PASS |
| `check-odds-calls-guarded` | PASS |
| `check-odds-budget-schema` | PASS |
| `check-push-lands` | 24/24 |
