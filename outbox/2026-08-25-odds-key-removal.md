# The Odds API key is out of the repo, and the workflow that would have restored it is gone

**2026-08-25.**

## What was there

```js
// src/index.js:572
const ODDS_API_KEY_FALLBACK = '<32-hex-literal>';
function _oddsPrimaryKey(env) { return (env && env.ODDS_API_KEY) || ODDS_API_KEY_FALLBACK; }
```

Same literal in `src/wp-resolver.js:42`, in `odds-backfill.yml` as
`${{ secrets.ODDS_API_KEY || '<literal>' }}`, and in an outbox audit doc.

Its own comment called it "the original exhausted free-tier key, retained ONLY
as a last-resort fallback". That is a **third** level of fallback — past the
two-level cap this project sets — to a key described as already dead.

## The worse thing, found while removing it

`.github/workflows/update-odds-key.yml`:

```yaml
name: Update Odds API Key
    name: Set ODDS_API_KEY to 20K plan key
      - name: Update ODDS_API_KEY to 20K plan
        run: |
          echo "<the exhausted literal>" | wrangler secret put ODDS_API_KEY --name field-relay-nba
          echo "✅ ODDS_API_KEY updated to 20K plan key"
```

**One `workflow_dispatch` replaces the working production key with the dead one
and prints a green checkmark saying it worked.** The step name, the job name and
the success message all say "20K plan key"; the value is the exhausted free-tier
key. A name and a value that disagree — the same defect class this session has
now hit eight times in other guises.

**Deleted, not edited.** It cannot be fixed by changing the literal: the correct
value is not in this repo and must not be. A workflow whose only purpose is to
write a secret from a repo literal is a credential-in-repo mechanism by design.
Rotating a secret belongs in the Cloudflare dashboard or an interactive
`wrangler secret put`.

## Removal was safe, and that was measured

`GET /budget/odds`, 2026-08-25:

```json
{"ok":true,
 "daily":{"date":"2026-08-25","used":192,"ceiling":3800,"remaining":3608},
 "monthly":{"month":"2026-08","used":42102,"limit":85000,"remaining":42898}}
```

42,102 credits consumed this month and 192 today against an 85,000 limit, so
`env.ODDS_API_KEY` is set and working in production and the constant was never
reached. Rule 3 class B — check the actual account, do not reason about quotas
from a comment.

## What replaced it

A missing key is now its own state, logged once by name:

```js
let _oddsKeyWarned = false;
function _oddsPrimaryKey(env) {
    const k = (env && env.ODDS_API_KEY) || null;
    if (!k && !_oddsKeyWarned) { _oddsKeyWarned = true; console.error('[odds] ODDS_API_KEY is not set. …'); }
    return k;
}
```

It does **not throw**. This runs inside the journalism cron and Rule 5 forbids an
enhancement path breaking a primary function.

The Starter key stays where it belongs — in `oddsFetchWithFallback`'s 401/429
retry — rather than being folded into the primary, which would make that retry a
no-op against the same key.

## A bug I introduced and caught before pushing

The mechanical pass rewrote `oddsUrl`'s

```js
const apiKey = envKey || ODDS_API_KEY_FALLBACK;
```

to `envKey || _oddsPrimaryKey(env)`. **`oddsUrl` has no `env` in scope** — it is
a pure URL builder whose one call site already passes `env?.ODDS_API_KEY`. That
compiles, passes `node --check`, and throws a ReferenceError at request time on
the `/odds` proxy route. Caught by reading the function rather than trusting the
replace, and by grepping its call sites (Rule 71). It is now `envKey || ''`.

## The guard

`scripts/check-exposed-secrets.mjs`, a deploy gate. It hashes every quoted string
and every bare token in the tree and looks the digests up against
`docs/exposed-secrets.sha256`, so neither file ever contains a credential.

**A ratchet, not a ban.** The Odds key is 0 — it may never come back. The shared
secret is 114 and load-bearing; see below. A check demanding 0 for both would be
red on main from the moment it shipped, and a red check nobody can make green is
a check that gets deleted.

Self-test: 8 assertions, including the scanner finding the same value as a
single-quoted JS literal, a double-quoted shell string, a
`${{ secrets.X || '…' }}` YAML expression and a bare token in prose — the four
syntaxes these have actually appeared in.

## And the finding that came out of it

The first full-tree run measured **114 occurrences of `RELAY_SHARED_SECRET`
across 70 files**, against a recorded figure of ~41 ("27 in src/index.js, 1 in
analytics-engine.js, 5 workflows, 8 docs"). The gap is ~40 `scripts/*.mjs`, each
of which reaches a credentialled write path — `POST /d1/execute` among them —
with the secret compiled in rather than read from the environment. Nobody had
counted them because the earlier figure came from grepping `src/`.

**Not changed in this session, deliberately.** Removing literals without rotating
first buys nothing — the value is in git history either way — and
`src/index.js:3997` is the auth comparison itself; pointing it at an unset
binding turns the gate into `undefined === undefined`. There is an order, and
`docs/CC-CMD-2026-08-25-rotate-relay-secret.md` writes it down. Step 1 needs a
human with dashboard credentials.
