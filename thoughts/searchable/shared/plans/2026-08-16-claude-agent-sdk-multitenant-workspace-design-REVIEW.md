## Plan Review Report: thoughts/searchable/shared/plans/2026-08-16-claude-agent-sdk-multitenant-workspace-design-REVIEW.md [Design: multi-tenant workspace/cwd scoping for the Claude Agent SDK endpoint — REVIEW]

**Reviewed:** thoughts/searchable/shared/plans/2026-08-16-claude-agent-sdk-multitenant-workspace-design.md
**Reviewer:** review_plan (automated, 2026-08-16)
**Document type note:** This is a design-decision document, not a phased TDD implementation plan. It answers four questions (Q1–Q4); Q1/Q2/Q3 are implemented and shipped this session, Q4's fix is deliberately deferred to follow-up beads `AF-5f2j` (P1) and `AF-hro9`. The review therefore does two things: (a) spot-verifies the "already implemented" claims for Q1–Q3 against the actual codebase, since the doc makes strong, specific, falsifiable claims about shipped code and test coverage; (b) applies full pre-implementation rigor (Contracts/Interfaces/Promises/Workflow-Closure/Test-Spec-Quality) to the _not-yet-built_ Q4 fix, since that is the actual remaining implementation work this document exists to authorize.

### Review Summary

| Category          | Status | Issues Found                                                        |
| ----------------- | ------ | ------------------------------------------------------------------- |
| Contracts         | ⚠️     | 2 issues                                                            |
| Interfaces        | ❌     | 2 issues                                                            |
| Promises          | ❌     | 1 issue                                                             |
| Data Models       | ✅     | N/A — no data model introduced by this doc                          |
| APIs              | ✅     | N/A — no external API surface introduced                            |
| Workflow Closure  | ⚠️     | 1 issue                                                             |
| Test-Spec Quality | ⚠️     | 1 issue (structural — no TDD plan exists yet for the deferred work) |

---

### Contract Review

#### Well-Defined:

- ✅ **Q1 cwd-derivation contract** — `resolveClaudeAgentSdkWorkspace(req)` (`silmari-chat/packages/api/src/endpoints/custom/initialize.ts:198-215`) derives solely from `req.user.id`, with a real resolve+relative+containment path-traversal guard (lines 205-208) that throws rather than silently clamping. Confirmed by direct code read — no thread/conversation coupling anywhere in the file.
- ✅ **Q3 pathExtractors contract** — `CLAUDE_AGENT_SDK_PATH_EXTRACTORS` (`initialize.ts:267-278`) exactly matches the plan's table (Read/Write/Edit→`file_path`, NotebookEdit→`notebook_path`, Grep/Glob→`path`). `outsideRead`/`outsideWrite` are explicitly `'deny'` (lines 310-311), not left at hook defaults — a good practice the plan explicitly calls out and the code delivers.
- ✅ **Q4 problem-diagnosis contract** — every specific technical claim about _why_ `multiTenant: true` is broken today is confirmed to the letter: `settingSources: []` is set (call site `ChatClaudeAgentSDK.ts:419-421`), the per-tenant dir is created genuinely empty (no copy/seed code anywhere in `src/llm/claudeAgentSdk/` — grep for `copyFile|cpSync|copySync|AAI_TEMPLATE|seed` returns zero hits), and the SDK's own `sdk.d.ts` doc comment is quoted verbatim correctly ("Pass `[]` to disable filesystem settings... Must include `'project'` to load CLAUDE.md files.", `sdk.d.ts:1986-1987`, inside the `Options` type that `ChatClaudeAgentSDK.ts` actually uses — not a different, unrelated `settingSources` doc comment that exists elsewhere in the same `.d.ts` file).

#### Missing or Unclear:

