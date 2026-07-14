# Claude Code Command — Generalize BSD post-game capture from WC26-only to any covered league

**Date:** 2026-07-14
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/bsd-endgame-capture-generalize-2026-07-14.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

`runBSDEndgameCapture` (src/index.js ~L1742) captures momentum/stats/incidents/average-positions to R2 at game-final, feeding a jubilant-bassoon post-game pitch replay (a client-side CC-CMD dispatched alongside this one fixes that side's own WC-only gating — coordinate the R2 key format with it, see TASK 2). This function is genuinely WC26-specific at the data source, not just at the write-key level — confirmed by reading its real, current body tonight, not assumed:

```js
// Fix: BSD /api/v2/events/live/ excludes national team competitions (league_id=27).
// WC games never appeared in live endpoint — runBSDEndgameCapture never fired.
// Use by-date+league_id=27 instead...
const dateResp = await fetch(`.../events/?date=${today}&league_id=27`, ...);
```

This `date`+`league_id=27` query is a **deliberate workaround for a BSD quirk specific to national-team competitions** — BSD's normal `/api/v2/events/live/` endpoint excludes them, so this function queries by date instead. MLS (lid=18) is a club league, not a national-team competition — it may not hit the same exclusion, meaning it could already be reachable via the simpler, standard `/live/` endpoint rather than needing this same by-date workaround. **This is a real, unverified hypothesis, not a confirmed fact — TASK 0's job is to check it empirically against BSD's real API, not assume either way.**

## TASK 0 — Probe (empirical, against the real BSD API — this determines the whole design)

Using `BSD_API_TOKEN` (available in this environment, not available to the dispatching chat session), check directly:
```bash
curl -s "https://sports.bzzoiro.com/api/v2/events/live/" -H "Authorization: Token $BSD_API_TOKEN" | ...
```
Does a real, currently-live non-national-team match (any covered club league — EPL, UCL, La Liga, etc., whatever's live at investigation time) appear in this standard `/live/` endpoint with real `current_minute` data? If nothing is live at investigation time, check BSD's own API documentation (if reachable) or historical R2/log evidence from a known past club-league match for the same signal. Do not guess from the WC26 comment's own reasoning alone — confirm directly.

**If club leagues DO appear correctly in `/live/`:** the fix is likely simpler than replicating the WC26 date+league_id workaround — extend (or add alongside) a standard `/live/` poll covering all BSD-tracked leagues, since the specific bug the date-workaround exists for doesn't apply to them.

**If club leagues do NOT appear correctly in `/live/`** (the exclusion is broader than "national team only," or some other quirk applies): the by-date+league_id pattern likely needs generalizing to loop over every BSD-covered `league_id` (1, 7, 8, 3, 4, 5, 6, 18 — confirmed coverage from earlier tonight's own matrix), not just 27.

Either way, document the real, empirical finding in the outbox before writing any capture logic — this is not a task to proceed on assumption.

## TASK 1 — Generalize the capture (design follows directly from TASK 0's real finding)

Based on TASK 0's confirmed mechanism: capture momentum/stats/incidents/average-positions for any BSD-covered live game crossing the 80-120 minute window, not just WC26. Preserve the existing `captureWithRetry` retry logic and `Promise.allSettled` isolation pattern unchanged — this task changes which games get captured and how they're keyed, not the capture mechanics themselves.

**R2 key format:** change from the hardcoded `bsd/wc26/${bsdId}` prefix to a sport-parameterized one, e.g. `bsd/{sportSlug}/${bsdId}` — derive `sportSlug` from real, available data on each `game` object (BSD's own league_id, mapped to the same slug convention the client uses — confirm the exact real mapping needed by checking what sport-slug format the client-side CC-CMD's fix expects, since these two repos must agree on this format or the client will silently find nothing). Keep WC26 games writing to `bsd/wc26/...` specifically (not `bsd/wc/...` or similar) — the client's post-game replay path for WC26 already reads that exact prefix and must keep working unchanged.

## TASK 2 — Verify

- `node --check src/index.js`: clean.
- Real evidence the new capture logic fires for a real or realistically-simulated non-WC26 game — either a genuine live club match during this session's window, or a forced-condition test using real BSD response shapes if nothing is live at execution time. State plainly which was possible.
- Confirm WC26's own existing capture path and R2 key format are unchanged — this is additive, not a replacement of working WC26 behavior.
- Cross-check the exact R2 key format against the client-side CC-CMD's own real, landed change (read its outbox if already executed) — confirm both sides agree, not just that each side individually seems reasonable.

## DONE CONDITION

Post-game BSD capture works for any covered league, not just WC26, with the real mechanism (live-endpoint vs. date-workaround) determined by empirical investigation, not assumption. R2 key format confirmed to match what the client actually reads. WC26's existing behavior fully preserved.

**Confidence scoring:**
- TASK 0 (35 pts): real empirical evidence for whether club leagues appear in the standard /live/ endpoint, not assumed from the WC26 comment's own reasoning
- TASK 1 (35 pts): capture generalized using the mechanism TASK 0 actually found, R2 key format sport-parameterized and cross-confirmed against the client's real expectation, WC26 path unchanged
- TASK 2 (30 pts): real evidence of the new path firing (live or realistic forced test, honestly labeled which), WC26 non-regression confirmed, cross-repo key format agreement confirmed

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
