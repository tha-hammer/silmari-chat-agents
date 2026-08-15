---
date: 2026-08-09T21:09:33-04:00
researcher: tha-hammer
git_commit: 7f9b3504fc5497298f06a704a6832d2a96465358
branch: providers-baml-2026-08-09-19-16
repository: silmari-chat-agents
topic: 'Providers.BAML port — Phase 0 complete, awaiting merge decision'
tags: [implementation, baml, providers, llm, ntm, orchestration, complete]
status: complete
last_updated: 2026-08-09
last_updated_by: tha-hammer
type: implementation_strategy
---

# Handoff: Providers.BAML Phase 0 is done — the branch is unmerged and unpushed

## Task(s)

The prior handoff asked me to poll three ntm agents, unblock them, review their work,
and drive the plan to completion. **That is done.** All 23 behaviors and all three
blocking closures are landed and verified.

| Task                                 | Status                                         |
| ------------------------------------ | ---------------------------------------------- |
| Drive B0–B17 to completion           | ✅ complete, 5 commits                         |
| B18 full loop closure **[BLOCKING]** | ✅ complete, `fc429fc`                         |
| B19–B21 packaging / errors / docs    | ✅ complete, `7f9b350`                         |
| Resolve `AF-d9m` (fast-check)        | ✅ ratified — no dependency, table-driven      |
| File the two upstream BAML issues    | ⏸ **still not filed** — deliberately deferred |
| Merge / push the branch              | ⏸ **needs your decision** — see Action Items  |

**What remains is a decision, not work.** The branch is complete and green; nobody
has decided whether it merges.

## Recent changes

Seven commits on `providers-baml-2026-08-09-19-16`, in
`/home/maceo/ntm_Dev/providers-baml-2026-08-09-19-16`. **40 files, +4,251 / −6.**
Not merged, not pushed.

```
7d35ac0 feat(baml): B0  — public type closure for Providers.BAML
13ecbcf feat(baml): B1-B5 — registration seam + blocking closure
ec56900 refactor(baml): narrow instead of casting in B4
630bb40 feat(baml): B6-B10 — transcript projection + turn state machine
2b17311 feat(baml): B11-B17 — tool binding safety gate, cancellation, usage
fc429fc test(baml): B18 — the full tool loop closes [BLOCKING CLOSURE]
7f9b350 feat(baml): B19-B21 — packaged boundary, public errors, host docs
```

Only one change lands outside `src/llm/baml/`, `test/package/`, `docs/`, `config/`
and `package.json`: `src/session/messageSerialization.ts` gains `export` on
`toJsonObject` — one token, no other edit. The alternative was
`toJsonValue(args) as JsonObject`, a cast `AGENTS.md` forbids and a second weaker
copy of logic three lines away.

## Gate results — every one run by me, not taken on agent report

```
npx tsc --noEmit                          exit 0
npx eslint src/                           0 errors (102 pre-existing warnings, none in baml)
npx jest                                  4276 passed / 12 failed  ← see below
npx jest langfuse deterministic-trace-id  165 / 165
npm run test:circular-deps                7 / 7, with the 13 → 14 change
npm run build                             clean, 353 CJS files
npm run test:package                      B19 PASSED — 5 packed consumers
npm audit                                 0 vulnerabilities
package-lock.json                         UNCHANGED — no dependency added, by design
```

**The 12 failures are not ours.** All three failing suites are live-API integration
specs. I confirmed the cause rather than assuming it:
`src/llm/google/llm.spec.ts` and `src/llm/anthropic/llm.spec.ts` fail _to load_
("Please set an API key … GOOGLE_API_KEY"); `src/llm/vertexai/llm.spec.ts` fails in
`GoogleAuth.findAndCacheProjectId`. Environmental, pre-existing, unrelated to BAML.

B19's own output:

