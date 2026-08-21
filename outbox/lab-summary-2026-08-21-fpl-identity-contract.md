# field-laboratory summary — FPL prerequisite resolved, one team-identity table

**Date:** 2026-08-21 · **Repos touched:** field-relay-nba, jubilant-bassoon
**Bears on:** `CC-CMD-2026-08-21-fpl-event-grounding-epl`
**Commits:** relay `6d0e31f`, client `9a9fef9b`

The FPL ask names a prerequisite it does not decide: it says to *"reuse"* the
client's `FPL_SHORT_NAME_MAP` for the FPL→game join, and separately to state in
`CONTRACTS.md` which feed owns the shared fields. Both are now settled, so the
build has nothing left to guess at.

---

## 1. The two-alias-table problem — settled by measuring, not by preference

`FPL_SHORT_NAME_MAP` (`jubilant-bassoon/src/legacy/field.js:19195`) is a 12-entry
club-alias map. The relay's `resolveTeamKey` (`src/identity-resolver.js`) is
another. Reusing the client map as the FPL ask suggests would mean **two
independent alias tables, in two repos, for the same clubs** — the divergence
`CONTRACTS.md` exists to prevent, and the same shape as the 173-line drift found
in `CONTRACTS.md` itself earlier today.

Rather than argue it, every entry was tested:

```
ok   Man Utd       -> Manchester United        ok   Leeds        -> Leeds United
ok   Man City      -> Manchester City          ok   Newcastle    -> Newcastle United
ok   Nottm Forest  -> Nottingham Forest        ok   Brighton     -> Brighton & Hove Albion
ok   Nott'm Forest -> Nottingham Forest        ok   Bournemouth  -> AFC Bournemouth
MISS Spurs         -> Tottenham Hotspur        ok   Sunderland   -> Sunderland AFC
ok   Wolves        -> Wolverhampton Wanderers  ok   West Ham     -> West Ham United

client aliases the relay resolver does NOT cover: 1 / 12
```

**Eleven of twelve already resolved. `Spurs` was the only gap.** Added `Spurs`
and `Tottenham`; the count is now **0 / 12**.

So the client map is a strict subset, and the second table is **unnecessary
rather than merely redundant**. The FPL→game join resolves through
`resolveTeamKey` like every other join. `FPL_SHORT_NAME_MAP` is retained only
until its call sites are repointed and **must not gain new entries** — any FPL
spelling found missing goes into `identity-resolver.js`, where the collision
guard covers it.

The guard now asserts every one of those 12 keys, so the client map can be
retired rather than hand-synced.

---

## 2. Why this is a contract, not a style preference

Recorded in `CONTRACTS.md` (both repos, verified byte-identical):

**A missing alias is a miss; a collision is a corruption.** The join keys on
`resolveTeamKey(home) + '|' + resolveTeamKey(away)`, so two clubs sharing a key
attach one club's data to another club's game — silently, and it looks entirely
plausible on the card. Two independent tables can drift into exactly that.

**Never normalise by token-stripping.** Spanish naming is the case that proves
it: unqualified *"Real"* means **Real Madrid**, while **Real Sociedad**'s short
form is *"Sociedad"* — the "Real" is dropped. A strip-leading-"Real" rule points
the wrong way in two directions at once, and Real Betis v Real Sociedad was a
real fixture on 2026-08-21.

Guard: `scripts/check-team-identity-collisions.mjs`, deploy-gating —
**35 alias pairs, 28 distinct clubs → 28 distinct keys**, negative-tested by club
name.

---

## 3. Source authority — the thing the FPL ask asked for

FPL `event/{gw}/live/` and ESPN `keyEvents` both carry goals and assists. Now
stated in `CONTRACTS.md` so one brief cannot name the same goal twice:

| field | authoritative source |
|-------|---------------------|
| goals, assists, match narrative | **ESPN** (`keyEvents`, per-sport table) |
| bonus points, saves, FPL-native stats | **FPL** (`event/{gw}/live/`) |
| cards, minutes | FPL (finer-grained), falling back to ESPN prose |

ESPN owns the match story; FPL adds the fantasy layer ESPN does not carry. This
matches the ask's own framing ("complementary, not redundant") and makes it
explicit which side loses a tie.

---

## 4. What the FPL build now inherits

- One resolver for the join, with a guard — no alias work left to do.
- A decided source split, so the generator does not have to arbitrate.
- Coventry, Ipswich and Hull all resolvable as of today, which matters because
  the ask's own test case is **Coventry's 3-0 loss to Arsenal** and Coventry was
  unresolvable until a few hours ago.

**Still to build (not started):** gameweek resolution from
`/fpl/bootstrap-static` (`events[].is_current`), the `/fpl/event/{gw}/live/` and
`/fpl/fixtures?event={gw}` reads, and the wiring into EPL brief generation.
`/fpl/*` is proxied and allow-listed at `src/index.js:13968` (`fplAllowed()` at
`:466`), so no new worker plumbing is needed — consistent with the ask's claim
that the endpoint is "already available".

**Unverified, flagged not assumed:** the live payload shape. The ask describes
`goals_scored, assists, yellow_cards, red_cards, minutes, saves, bonus,
modified`, sourced from a 2026-05-17 Drive doc. Per Rule 73 that is a claim, not
a measurement — it gets probed against the real endpoint before any field name is
written, exactly as the ESPN container claim was, which turned out wrong for four
of five sports.

---

## 5. One open decision

`La Real` — Real Sociedad's other common short form — is deliberately **not** in
the table. It is the one form actively dangerous under the naming convention:
any future article-stripping turns `La Real` → `Real` → **Real Madrid**. If the
FPL or Odds feeds use it, it needs an explicit entry *plus* a guard assertion
that it never resolves to Real Madrid. Flagged for a decision rather than
silently included.
