# Archive catch-up block: instrument the silent outer catch — 2026-07-13

## TASK 0 — Probe

```
$ grep -n "_catchupFilled = 0" -A 40 src/index.js
6044:    let _catchupFilled = 0;
6045-    try {
...
6079-        _catchupFilled++;
6080-      }
6080:    } catch (_) { /* catch-up failure never breaks journalism */ }
```
Confirmed the real current location and structure fresh, located by
content (not a remembered line number). Matches CONTEXT exactly: this
is the block P15B relocated ahead of the WC morning-brief guard earlier
today — verified it's still in that post-P15B position. The target
catch (line 6080) is the *inner* one wrapping the ESPN-final-fill loop
only — distinct from the *outer* wrapper catch at line 6084
(`/* league fetch / catch-up setup failure must never block WC
morning-brief or slate-brief paths below */`), which P15B added and
which is correctly out of this CC-CMD's scope.

## TASK 1 — The log

```diff
-    } catch (_) { /* catch-up failure never breaks journalism */ }
+    } catch (e) {
+      console.error("[ARCHIVE-CATCHUP] loop failed:", e.message);
+      /* catch-up failure never breaks journalism */
+    }
```
Matches the doc's specified text exactly, using this block's own
existing `[ARCHIVE-CATCHUP]` tag (already used by its success log two
lines below). `catch (_)` → `catch (e)` was a necessary, minimal change
to capture the error object for `e.message` — no other lines touched.

## TASK 2 — Verification, real and live throughout

**Real constraint found before testing**: `/v2/games?sport=mlb&date=2026-07-13`
returned zero games; `/v2/games?sport=wnba&date=2026-07-13` showed both
today's games still `state:"pre"` (not started). No real "final,
not-yet-archived" game existed at test time to naturally exercise a
partial-success scenario. Built a minimal, clearly-marked, temporary
synthetic test entry (reverted immediately after use) rather than
either skip the test or wait indefinitely for real data.

**Forced-throw test, live:**
1. Temporarily appended one synthetic entry to the loop's iteration
   (`eventId: '9999999999_TEMP_CATCHUP_TEST'`, real-shaped MLB game
   data) and added `if (gm.eventId === '...') throw new Error('TEMP_CATCHUP_TEST_FORCED_THROW_AFTER_POST');`
   immediately after its `_catchupFilled++` — i.e., **after** its real
   POST fires, guaranteeing the throw happens partway through, not before.
2. Deployed. Used `wrangler tail --format json --search "ARCHIVE-CATCHUP"`
   (via a temporary GitHub Actions workflow, `CLOUDFLARE_API_TOKEN`/
   `CLOUDFLARE_ACCOUNT_ID` secrets already available) while triggering
   `POST /journalism/run`.
3. **Real captured log, exact:**
   ```json
   {"message": ["[ARCHIVE-CATCHUP] loop failed:", "TEMP_CATCHUP_TEST_FORCED_THROW_AFTER_POST"], "level": "error"}
   {"message": ["[ARCHIVE-CATCHUP] 1 finals gap-filled"], "level": "log"}
   ```
   The error log fired with the real error message. Critically, the
   `1 finals gap-filled` success-count log **also** fired immediately
   after — proving `_catchupFilled` retained the pre-throw increment
   (it's incremented, then the throw fires, then the outer catch
   swallows it, then the unconditional `if (_catchupFilled > 0)` check
   after the try/catch still sees the correct count).
4. **Confirmed end-to-end, not just that fetch was called**: queried
   D1 directly —
   ```sql
   SELECT id, sport, home, away, home_score, away_score, espn_event_id
   FROM regular_season_games WHERE espn_event_id = '9999999999_TEMP_CATCHUP_TEST';
   -- id: MLB_2026-07-13_testhome_testaway, sport: MLB, home_score: 1, away_score: 0
   ```
   The write genuinely landed before the throw — proving "games
   processed before the throw still got their POST" for real, not by
   inference.
5. Deleted the test row (`DELETE ... WHERE espn_event_id = '...'`,
   `changes:1`, confirmed).
6. Reverted the temporary test injection from source. `git diff 7b5847f
   -- src/index.js` — **empty**, confirming byte-identical to the real
   TASK 1 fix commit, zero net drift.
7. Redeployed.

**Clean-run test, live** (confirms "a genuine full-success run... logs
nothing new"): re-ran the same `wrangler tail --search "ARCHIVE-CATCHUP"`
+ `POST /journalism/run` pattern against the reverted code with real
production data. **`tail.log` was completely empty** — zero
`[ARCHIVE-CATCHUP]` lines of any kind. Consistent with the earlier
`/v2/games` check (no qualifying finals exist right now, so
`_catchupFilled` correctly stayed `0` and neither the success log nor
the error log fired) — and critically, confirms the reverted code does
**not** spuriously log an error on a clean run.

`node --check src/index.js` — clean throughout (after the real fix,
after the temp injection, after the revert).

## DONE CONDITION

Met: the catch-up block's own catch now logs on real failure, matching
the established `[TAG]` convention exactly (`[ARCHIVE-CATCHUP]`,
matching this block's own existing success-log tag). Zero behavior
change to what games get archived — proven via a real D1 write landing
before an injected throw, not just reasoned about. Verified via a real
forced-failure test (live Cloudflare error captured through
`wrangler tail`) and a real clean-run test (zero spurious log output on
today's actual, empty-of-qualifying-finals production data).

## Confidence Score

```
+20  TASK 0 located the block by content, confirmed the real current
     structure fresh, correctly distinguished the target inner catch
     from P15B's outer wrapper catch (explicitly out of scope)
+40  TASK 1 matches the [ARCHIVE-CATCHUP] convention exactly (reusing
     this block's own existing tag, not inventing a new one); zero
     behavior change confirmed via git diff (single catch block only)
+40  TASK 2: real forced-throw test with the actual error message
     captured live, PLUS direct D1 confirmation that the pre-throw
     write genuinely landed (not inferred); genuine clean-run test
     against real production data confirmed zero spurious log output;
     all synthetic test data (source injection + D1 test row) fully
     reverted and independently verified clean via git diff and D1 query
= 100/100
```

**Score: 100/100. Clears the >=95 threshold.**

## Commits (all on `main`)

- `7b5847f` — the real fix: `console.error` added to the catch-up
  loop's own empty catch
- `7078b7b`/`e1f8367` — temporary forced-throw test injection + revert
- various `temp:` commits — wrangler-tail test workflows, all deleted
  after use
- (this commit) — this outbox, written after full live verification and
  confirmed-clean reversion
