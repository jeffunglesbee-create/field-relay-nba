# CC-CMD-2026-08-02-ruwt-baseline-audit — Result

## Status: DONE. Report-only per scope. Overall verdict: **COMPLIANT**,
with one real, pre-existing, explicitly self-flagged latent risk noted
(not a violation) and no fixes applied (per explicit scope).

## Task 1 — governing text, re-read fresh from `jubilant-bassoon/docs/ADR-002-CONTEXT.md`

- **Rule A**: the relay may compute and serve composite interest-level
  values in normal pull-based responses, but must never autonomously
  transmit an unprompted alert/notification keyed to a computed value
  crossing a threshold. Any push must originate from the user's own
  pre-authorized, named condition.
- **Rule F**: the relay may compute anything a neutral data vendor
  could publish (win probability, xG, Elo, factual classification). It
  may never compute anything that functions as a watch recommendation,
  regardless of label. Both tests (Rule F content, Rule A delivery)
  must independently hold — passing one doesn't clear the other.

## Task 2 — every route + scheduled workflow audited against Rule A

**Real autonomous-push mechanisms found (exactly 2, both via
`sendWebPush`/`PUSH_SUBS`):**

1. **`handleCron`'s live-game alert** (`src/index.js` ~line 4479-4569).
   Gate: `latePhase && closeGame` — two independent factual boolean
   dimensions, ANDed, no scalar (confirmed via direct read of the
   `live.push({...})` object: `type:'SCORE_CHANGE'`, raw score/period/
   clock/broadcast fields, `watchUrl:null` explicitly — no drama score,
   no watch value anywhere in the payload). Delivery is filtered
   per-subscriber by `prefs.sports` — the user's own pre-set,
   named condition, exactly matching Rule A's required basis. **PASS.**

2. **Tubi free-game pre-game alert** (`handleTubiPreGameAlerts`,
   ~line 4180-4214). Fires on wall-clock proximity to a hardcoded,
   tournament-static kickoff time — not on any computed/threshold-
   crossing value at all. Payload is broadcast-availability data
   (`FREE_GAME_ALERT`, "free on Tubi/FOX OTA") — a neutral TV-guide
   service would publish the identical fact (Rule F commodity test).
   **PASS** on both axes.

**No other route or scheduled workflow in this repo sends any
autonomous push, webhook, or notification to an external consumer** —
confirmed via a full-file grep for `.send(`, `broadcast`, `webPush`,
`sendNotification`, `PUSH_SUBS.` (213 routes' worth of matches
individually reviewed by grep context; only the two call sites above
actually invoke `sendWebPush`).

**Scheduled workflows in this repo** (`schedule:` trigger, checked
individually): `drama-backfill.yml` (data backfill only — confirmed via
grep of `scripts/drama-backfill.mjs`, zero push/notification/webhook
calls, writes only), `odds-backfill.yml`, `score-fill.yml`,
`rule90-staleness-monitor.yml` (detection-only, already self-documented
as non-blocking/visible-in-Actions-tab only), `undocumented-api-health-
check.yml` (this session's own work — confirmed detection-only, writes
a `codex` incident row on failure, never pushes/alerts externally),
`verify-pending-checks.yml`, `auto-merge-stray-branches.yml` (infra
housekeeping, not RUWT-relevant). **All PASS** — none has any
externally-visible action beyond a detection record or a data write.

## Task 3 — audited against Rule F where relevant

- **`soccer-wp.js` (Poisson + Dixon-Coles win probability)**: already
  the explicit worked example in Rule F's own text — a genuine
  commodity statistical model, correctly relay-side. **PASS**
  (unchanged, not re-litigated).
- **`dramaScoreLive` / `computeWatchValue` / `preGameScore`**:
  confirmed via grep these are **not** computed or served by any
  production route. The only server-side reference is
  `dramaScoreLiveTest` (imported from `drama-score-test.js`), used
  exclusively by one route:

  **`GET /test/drama-score-cost`** (~line 13462) — a real, pull-only
  (GET, no cron trigger) CPU-cost benchmark. Its own header comment
  self-flags: *"TEST-ONLY... Not linked from any production path. Not
  called by any client code... MUST be removed or gated before any
  relay-side drama-score migration ships."* The response includes a
  `_sink` field — an accumulated numeric total across 100,000+
  synthetic iterations, explicitly there only to prevent V8 dead-code
  elimination in the benchmark, not a usable per-game drama score. It
  does not function as a watch recommendation for any real game.
  **PASS on both Rule A (pull-only, no push) and Rule F (the exposed
  value isn't a usable recommendation)** — but flagged below as a real,
  pre-existing latent risk to track, per Task 4's instruction to report
  ambiguity plainly rather than silently pass over it.

## Task 4 — findings

**Overall: genuinely compliant.** No violation found. One real,
pre-existing, already-self-documented latent risk, not a violation:

- `/test/drama-score-cost` exists specifically to measure whether a
  *future* relay-side `dramaScoreLive()` migration (explicitly
  permitted under Rule C, subject to Rules A/B) would be
  CPU-affordable. It is compliant today because it's test-only,
  unlinked, and pull-only. Its own comment already states the correct
  discipline: any real migration must re-gate or remove this route.
  **No action needed now** — this is not a drifted violation, it's
  exactly the kind of forward-looking test infrastructure Rule C
  anticipates, already carrying its own warning label. Flagging here
  only so this audit's record is honest that it exists, per Task 4's
  explicit instruction not to treat a clean audit as license to skip
  disclosing real, adjacent latent risk.

## Task 5 — quality gate

No code changed in this CC-CMD (report-only, per explicit scope).
`node --check src/index.js` confirmed passing (unchanged from HEAD).

## Outbox
This file.
