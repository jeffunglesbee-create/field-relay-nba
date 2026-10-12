# Odds watches — daily read, 2026-10-12

Read at 18:37Z from each watch's committed artifact. **Four of seven had not
fired today**, which is GitHub's scheduler running late, not the watches failing:
the repo's other scheduled workflows fired through the afternoon (odds coverage
census at 17:53Z). No credits spent. Nothing differencing was dispatched.

## Verdicts

| watch | today | artifact |
|---|---|---|
| odds-daily-vs-vendor | **RED** — `we-overcharge-ourselves`, residual `-1220` (tolerance 140); `unreconciled estimate : 584 over 292 call(s) in state no-header`; `residual after it : -636` | `odds-daily-vs-vendor-2026-10-12T0548.log` |
| odds-attribution-gap | **not fired** — 09:20 slot, 557 min at read time; its last 6 fired 363–431 min late | last: 10-11, `ok` |
| odds-site-drift | `gap-did-not-grow` 02:50→09:52, `usedD 6`, `gap 0`; the 12:00, 15:00 and 18:00 slots had not fired | `odds-site-drift-2026-10-12T0952.log` |
| odds-pairing-rate | **not fired** — 11:00 slot, 577 min; this workflow's own worst is 508 (10-05). Retry check-in armed 20:05Z | last: 10-11 |
| silently-dead-crons | **not fired** — 12:15 slot; last 6 fired 17:19–18:54Z. Yesterday's 3 NEW: see below | last: 10-11, RED |
| undeployed-src | `deployed` — "every deploy-triggering commit has been through a successful deploy" | `undeployed-src-2026-10-12T1601.log` |
| /budget/odds | 2026-10-12 at 09:52Z: `used 513`, `no veto recorded today` (10-11 at 09:21Z: 717, ceiling by 14:03:59Z) | read via site-drift |

## Watch 1 — closed day 2026-10-11

Covered in full by HANDOFF 2026-10-12c. The `no-header` tally is the pre-fix
rate (292 / 584, against 289 / 578 at 16:51Z), and **−636 is left after it,
explained by nothing named**; 2026-10-10's was +107. The 2026-10-12 closed day
is the first with `no-header` near zero (the 02:50Z drift sample has none) and is
read by the check-in armed for 2026-10-13T06:30Z.

## Watch 5 — yesterday's three NEW dead crons

| workflow | now | evidence |
|---|---|---|
| `field-laboratory` `drift-sentinel.yml` | **recovered** | scheduled run 38218407008, 07:33Z, success |
| `field-relay-nba` `tennis-tier-ladders.yml` | **recovered** | scheduled run 38252843205, 13:01Z, success |
| `jubilant-bassoon` `forward-window-probe.yml` | **probe fixed; cause NOT established** | below |

Neither recovery is admitted to the baseline. The watch judges the last three
scheduled runs, so both leave its NEW list on their own.

### forward-window-probe

Four scheduled runs, 10-08 to 10-11, died two seconds in, verbatim from job
114520235166:

```
page.evaluate: TypeError: Cannot read properties of undefined (reading 'scheduleForDate')
    at /home/runner/work/jubilant-bassoon/jubilant-bassoon/forward_window_probe.js:66:33
```

`window._plVerify` was undefined in the context the window read ran in. The
probe then exited before `writeFileSync`, so **none of the four left a manifest**,
although the workflow says it commits one "either way". The last manifest on
file was 10-07's.

**What was measured, and what it does not establish:**

- No client code changed between the last green run (10-07 17:52Z) and the first
  red one (10-08 17:54Z): `git log` over `src/legacy/field.js`, `index.html` and
  `sw.js` for that window is empty.
- `@playwright/test` 1.64.0 was published 2026-10-07T20:44:27Z, inside that
  window. The workflow installs it unpinned (`^1.44.0`). **The timing fits, and it
  is not a cause:** three local runs did not reproduce the crash, on 1.61.1 or
  1.64.0, with and without a page reload landing mid-wait.
- After the fix, run 38293199977 (dispatch, 18:47Z) **passed** on 1.64.0:
  `windowDaysReachingClient 3`, `windowMlbTotal 4`, one main-frame navigation,
  `readFailures []`, `metaError null`. The retry never engaged, so the pass is
  not evidence that it was needed.

**What changed in the probe** (`jubilant-bassoon` `e1681b21`): the error from its
first wait is kept instead of swallowed by `catch(() => null)`; every main-frame
navigation, each failed read, the stage it died in and the Playwright version
go into the manifest; a crash writes the manifest too; the window read waits
for the API in the current document, at most three attempts, each failure kept.
What is asserted did not change.

If the crash recurs on a scheduled run, its manifest now names the stage and
the error. That is the measurement the four red runs could not leave.

## Not done, and why

- Watches 2, 4 and 5 are unread for today because they have not run. Watch 4 has
  a check-in at 20:05Z; 2 and 5 are read by tomorrow's routine.
- The −636 has no cause and none is offered (Rule 100). 10-12's closed day is the
  reading that tests it.
