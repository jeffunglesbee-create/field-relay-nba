# Claude Code Command — JOURNALISM_QUEUE failure visibility + WC26 finals sweep gap

**Date:** 2026-07-15
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull; git log --oneline -5.

Write findings to outbox/queue-dlq-wc26-sweep-gap-2026-07-15.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

Session `wc26-archive-audit-brief-backfill-2026-07-15.md` (commit `e41178b`) found and manually repaired 8 WC26 finals with no brief, then documented two structural gaps behind that outage without fixing them — this CC-CMD closes both. **Re-probe all line numbers below against current HEAD before writing any code — the source has moved since this doc was written and CLAUDE.md's own line references are already known-stale in places (e.g. it currently cites `handleJournalismCycle` at line 5504; live grep on 2026-07-15 found it at line 6144).**

**Gap 1 — no failure visibility on the `game-brief` queue route.** `wrangler.toml` lines 149-157 define `JOURNALISM_QUEUE` with `max_retries = 3` and no `dead_letter_queue` config. Inside the queue consumer (`async queue(batch, env, ctx)`, `src/index.js` line 14835), the `job.type === 'game-brief'` branch (starts line 14842) catches its own failure at line 14997 and does: `if (msg.attempts >= 3) { msg.ack(); } else { msg.retry(); }` — on final failure the message is just acked and silently dropped, zero forensic trail. Contrast with the *other* route in the same `queue()` handler, the `jobId` branch (starts line 15004): on final failure (line 15066) it writes a `{status:'failed', error, failedAt}` marker to `FIELD_JOURNALISM` KV before acking, so `/journalism/result/:jobId` can report it. The `game-brief` route has no equivalent KV key to poll, so a failed WC26 (or any sport's) game-brief job is invisible until someone manually audits `briefs` against the game tables, as happened this session.

**Gap 2 — WC26 brief generation has no fallback for games nobody re-requests.** Traced live (confirmed via grep on 2026-07-15): `writeWCResult(db, game, env, ctx)` (`src/index.js` line 2037) is called from exactly 2 sites, both at lines 3693/3695, both inside `if (env.WC2026_DB) { const finals = games.filter(g => g.state === 'final'); ... }` nested inside the `/v2/games?sport=wc26` ESPN-adapter route. This means a WC26 game only ever gets a brief job enqueued when some client happens to request `/v2/games?sport=wc26&date=X` for the date it went final. `handleJournalismCycle` (`src/index.js` line 6144, cron every 15 min per `wrangler.toml`) never calls `writeWCResult` and has no WC26-specific finals sweep — confirmed via grep, `writeWCResult` and `handleJournalismCycle` appear in entirely separate call graphs. If no client ever requests a given date after the games there go final (plausible for older tournament dates once client traffic moves on to the current slate), those games silently never get a brief, indefinitely — exactly what happened to the 8 games repaired manually this session.

**Constraints from CLAUDE.md — read before writing code:**
- Do NOT change cron frequencies. Any sweep fix must run inside an *existing* cron-fired function (`handleJournalismCycle`, fires every 15 min) — do not add a new `scheduled()` trigger or cron entry.
- Do NOT modify `wrangler.toml` bindings without explicit approval. A true dead-letter queue requires adding a `dead_letter_queue` key to the `[[queues.consumers]]` block (`wrangler.toml` lines 153-157) and provisioning the DLQ resource via the Cloudflare API/dashboard — that is a `wrangler.toml` binding change and is **out of scope for this CC-CMD without a separate, explicit approval step**. TASK 1a below is scoped to the code-only fix (a KV failure marker, mirroring the `jobId` route's existing pattern) specifically to stay inside that constraint; do not touch `wrangler.toml`.
- Rule 78 (API-COST-A): a periodic sweep must not redundantly re-enqueue games that already have a brief. It must check real coverage (a D1 query against `briefs`, accounting for the `espn:`-prefix quirk documented in the audit session — `briefs.game_id` may be stored as either bare `{eventId}` or `espn:{eventId}` depending on which write path produced it) before enqueueing anything.
- Rule 76 (FALLBACK-CAP-A): this sweep is fallback #2 for brief coverage (request-triggered `writeWCResult` is #1). Do not add a third fallback layer on top of it — if the sweep itself needs a fallback, that means the sweep's design is wrong and needs to be fixed directly, not patched with another layer.

## TASK 0 — Probe

1. Re-confirm all line numbers cited above against current HEAD (`grep -n "async function writeWCResult\|async queue(batch\|job.type === 'game-brief'\|max_retries\|dead_letter_queue\|async function handleJournalismCycle" src/index.js wrangler.toml`).
2. Confirm live whether any other queue job type besides `game-brief` and the `jobId` route exists in the `queue()` consumer, and whether any of them share the same silent-drop gap as `game-brief` — TASK 1a's fix should cover all of them if the same pattern recurs, not just `game-brief`.
3. Confirm live (D1 query against `WC2026_DB`/`ARCHIVE_DB`) the current count of WC26 finals with no matching `briefs` row (using the `LIKE`-based match from the audit session, not exact match, to avoid the same `espn:`-prefix false negative). This is today's real baseline, not the "8" from the prior session — new finals may have completed since.
4. Check whether `handleJournalismCycle` already iterates a `LEAGUES`-style table per sport (CLAUDE.md and inline comments reference one near this function) that WC26 sweep logic could hook into, versus needing a standalone block.

## TASK 1a — Fix: failure visibility for `game-brief` queue jobs

Add a KV failure marker on final failure for the `game-brief` route, matching the existing pattern in the `jobId` route (`src/index.js` ~line 15066-15080) as closely as makes sense for this route's own key shape (likely something under `brief:game:{eventId}:failed` or a similar convention — check for an existing convention before inventing one, per Rule 62). This does not require a wrangler.toml change and does not require a new binding — it reuses `FIELD_JOURNALISM`, already bound.

Do not attempt a true Cloudflare dead-letter queue in this task — that is the explicitly out-of-scope wrangler.toml change described in CONTEXT. If the KV-marker approach turns out to be insufficient for some reason found during TASK 0, stop and report why rather than silently escalating to a wrangler.toml edit.

## TASK 1b — Fix: WC26 finals coverage sweep

Add a check inside `handleJournalismCycle` (or a function it already calls each cycle) that, for WC26 specifically: queries finalized games from `WC2026_DB` lacking a matching `briefs` row (LIKE-based match per TASK 0.3), and for each gap found, triggers the same real generation path already used by `writeWCResult` — either by calling `writeWCResult` directly with the missing game's data, or by re-deriving the minimal inputs it needs. Do not duplicate `writeWCResult`'s logic into a second implementation (Rule 62) — reuse the existing function.

Bound the sweep's blast radius explicitly: decide and document how many missing games it will backfill per 15-min cycle (e.g. all found, or a capped batch) so a large historical gap doesn't cause a single cron cycle to enqueue an unbounded number of LLM calls at once. State the reasoning for whatever cap (or no-cap) decision is made.

## TASK 2 — Verify

- `node --check src/index.js`: clean.
- TASK 1a: real forced test — simulate 3 failed attempts on a synthetic `game-brief` job (or trace the code path manually if a live simulation isn't practical) and confirm a KV marker is written before the final ack, with no change to the retry/ack behavior for attempts 1-2.
- TASK 1b: real live test — using a synthetic or currently-known-missing WC26 final (re-run TASK 0.3's query first to find one, or synthesize a test row clearly tagged as a test and delete it after), confirm one `handleJournalismCycle` cron cycle (or a manually-triggered equivalent, e.g. via whatever admin/force endpoint already exists for this cron — check before assuming one needs to be added) fills the gap without needing a `/v2/games` request for that date.
- Confirm via direct D1 query that the sweep does NOT re-enqueue any WC26 game that already has a brief (no redundant regeneration for already-covered games — this is the Rule 78 check).
- Live re-run of TASK 0.3's coverage query post-fix: confirm 0 gaps remain (or document why a residual gap is expected, e.g. a very recently-finalized game not yet due for its next sweep cycle).

## DONE CONDITION

`game-brief` queue jobs that exhaust retries leave a real, queryable failure record (not silent). WC26 games that go final are guaranteed a brief within one `handleJournalismCycle` cycle (~15 min) regardless of whether any client requests `/v2/games?sport=wc26` for that date — verified live, not assumed. No wrangler.toml changes made. No redundant regeneration of already-covered games, verified via direct query.

**Confidence scoring:**
- TASK 0 (20 pts): correct, current-HEAD line numbers; correct live count of the real current coverage gap (not reused from the prior session); correctly determines whether other job types share the same silent-drop pattern
- TASK 1a (25 pts): failure marker written on final failure only, matches an existing real convention (not invented from scratch if one already exists), zero wrangler.toml changes, zero change to attempts-1/2 retry behavior
- TASK 1b (35 pts): sweep correctly reuses `writeWCResult` (no duplicated logic), correctly bounds its own blast radius with stated reasoning, runs inside the existing 15-min cron (no new cron entry), verified live to close a real gap without redundant regeneration
- TASK 2 (20 pts): real tests for both fixes, real live coverage-gap query before and after, real confirmation of no redundant regeneration

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
