// Read jubilant-bassoon's team-event split FROM THE CLIENT, not from a copy of it.
//
// tennis-tier-ladders.mjs used to hold two string literals naming which team
// events the client admits to the Draw tab and which it excludes. Those literals
// were a copy of the client's source living in the other repo, and a copy has
// exactly one failure mode, which it then had: the client changed, nobody
// mirrored the change here, and the run stayed red against the stale copy for
// three weekly scheduled runs (2026-09-21, 09-28, 10-05). The reverse is worse
// and silent — a change made only here reports drift that does not exist.
//
// The probe's own header said the client "cannot notice — its lists are
// literals" while its lists were literals too.
//
// WHAT COUNTS AS THE CLIENT. Two different questions, so two reads:
//   DEPLOYED  the page a reader loads. This is the one that decides whether a
//             draw is actually unreachable, and it is what the check is for.
//   SOURCE    src/legacy/field.js on main. Disagreement with DEPLOYED is a
//             client change that has not shipped, which is its own finding.
// index.html is not read: its script block is generated from field.js by
// scripts/sync-source.mjs, so it is a copy of the source in the source's repo.
//
// REFUSAL IS NOT AGREEMENT (Rule 99). Every failure here throws. An unreadable
// client must not produce an empty exclusion list, because an empty list makes
// the drift comparison vacuously true and the run green — a green that means
// "I could not look" is the one outcome worse than red.

/** Arms of `_TENNIS_DRAW_NO_BRACKET = /^(A|B)$/` and keys of
 *  `_TENNIS_DRAW_NAMED_RANK = { 'A': 1, ... }`, or throws saying which anchor
 *  failed and why. `where` names the text so the message is actionable. */
