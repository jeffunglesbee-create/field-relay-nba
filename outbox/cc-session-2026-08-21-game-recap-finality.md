# CC Session — 2026-08-21 — brief-data-quality ask 2 (game_recap gated on finality)

**Serves:** `docs/CC-CMD-2026-08-20-brief-data-quality.md` rev 3, ask 2.
**HEAD:** `a91ee93` → `0a69e15` (fix) → `389948e` (ci) → `4050679` (probe refinement)
**Deploy:** run `32444882952`, success 2026-08-21T03:51Z.

## Root cause — a classifier that could not do what its comment claimed

```js
// "presence of scores distinguishes a true game recap from a pre-game brief"
briefType = (home_score != null) ? 'game_recap' : 'narrative_context'
```

Score presence separates PRE-GAME from NOT-PRE-GAME. It cannot separate
IN-PROGRESS from FINAL — a game five minutes in has a score of 0-0. So every live
capture was written as a recap. That is how *"remain scoreless at Lumen Field
through 46 minutes of play"* shipped as a `game_recap` on 2026-08-19 and scored
191, top of the slate.

There was also **no upstream gate**: the cron enqueue loop iterates every
scoreboard event regardless of `status.type.state`, and its dedup hash
deliberately *includes* the status description, so one game is re-enqueued as its
state changes through the day. In-progress briefs were not an accident.

## Four writers, one rule

`brief_type` was decided in four places — three hardcoded `'game_recap'` literals
plus that classifier. All now route through one helper, because four copies of a
rule is precisely how the `LEAGUES` / `SOCCER_LEAGUE_LABELS` split happened
(closed 2026-08-20).

| site | signal used |
| -- | -- |
| queue consumer (**dominant writer**) | `job.isFinal` = ESPN's own `status.type.completed`, forwarded at enqueue |
| `/archive/game` KV capture | `finalized_at` via `isGameFinalByEventId` |
| `kv_sweep` | `finalized_at` (fresh inserts only — type preserved on conflict) |
| `kv_repair` | `finalized_at` (same) |

The queue consumer uses the state **at generation time**, which is the actual
truth about whether that prose describes a finished game, and costs no extra
lookup. `status.type.completed` was already trusted at ~L8548 as the debrief-block
gate — same signal, not a new judgement.

## start_time is the artifact, not the gate

`created_at < start_time` catches all five originally-observed rows but misses a
halftime capture — after kickoff, still not a recap. Finality gates; the
timestamp measures. Keeping those separate is the point.

## Rule 86 — checked before writing, not after

`brief_type` crosses to the client. Consumers traced in `jubilant-bassoon`: three
`brief_type=slate` filters (unaffected) and one generic renderer doing
`type.replace('_',' ')` with no switch. `game_live` degrades to an unstyled chip.
**Client-safe, verified.**

Beneficial side effect: `SELECT DISTINCT game_id … WHERE brief_type='game_recap'`
— the "does this game already have a recap" check — now correctly excludes live
snapshots, so a game still receives a real recap once final. It previously would
not have.

## Measured residue — and a correction to my own first number

First probe run reported **513** `game_recap` rows whose `created_at` precedes
their game's `start_time`, and I quoted it before checking the schema. That was an
**upper bound, not a defect count**. `briefs` has `created_at` and **no
`updated_at`**, and every write site's `ON CONFLICT DO UPDATE` refreshes
`brief_text` without touching `created_at` — so a row seeded pre-game and later
refreshed with genuine recap prose still reads as "written before kickoff."

Intersecting the timestamp signal with in-progress *language* separates them
(`4050679`):

```
pre-kickoff created_at (upper bound):   513
  ...AND live phrasing (real defects):   41
  -> merely-updated rows:               472     only 8% of the upper bound are real
```

The artifact alone overstated the problem **12.5×**. Worth recording as a
property of the artifact, not a one-off: the timestamp test is structural and
unevadable, which makes it the right check on NEW rows where the finality gate
decides type at write time — but on HISTORICAL rows it cannot distinguish a
defect from a normal update.

## Status

- **Code path: VERIFIED.** Deploy `32444882952`, step 9 `game_recap gated on
  finality` — success, immediately before step 10 (deploy). Three guards from
  this session now gate every deploy (soccer three-table, drama number,
  finality).
- **End-to-end: PENDING.** `brief_type` census is `game_recap 1475`,
  `narrative_context 171`, **`game_live 0`** — correct, since the deploy landed
  03:51Z and no `*/15` tick has yet written a brief for an in-progress game. The
  first `game_live` row is the true confirmation. Probe:
  `outbox/brief-join-premise-manifest-*.json` → `recap_types_present` must
  contain `game_live`.

## Guard, negative-tested

```
hardcode 'game_recap' back into an INSERT -> FAIL: hardcodes a brief_type literal
drop isFinal from the enqueue             -> FAIL: no longer forwards isFinal
```
The second is the one that earns its keep: without `isFinal`, `job.isFinal` is
`undefined`, every brief resolves to `game_recap`, and the pre-fix behaviour
returns **silently** — a deletion a diff review would very likely wave through.

## Residual — a data decision, not deferred work

41 historical rows are genuinely mislabelled. Cleanup is a live-D1 mutation
outside this ask and needs explicit authorisation, same as the UEFA label row
(2026-08-20) and the drama-number rows (ask 1). The fix is a targeted `UPDATE`
on those 41 ids with pre-state assertion — not a blanket rewrite. The probe keeps
the count visible.
