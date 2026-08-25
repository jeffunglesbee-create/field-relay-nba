# CC-CMD-2026-08-25-spread-price-capture

**Filed from:** field-laboratory, after a 45-day census.
**Ask to:** field-relay-nba, `extractOddsForGame`.
**Status:** OPEN.

## The evidence, which did not exist when this was first suggested

`favourite-band-census` over 45 days, 621 games carrying a moneyline and a
balanced handicap. Four judged disagreements, and every one of them:

```
2026-08-09  MLB_2026-08-09_mariners_rays      ML -114/+106  H +1.5
2026-08-08  MLB_2026-08-08_mariners_rays      ML -121/+101  H +1.5
2026-07-25  MLB_2026-07-25_redsox_bluejays    ML -122/+101  H +1.5
2026-07-19  MLB_2026-07-19_astros_orioles     ML -122/+101  H +1.5
```

Home favourite, a price range spanning nine cents, `+1.5` every time, and **not
one away-favourite case**. `MLB_2026-08-25_padres_pirates` at `-124/+103 H +1.5`
is the same shape and is what started this.

**None of them can be adjudicated from what the relay stores.**

## Run 2 made the case harder to dismiss

Extended to 60 days, 779 games, and the census now reports the disagreement
rate by which side is favoured, among judged games inside 3x the vig:

```
home favourite    143 game(s), 9 disagree (6.3%)
away favourite     80 game(s), 0 disagree (0.0%)
```

**Nine on one side, zero on the other.** If the book's choice of which side lays
`-1.5` were near-arbitrary near an even market, both sides would show it. Eighty
away-favourite games producing zero disagreements is not that. One-sided is the
signature of a feed or adapter artefact.

All nine sit between `-114` and `-126` on the home moneyline, holding `+1.5`.
The spread price is what separates "a favourite's normal alternate line" from "a
contradiction," and it is the only thing that does.

## What is discarded

`extractOddsForGame` — `src/index.js`, `out.spread = { home: h.point, away: a.point }`:

```js
if (spreads) {
  const h = spreads.outcomes.find(o => o.name === home);
  const a = spreads.outcomes.find(o => o.name === away);
  if (h && a) out.spread = { home: h.point, away: a.point };
}
```

The Odds API returns `price` on every spread outcome, beside `point`. It is read
and thrown away. With it, each row above answers itself:

- `+1.5 at -240` — the normal alternate line for a favourite. Nothing is wrong.
- `+1.5 at +130` — genuinely contradictory, and a real finding.

Without it, the laboratory's `favouriteAgreement` can never be better than
"these two numbers look odd together," which is what it currently is.

## The ask

1. **Probe first.** Print one live `spreads` market's raw outcomes and confirm
   `price` is present beside `point` on both. Paste it. Do not write from this
   document.
2. **Capture it**, additively:
   ```js
   out.spread = { home: h.point, away: a.point,
                  homePrice: h.price, awayPrice: a.price };
   ```
   Additive because `spread.home` / `spread.away` are consumed by
   field-laboratory's `Odds` decoder and by the client. Nothing existing moves.
3. **Update CONTRACTS.md** in both repos — this is a cross-system shape and
   Rule 86 requires it.
4. **Guard it** in `scripts/three-way-odds-check.mjs` or a sibling: a spreads
   market yielding a `point` must also yield a finite price for both sides, and
   a market with no spreads must gain neither.

## Done condition

Not a green deploy. After one opening-odds cron cycle:

```
GET /context/date/<a date after the deploy>
```

must show a game whose `opening_odds.spread` carries `homePrice` and
`awayPrice` as finite numbers, pasted verbatim into the outbox manifest.

Then, laboratory side: re-run `favourite-band-census` and adjudicate the four
rows above. Each becomes either a normal alternate line or a real defect, and
this CC-CMD closes by naming which.

## Scope boundary

Do **not** change `favouriteAgreement` in field-laboratory as part of this. The
census established its vig threshold is correct and its blind spot is empty
(114 band games, 49.1% agreement — a coin flip). This ask is about capturing
data that already exists in the response, nothing else.