function extractClientSplit(text, where) {
  if (typeof text !== 'string' || !text.length) {
    throw new Error(`${where}: nothing to read (${typeof text}, ${text ? text.length : 0} chars)`);
  }

  // Capture lazily up to the first `)$/` ON THE SAME LINE rather than with
  // `[^)]*`. The tight version could not match the client's own pre-2026-10-07
  // shape at all — `Cup( Group I)?)$/` leaves a `?` between the group's close
  // paren and the anchor — so it threw "constant not found" about a constant
  // that was right there, sending a reader to hunt for a rename. Refusing was
  // safe; the diagnostic was wrong, and a wrong diagnostic on a refusal costs
  // the next session the same hour. Found by mutation M8, not by reading.
  const reM = text.match(/_TENNIS_DRAW_NO_BRACKET\s*=\s*\/\^\(([^\n]{0,400}?)\)\$\//);
  if (!reM) {
    // Deliberately not a fallback to a wider pattern. If the constant was
    // renamed or its shape changed, the honest answer is that this parser no
    // longer knows what the client does.
    throw new Error(`${where}: no _TENNIS_DRAW_NO_BRACKET = /^(...)$/ found`);
  }
  const excludes = reM[1].split('|').map((s) => s.trim()).filter(Boolean);
  if (!excludes.length) throw new Error(`${where}: the exclusion alternation parsed to zero names`);

  // An arm carrying regex syntax is one arm standing for several names, and
  // this parser cannot say which. The client's own regex was
  // `Billie Jean King Cup( Group I)?` until 2026-10-07 — that arm is two names
  // and the `[^)]*` above would have swallowed the group open-paren, so this
  // check is what stops a mis-parse being reported as a reading. The client
  // must spell its arms as literal names; the fix if this throws is there.
  const syntactic = excludes.filter((n) => /[()?*+\[\]{}\\|]/.test(n));
  if (syntactic.length) {
    throw new Error(`${where}: alternation arm is not a literal name: ${JSON.stringify(syntactic)}`
                  + ` — spell each arm out in the client, this parser reads literal names only`);
  }

  const rankM = text.match(/_TENNIS_DRAW_NAMED_RANK\s*=\s*\{([\s\S]{0,4000}?)\}/);
  if (!rankM) throw new Error(`${where}: no _TENNIS_DRAW_NAMED_RANK = { ... } found`);
  // EITHER QUOTE STYLE. The deployed page is esbuild output, and esbuild
  // normalizes string literals to double quotes (it also rewrites `const` to
  // `var`, which these anchors do not depend on). Requiring single quotes made
  // the first live run refuse with "the rank map parsed to zero names" against
  // a map that was right there in double quotes — measured on run 10,
  // 2026-10-07T03:18Z, and reproduced locally by running the real pipeline
  // (scripts/build-bundle.mjs then scripts/strip-comments.js), which prints
  //   var _TENNIS_DRAW_NAMED_RANK = {
  //     "ATP Finals": 1, ...
  // The regex literal survives esbuild verbatim, so only this needed widening.
  const admits = [...rankM[1].matchAll(/['"]([^'"]+)['"]\s*:\s*\d+/g)].map((m) => m[1]);
  if (!admits.length) {
    // The excerpt is the whole point of this message. Without it the first
    // refusal said only "parsed to zero names", and finding out why took
    // reproducing the client's build pipeline. A refusal that does not show
    // what it was looking at costs the next reader that hour again.
    const seen = rankM[1].replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new Error(`${where}: the rank map parsed to zero names — found at the anchor: ${
      seen ? JSON.stringify(seen) : '(nothing)'}`);
  }

  // The regex is tested BEFORE the rank lookup in _tennisDrawPick, so a name in
  // both is excluded whatever its rank says. That is a client defect rather
  // than drift between the repos, and it is reported as one.
  const both = admits.filter((n) => excludes.includes(n));

  return { where, excludes, admits, contradictory: both };
}

const CLIENT_REPO = 'jeffunglesbee-create/jubilant-bassoon';
const CLIENT_SOURCE_PATH = 'src/legacy/field.js';
const CLIENT_DEPLOYED_URL = 'https://jubilant-bassoon.jeffunglesbee.workers.dev/';
const CLIENT_SOURCE_URL =
  `https://raw.githubusercontent.com/${CLIENT_REPO}/main/${CLIENT_SOURCE_PATH}`;

/** Both readings of the client, each either parsed or refused with a reason.
 *  DEPLOYED decides a drift verdict — it is the page a reader loads, and the
 *  question is whether a real draw is unreachable. SOURCE is read so a client
 *  fix that has not shipped shows up as its own finding rather than as
 *  agreement. There is deliberately NO fall back from one to the other.
 *
 *  Unauthenticated: jubilant-bassoon is public (verified 2026-10-07 by
 *  `gh api repos/jeffunglesbee-create/jubilant-bassoon` -> "visibility":
 *  "public"), so no secret is added for this. If it is ever made private the
 *  source read fails loudly here instead of quietly parsing an error page —
 *  an error page contains neither anchor, so extractClientSplit throws.
 *
 *  `fetchImpl` exists so the refusal paths can be exercised without a network;
 *  scripts/check-client-tennis-split.mjs drives every one of them. */
async function readClient(fetchImpl = fetch) {
  const reading = { deployed: null, source: null, refusals: [], sourceAgreesWithDeployed: null };
  const targets = {
    deployed: { url: CLIENT_DEPLOYED_URL, where: `DEPLOYED ${CLIENT_DEPLOYED_URL}` },
    source: { url: CLIENT_SOURCE_URL, where: `SOURCE ${CLIENT_REPO}:${CLIENT_SOURCE_PATH}@main` },
  };
  for (const [key, { url, where }] of Object.entries(targets)) {
    let text = null;
    try {
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(60000),
                                       headers: { 'User-Agent': 'field-relay-tennis-tier-ladders' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      text = await r.text();
    } catch (e) {
      reading.refusals.push(`${where}: could not read — ${e.message}`);
      continue;
    }
    try { reading[key] = extractClientSplit(text, where); }
    catch (e) { reading.refusals.push(e.message); }
  }
  if (reading.deployed && reading.source) {
    const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    reading.sourceAgreesWithDeployed =
      same(reading.deployed.excludes, reading.source.excludes)
      && same(reading.deployed.admits, reading.source.admits);
  }
  return reading;
}

module.exports = { extractClientSplit, readClient, CLIENT_REPO, CLIENT_SOURCE_PATH,
                   CLIENT_DEPLOYED_URL, CLIENT_SOURCE_URL };
