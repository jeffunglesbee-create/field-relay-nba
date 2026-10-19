# CC session — the push cron's live-game loop deleted, as a stated absence, 2026-10-19

`docs/CC-CMD-2026-10-14-push-cron-gambit-path.md`, option 1. The owner ruled
on 2026-10-18 (delegated).

**HEAD:** `4659390e` → `2ebddc86`, 5 commits in one push.
**Runs, all green:**
- deploy run 39194042279 (deploy and verify);
- guards run 39194042320;
- YAML gate run 39194042268.

**Integration status:** VERIFIED for the relay. The client consumer is filed
(below).

## Probe first (Rule 87, Rule 100)

- **The premise "the loop already does nothing", re-executed at HEAD before
  deleting:**
  - `espnGambitAllowed` returned `false` for all 8 `SPORT_CONFIG` paths;
  - the `/espn-gambit` route answers 403 `espn-gambit-path-not-whitelisted`
    for them.
- **What the loop fed:** `live` was read only by the subscriber fan-out after
  it, so the fan-out was dead with it. `handleTubiPreGameAlerts` is
  independent.
- **Consumers of the payload:**
  - `SCORE_CHANGE` had exactly one producer, this loop.
  - Its only consumer is jubilant-bassoon `sw.js:230-277`.
  - `/signal/crunch`, which that branch also POSTs to, has two other
    page-side emitters (`field.js:15727`, `:37080`), so it stays.

## What landed

| commit | what |
|---|---|
| `32f7b596` | deletes the loop, its late-phase and close-margin gates, the fan-out, handleCron's RELAY constant and index.js's SPORT_CONFIG import. Adds the stated-absence paragraph in handleCron, and keeps a captureFieldError comment true. |
| `80798d82` | `scripts/check-push-cron-live-absence.mjs`, wired into deploy.yml (guards.yml ignores src/**) and guards.yml |
| `8c488b64` | three more comments that still described the push (from the review) |
| `882d99be` | guard v2: whole-line comment stripping, a per-file sendWebPush pin, any quoted 'SCORE_CHANGE', a recursive src walk (from the review) |
| `2ebddc86` | the stated absence flags the ADR-002 question instead of answering it (below) |

## The adversarial review: 8 confirmed, 2 refuted

Two lenses (semantics and blast radius; guard teeth), each finding
reproduced, then refuted or confirmed.

- **High: the guard's comment stripper was string-blind.** The `/*` in
  `// Route: /espn-gambit/*` opened a fake block comment. It hid 3,768 lines
  of `src/index.js`, `sendWebPush`'s definition among them.
- **High: a helper slipped past the guard.** The poll and fan-out moved into a
  helper passed, whether the helper was called from handleCron or from the
  scheduled handler, under any payload type.
- **Medium:**
  - other spellings of 'SCORE_CHANGE' passed: quoted key, constant, enum;
  - an Accept '*/*' blinded the in-handleCron checks.
- **Low:**
  - three stale comments;
  - the flat src walk;
  - jubilant-bassoon's `ADR-002-CONTEXT.md` missing from the client
    follow-up.

All are fixed in guard v2 and the follow-up commits. Rule 90 on the guard:

- **Self-test, 19 of 19**, including the helper (H1-H3), the hidden-span
  cases (S1-S2), the spellings (G8-G10) and a subdirectory walk (W1).
- **Reverting each mechanism turns its own cases red:**
  - old stripper: G4, H1, H2, S1;
  - no pin: G4, H1-H3;
  - old regex: G8-G10;
  - flat walk: W1.
- **Pre-deletion source:** run against it, the guard fails with 7 findings.

## A premise corrected before push (Rule 100, Rule 45)

The ruling's second reason, which the first draft of the handleCron paragraph
repeated as fact, said **ADR-002 Rule A** forbids a late-and-close push.
jubilant-bassoon `docs/ADR-002-CONTEXT.md` **Rule B** says the opposite:
those boolean gates "remain free to trigger the existing `SCORE_CHANGE` push
path directly, exactly as before".

- A code comment is no place for a patent-compliance verdict (Rule 45).
- The deletion does not need one. It rests on the ruling's first and third
  reasons:
  - it changed no behaviour;
  - a `continue` on a 403 that reads as "no live games" is the shape most
    likely to hide again.
- The paragraph now records the Rule A / Rule B disagreement as **an open
  ADR-002 question for the owner**, and says a restore needs that resolved
  first.
- The CC-CMD carries a dated correction note under the ruling. The ruling
  itself is unaltered.

## Done condition

| | probe | result |
|---|---|---|
| 1 | `git grep -c "espn-gambit/apis/site" origin/main -- src/` | **0 files** |
| 2 | handleCron at origin/main contains the stated-absence paragraph citing the ruling | **present**: "THE LIVE-GAME HALF OF THIS HEARTBEAT DOES NOT EXIST" and the CC-CMD path |
| 3 | deploy green | **run 39194042279**, deploy and verify success. Its guard step "The push cron's live-game half stays absent, and says so" passed |

Before the push: the offline sweep of every guards.yml and deploy.yml step
passed 111 of 112, on a checkout confirmed to be the pushed HEAD. The one red
is the BSD frame contract's live fetch (HTTP 0, sandbox egress), green on the
runner. `wrangler deploy --dry-run` built 2095.65 KiB with no missing export.

## Filed, not done here

- **jubilant-bassoon `docs/CC-CMD-2026-10-19-sw-score-change-has-no-producer.md`**
  (`6284472b`, Rule 87.4):
  - `sw.js`'s `SCORE_CHANGE` branch now has no producer.
  - Its `DRAMA_THRESHOLD` branch has had none for longer.
  - `ADR-002-CONTEXT.md` Rule B names the deleted path.

  It recommends deleting both branches as a stated absence, and a
  fact-only ADR correction. The permission question is left to the owner.
- **The ADR-002 question itself.** Is a relay push gated by raw-state booleans
  permitted (Rule B), or is it an unprompted value-based alert (Rule A as the
  ruling read it)? This is for the owner. Nothing here depends on the answer.

## Integration state (Rule 65)

- **Relay contract:** no push payload of type `SCORE_CHANGE` exists any more.
  The `/push/subscribe` route and the Tubi pre-game push are unchanged.
- **Client consumer:** `sw.js` `SCORE_CHANGE` branch, producerless, filed as
  above.
- **Known mismatches:** the client still handles a type the relay does not
  send. That is harmless, and it is filed.