```
• packed librechat-agents-3.4.3.tgz
  ✓ ESM  (import ./baml side-effect + root initializeModel resolves BAML)
  ✓ CJS  (require ./baml + root share ONE registry — dual-format proof)
  ✓ NEG  (root-only import leaves BAML unregistered — fails closed)
  ✓ TYPE bundler (BamlClientOptions + errors via exports.types)
  ✓ TYPE node10  (BamlClientOptions + errors via typesVersions)
```

## Learnings

### The plan had five defects that only implementation exposed — tracked as `AF-fhk`

The plan was reviewed (rev 2) and diagrammed (rev 3) without any of these surfacing.
Every one was caught by an implementing agent or by executing a gate:

1. **S7's grammar is unsatisfiable.** `plan:468` says `toolCalls = selected-tool*`,
   but `selected-tool` (`plan:425`) has no `id`, while S7's own contract sentence
   (`plan:471`) requires `toolCalls[].id`. Fixed in code with
   `BamlTranscriptToolCall extends BamlSelectedTool { id }`.
2. **`BamlTurnChunk` is a dangling nonterminal** — referenced at `plan:131`, `:309`,
   `:409`, never defined.
3. **B20's error inventory is six, not four.** `plan:804-809` and the S1 production
   at `plan:313-314` both omit `BamlTurnError` (B9) and `BamlUnsupportedError` (B16).
   All six must be exported or B19's type consumer cannot catch them by class.
4. **`npm run check:cjs-clean` (`plan:833`) names a script that does not exist** and
   never did. Satisfied the review's real intent by adding `test:package` and wiring
   it into `prepublishOnly` — release-facing, not CI-only.
5. **B19's NodeNext type consumer cannot pass.** Tracked separately as `AF-sy8`.

### The NodeNext limitation is repo-wide, not BAML's — verify before you re-litigate

An agent deleted `tsconfig.nodenext.json` from the B19 matrix. Dropping a requirement
from a blocking closure is exactly what should not be taken on report, so I checked
the emitted declarations:

- `dist/types/index.d.ts` — **the root entry** — re-exports extensionlessly
  (`export * from './run'`). Under `moduleResolution: nodenext` a `.d.ts` in ESM
  context needs explicit `.js` extensions, so the root fails NodeNext before BAML
  is involved.
- `@/` aliases survive into emitted declarations for unrelated modules:
  `dist/types/stream.d.ts`, `dist/types/langfuseRuntimeContext.d.ts`,
  `dist/types/llm/contextOverflowRecovery.d.ts`.

No entry of this package resolves types under NodeNext today. The `bundler` and
`node10` consumers cover `exports.types` and `typesVersions` and both pass.

### About orchestrating this ntm session

- **`ntm activity` / `ntm wait` give false idles on narrow panes.** `--until=idle`
  reported all four WAITING while pane 2 was visibly mid-turn at 1m53s.
  `--until=complete` was better but still raced. **Poll `git log` and `bd show`
  instead** — artifacts do not lie about state.
- **A pane stuck in `UNKNOWN` is often blocked on a confirmation prompt**, not hung.
  Pane 4 sat 8 minutes on an `AskUserQuestion` gate asking whether to commit. Tail
  the pane before assuming a stall.
- **`ntm send --file` is more reliable than a long inline prompt** for multi-line
  briefs.
- `ntm add <session> --cc=1` works past the `large_spawn_threshold: 4` gate that
  refuses a fresh 4-agent spawn. Confirmed, not just documented.
- **The agents mutation-tested their own work unprompted**, and it paid: cc_1 caught
  that `__resetChatModelRegistry` must clear before restoring (`Object.assign` alone
  undoes deletions but leaves additions); cc_2 killed three transcript mutants and in
  doing so _pre-validated the red-at-seam it handed to B18_.

### A shared file across three agents costs you a bisectable history

`630bb40` **does not typecheck on its own** — it imports `toolBinding.ts`,
`callMeta.ts` and `errors.ts`, which were untracked at the time and owned by two other
agents. cc_2 disclosed this in its own commit message rather than hiding it, and its
reasoning is defensible (sweeping them in would have captured another agent's
half-written state and misattributed the work). But `git bisect` across this branch
will hit a broken commit. **If you want a clean history, squash `630bb40` + `2b17311`
before this leaves the branch.**

