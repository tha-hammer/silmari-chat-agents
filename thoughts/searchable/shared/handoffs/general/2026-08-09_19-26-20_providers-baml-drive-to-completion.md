---
date: 2026-08-09T19:26:20-04:00
researcher: tha-hammer
git_commit: 2989dd20fcd5660e6c5382e08ebe697bc3b85d52
branch: main
repository: silmari-chat-agents
topic: 'Providers.BAML port — drive 3-agent ntm session to completion'
tags: [implementation, strategy, baml, providers, llm, ntm, orchestration]
status: complete
last_updated: 2026-08-09
last_updated_by: tha-hammer
type: implementation_strategy
---

# Handoff: Providers.BAML port — poll the ntm session and drive it to done

## Task(s)

**Your job: actively poll the three ntm agents, unblock them, review their work, and drive the plan to completion.** They are already working; nothing needs kicking off.

| Task                                                             | Status                                                      |
| ---------------------------------------------------------------- | ----------------------------------------------------------- |
| Research the LLM interface for BAML integration                  | ✅ complete, committed                                      |
| Spike BAML's real capabilities (tool loop, runtime types, async) | ✅ complete — 40+ green offline checks in `../silmari-chat` |
| Scope the port                                                   | ✅ complete                                                 |
| TDD plan (rev 3, review applied)                                 | ✅ complete, committed                                      |
| Write upstream bug reports                                       | ✅ written, **not filed**                                   |
| **Implement B0–B17**                                             | 🔄 **in progress** — 3 agents, 0 commits as of this handoff |
| B18 (loop closure), B19–B21 (packaging/docs)                     | ⏸ not started, blocked on the three streams                |

Plan phase: **Phase 0** of the 5-phase scope. Phases 1–4 are deferred behind upstream bugs.

## Critical References

- **`thoughts/searchable/shared/plans/2026-08-09-15-57-tdd-providers-baml-phase0.md`** — the plan (rev 3). 23 behaviors, 3 blocking closure tests, System Map with 4 diagrams + 7 seam grammars. **Read the "Review resolution" section first**: three rev-1 decisions were _reversed_, and agents may try to reinstate them.
- `thoughts/searchable/shared/research/2026-08-09-13-21-llm-interface-baml-integration.md` — the interface map, citation-verified.
- `../silmari-chat/scripts/baml-toolloop/README.md` — every empirical BAML finding, with repro scripts.

## Recent changes

Only one commit; **no `src/` changes yet**.

- `2989dd2` — docs only: research, scope, plan rev 3, review, plus the `bd init` changes to `CLAUDE.md`/`AGENTS.md`/`.gitignore`. 10 files, +2,535 lines.
- Worktree `/home/maceo/ntm_Dev/providers-baml-2026-08-09-19-16` on branch of the same name, from `2989dd2`.
- ntm session `providers-baml-2026-08-09-19-16`, 3 Claude agents (cc=3, cod=0).

## Learnings

### About this repo

- **`node_modules` is NOT installed here.** `npx tsc`/`npx jest` cannot run in `/home/maceo/Dev/silmari-chat-agents`. The worktree needs `npm install` before any gate passes. Every type claim in the plan came from reading definitions, not from executing the compiler — verify when you can.
- **`ChatModelConstructorMap` is a mapped type over `Providers`** (`src/types/llm.ts:200-202`). Adding an enum member without `ProviderOptionsMap`/`ChatModelMap` entries is a **compile error**. This is why B0 exists and why cc_2/cc_3 are blocked on it.
- **`config/circular-deps.test.mjs:56` asserts exactly 13 package entries** and CI runs it. Adding the `./baml` entry breaks it → must go to 14 in the same change.
- Three shapes that fail _silently_, all verified:
  - `tool_call_chunks[0].index` must be **numeric** or `handleToolCallChunks` is never reached (`src/stream.ts:1756-1761`).
  - `attemptInvoke` **silently drops** `tool_calls` entries with a falsy `name` (`src/llm/invoke.ts:1032-1036`).
  - `config.signal` is inspected **only** for `StreamLimitExceededError` (`src/llm/invoke.ts:868-876`); general abort is the provider's own job, threaded as `options.signal` (pattern: `src/llm/mistral/index.ts:26-30`).
