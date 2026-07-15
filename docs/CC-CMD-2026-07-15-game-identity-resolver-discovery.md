# Claude Code Command — Game Identity Resolver: discovery + go/no-go recommendation (NOT implementation)

**Date:** 2026-07-15
**Repo:** jeffunglesbee-create/field-relay-nba (primary) — may need read access to jubilant-bassoon (client repo) for TASK 0.2; if not already available in-session, use the multi-repo tools (`list_repos`/`add_repo`) to request it rather than guessing at client behavior.
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull; git log --oneline -5.

Write findings to outbox/game-identity-resolver-discovery-2026-07-15.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

A tree-sitter audit of `FIELD_JOURNALISM` KV calls (2026-07-15) found the `brief:game:{id}` namespace has 5-6 distinct id-shape conventions across sports (`espn:{id}`, `nhl:{id}`, `nba:{gameId}`, `golf_{id}_R{round}`, two bare-unprefixed sources), with the public read route doing zero normalization. A follow-up CC-CMD (`docs/CC-CMD-2026-07-15-brief-game-kv-id-convention.md`) scoped a narrow fix (normalize-at-write vs. bounded resilient read-lookup).

An external review (ChatGPT, pasted into chat by the user) reframed this as a deeper architectural gap — "multiple identity domains rather than one game identity system" — and proposed a **canonical Game Identity Resolver**: producers resolve provider IDs into one canonical FIELD game identity; journalism, archives, Night Owl, drama history, and Watch Window all operate on canonical identities instead of provider-specific formats.

**This diagnosis may be directionally right, but two things must be verified — not assumed — before any design or implementation work happens:**

1. **Scope claim.** "Journalism" and "archives" are confirmed relay-side (this repo). "Night Owl" is confirmed relay-side (a real `brief_type` value in the `briefs` D1 table). **"Drama history" and "Watch Window" are NOT yet confirmed to exist in this repo at all** — and per this repo's own CLAUDE.md (Rule 47/ADR-002, RELAY-IS-DUMB), the relay "NEVER computes drama scores, watch verdicts, interest levels... The browser does all intelligence." If those two are jubilant-bassoon (client) concepts, a resolver spanning them would be a cross-repo project, not a relay-only one — a materially different scope than the proposal implies.
2. **Real blast radius.** The existing narrow fix already covers the one confirmed broken read path (`/journalism/game/{eventId}`) and its 6 write sites. Before committing to a resolver layer (a genuine architectural change — new abstraction, new call-site discipline for every future producer, the exact shape of invasive change CLAUDE.md's CSS Grid case study warns against shipping without impact analysis), the actual number of distinct "identity domains" and their real consumers across *this whole repo* — not just the one KV namespace already audited — needs to be counted.

3. **Fix vs. fallback — the resolver has two possible shapes, and only one is admissible here.** A *write-time* resolver (every producer calls it once, at first write, to get the one canonical FIELD id; every downstream write — KV, D1, R2, DO naming — uses only that id) is Rule 60 applied broadly: a real fix, one mandatory convention, no consumer ever guesses a shape. A *read-time* resolver (a lookup that tries `espn:{id}`, then `nba:{id}`, then bare `{id}` to find a hit at request time) is Rule 76's capped-fallback-chain anti-pattern wearing a new name — it doesn't eliminate the inconsistency, it hides the guessing behind a nicer label. **If TASK 1 recommends building a resolver, the design must be write-time-only. A read-time multi-format lookup is not an acceptable resolver design under this repo's "no fallbacks, only fixes" standard, and TASK 1 must say so explicitly if the evidence points toward recommending one anyway (it shouldn't).**

**This CC-CMD authorizes discovery and a recommendation only. Do NOT design, prototype, or implement a resolver in this dispatch — that decision needs the evidence this dispatch produces.**

## TASK 0 — Probe: does this repo even have the claimed consumers?