The root cause was three agents writing `src/llm/baml/ChatBAML.ts`. The fix that did
work: I gave `src/llm/baml/errors.ts` to a **single** owner who landed all five error
classes up front, before its own research pass, which removed a three-way write hazard
before it happened.

## Artifacts

**On branch `providers-baml-2026-08-09-19-16`:**

- `src/llm/baml/{types,ChatBAML,transcript,toolBinding,callMeta,errors,index}.ts`
- `src/llm/baml/__tests__/` — 12 suites including `toolLoop.closure.test.ts` (B18)
- `src/llm/__tests__/providers.registry.test.ts`
- `test/package/run.mjs` + 5 consumers, 3 tsconfigs (B19)
- `docs/providers/baml.md` — 259 lines, 9 sections (B21)

**Unchanged on `main`:** the plan, review, research and scope docs from `2989dd2`.

## Action Items & Next Steps

**1. Decide what happens to the branch.** It is complete, green, and untouched by
anyone else. Nothing was pushed. Options: merge to `main` as-is, squash
`630bb40`+`2b17311` first for a bisectable history, or open a PR.

**2. File the two upstream BAML issues.** Still not filed. Text and repros are ready
in `../silmari-chat/scripts/baml-toolloop/issues/0{1,2}-*.md`. Fixing bug 2
(`AF-ln0`) would collapse most of Phase 1.

**3. Revise the plan to rev 4** (`AF-fhk`) so the five defects above do not mislead
the next reader. The code is right; the document is not.

**4. Fix the NodeNext type emit** (`AF-sy8`) and restore `tsconfig.nodenext.json` to
the B19 matrix. This is a pre-existing package-wide defect that the BAML port merely
surfaced — it affects every consumer of this package, not just BAML's.

**5. Shut down the ntm session** when you are satisfied:
`ntm kill providers-baml-2026-08-09-19-16`. All four agents are idle with their beads
closed.

## Other Notes

**Beads** (prefix `AF-`):

| ID       | Scope                                        | Status                              |
| -------- | -------------------------------------------- | ----------------------------------- |
| `AF-la1` | epic — Providers.BAML port                   | ✅ closed                           |
| `AF-iur` | B0–B5 registration seam, closure **B5**      | ✅ closed                           |
| `AF-cob` | B6–B10 transcript + turn machine             | ✅ closed                           |
| `AF-abc` | B11–B17 tool binding / safety / cancellation | ✅ closed                           |
| `AF-0km` | B18 full loop closure **[BLOCKING]**         | ✅ closed                           |
| `AF-z59` | B19–B21 packaging, errors, docs              | ✅ closed                           |
| `AF-d9m` | fast-check decision                          | ✅ closed — ratified, no dependency |
| `AF-fhk` | plan rev 4 — five defects                    | 🆕 open, P3                         |
| `AF-sy8` | NodeNext-incompatible type emit              | 🆕 open, P2                         |
| `AF-ln0` | upstream bug 2 — blocks runtime unions       | open, P2                            |
| `AF-e82` | upstream bug 1 — designed around             | open, P2                            |

**All three rev-1 reversals held under implementation pressure**, which was the thing
most at risk of quiet regression: `./baml` ships dual CJS+ESM (the CJS consumer is
what proves it), no optional peer dependency on the bridge was added, and
`registerChatModel` is still absent from `src/index.ts`. No `as never` and no `any`
anywhere in `src/llm/baml`.

**Git posture: conservative.** Seven commits exist on the worktree branch only.
Nothing merged, nothing pushed, `main` untouched since `2989dd2`.

**NTM**: session `providers-baml-2026-08-09-19-16` · panes 0=user, 1=cc_1 (B0–B5,
B18), 2=cc_2 (B6–B10), 3=cc_3 (B11–B17), 4=cc_4 (B19–B21, added mid-session).