- `t.ChatModel.invoke` returns `Promise<AIMessageChunk>` — not `AIMessage` (`src/types/graph.ts:44-53`).

### About BAML (toolchain 0.15.0) — all empirically verified

- **A result union (`Ok | Err`) sidesteps the `spawn`/`catch` race entirely** — 30/30 at four tasks, 20/20 at eight with `TaskGroup(3)`. This is why the port's contract says `takeTurn` must never reject for a per-tool failure. **Do not let an agent reintroduce `throws` across a spawn boundary.**
- `$types` runtime type binding **works on `$parse`** (including `{list:{union:[...]}}` built from a varying array) but **panics on every prompt-rendering path** (`output_format.rs:608`). Hence the frozen build-time union.
- Arrays of class instances **cannot** cross the TS bridge (`expected instance, got map`); nested class fields degrade to maps so `if let` narrowing fails. **Primitives only at the boundary.**
- A **bare** top-level union cannot be `$parse`d (`Unions must be flattened`) — use `(A|B|C)[]` or a wrapper class.
- A `type` alias as an LLM return type breaks codegen (`Unknown type alias: …$stream`) — **inline the union in the signature**.
- The rendered schema carries **no type names**, only field shapes — every tool needs a literal `tool: "name"` discriminator.
- The generated **sync** companions block the Node event loop; use `_async` throughout.
- **The docs are v0; the toolchain is v1.** `baml describe` is the authority. A prior spike falsified 11 of 18 doc-derived claims. I repeated that mistake once (searched for the v0 `TypeBuilder` symbol and wrongly concluded runtime types were removed).

### About the ntm gate

`large_spawn_threshold: 4`. `proc_count` reports ratio 1.0 / critical on an otherwise idle host (865 procs, `pid_max` 4.1M, 0 tmux servers), so **any spawn of ≥4 agents is refused**. 3 admits. Do not raise the caps — that is the documented anti-pattern. `ntm add <session> --cc=1` is the incremental path if you want a 4th.

## Artifacts

**Committed in `2989dd2`:**

- `thoughts/searchable/shared/plans/2026-08-09-15-57-tdd-providers-baml-phase0.md` (876 lines, rev 3)
- `thoughts/searchable/shared/plans/2026-08-09-15-57-tdd-providers-baml-phase0-REVIEW.md`
- `thoughts/searchable/shared/plans/2026-08-09-providers-baml-port-scope.md`
- `thoughts/searchable/shared/research/2026-08-09-13-21-llm-interface-baml-integration.md`
- `thoughts/searchable/shared/research/…-integration.closure-adapter.py`

**In `../silmari-chat` (separate repo, uncommitted):**

- `scripts/baml-toolloop/README.md` — findings 1–6
- `scripts/baml-toolloop/{provider-pattern,bridge-loop,runtime-union-probe,dynamic-probe,async-probe}.mjs` — 40 checks, all green
- `scripts/baml-toolloop/repro-spawn-catch/` + `measure.sh` — upstream bug 1 repro
- `scripts/baml-toolloop/repro-generic-output-format/` + `check.sh` — upstream bug 2 repro
- `scripts/baml-toolloop/issues/0{1,2}-*.md` — filable issue text
- `baml_src/ns_toolloop/*.baml` — the proven provider pattern

## Action Items & Next Steps

**1. Poll the session.** Do not spin — check every few minutes:

```bash
S=providers-baml-2026-08-09-19-16
ntm --robot-activity=$S              # THINKING | WAITING | ERROR
ntm --robot-tail=$S --lines=40       # what they are actually doing
bd list --status=in_progress | grep BAML
git -C /home/maceo/ntm_Dev/$S log --oneline main..HEAD
```

