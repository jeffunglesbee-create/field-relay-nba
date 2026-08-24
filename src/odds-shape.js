// Which h2h outcome is the draw — the one decision in the soccer three-way fix.
//
// Split out from extractOddsForGame so a deploy gate can exercise it. src/index.js
// imports @cloudflare/puppeteer, which deploy.yml does not install, so a guard
// that imported the whole worker could not run there. One implementation,
// imported by both — not a copy, which is how one concept comes to have two
// versions that disagree.
//
// CC-CMD-2026-08-23-soccer-three-way-odds. Association football prices THREE
// outcomes; extractOddsForGame matched h2h against `home` and `away` and nothing
// else, so the third entry matched neither predicate. It was never dropped — it
// was never asked for. Measured 2026-08-23: fifteen MLS games, all {home, away},
// no draw, and every soccer card downstream rendered "three-way market; no draw
// price served" instead of a win probability.

/// The draw price, or null.
///
/// IDENTIFIED BY POSITION, NOT BY NAME. `o.name === 'Draw'` is the obvious fix
/// and the wrong one: it is a string literal nothing here can verify, and a
/// renamed selection would silently drop the price again — the defect class that
/// emptied UNREACHABLE_DIMS and broke DIM_TO_SCALE on this same day. On a
/// three-outcome market the entry that is neither team IS the draw, by
/// construction. There is no literal to drift.
///
/// NO SPORT CHECK, DELIBERATELY. The ask requires non-soccer markets not to gain
/// a null draw. A branch on sport could be wrong about which competitions draw;
/// a two-outcome h2h simply has no third entry. The SHAPE enforces it, which is
/// stronger than a conditional that has to be right.
///
/// Exactly three, never "more than two": a longer outcomes array is a shape this
/// has not seen, and picking one of several unknown entries is how a wrong price
/// reaches a card that looks right.
export function drawPriceFrom(outcomes, homeOutcome, awayOutcome) {
  if (!Array.isArray(outcomes) || outcomes.length !== 3) return null;
  if (!homeOutcome || !awayOutcome) return null;
  const d = outcomes.find(o => o !== homeOutcome && o !== awayOutcome);
  return d && Number.isFinite(d.price) ? d.price : null;
}
