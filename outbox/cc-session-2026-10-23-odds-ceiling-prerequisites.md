# CC session — three fixes before any per-consumer odds ceiling (2026-10-23)

`docs/CC-CMD-2026-10-23-odds-ceiling-prerequisites.md`. The owner dispatched
"next approved" (Task 3 of `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`,
the per-consumer ceiling). The premise test refuted six of its premises, and the
owner ruled "Hold it; fix 3 first". Standing order the same day, BUILD-ON-A:
"We should always be building and not duplicating or working against previous
cc-cmd's". Two more owner rulings this session: fix 2 takes shape (a), "make
the join match"; commits keep the CLAUDE.md identity.

**Status:** PARTIAL. Fix 1 and fix 3 A-D are live. Done condition 3 waits on
the next scheduled pairing-watch run (2026-10-24, about 15:40Z). Fix 2 moved to
`docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md` (ruled
(a), being built, lands after the 10-25 11:07Z read). Fix 3 E (the stamp's
write can fail) is filed for the owner.

**HEAD:** `4bcfc5a` → `e259c39` → this close-out. Branch main throughout.

## What landed

| commit | what |
|---|---|
| `da44521` | Fix 1. `_captureClosingOdds` returns `false` when the guard declines; `_poll` withdraws those games from the capture record and writes it at once, so the next poll in the window buys them |
| `35d61ec` | Fix 3, first version: the pairing watch reads `ceiling_reached_at` and month headroom. Found incomplete |
| `1e9fbf1`, `bde93af` | accounting-edges item 1 is multiplied by fix 1's retry; fix 2 folded into the 10-21 join CC-CMD |
| `b3f8d69` | The 10-23 audit (workflow `wf_dd67792d-4ca`) folded into the CC-CMDs that already own each finding |
| `8e4a4cf` | Fix 1 harness: W23 (billed failures keep the record), two games refused together (W21, S20), W22 (the month-veto phantom pinned on the real `chargeOdds`) |
| `69ce2b6` | TASK 0 results; fix 3 reopened |
| `15d5cfe` | Fix 3 A: the day stamp lives `(SITE_TTL_DAYS + 1)` days |
| `09b89ea` | Fix 3 B: `/budget/odds?date=` serves `month_limit_reached_at` for the date's month |
| `0733d2b`, `b03bb01` | Harness hardening from the review: first-not-latest, the month stamp's lifetime, a failed read, `expiration` modelled; W22 routes every `odds_*` statement to SQLite |
| `aadf296` | Fix 3 C: the watch judges a refusal by the two stamps |
| `c483872` | Owner ruling on fix 2 recorded in the 10-21 CC-CMD |
| `8d7ea20`, `370f895` | Fix 3 D: a stamp read that throws is named in `stamps_unreadable`; the watch reads it as `not-reported` |
| `e259c39` | CC-CMD: A-C landed, D recorded, fix 3 E filed |

## Verification

| check | result |
|---|---|
| Fix 1 harnesses | write 34 of 34 mutations caught; dedup 50 of 50. The four new mutations pass the old harnesses and fail the new |
| Fix 3 replay (`check-ceiling-reached.mjs`) | real `chargeOdds` and `peekDailyOdds`, node:sqlite, a KV that expires keys as Cloudflare does. 24 of 24; red against each parent. `mutate-ceiling-reached` 26 of 26, crashes counted as harness errors, not catches |
| `check-monthly-atomic` | 90 of 90; `mutate-monthly-atomic` 32 of 32 |
| Watch | self-test 14 refusal cases; `mutate-odds-pairing-rate` 26 of 26 |
| Adversarial reviews | `wf_ab03e793-34e` (src 0 findings; harness 6, all verified and fixed; ops 1, built as D). `wf_07599759-ba8` on D: 5 minor, all verified; 4 fixed, 1 filed as fix 3 E |
| Clean-clone gates, every step of deploy.yml and guards.yml | 131 of 133 at each push (`8e4a4cf`, `aadf296`, `63ca846`); the 2 failures are environment-only (BSD frames list HTTP 0; RELAY_SHARED_SECRET) |
| Deploys | `bde93af` run 40023071623; `aadf296` run 40029905648; both green, with Repo guards green |
| Live | `/budget/odds?date=2026-10-22` serves `ceiling_reached_at: null, month_limit_reached_at: null`; the committed `refusalVerdict` reads it as `none`, and as `not-reported` with the field removed |

## Integration state (Rule 65)

- **Relay contract.** `/budget/odds?date=D` → `daily`:
  - `ceiling_reached_at` (stamp now lives 3 days);
  - `month_limit_reached_at`: ISO string, `true` (hour unknown) or `null`, from
    `odds:credits:<D's month>:warned:limit`;
  - `stamps_unreadable`: `null`, or the names of the stamp fields whose read
    failed.
- **Consumer.** `scripts/watch-odds-pairing-rate.mjs` `refusalVerdict(day)`.
  No client consumer; CONTRACTS.md has no `/budget/odds` entry.
- **Status.** STAGED until the next scheduled pairing-watch run reads
  `refusals, closed day <D> : none`. Verify: the run's log line, or
  `/budget/odds?date=<D>` through the relay self-probe with all three fields
  present.

## Open items, each filed

- Fix 2: `docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md`,
  shape (a), map and design workflow `wf_0d274771-67f`; lands after the
  2026-10-25 11:07Z read.
- Fix 3 E (a failed stamp write reads as no refusal): in the prerequisites
  CC-CMD; a schema and `chargeOdds` change, the owner's call.
- 09-16 Task 3: HELD by the owner.