`ntm --robot-wait=$S --wait-until=idle --timeout=15m` blocks until they settle.

**2. Unblock B0 first.** cc_1 owns `AF-iur` and is the critical path — cc_2 (`AF-cob`) and cc_3 (`AF-abc`) **cannot compile** until B0 lands. If cc_1 stalls, that is the highest-value intervention. Confirm `npm install` has run in the worktree.

**3. Watch for the shared-file conflict.** cc_2 and cc_3 both edit `src/llm/baml/ChatBAML.ts`. They were told to reserve it (`ntm lock`). If they collide, serialize them.

**4. Review against the plan, not vibes.** For each behavior: did the red test fail for the _right_ reason? Was the refactor step actually done? No `any`, no `as never`, fakes implement our port rather than mocking BAML.

**5. Then B18, then B19–B21.** `AF-0km` (B18 full loop closure, BLOCKING) needs all three streams landed. `AF-z59` (B19 packed-package closure, B20 errors, B21 docs) can start once B0 is stable.

**6. Resolve `AF-d9m`** — `fast-check` as a devDependency vs table-driven properties. Five behaviors are affected (B2b, B3, B6, B11, B12). Agents were told **not** to add the dep and to defer. This needs a human call.

**7. File the two upstream BAML issues.** Text and repros are ready; nobody has filed them. Fixing bug 2 would collapse most of Phase 1.

**8. Run the full gate before declaring done:**

```
npm install && npm audit
npx tsc --noEmit ; npx eslint src/ ; npx jest
npx jest langfuse deterministic-trace-id     # non-negotiable for a provider
npm run test:circular-deps ; npm run build
npm run check:cjs-clean ; node test/package/run.mjs
```

## Other Notes

**Beads** (prefix `AF-`, this repo now has a beads DB):

| ID       | Scope                                           | Status                |
| -------- | ----------------------------------------------- | --------------------- |
| `AF-la1` | epic — Providers.BAML port                      | open                  |
| `AF-iur` | B0–B5 registration seam (closure **B5**) — cc_1 | in_progress           |
| `AF-cob` | B6–B10 transcript + turn machine — cc_2         | in_progress           |
| `AF-abc` | B11–B17 tool binding/safety/cancellation — cc_3 | in_progress           |
| `AF-0km` | B18 full loop closure **[BLOCKING]**            | open, unassigned      |
| `AF-z59` | B19–B21 packaging, errors, docs                 | open, unassigned      |
| `AF-d9m` | decision — fast-check                           | open, **needs human** |
| `AF-ln0` | upstream bug 2 (blocks runtime unions)          | open                  |
| `AF-e82` | upstream bug 1 (designed around, not blocking)  | open                  |

Other `AF-*` in-progress issues belong to unrelated reel-af work — ignore them.

**Agent Mail**: I did not register an identity, so there are no open message numbers from me. The three agents were told to use agent mail to coordinate (cc_1 announcing B0's landing, and `ChatBAML.ts` reservations) — check their inboxes for cross-talk.

**NTM**: _you are ORCHESTRATING an ntm session. use `ntm --help` to learn the ntm commands._
Session `providers-baml-2026-08-09-19-16` · panes 0=user, 1=cc_1, 2=cc_2, 3=cc_3 · `ntm attach providers-baml-2026-08-09-19-16`.

**Git posture**: conservative. `2989dd2` was committed on `main` with explicit user authorization and has **not** been pushed. Do not push without asking. Agents commit on their own branch.

**Two corrections I made mid-session, so you don't re-derive them**: I twice asserted BAML limitations without testing — "no tool calling" (wrong: union return types) and "no runtime type building" (wrong: generics + `$types`). Both were caught by the user. The lesson is in `../silmari-chat/scripts/baml-toolloop/README.md`: probe the CLI before trusting the docs _or_ memory.