1. Grep this repo (`src/*.js`) for `drama` and `watch` (case-insensitive, e.g. `grep -rin "drama\|watch_window\|watchWindow"`). For every real hit, determine: is it relay-side computation (a violation of Rule 47 if so — flag it, don't silently note it) or relay-side *storage/passthrough* of a value the client computed and sent back for archival (consistent with RELAY-IS-DUMB)? Report the real answer, not an assumption either way.
2. If jubilant-bassoon access is available (request via `list_repos`/`add_repo` if not already in this session's scope), grep it for `drama`, `watchWindow`, `nightOwl`, and any client-side game-id normalization/mapping code. Report what you find — specifically, does the client already normalize provider ids into its own canonical shape today (which would mean a relay-side resolver duplicates work the client already does), or does it rely on the relay's ids as-is?
3. Catalog every OTHER place in this repo (not just `FIELD_JOURNALISM` KV, already audited) where a provider-specific game/event id shows up as a stored key or lookup value: `ARCHIVE_DB` (`briefs.game_id`, `regular_season_games`/`postseason_games` id columns — already known to have the same `espn:` prefix inconsistency, fixed once for `sport` labels but not for ids), `WC2026_DB.wc_results.game_id` (confirmed this session to carry BOTH `football:{id}` legacy rows and `espn:{id}` current rows for the same match), `R2` key prefixes (`bsd/wc26/{bsdId}/...` — a THIRD id namespace, BSD's own numbering, unrelated to ESPN/NHL/NBA ids), Durable Object naming (`GAME_DO.idFromName(...)`, `BRACKET_DO`), and any others found via grep. For each, note: is it internally self-consistent (like the KV case), or does it show the same cross-format collision risk?
4. Produce a real count: how many distinct id "domains" exist across the whole repo, how many call sites touch each, and how many of those call sites are BOTH producer and consumer of the same domain (self-consistent, lower risk) vs. cross-domain readers (the actual risk surface).

## TASK 1 — Recommendation (not implementation)

Based on TASK 0's real counts — not the external review's assumed scope — answer directly: does this repo's actual identity-fragmentation problem justify a dedicated resolver layer, or is the narrower per-namespace fix (already scoped in `CC-CMD-2026-07-15-brief-game-kv-id-convention.md`, and the equivalent already-shipped fix for `briefs.sport` labels) sufficient and lower-risk?

If recommending FOR a resolver: sketch (in the outbox, not in code) what it would need to touch, cite the specific real call sites from TASK 0 as the dependency list Rule 39 requires, and note whether it's a relay-only change or genuinely cross-repo (per TASK 0.2). The sketch MUST be a write-time design (per CONTEXT point 3) — one mandatory resolve-and-assign call per producer at first write, canonical id used for every downstream write, zero read-time format-guessing anywhere in the sketch. Do not write implementation code in this dispatch.

If recommending AGAINST (or "not yet"): say what real signal would change that recommendation — e.g., a second and third independent id-format collision found in production data, not just a hypothetical.

## DONE CONDITION

A real, evidence-based answer — not a restatement of the external proposal — to: (a) does "drama history"/"Watch Window" exist in this repo, and if not, where does the resolver's actual scope end; (b) how many real id domains and cross-domain-risk call sites exist across the whole repo, not just the one KV namespace already audited; (c) a direct go/no-go recommendation on the resolver, justified by (a) and (b), with no code written either way.

**Confidence scoring:**
- TASK 0 (60 pts): real grep-based verification (not assumption) of drama/Watch Window's existence and location; real cross-repo check if jubilant-bassoon access was available (or an honest note if it wasn't, per Rule 61 — STAGED, not silently skipped); a genuine, counted catalog of id domains across ARCHIVE_DB/WC2026_DB/R2/DO naming, not just the KV namespace already known
- TASK 1 (40 pts): a direct, evidence-backed go/no-go recommendation (not a hedge), citing TASK 0's real counts, with implementation explicitly out of scope and not attempted; if recommending FOR a resolver, the sketch is write-time-only per CONTEXT point 3 — any read-time multi-format lookup appearing in the sketch is an automatic score cap at 20/40 regardless of the rest of the analysis' quality, since it means the dispatch reproduced the fallback anti-pattern it was explicitly warned off

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
