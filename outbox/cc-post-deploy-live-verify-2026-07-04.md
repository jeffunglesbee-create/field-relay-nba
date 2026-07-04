# Outbox — Automated Post-Deploy Live Verification

**Date:** 2026-07-04
**CC-CMD:** docs/CC-CMD-2026-07-04-post-deploy-live-verify.md
**Status:** SHIPPED (workflow created and pushed; firing confirmation deferred by design)

---

## What was built

`.github/workflows/post-deploy-live-verify.yml` — triggers automatically via
`workflow_run` after every successful `Deploy RELAY Worker` run. Curls
`/circadian/preview` and `/circadian/late` for today + yesterday, plus two
validation checks (bogus phase → 400, bad date → 400). Writes results to
`outbox/live-verify-{run_id}.md` and commits with `[skip ci]` to prevent loops.

## Deploy workflow name

Used `"Deploy RELAY Worker"` — confirmed exact name 2026-07-04 via direct grep
of `.github/workflows/deploy.yml` (`grep "^name:"` → `name: Deploy RELAY Worker`).
Not guessed, not re-derived from this session.

## Closes the manual-curl gap

This is the concrete fix for the third documented instance of the
"CC egress blocked from *.workers.dev" pattern causing a manual chat pass or
stall. Going forward, every deploy automatically produces a live-verify outbox
file — no chat involvement needed for basic endpoint health/data checks.

## Deferred confirmation (by design — Rule 87 note)

**This workflow's actual firing and output will only be confirmed on the NEXT
deploy after this one — not verifiable in this session, by design.** The
`workflow_run` trigger fires when `Deploy RELAY Worker` completes; this workflow
itself was shipped in the same push that triggers one such deploy, so the first
firing will be on the deploy *after* this commit lands.

Confidence scored on CC-verifiable portion only (YAML validity, workflow logic,
trigger configuration) per the CC-CMD's explicit confidence gate note — full
self-completion deferred one deploy cycle, documented here not glossed over.

## Extensibility

The endpoint check list (`/circadian/preview`, `/circadian/late`) is a starting
point. Adding new curl blocks to the same `Live-check endpoints` step is
append-only and low-risk — a follow-up CC-CMD or direct small edit can extend
it for any new endpoint needing post-deploy verification.
