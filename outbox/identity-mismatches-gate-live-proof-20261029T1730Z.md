# /identity/mismatches gate (Route B) — live proof, 2026-10-29 17:30Z

**Change:** `5c664f8` `feat: /identity/mismatches joins the way the relay's writers do, counts its rows, and is gated`, with the
probe and the two workflows that call it in `3f5dabf`, pushed together as `89f047a`. Route B of
`docs/CC-CMD-2026-10-23-unauthenticated-odds-spend-routes.md` TASK 1, released with B1 of the CFB Saturday CC-CMD.
**Deploy:** Deploy RELAY Worker run `40920118796`, success (17:18:51Z to 17:29:30Z). Repo guards run `40920117821`, success.

## Done condition 3, as run

Tool: the relay self-probe (`probe_relay_route`, which sends no credential), after the deploy reported success.

```
GET /identity/mismatches?date=2026-10-29&sports=CFB      (no Authorization header)
  status:       401
  content-type: text/plain;charset=UTF-8
  body:         Unauthorized          (12 bytes)
```

`/budget/odds` read 15 seconds before (17:29:46Z, `provider.checked_at`) and 15 seconds after (17:30:01Z) that probe:

| field | before | after |
|---|---|---|
| `daily.used` | 758 | 758 |
| `daily.by_site.identityMismatches` | 0 | 0 |
| `daily.by_site` (all 13 labels) | identical | identical |
| `daily.reconcile` (13 rows) | identical | identical |
| `monthly.used` | 46632 | 46632 |
| `daily.refusals` | `[]` | `[]` |

Nothing moved in the window, including the reconcile rows, so the "no cron tick between" condition held in the strong form.
The 0 to 0 on `identityMismatches` is weak evidence on its own (no other caller uses the label); the **401 is the artifact**,
and that the route cannot spend without the secret is shown by the checks below.

## What was NOT observed live, and the unblock

The authorized path and the NEW report fields (`d1_rows`, `d1_priced`, `priceable`, `slate_matched`, the verdicts) were not run
against the deployed worker: I do not hold `FIELD_MCP_SECRET`, and an off-schedule run of the probe workflow would spend about 12
ledger credits, which the CFB Saturday CC-CMD forbids without the owner's approval. They are exercised by
`scripts/check-identity-route-join.mjs` (41 checks, the real worker on the real 80-row slate) and
`scripts/check-odds-join-probe.mjs` (88 checks, the script against a local relay).
**Unblocked by:** the scheduled run of `.github/workflows/odds-identity-join-saturday.yml` on Saturday 2026-10-31 (cron 23:40Z;
it starts 1.5 to 3 hours late). **Verify:** the newest `outbox/odds-join-probe-20261101T*.json` has `probe_date` `2026-10-31`,
`http` 200, `report.sports.CFB` with numeric `d1_rows` and `d1_priced`, and a CFB verdict that is not a refusal; the wake
`trig_01Xrhu7D91b4WhnQKAcPYQS9` (2026-11-01T04:30Z) reads it.

## Checks and gates

`check-identity-route-join` 41 of 41 and its mutants 32 of 32; `check-odds-label-split` 80 of 80 and 27 of 27 (the gate with no
credential, a wrong one, the published relay secret by `Authorization` and by `X-FIELD-Relay`, an unset and an empty secret, the
right secret with something before or after it); `check-odds-join-probe` 88 and 47 of 47; `check-saturday-probe-workflow` 35 and
19 of 19. `gates.py` on the pushed tree, 152 steps: the last full run was 147 of 152 and its three non-environment failures were
fixed (below); the 62 steps that touch these files were re-run after the fixes and passed. CI on the pushed head: both runs green.

## What the gates found in my own work (all fixed before the push)

- `deploy: No absence-collapse site appears beyond the baseline` failed because removing two `|| []` sites from `src/index.js`
  left the baseline at 204 against a count of 202: the ratchet's own mutation (add one site) then passed, which it reports as
  `MUTATION NOT CAUGHT`. A ratchet with slack cannot catch a new site. The baseline was lowered to the true count with the
  tool the ratchet names.
- `deploy: A closing line's captured_at is a snapshot time, not the clock` failed because the route's `extractOddsForGame` call
  omitted the capture instant, and that check allows one call to omit it (the cron's live fetch). The route now states it.
- Earlier, the doc-citation ratchet and the Status vocabulary: a rewritten script moved a line that a CC-CMD cited.
