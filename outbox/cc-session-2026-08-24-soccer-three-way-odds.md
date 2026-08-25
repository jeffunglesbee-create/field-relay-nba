# The draw was never dropped — it was never asked for

Closes `CC-CMD-2026-08-23-soccer-three-way-odds`.

## Result

```
"moneyline": { "home": 125, "away": 180, "draw": 240 }
```

| | |
|---|---|
| relay fix | `5a2bacc` — `drawPriceFrom` in `src/odds-shape.js` |
| deploy | run 874, green |
| gate | `scripts/three-way-odds-check.mjs`, 16 assertions |
| premise probe | `df64b28`, artifact `outbox/odds-h2h-shape-20260824T234850Z.json` |
| laboratory | unchanged, as scoped — status closed in `d28c02b` |

## Where the draw was going

The command says the price "is being dropped somewhere between the feed and
`opening_odds.moneyline`." It isn't. `extractOddsForGame` matched h2h outcomes
against exactly two predicates:

```js
const h = h2h.outcomes.find(o => o.name === home);
const a = h2h.outcomes.find(o => o.name === away);
if (h && a) out.moneyline = { home: h.price, away: a.price };
```

Association football prices three. The third matched neither, and **no code path
ever referred to it**. Same line, different diagnosis: there is no lossy step to
find, only a question nobody asked.

## Identified by position, not by name

`o.name === 'Draw'` is the obvious fix and the wrong one. It is a string literal
nothing in the sandbox can verify, and a renamed selection would silently drop
the price again — the defect class that emptied `UNREACHABLE_DIMS` and broke
`DIM_TO_SCALE` **on this same day**.

On a three-outcome market the entry that is neither team **is** the draw, by
construction. There is no literal to drift. Asserted against `Tie`, `Empate`,
`X`, `DRAW` and `""`.

The probe later showed the feed does call it `"Draw"` today — so a name match
would have worked. Position costs nothing extra and survives the rename that
would break it.

## No sport check, deliberately

The ask requires non-soccer markets not to gain a null draw. A branch on sport
could be wrong about which competitions draw. A two-outcome h2h simply has no
third entry — **the shape enforces it**, which is stronger than a conditional
that has to be right.

Corners that must yield nothing, all asserted: four outcomes, a null third price,
a missing team, a one-entry array, an empty array, a null array. Picking one of
several unknown entries is how a wrong price reaches a card that looks right.

## The premise was inherited and unmeasured

The command asserts the feed prices all three outcomes. **The fix was built on
that sentence.** Rule 72 makes it a hypothesis until probed, and the sandbox
403s `*.workers.dev` — so it went to CI:

```
PREMISE HOLDS — every one of 10 sampled soccer h2h markets prices three outcomes

soccer_usa_mls  30 games  Chicago Fire @ Seattle Sounders  {home 170, away 120, Draw 285}
soccer_epl      20 games  Man City @ Crystal Palace        {home 400, away -165, Draw 320}
```

`outcome_count: 3`, `third_selection: "Draw"`, ten for ten.

**The probe reports the shape and asserts nothing.** Asserting three outcomes
would have made a false premise look like a broken probe. Four verdicts, all
legitimate:

| verdict | meaning |
|---|---|
| `PREMISE HOLDS` | the fix will fire on real data |
| `PREMISE FALSE` | the fix is correct and inert; the ask needs a different market key or region |
| `MIXED` | it works where they price three |
| `NOT OBSERVABLE` | no soccer h2h from this book right now — says nothing |

A fetch failure is a **failed probe**, not a finding: the script exits non-zero
and prints "nothing above is established" rather than emitting a verdict about a
feed it could not read. Confirmed by running it from the sandbox, where it
reported the 403 as a probe failure rather than as a two-way market.

**What it rules out** is the real value. If the follow-up now reports `false` on
a post-deploy slate, the premise is off the table and the fault is between the
adapter and `/context/date` — a far narrower search than "somewhere upstream".

## Cost, against a scar

Rule 78. A June session shipped two Odds API helpers with no caching and burned
**19,999 of 20,000 credits in one sitting**.

This probe never touches `api.the-odds-api.com`. It goes through the relay's own
`/odds` proxy and its 3600s edge cache (`ODDS_TTL_ODDS`), so a sport key any cron
already fetched within the hour costs **zero** credits and a cold one costs one.
One region, one market, one bookmaker, two sport keys, five games sampled each.

The relay fix itself adds **no** request — the draw was already in the payload.

## Why the rule lives in its own module

`src/index.js` imports `@cloudflare/puppeteer` and `deploy.yml` runs no
`npm install`, so a gate importing the whole worker could not run there.
`src/odds-shape.js` holds the decision; index.js imports it. One implementation
with two readers, never a copy.

Three assertions check the wiring — that `index.js` imports it, applies it to
`h2h.outcomes`, and only sets the key when a price came back. A module nothing
calls is worth nothing, and an unconditional assignment would put a null draw on
every non-soccer market.

## The artifact is not observable yet, and the wait is structural

Not a partial build. field-laboratory's `cc-cmd-followup.mjs` probes
`/context/date/${yesterdayUTC()}`, and `opening_odds` freeze at capture (~10:01Z
on the game date). So the first slate captured against the deployed adapter
becomes "yesterday" for the **2026-08-26 02:30Z** drift-sentinel run.

Runs #46 (13:02Z) and #47 (23:21Z) on the 24th both read pre-deploy rows. **A
`false` from either is arithmetic, not evidence** — worth stating, because the
timestamps alone would let a later reader mistake it for a failed fix.

- Check-in scheduled 2026-08-26 03:15Z (`trig_01H5WvdFB2EzsMJroVF92BAA`).
- Verify: `::notice::LANDED` in the drift-sentinel job log, or a `draw` key in
  `/context/date`'s soccer `opening_odds.moneyline`.
- Reads as: LANDED → the chain is closed feed → adapter → `/context/date` → the
  laboratory's three-way card. `false` → look downstream of the adapter.

## Files

- `src/odds-shape.js` — `drawPriceFrom`, new
- `src/index.js` — `extractOddsForGame` applies it
- `scripts/three-way-odds-check.mjs` — 16 assertions, deploy gate
- `scripts/odds-h2h-shape-probe.mjs` + `.github/workflows/odds-h2h-shape-probe.yml`
- `docs/CC-CMD-2026-08-23-soccer-three-way-odds.md` (field-laboratory) — status
