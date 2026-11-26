# Session doc — Item 4: the relay sends a contact address in its Squiggle User-Agent, as a Worker secret the owner sets

**Date:** 2026-11-26 · **Repo:** field-relay-nba · **Branch:** main · **CC-CMD:** `docs/CC-CMD-2026-11-24-afl-squiggle-reads-and-the-round-label.md`, Item 4 (decided and built; the owner's one step is STAGED) and Item 8 (new, for the owner).
**Owner decision, verbatim:** "Yes, contact address", to the question "decide Item 4, whether Squiggle's User-Agent gets a contact address"; then, asked which address, the account address (given in the answer to that question; deliberately not repeated anywhere in the repo).

## What was built and why it is shaped this way

Squiggle's Requirements, item 1 (read in full on 2026-11-26, https://api.squiggle.com.au/ v1.14.0): "Set your bot's UserAgent to something that identifies it and contains a contact email, e.g. "Dan's Tipping Comp - dan@example.com"". Changelog 1.13.0: a bot that does not comply "may now be blocked at edge level (particularly if they run from a server farm)". A GitHub runner without one was answered HTTP 403 on 2026-11-25 (run 45524946667).

**The address is not in the source or the git history.** The first attempt, a script that held the address next to the client identity, was refused by a privacy guard on this session ("To send this address, the person sets it themselves in an environment variable the script reads"). The guard's route is also the better design: the relay reads the Worker secret `SQUIGGLE_CONTACT`, which the owner sets, so there is nothing to commit and nothing to deploy to change it. `squiggleHeaders(env)` (`src/afl-squiggle.js`) builds the User-Agent per request: `FIELD-Global-Sports-Intelligence/1.0 (jeffunglesbee-create/jubilant-bassoon) - <address>` (Squiggle's own example shape). Unset or not one plain address it is exactly the User-Agent sent before, one warning per isolate (never naming the value), and every request is still made, so a missing secret degrades to the state before this. All five request sites use it (the round read, the finals read, the `/squiggle` pass-through, the resolver's two reads); the two `SQUIGGLE_HEADERS` constants are gone. The `/squiggle` route answers `X-FIELD-Squiggle-Contact: set | unset | invalid` (a word, never the address) on every answer to a forwarded query, and check 14 of `scripts/verify-staged-items.mjs` (`squiggle_contact_set`) reads it daily.

## HEAD progression

| commit | what |
|---|---|
| `343461ce` | the feature: `squiggleHeaders(env)`, `squiggleContactState`, the route header, the checks (journalism 48 -> 103, resolver 82 -> 87 assertions) and mutants (68 -> 103 of 103, 65 -> 70 of 70) |
| `769cca18` | check 14 and its verdict (`squiggleContactSet`, `squiggleContactStateOf`): the real executor block is run offline by `staged-verdicts-check.mjs` (142 -> 183) |
| `bc6b8aad` | Item 4 decided, Item 8 filed, the owner's step, `CONTRACTS.md` (the header) |
| `b300686b` | the scheduled NFL R2 regression read of 2026-11-26, recorded: `NOTHING MEASURED: no exceededMemory invocation ... Not a pass.`; the runner's scheduled run fired 9 h 17 min late and wrote and served the file |
| this commit | this doc and the HANDOFF close-out |

The commits were re-authored as `Claude <noreply@anthropic.com>` before the push, on a Stop hook's instruction (GitHub shows other committer emails as Unverified). The repo's `CLAUDE.md` says `FIELD CI <claude@field.dev>`; the two instructions conflict and the hook's was followed. Say which the repo should use.

## What the review found that I had wrong (five lenses in isolated worktrees, a skeptic per finding)

1. **The checks could not see the route wrapper.** `new Response(upstream.body, upstream)` (it keeps the upstream status and the relay's CORS and proxy headers, and copes with a cache hit whose headers are immutable) had six surviving mutants. Now asserted: a 503 stays a 503 with its `X-RELAY-Error`, headers kept, a cache hit with immutable headers answered with no request to Squiggle; mutants B30-B34.
2. **A call site was unasserted** (the finals read built from the raw secret survived): C6 runs the finals reads set, unset and malformed; mutant B35.
3. **The shape check was loose and the claim about it was wrong.** It accepted `a@...`, `ops@example..invalid`, a trailing backslash, a 5 KB value, and ran quadratic on dots. Now an RFC 5322 atext local part, a dotted domain of letters, digits and hyphens, at most 254 characters (the lookahead bounds the matching): 32 malformed shapes asserted, five realistic addresses sent as given, 14 shape mutants. The comment that a character above U+00FF makes `Headers.set()` throw is true in Node and false in workerd (measured by the review: only control characters throw there); corrected.
4. **Check 14 copied the raw header into the manifest that the daily run commits**, so a producer regression would have committed an address to `main`. The header is mapped to a word first; an unknown value is a FAIL, never printed. A `set` whose own read of Squiggle answered 403 is a FAIL (the contact did not buy access); another non-200 is PENDING.
5. **Nothing gated check 14's wiring** (a wrong header name, a lost import or a hard-coded state left every gate green): the real block is now run offline against a stubbed relay in every state, in `staged-verdicts-check.mjs`.
6. **Stale or wrong text:** Squiggle's requirement was quoted in quotation marks and was not verbatim (now verbatim, first-hand); "per request because env is not available at module load" is false (Cloudflare allows `import { env } from 'cloudflare:workers'`; the real reasons are the codebase's convention and the Node-side checks that import the module); "on every answer" was false for the 400, OPTIONS and 405; the owner's step omitted the dashboard Deploy click and the Text-variable trap; commit counts were wrong (48 and 68 at the parent, not 64 and 80); a mutant (B21) named a deleted constant and was caught by a ReferenceError.
7. **Refuted by a skeptic:** that these commits should have carried a HANDOFF line (this close-out is that line).

## Integration state (Rule 65)

- **Relay contract:** every request to `api.squiggle.com.au` carries `User-Agent: FIELD-Global-Sports-Intelligence/1.0 (jeffunglesbee-create/jubilant-bassoon) - <SQUIGGLE_CONTACT>` when the secret is one plain address, else the same without ` - <address>`; `GET /squiggle?q=...` adds `X-FIELD-Squiggle-Contact: set | unset | invalid`. Documented in `CONTRACTS.md`. Consumer: check 14 only; no client reads anything new (the body is unchanged).
- **INTEGRATION STATUS: STAGED.** Blocked by: the owner's step. Unblocked when: `GET /squiggle?q=teams` answers `set`. Verify: `staged-verification.yml` (daily 06:00 UTC) check 14, or a dispatch of it.
- **Known mismatches:** none new. Item 8 (the open forwarder now signs its traffic with the owner's address; the client's Squiggle year is the constant 2026) is for the owner.

{{LIVE}}

## The owner's step (nobody else can do it; about a minute)

Cloudflare dashboard -> Workers & Pages -> `field-relay-nba` -> Settings -> Variables and Secrets -> Add, type **Secret** (not Text), name `SQUIGGLE_CONTACT`, value the address, then **Deploy**. Or `npx wrangler secret put SQUIGGLE_CONTACT --name field-relay-nba`, which deploys at once. A Secret survives every deploy (`deploy.yml` puts only its own eleven secrets). After it, `staged-verification.yml` check 14 turns PASS (or FAIL, with the reason, if the value is not one plain address).

## Gates

{{GATES}}

## Residual (genuine, not deferred work; each has a CC-CMD item)

The owner's step (above). Item 8 and Items 2, 3, 6 and 7 of the same CC-CMD. Whether Squiggle accepts the User-Agent, and whether the contact also lets a runner read it directly, is unmeasured and cannot be measured until the secret is set: check 14 FAILs if Squiggle answers 403 to the relay afterwards.
