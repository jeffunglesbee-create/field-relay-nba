# whoop_tokens: the decision that was a question

**2026-09-20** · field-relay-nba · commits `2ebb5c0`, `ca9e24a`, `ae45fd9`
(plus two artifact commits written by the runs themselves, `0d707e2` and
`8fbd323`)

## What this closes

"Drop the `whoop_tokens` table?" had been carried since 2026-09-19 as an owner
decision. Rule 42 on it: **it was never a decision. It is a question nobody
asked.**

The thing that made it look like a decision was a sentence in
`outbox/2026-09-19-whoop-removal.md` — "Still there, now unreferenced" — written
as a fact. Nothing had measured it. No `CREATE TABLE whoop_tokens` exists in any
commit, so the table was made out of band if it was made at all, and no session
had ever queried it. The decision was downstream of a premise, and the premise
was never probed (Rule 100).

Three of the four outcomes delete the decision:

| outcome | what it means |
|---|---|
| `absent` | nothing to drop. The item closes with no owner and no write. |
| `empty` | the drop removes a name and no data. Nothing is at stake in it. |
| `holds-rows` | genuinely the owner's — and now with a count in hand. |
| anything else | nothing is known. Do not read an answer off the run. |

## The transport, and why not the obvious one

`/d1/execute` binds `env.ARCHIVE_DB` (field-archive, `cc49101c`) and has no path
to the database in question. The removed Whoop code reached its table through
`env.DB`, `database_id f26669de` — the same store `WC2026_DB` binds, which is
why `712227d` removed a name rather than an access path. So `f26669de` is the
only database the table could be in, and the Cloudflare D1 REST API is the only
way this repo can reach it read-only.

An earlier, false version of this: "say the word and it's ~2 minutes." That
assumed `/d1/execute` could reach it. It cannot.

## Two runs, and the second one is the point

**Run 35482911059** produced `unreadable`. That was the probe working: the
control — `SELECT name FROM sqlite_master` — refused to let a permission failure
read as "the table is not there". Cloudflare answered `7403`, *"the given
account is not valid or is not authorized to access this service."*

But `unreadable` names no remedy, and `7403` covers three different failures
with three different one-line fixes. A verdict nobody can act on is a run that
gets repeated by hand. So the classifier became a ladder:

| rung | failure state | the fix it names |
|---|---|---|
| 1 `/user/tokens/verify` | `token-invalid` | re-issue the secret |
| 2 list the account's D1 | `no-d1-scope` | **add D1:Read** |
| 3 is `f26669de` among them | `database-not-in-account` | wrong account, or gone |
| 4 `sqlite_master` on it | `no-access-to-this-database` | token scoped elsewhere |

**Run after `ca9e24a`** answered: rung 1 `ok`, rung 2
`Authentication error [code: 10000]`. Verdict **`no-d1-scope`**.

The ordering is the property, not the rungs. Every self-test case sets each
lower rung to its happy value, so a rung that stopped being consulted would
report the answer beneath it. `W1` is the mutation for the one that matters —
a missing D1 scope reading as an absent table, which would close the question by
never having been allowed to ask it.

## The watch already existed

`timetravel-window-watch.yml` has been waiting weekly since 2026-09-07 on the
same token, the same endpoint family and the same error code, for the same token
mint. A second weekly cron would have cost twice, informed once, and added a row
to the dead-cron ratchet for a question that closes the week it is answered. The
probe rides the existing watch instead.

Re-verifying an inherited claim (Rule 72) is what made that visible: the Task 0b
write-up said the token is refused on D1 with `10000`, and this session's run
reproduced it independently *before* going looking for a watch. Two findings
agreeing is why this is one watch and not two.

**It commits only a CHANGED verdict.** The probe writes a timestamped log every
run, so there is no byte-identical-file test to lean on; committing weekly would
be 52 logs saying the token still has no D1 scope. Verified against real files,
both ways, before it was committed — and then verified again in the live watch
run, which printed `verdict: no-d1-scope -> no-d1-scope` and
`unchanged — not committing a 52nd copy of the same answer`.

Sorted by **name**, not mtime: the names carry a UTC stamp and every checked-out
file shares one checkout mtime, so `ls -t` would be a coin flip on exactly the
run that writes no log — the run where picking wrong compares a log against
itself and skips forever.

## The rows are secrets

`whoop_tokens` holds live OAuth access and refresh tokens for a real account.
(The client secret was rotated on 2026-09-19, so any refresh token there is
already dead — that is a reason the rows are worthless, not a reason a session
may delete them.)

Two statements, both `SELECT`, plus two `GET`s. The self-test fails if any SQL
string names a token column or can write; `W7` and `W8` are the mutations that
hold that line, and the harness runs **before** the probe does. No response body
is printed beyond database names and error codes, because a Cloudflare error body
can echo account identifiers.

## Verification

| what | result |
|---|---|
| `probe-whoop-tokens.mjs --self-test` | 20/20 |
| `mutate-whoop-tokens.mjs` | 11/11 caught |
| `check-push-lands.py` | OK, 25 loops |
| workflow YAML | both files parse |
| `deploy.yml` node gates | 93/95 — the 2 red are `--live` variants printing "RELAY_SHARED_SECRET is not set" in the sandbox |
| live probe, run 1 | `unreadable` (pre-ladder) |
| live probe, run 2 | **`no-d1-scope`** |
| live watch, steps 7–9 | all ran; commit step correctly skipped |
| rows read from `whoop_tokens` | 0 |
| writes of any kind | 0 |

## One self-inflicted defect, caught on its first run

The "absent does not depend on the count" assertion compared two `classify()`
calls **to each other** — which passes with both wrong in the same way. The
vacuous-assertion class again, in the very check written to prevent a vacuous
answer. It now names the expected pair.

## What is still open, and it is one line

Mint a Cloudflare API token with **D1:Read** (or add that scope to the existing
`CLOUDFLARE_API_TOKEN`). The watch then answers both this question and the Time
Travel window question on its next Monday run, with no session involved.