- ❌ **AF-5f2j's idempotency promise has no concurrency-safe mechanism, and none exists in this codebase to reuse.** The plan states the fix must be "idempotent: only seed on first creation, never overwrite a tenant's subsequent session/state files on later calls" (plan lines 189-191) but does not specify _how_ that's enforced under concurrent access. `perTenantConfigDir()` today is fully synchronous with no marker/lock state (`ChatClaudeAgentSDK.ts:164-169`). The only "compute-once" pattern anywhere in this codebase is single-flight promise memoization for one global resource (`loadRealQuery()`/`loadSandboxRuntime()`, `ChatClaudeAgentSDK.ts:75-81`, `LocalExecutionEngine.ts:331-336`) — not keyed per-tenant, not directly reusable. No lockfile/mutex library exists in `src/`. Two concurrent first-requests for the same new tenant hash (a normal occurrence in a request-driven multi-tenant server — e.g. a client firing parallel requests before any response returns) can race on directory creation/copy with the design as specified.
- ⚠️ **`settingSources` value is left as an undecided either/or.** Plan lines 192-197 present two options ("Either drop it from `multiTenantEnv()`'s output entirely... or make it `['user', 'project', 'local']` explicitly") without picking one. `AF-5f2j`'s bead description repeats the same unresolved either/or. This should be pinned to a single value before a TDD plan is written — the two options are not behaviorally identical if the SDK's own CLI defaults ever diverge from `['user','project','local']` in a future SDK version.

#### Recommendations:

