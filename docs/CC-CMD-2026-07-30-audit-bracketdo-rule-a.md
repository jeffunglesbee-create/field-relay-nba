# CC-CMD-2026-07-30-audit-bracketdo-rule-a

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-30-audit-bracketdo-rule-a.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## This is an AUDIT, not a fix — read this before touching anything

`BracketDO` is live, currently-shipping infrastructure (built 2026-06-11,
predates Rule A's 2026-07-07 establishment). A chat session today found
its behavior matches the exact violation pattern named in the July 2026
ADR-002 amendment's own worked example — autonomous, threshold-gated
WebSocket fan-out on every confirmed result. Full context:
`docs/outbox/chat-update-2026-07-30-bracketdo-rule-a-concern.md`
(jubilant-bassoon repo — cross-repo reference, read it there).

**This CC-CMD's job is to investigate thoroughly and report a precise
verdict — not to convert the architecture.** Changing a live WebSocket
system to polling is a real UX tradeoff (perceived responsiveness) on
production infrastructure. That decision belongs to Jeff once the
findings are precise, not to this session acting on one prior session's
analysis alone.

---

## Task 1 — Re-verify from HEAD before concluding anything (Rule 87)

- Re-read `bracket-do.js`'s current full body fresh. Confirm the exact
  trigger condition ("delta exceeds significance threshold") and the
  exact fan-out mechanism still match what was found today — code may
  have changed since.
- Re-read the CURRENT `ADR-002-CONTEXT.md` Rule A/Rule F text directly,
  fresh, not from any prior session's paraphrase of it (this doc itself
  is now a paraphrase of a paraphrase — go to the source).

## Task 2 — The nuance that was NOT resolved today, and matters

Today's finding treated the WebSocket fan-out as unambiguously "push."
There is a real, unresolved question that changes the analysis:

**Is the WebSocket connection itself established in response to an
explicit user action (e.g., the user opening the bracket view, which is
arguably a pull/request), or does it connect proactively/globally
regardless of what the user is currently looking at?**

If the connection is user-initiated (an explicit pull that opens a
channel), then keeping that ALREADY-OPEN channel current via
server-initiated messages is a materially different case from pushing
an unsolicited notification to a dormant, backgrounded client — this
is genuinely unresolved and needs a real answer, not an assumption
either way. Trace the client-side code that opens the WebSocket
connection (`src/legacy/field.js`, search for where the BracketDO
WebSocket client is instantiated) and determine precisely what user
action, if any, triggers it.

Also check: does the connection persist/reconnect automatically when
the user navigates away from the bracket view and back, or when the
tab is backgrounded? This bears directly on whether updates could reach
a user who is not actively looking at the bracket right now — which is
the closer analogue to the prohibited "unprompted alert" case.

## Task 3 — Report a precise verdict, do not implement a fix

Based on Tasks 1-2, report one of:

- **Confirmed violation**: the connection is not meaningfully
  pull-gated (e.g., it's opened globally on app load, or persists and
  delivers updates to backgrounded/inactive views). State this plainly
  with the supporting evidence.
- **Not a violation, or a closer call than initially assessed**: the
  connection genuinely requires an explicit, recent user pull to be
  open at all, and delivered updates only reach actively-viewing users
  in a channel THEY opened. State this plainly too — a corrected
  finding is exactly as valuable as a confirmed one, and this is
  genuinely uncertain until checked.

If a violation is confirmed, outline (do not implement) what a
pull-based conversion would look like — likely: client polls the DO's
current snapshot on its existing poll cycle, no WebSocket, no
autonomous send — matching the pattern already specified in
`CC-CMD-2026-07-30-layer4-cross-game-facts-pull.md` (jubilant-bassoon).
Note the real tradeoff (perceived latency between poll intervals vs.
instant push) rather than presenting the conversion as free.

---

## Explicitly NOT in scope

- Do not modify `bracket-do.js` or any WebSocket code. This is
  investigation and reporting only.
- Do not extend this audit to `GameDO`, `UserDO`, `AmbientDO`, or
  `BrowserDO` — scope is `BracketDO` specifically. If the audit
  surfaces reason to believe another DO has the same pattern, note it
  explicitly as a follow-up candidate rather than auditing it in this
  same pass.

---

## Outbox

`outbox/cc-session-2026-07-30-audit-bracketdo-rule-a.md`: the precise
verdict (violation confirmed / not confirmed / genuinely ambiguous),
the connection-establishment evidence from Task 2 specifically, and if
a violation is confirmed, the outlined (not implemented) conversion
approach with its real tradeoff stated.
