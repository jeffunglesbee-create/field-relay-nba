# Manifest — the numeric-id upsert key is deployed and both done conditions hold

**Date:** 2026-09-02
**Commit deployed:** `ce32eaa` (contains `d253209`, the key change, held since 2026-09-01)
**Deploy run:** 888 / `33655153163` — success
**Assertion run:** `33655821329` — success

## The gate that held it, and what opened it

`d253209` sat on main under `[skip ci]` because the exposure probe had read
`quiet-window`: unscored rows carrying numeric event ids, which the new key would
strand. The 07:00 check re-read it:

```
116 forward row(s), 0 EXPOSED
  today (in flight, resolves on its own): 0
  future-dated (strands)                : 0
control 2026-09-01  18 row(s), 8 scored
SHIP ADVICE: clear
```

Twenty-two dates at zero, with the control confirming the probe could see scored
rows at all — `measured`, not an empty sweep reading as clean.

## Done condition A — one numeric source_id, two spellings, ONE row

```
=== A. one numeric source_id, two spellings ===
  POST {"home":"Test Alpha","away":"Dream"} -> 200 {"ok":true,"id":"MLB_2099-03-01_e999000111","table":"regular_season_games","brief_captured":null}
  POST {"home":"Test Alpha FC","away":"Atlanta Dream"} -> 200 {"ok":true,"id":"MLB_2099-03-01_e999000111","table":"regular_season_games","brief_captured":null}
  rows on 2099-03-01: 1 — MLB_2099-03-01_e999000111
PASS  A1: exactly ONE row
PASS  A2: its id ends _e<digits>
```

`Dream` and `Atlanta Dream` — the exact drift this change exists for — upsert onto
one row rather than inserting a second.

## Done condition B — golf_ source_id, two spellings, still TWO rows

```
=== B. golf_ source_id, two spellings ===
  POST {"home":"Test Alpha","away":"Dream"} -> 200 {"ok":true,"id":"MLB_2099-03-02_testalpha_dream","table":"regular_season_games","brief_captured":null}
  POST {"home":"Test Alpha FC","away":"Atlanta Dream"} -> 200 {"ok":true,"id":"MLB_2099-03-02_testalphafc_atlantadream","table":"regular_season_games","brief_captured":null}
  rows on 2099-03-02: 2 — MLB_2099-03-02_testalpha_dream, MLB_2099-03-02_testalphafc_atlantadream
PASS  B1: still TWO rows — a golf key must never merge rounds
PASS  B2: neither id ends _e<digits>
```

B is the one that matters more. `golf_<eventId>` is a per-TOURNAMENT key covering
R1..R4 as separate rows; keying the id on it would merge two real rounds and
destroy a scored row. A change that passed A and failed B would be data loss
wearing a success.

```
=== cleanup ===
PASS  cleanup: 2099-03-01 is empty
PASS  cleanup: 2099-03-02 is empty

ALL ASSERTIONS PASSED
```

Synthetic 2099 dates so no real slate was written to, a pre-check clearing
leftovers so A could not pass for the wrong reason, and both dates deleted with
emptiness asserted rather than assumed.

## The deploy failed first, on a gate this session's own document tripped

Deploy 887 failed — not on the key, on `staged-verifier-check`:

```
1 staged claim(s) name NO verifier:
    docs/CC-CMD-2026-09-02-d1-write-provenance.md: - **Staged:** the caller's identity.
```

That document said the blocker was "an account-scoped AE read, which no session
credential covers". Written from reading rather than from trying, and false:
`ae-read-scope-probe.yml` asked Analytics Engine for a count with this repo's
existing `CLOUDFLARE_API_TOKEN` and got **HTTP 200**. The token that deploys the
worker also carries Account Analytics Read.

So the claim was verifiable and the gate was right. It was not bypassed. What
shipped instead:

- `d1WriteProvenance` in `staged-verdicts.mjs`, five states, only one of them a
  FAIL — a run with no control entry has measured nothing, and reporting that as
  "no second writer found" would be the loudest possible false negative.
- Check 6 in `verify-staged-items.mjs`, reading AE over a 48h window and counting
  distinct game dates from `regular_season_games` (`date` is the column every
  other query in `src/index.js` uses — confirmed, not guessed).
- `staged-verification.yml` passes the two CF secrets for that check only.
- The document's section rewritten, tagged
  `**STAGED** (verifier: d1_write_provenance @ relay/staged-verification.yml)`,
  with the real blocker named: 48 hours of data the instrumentation has not
  produced. The dataset holds **zero** `d1-write` entries.

### A hole found on the way

`staged-verdicts-check`'s "CAN reach PASS on a clean payload" loop iterated
`CAN_PASS` rather than `VERDICTS`, so a verdict added without an entry there was
silently exempt from the one check that says it can ever go green — the same
shape as a missing `mustFailOn`, which the block directly above already refuses.
Every registered verdict must now declare a clean payload. Proven by removing the
new entry: 1 failed; restored, 24 passed.

## Residual, disclosed

**197 rows (18.2%) of the 1085-row census remain outside this change's reach.**
They carry non-numeric, non-`golf_` source ids or none at all, and keep the
team-name key. The change does not claim them and this manifest does not imply
otherwise.

The `d1-write` provenance claim is now owned rather than orphaned: it reports
PENDING daily until the instrumentation deploys and a 48h window containing a
day-after-game elapses. That is Task 2 of
`CC-CMD-2026-09-02-d1-write-provenance`, and the blob contract it must satisfy —
`index1 = 'd1-write'`, `blob1 = 'control' | 'dash'` — is stated in that document
because the verifier had to be written first.