- Before authorizing AF-5f2j implementation, specify the concurrency-safety mechanism for first-time seeding (e.g., an atomic rename-into-place pattern: copy into a temp sibling dir, then `renameSync` into the final path, which is atomic on POSIX and naturally idempotent against a second racing writer; or a per-tenant in-memory promise cache analogous to `loadRealQuery()` but keyed by tenant hash).
- Pin the `settingSources` decision to one explicit value (recommend the explicit `['user','project','local']` form — the plan's own rationale that "the intent is visible in the code rather than relying on 'omitted means default'" is the stronger argument of the two it presents).

---

### Interface Review

#### Well-Defined:

- ✅ **`buildClaudeAgentSdkPreToolUseHook(toolPolicyHook, cwd)`** (`initialize.ts:302-321`) — confirmed real signature, confirmed real production caller at `initializeClaudeAgentSdk:385`, confirmed the result flows through `setAgentRuntimeOptions` (`agents/initialize.ts:1573/1575`) into `getAgentRuntimeOptions`'s `Object.assign(llmConfig, runtimeOptions)` merge (`agents/run.ts:1407-1409`). This is a live, wired production path, not a defined-but-unused function.

#### Missing or Unclear:

- ❌ **`AAI_TEMPLATE_DIR` — the interface AF-5f2j's fix depends on — does not exist anywhere in code and is undefined as a contract.** Grep across the repo for `AAI_TEMPLATE_DIR` returns exactly one hit: the plan document itself. `ClaudeAgentSDKClientOptions` (`src/llm/claudeAgentSdk/types.ts:41-105`) has no field resembling a template/config-source dir today. Unspecified: its type, whether required or optional, its default when unset outside the Docker deployment path (i.e. local dev — the plan only names `/home/node/.claude`, which won't exist on a developer's laptop), and behavior when the named template source doesn't exist (hard error vs. silent skip-seeding). An implementer cannot build this field without inventing all of the above unaided.
- ⚠️ **No copy-semantics specified.** "Copy the baked AAI package... into it" (plan line 187) doesn't state recursive/deep-copy behavior, symlink handling, or resulting file permissions on the copied tree — normally inconsequential, but worth one line in a future TDD plan since `fs.cpSync`'s default symlink behavior (`dereference: false`, copies the symlink itself) may not be what's wanted for a config directory that could itself contain symlinks (e.g. a shared skills directory).
- ⚠️ **AF-hro9's export name/shape is left ambiguous** ("export `extractCompileCheckPaths` (or a renamed, generalized sibling)", plan line 123). Low risk — no existing test imports the function by name (only exercises it indirectly via the built hook), so nothing downstream is locked to a specific identifier yet — but should be pinned in a future TDD plan's interface section rather than left as "either is fine."

#### Recommendations:

- Add an explicit `clientOptions.aaiTemplateDir?: string` (or equivalent) field to `ClaudeAgentSDKClientOptions`/`types.ts` as part of AF-5f2j's own scope, with a stated default resolution order (e.g. `clientOptions.aaiTemplateDir ?? '/home/node/.claude' if it exists ?? no seeding, log a warning`) rather than leaving the fallback path implicit.
- Decide and state the final exported name for AF-hro9 in that bead's own design notes (this review adds it there — see Beads section below).

---

### Promise Review

#### Well-Defined:

- ✅ **Q4's dormancy analysis for `ChatClaudeAgentSDKSessionResumeError`** — confirmed exactly: thrown at `ChatClaudeAgentSDK.ts:390` guarded by a mismatch condition requiring a _non-null_ prior session entry (`errors.ts:52-68`, guard `ChatClaudeAgentSDK.ts:385-391`). Confirmed _not_ reachable via `SessionRegistry` eviction: `get()` returns `undefined` on a missing/evicted key (`sessionRegistry.ts:34-36`), and the calling code correctly takes the fresh-start branch, not the mismatch-throw branch, when the entry is absent (`ChatClaudeAgentSDK.ts:383-393`). This is a well-reasoned, verified promise about when a specific error can and cannot fire.

#### Missing or Unclear:

- ❌ (Same finding as Contracts §1, restated here since it is fundamentally a broken-promise risk, not just a missing mechanism) — AF-5f2j's "idempotent... never overwrite" guarantee is stated as a promise the fix must uphold, but the design as written provides no mechanism to actually keep that promise under concurrent access. See Contracts §1 for the specific recommendation.

---

### Data Model Review

N/A — this document introduces no persisted data model, schema, or serialization format. `CLAUDE_CONFIG_DIR`'s on-disk directory layout is effectively a filesystem "shape" contract, covered under Interfaces above rather than as a data model.

---

### API Review

N/A — no new external (HTTP/RPC) API surface is introduced by this document. All changes are internal library/provider-configuration surface (`clientOptions`, hook composition), already covered under Interfaces/Contracts.

---

### Workflow Closure Review

#### Well-Defined:

- ✅ **Q3's hook composition has a real, confirmed production caller and correct runtime-options merge path** — `initializeClaudeAgentSdk` (`initialize.ts:365-400`, dispatched from `initializeCustom:516` guarded by `isClaudeAgentSdkEndpoint:515`) calls `buildClaudeAgentSdkPreToolUseHook` at line 385, and the resulting `runtimeOptions: { preToolUseHook }` is confirmed to reach `agents/run.ts:1407-1409`'s `Object.assign(llmConfig, runtimeOptions)`. This is not merely claimed in the plan text — it was independently traced through the actual call chain by the verification agent.
- ✅ **AF-j59p / AF-5f2j / AF-hro9 bead traceability** — both follow-up beads referenced by the plan already exist with matching DESIGN and ACCEPTANCE CRITERIA sections that mirror the plan's Q3/Q4 text. This is good workflow hygiene: the deferred work isn't an orphaned TODO in prose, it's tracked and linked (`AF-j59p` DEPENDS ON `AF-5f2j`).

#### Missing or Unclear:

- ⚠️ **No test proves the Q3 hook composition reaches the live request path end-to-end — only code-reading does.** All 9 tests in `claude-agent-sdk-workspace-hook.spec.ts`, and the sibling `__tests__/initialize.claudeAgentSdk.test.ts`, call `buildClaudeAgentSdkPreToolUseHook` directly with hand-built mock `toolPolicyHook`s (`alwaysAllow`/`alwaysDeny`, or a real `createToolPolicyHook({mode:'bypass'})`). None of them invokes `initializeClaudeAgentSdk` and asserts the composed hook actually lands in the `agents/run.ts` runtime-options merge. This is a source-to-sink test gap: the production wiring is real (confirmed above), but its correctness is currently guaranteed only by manual code review, not by an automated regression test — a future refactor of `initializeCustom`'s dispatch or `setAgentRuntimeOptions` could silently drop the wiring with no test failure.

#### Recommendations:

- Add one integration-level test that calls `initializeClaudeAgentSdk` (or the full `initializeCustom` dispatch) with a fixture request, and asserts the resulting `runtimeOptions.preToolUseHook` — when invoked with an out-of-workspace `Read` — denies, proving the composition survives the real production wiring path rather than only the hand-assembled unit-test path. This can be scoped as a small addendum to the existing Q3 test file rather than new work.

---

### Test-Spec-Quality Review

#### Well-Defined:

- ✅ **The document is honest about its own scope** — it explicitly states "This session did not ship the fix; it's the concrete next step, tracked below" (Q4) rather than presenting Q4 as done. It does not contain fabricated Given/When/Then blocks dressed up to look more complete than the work actually is.
- ✅ **Existing test conventions for this area are real, not mocked-to-uselessness.** `ChatClaudeAgentSDK.workspace.test.ts` and `createWorkspacePolicyHook.test.ts` both exercise real temp directories (`mkdtempSync`/`mkdtemp` + real `existsSync` assertions), not an injected fs mock — this is the established convention a future AF-5f2j implementation should follow, and it means the "no injectable fs seam" observation (see Interfaces) is not actually a blocker: the codebase's own pattern is to assert against the real filesystem in a temp dir, which works fine for verifying seeding behavior too.

#### Missing or Unclear:

- ⚠️ **No TDD plan exists yet for AF-5f2j or AF-hro9 — confirmed by exhaustive search.** `thoughts/` was grepped for `extractCompileCheckPaths`, `settingSources`, `perTenantConfigDir`, `multiTenant`, `AF-5f2j`, `AF-hro9` — the only matches are this design doc, its companion handoff, and the original (pre-dating these beads) phase-0 provider-build plan, which covers the original `multiTenant: true` behavior as shipped, not the AAI-seeding fix. This document is a design-decision narrative, not a Given/When/Then TDD plan, and does not claim to be one — so Test-Spec-Quality's checklist (concreteness, Edge Cases, Property/Domain, Red-step realism) cannot be scored against it directly. It is scored here as a **structural gap relative to the review's purpose**: implementation should not start on AF-5f2j/AF-hro9 until a proper TDD plan exists for them, given the concurrency-hazard and unresolved-interface findings above make this non-trivial, security-adjacent work (it governs whether every tenant's `claude` subprocess gets the mandatory AAI framework).

#### Recommendations:

- Before implementation, run `create_tdd_plan` (or the `create-tdd-plan` skill) against `AF-5f2j` and `AF-hro9`, seeded with this review's findings. At minimum it should include: a Given/When/Then behavior for the concurrent-first-request race (two simultaneous calls for a new tenant hash both must observe a fully-seeded, non-corrupted directory afterward — a natural **Invariant** property: _regardless of request interleaving, `perTenantConfigDir()` never returns a path whose seeding is partially complete_, with concurrency/interleaving as the generator domain), a behavior for the missing-template-source case, and a behavior locking down the final `settingSources` value.

---

### Critical Issues (Must Address Before Implementation)

1. **Promises/Contracts — AF-5f2j's idempotent-seeding guarantee has no concurrency-safe mechanism specified, and none exists in the codebase to reuse.**
   - Impact: A naive check-then-copy implementation has a classic TOCTOU race; under real multi-tenant load, two concurrent first-requests for a new tenant could interleave and leave `CLAUDE_CONFIG_DIR` partially seeded — which is exactly the "tenant gets no/broken AAI" failure mode this fix exists to close, just moved from "always" (today) to "sometimes, under load" (post-fix, if unaddressed).
   - Recommendation: specify an atomic seed mechanism (copy-to-temp-then-rename, or a per-tenant-keyed single-flight promise cache) in a follow-up TDD plan before implementation.

2. **Interfaces — `AAI_TEMPLATE_DIR` (the field AF-5f2j's fix is built on) does not exist in code and has no default/error-behavior specification.**
   - Impact: Without a stated default for non-Docker environments and a stated behavior for a missing template source, an implementer must invent both, risking divergent behavior between local dev and deployed image, or a fix that silently no-ops when misconfigured (repeating the exact "ships tenants an empty dir with nothing pointing out the problem" failure this fix is meant to close).
   - Recommendation: add `clientOptions.aaiTemplateDir` to `ClaudeAgentSDKClientOptions`/`types.ts` as explicit scope of AF-5f2j, with a stated resolution order and explicit error (not silent skip) when a configured template dir doesn't exist.

3. **Contracts — AF-5f2j's design leans on an external precondition (`/home/node/.claude` baked into the deployed image via `apps/cosmic-agent-core`) whose commit status is unconfirmed.**
   - Impact: The companion handoff document (`thoughts/searchable/shared/handoffs/general/2026-08-15_23-01-48_wire-claude-agent-sdk-into-silmari-chat-and-fix-session-bug.md`) states this Dockerfile + `apps/cosmic-agent-core/` seeding infrastructure was, as of that handoff, uncommitted and explicitly "not mine to touch or commit" in `silmari-chat`. If that infrastructure hasn't landed, AF-5f2j has no source directory to copy from in production, regardless of how correctly the copy logic itself is implemented.
   - Recommendation: before scheduling AF-5f2j implementation, confirm in `silmari-chat` that the baked `/home/node/.claude` image path is actually committed and shipped (or supply `aaiTemplateDir` from a confirmed alternate source).

---

### Suggested Plan Amendments

```diff
# Q4 — multiTenant: true / ChatClaudeAgentSDKSessionResumeError interaction

  ### The actual fix (tracked as AF-j59p's remaining implementation work)

  1. Seed, don't create empty. ...
+    Specify the concurrency-safety mechanism explicitly (e.g. copy-to-temp-dir
+    then atomic rename into place) so two concurrent first-requests for the
+    same new tenant cannot interleave into a partially-seeded directory.
+    Add `clientOptions.aaiTemplateDir?: string` to `ClaudeAgentSDKClientOptions`
+    with a stated default-resolution order and explicit error (not silent
+    no-op) when the resolved template source doesn't exist.
  2. Stop hardcoding settingSources: []. Either drop it ... or make it
-    ['user', 'project', 'local'] explicitly ...
+    ['user', 'project', 'local'] explicitly — PICK ONE (recommend the
+    explicit form) before writing a TDD plan for this bead.

+ Add: confirmation that `/home/node/.claude` (or equivalent baked AAI
+ location) is actually committed/shipped in `silmari-chat`'s Dockerfile +
+ `apps/cosmic-agent-core/`, not still-uncommitted infrastructure per the
+ 2026-08-15 handoff.
```

### Approval Status

- [x] **Needs Minor Revision** — Q1–Q3 sections are accurate, verified, and require no changes; they may be treated as settled/closed. Q4's _decision_ (extend `multiTenant`, don't avoid it) is sound and well-evidenced.
- [ ] Ready for Implementation
- [ ] Needs Major Revision

**Scoped correctly:** this document fully satisfies `AF-j59p`'s own acceptance criteria (state the decisions) and should not itself be revised further for Q1–Q3. The "Needs Minor Revision" gate applies specifically to `AF-5f2j`: do not move it to `create_tdd_plan` until the three critical findings above (concurrency mechanism, `aaiTemplateDir` interface, and the baked-image precondition) are resolved in the bead's design notes — after which a proper TDD plan (not this design doc) should carry the Given/When/Then detail. `AF-hro9` is lower-risk (naming ambiguity only) and can proceed to `create_tdd_plan` as-is.

---

### Minor / Citation Notes (non-blocking)

Several file:line citations in the plan have drifted from the actual current line numbers, almost certainly because later edits in the same session shifted content downward after the citations were written:

- Q1: `initialize.ts:192` (JSDoc, not the function) → actual function declaration is line 198; `initialize.ts:261` (unrelated `initializeBaml` code) → the actual `llmConfig: { cwd }` assignment is at line 390.
- Q4: `ChatClaudeAgentSDK.ts:216-226` cited for `settingSources: []` → that range is `multiTenantEnv()`'s body; the `settingSources: []` literal itself is at the `query()` call site, lines 419-421. `sdk.d.ts:1978-1984` → the actual doc-comment block is lines 1979-1988, with the quoted sentences at 1986-1987.
- Q4: the plan's "'ask' already degrades to a silent deny" (line 98) is slightly stronger than `docs/providers/claude-agent-sdk.md` §7's own wording, which describes the deny as carrying "a message distinguishing it as a degraded-ask outcome" — not unexplained/silent to the caller, just without a human-approval escalation path.

None of these affect the substance of any claim (all were independently re-verified against current line numbers and confirmed accurate in behavior) — recommend a quick pass to refresh citations since this doc is referenced as a long-lived companion to `docs/providers/claude-agent-sdk.md` and the handoff doc.
