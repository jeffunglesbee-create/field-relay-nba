# Claude Code Command — Signature-event detection: known-dates calendar + missing-entry alert

**Date:** 2026-07-14
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/signature-event-detection-2026-07-14.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

`SIGNATURE_EVENTS` (src/analytics-engine.js, shipped tonight) is a manually-curated registry feeding Night Stars' signature-event signal — currently one entry, the 2026-07-13 Home Run Derby. Its known limitation, stated in its own shipping CC-CMD: a future signature event needs a manual code entry + deploy to register, since there's no live feed the relay can poll for this event category. Confirmed via real investigation tonight why that's true and likely to stay true: the 2026 Home Run Derby moved exclusively to Netflix, the first year off MLB's own broadcast infrastructure — MLB's Stats API `/homeRunDerby/{gamePk}` endpoint stayed stuck in "Preview" state through the actual event (confirmed via 7 direct probe attempts, documented in codex key `hrd-live-gamepk-stuck-preview-2026-07-13`). ESPN's structured scoreboard returned zero events for that date too. This is a genuine, likely-persistent broadcast-rights-driven data gap, not a fixable query-shape bug — do not attempt to build a live-polling solution against it.

**What's actually buildable, and the sole scope of this CC-CMD:** signature events have known dates, published well in advance (MLB All-Star Week is a fixed, publicly announced schedule). The real risk this closes isn't "no live data" — that's accepted as a real constraint — it's "the event gets forgotten entirely," which is what nearly happened tonight until caught by hand hours after the fact. This CC-CMD builds detection (a known-dates calendar + a daily check that alerts when a known date has passed with no registry entry) — not data automation. A separate, future CC-CMD would build the draft-generation half (a scheduled workflow that does multi-source web verification the day after and proposes an entry for human review) — explicitly out of scope here, flagged as a real follow-on, not attempted.

## TASK 0 — Probe

```bash
grep -n "SIGNATURE_EVENTS" src/analytics-engine.js
grep -n "0 9 \* \* \*\|schedule:" wrangler.toml .github/workflows/*.yml 2>/dev/null | head -10
```
Confirm the real, current shape of `SIGNATURE_EVENTS` and the existing daily-sweep cron pattern (the same one PURE_FEATURES self-heals against) before building alongside it.

## TASK 1 — Known-dates calendar (real dates only, verified, not guessed)

Add `KNOWN_SIGNATURE_EVENT_DATES` (or similar, matching existing naming conventions) — a small array of `{ date, label }` entries for real, confirmed MLB All-Star Week signature events. Do not populate with guessed or memory-recalled dates — web-search each one and cite a real source before adding it, the same verification bar `HRD_2026_VERIFIED_FINAL`/`SIGNATURE_EVENTS['2026-07-13']` already used. Start narrow (this year's confirmed Derby date at minimum) rather than guessing at events whose existence or date this year isn't independently confirmed — a smaller, real list is better than a padded, assumed one. Document in the outbox exactly which dates were added and what source confirmed each.

## TASK 2 — Daily detection + alert

Wire a check into the existing daily-sweep cron path (reuse the real, current mechanism found in TASK 0 — do not invent a new cron schedule if one already fires at the right cadence): for each `KNOWN_SIGNATURE_EVENT_DATES` entry whose date has passed, confirm a matching `SIGNATURE_EVENTS[date]` entry exists. If not, surface this as a real, visible signal — the same shape as an open incident (writeable via the existing codex/incident mechanism this session has used all night, or a comparable durable, checkable signal already established in this codebase — TASK 0 should confirm which real mechanism is cleanest to reuse rather than inventing a new one). Self-clears once a real entry lands, the same way PURE_FEATURES degradation self-heals.

## TASK 3 — Verify

- `node --check src/analytics-engine.js`: clean.
- Real forced-condition test: inject a known-past test date with no `SIGNATURE_EVENTS` entry, confirm the alert fires. Inject a known-past date that DOES have an entry (2026-07-13 itself is real and available for this), confirm no alert fires. A future-dated known entry should also not alert (event hasn't happened yet).
- Confirm zero effect on Night Stars' own existing computation — this task only adds detection, not scoring changes.

## DONE CONDITION

A real, source-verified calendar of known signature-event dates exists. A daily check correctly and visibly flags any past known date missing a registry entry, self-clearing once filled, proven via real forced-condition tests (missing/present/future all correctly differentiated). Zero changes to Night Stars' scoring itself. Draft-generation (the web-search/auto-draft half) explicitly NOT attempted — flagged in the outbox as a real, separate follow-on.

**Confidence scoring:**
- TASK 0 confirms the real current registry shape and the real existing cron mechanism to reuse, not invented fresh (20 pts)
- TASK 1 calendar entries are real and source-verified, not guessed; starts narrow rather than padded (30 pts)
- TASK 2 detection reuses an existing, established alerting mechanism correctly, not a new bespoke one (25 pts)
- TASK 3 real forced tests for all three cases (missing/present/future), zero Night Stars scoring impact confirmed (25 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
