# CC session — 2026-10-13 — RELAY_SHARED_SECRET, steps 1 and 2

**CC-CMD:** `docs/CC-CMD-2026-08-25-rotate-relay-secret.md` — OPEN, step 3 is
one dispatch of `rotate-relay-secret.yml` with `confirm=ROTATE`.
**HEAD:** `6e7aedd` → `cabcdee` → `199c02c` → `28203a2` → `17b966d` →
`8329fc6` → `1e196d5` → `d214ef1` → `7771486` → this commit. jubilant-bassoon:
`0dc9a6fd`, `cc2b5b98`. **Credits:** 0.

## Per commit

| commit | what |
|---|---|
| `cabcdee` | `worker-secret-names.sh` + workflow: which Workers hold a binding, names only |
| `199c02c` | the secret sync can target field-claude-proxy; both bindings written |
| `28203a2` | relay gates and self-calls read `env.RELAY_SHARED_SECRET`, fail closed; proxy too; `callProxy(env, …)`; gate check + live probe; ratchet 109 → 86 |
| `17b966d` | 44 scripts read the env; 24 workflows pass it; ratchet 86 → 33 |
| `8329fc6` | `distribute-relay-secret.sh` writes field-laboratory and jubilant-bassoon; deploy.yml uses it |
| `1e196d5` | two probes stop grepping source for the literal |
| `d214ef1` | `bootstrap-relay-secret.yml` deleted; courier guard follows the script |
| `7771486` | `rotate-relay-secret.sh` + workflow: runner-generated value, verify, rollback |
| jb `0dc9a6fd` | retry probe, two MLS seeds, proxy copy read the env; ratchet 9 → 5 |
| jb `cc2b5b98` | two `.pyc` files committed by mistake removed; `__pycache__/` ignored |

## Verified vs STAGED

| thing | state |
|---|---|
| both Workers hold the binding | **VERIFIED** — run 38357685164: PRESENT, PRESENT |
| gates accept the secret, refuse wrong/missing; proxy likewise | **VERIFIED** — run 38358907878, 5/5 |
| no code path holds the literal | **VERIFIED** — 0 in src/, workers/, scripts/, .github/ in both repos |
| siblings hold the secret | **VERIFIED** — run 38359407131 |
| converted scripts authenticate from env | **VERIFIED** for one: `probe-drama-backfill-fields` ran on push, success |
| the rotation | **STAGED** — blocked: a session's dispatch is refused by its permission policy. Unblocked by: the owner runs `rotate-relay-secret.yml` with `confirm=ROTATE`. Verify: its log ends `ROTATED`, and its probe lines read `relay, the OLD value -> 401` and `proxy, the OLD value -> 403` |
| steps 4 and 5 | **STAGED** on the rotation: redact 33 lines here and 4 in jubilant-bassoon, ratchet 0 in both, the new hash from the log at 0 |

## Errors in this session, stated

- The `git diff` I read to review step 1b printed the old value in my own tool
  output. It reached no commit, file or chat message, and it is the value the
  rotation retires.
- `py_compile` wrote two `.pyc` files that went into jb `0dc9a6fd`. They held
  no credential and were removed in `cc2b5b98`.
- I estimated 13 outbound headers in `src/index.js`. There were 12. The edit
  asserted the count and refused to write until it was corrected.
