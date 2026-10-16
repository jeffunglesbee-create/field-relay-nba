# Claude Code Command — `/bsd/r2/list` answers scoped and silent; `/bsd/contract` declares a frame it does not have

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba
**Confidence gate:** >= 95 before any commit
**Filed:** 2026-10-16 by chat, read from `src/index.js` at `5193016`
**Status:** NOT STARTED — not dispatched.

Two defects in relay-served BSD surfaces. Both were found from
field-laboratory, not by a relay session. Both have already produced a wrong
conclusion that reached a document.

---

## DEFECT 1 — `/bsd/r2/list` answers a scoped page and does not say so

Current handler, verbatim:

```js
const prefix = url.searchParams.get('prefix') || 'bsd/wc26/';
const list = await env.FIELD_DATA.list({ prefix, limit: 100 });
return new Response(JSON.stringify({
    keys: list.objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded })),
    truncated: list.truncated,
}), ...);
```

Three defects in six lines:

1. **`|| 'bsd/wc26/'`** — a request with **no** prefix is answered from
   `bsd/wc26/`, and the response says nothing about it. The caller cannot tell a
   scoped page from the store.
2. **`limit: 100` is hardcoded** — a `limit` parameter is accepted by the URL and
   silently ignored.
3. **`list.cursor` is dropped.** R2's `list()` returns a cursor when the result
   is truncated. The handler returns `truncated: true` and discards the only
   thing that could act on it, so there is no way to page.

Together: a caller gets a page scoped to a prefix it did not ask for, cannot
page past it, and has nothing in the response that would reveal either.

**This is not theoretical.** On 2026-10-15 chat read this route, saw 100 keys
all under `bsd/wc26/`, and concluded R2 held wc26 only. A field-laboratory
census that walks the store found **887 events across 10 competitions**. The
wrong conclusion was chat's; the route is what made it reachable, and it will
do the same to the next caller.

### The fix

- **Echo the effective prefix in the response** — `"prefix": "<what was used>"`.
  This is the whole fix for defect 1; everything else is convenience. A response
  that states its own scope cannot be mistaken for the store.
- Honour `limit`, clamped to R2's maximum of 1000, default unchanged at 100.
- Return `cursor` when `truncated` is true, and accept a `cursor` parameter.
  `truncated` without a cursor is a dead end dressed as a signal.

### TASK 0 — find the callers BEFORE changing the default (blocking)

Changing the default prefix from `bsd/wc26/` to `bsd/` is a **behaviour change
for every caller relying on the current scope**. Search both repos and the
workflows for `r2/list` and for callers that pass no `prefix`.

**If any caller depends on the wc26 default, do not change it.** Echo the
prefix, add `limit` and `cursor`, and record the default as a deliberate
compatibility decision rather than quietly widening it. The scope is survivable
once it is visible; a broken consumer is not.

---

## DEFECT 2 — `/bsd/contract` declares a frame the data does not use

Current declaration:

```js
'incidents[].sequence[].pos': {
    frame:  'target-goal-relative',
    xZero:  'the goal this team ATTACKS',
    perTeam: true,
    note:   'Same frame as shotmap[].pos; `.end` and `.gk` are in it too. Confirmed by the ' +
            '73\' goal in 223324: the DEFENDING keeper reads gk.x 5.4 beside the away ' +
            'scorer\'s pos.x 7.3 — in front of the goal being attacked, not his own half.',
},
```

**Measured, it is one shared pitch frame**, home attacking toward x=100 and away
toward x=0 — `perTeam: false`. A field-laboratory census over **427 non-own
goals** reads home scorers high x **246/246** and away low x **181/181**. An
independent diagnostic over 11 goals in 8 matches agrees
(`field-laboratory docs/BSD-FRAME-DIAGNOSTIC-2026-10-15.md`).

### Why the note is the defect, not just the field

The note names its evidence: *the 73' goal in 223324*. That is the **only** goal
sequence in that capture, and it is an **away** goal.

For the away side the two candidate frames are **numerically identical**. Shared
absolute puts the away shooter near x=0 and the goal he attacks — with its
keeper — also near x=0. Per-team target-goal-relative puts both near x=0 by
definition. Both predict `shot 7.3, gk 5.4` exactly.

**Only a home goal discriminates** — shared absolute predicts ~88/~99, per-team
predicts ~12/~2 — and 223324 has none. The contract asserted `perTeam: true`
from a sample structurally incapable of testing it. **SAMPLE-COVERAGE-A**
(`field-relay-nba/CLAUDE.md`) — cited by tag because the bare number resolves
only in this repo, and this finding is cross-referenced from field-laboratory,
where Rule 91 is SCOPE-LEGIBLE-A.

`shotmap[].pos` and `shotmap[].gm` were re-measured and **hold exactly as
declared**. Do not touch them. That is what makes this dangerous: the two pitch
frames share a key shape and differ in origin, so **mixing them mirrors the away
team silently** — no error, a plausible wrong answer.

### The fix

1. Correct the declaration to the measured frame, `perTeam: false`.
2. Replace the note's evidence with the discriminating evidence — the counts,
   and the fact that a home goal is what separates the two.
3. Bump `revision` and say in the contract that the prior revision was wrong
   about this field, so a consumer pinned to `2026-10-10-1` learns why.
4. `ownGoal` is a **frame discontinuity**: `is_home` marks the credited team
   while the sequence records the attacking move, and on an own goal those are
   opposite sides. The contract must say so — it is why the census excludes them.

### TASK — the guard, which is the actual repair

A declaration nothing tests will drift again. Add
`scripts/check-bsd-frame-contract.mjs`:

- Re-measure every frame the contract declares against R2 captures, split by
  side, excluding `ownGoal`.
- **Fail when a declaration disagrees with the measurement**, naming both.
- Fail when the sample contains **no home goal sequence**, because that sample
  cannot test `perTeam` and a pass from it would be the original defect
  reproduced. *Insufficient evidence is a distinct outcome from agreement.*
- `--self-test` with both directions, and a mutation that flips a declared
  frame and must be caught.

Wire it into `guards.yml` beside the existing checks.

---

## Verification, in this session

1. `GET /bsd/r2/list` with no prefix — response carries `prefix`, and it is
   whatever was actually used.
2. `GET /bsd/r2/list?limit=5` returns 5; `?limit=99999` clamps rather than errors.
3. A truncated response carries a `cursor`, and passing it back returns the
   next page with no overlap.
4. `GET /bsd/contract` shows the corrected frame and the bumped revision.
5. The new guard passes against live captures, and its mutation is caught.

## Done conditions

- All five verifications run against the **deployed** relay, output recorded.
- Task 0's caller search written down with what it found, including if nothing.
- `outbox/cc-session-2026-10-16-bsd-list-and-contract.md` is the **last** task
  (Rule 87), named in `HANDOFF.md` (Rule 67).

## Constraints

- Rule 80: no credential value in any committed file or log.
- Do not change `shotmap[].pos` or `shotmap[].gm` — both re-measured and correct.
- Do not change `/bsd/r2/read`'s `bsd/` prefix requirement; it is a safety check,
  not the defect.
