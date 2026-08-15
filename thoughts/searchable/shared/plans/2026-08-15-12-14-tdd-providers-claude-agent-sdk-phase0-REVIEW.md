---
date: 2026-08-15T16:50:00-04:00
reviewer: Claude (review_plan)
git_commit: 3f5dc561fc07fe710e9183de7f8a5015bda0751c
reviewed_plan: thoughts/searchable/shared/plans/2026-08-15-12-14-tdd-providers-claude-agent-sdk-phase0.md
status: needs-minor-revision
tags: [plan-review, tdd, claude-agent-sdk, providers, llm, hooks, closure-tests]
---

# Plan Review Report: `Providers.CLAUDE_AGENT_SDK` Phase 0

## Review Summary

This is a well-researched plan — every ground-truth SDK type claim is
tarball-verified (not scraped-docs), the central architectural risk (per-turn
model reconstruction vs. a stateful subprocess) is independently confirmed
and, on closer inspection, _understated_ rather than overstated, and the four
BLOCKING closure tests are structurally well-formed against the closure-test
framework. Six parallel codebase-verification passes against every cited
`file:line` came back almost entirely CONFIRMED.

That said, five findings are load-bearing enough to require a plan amendment
before implementation starts, not a note for later: (1) the hook-bridging
design never states whether Claude-internal tool calls go through this
repo's full `HookRegistry`/`executeHooks` composition — the same path every
other provider's tool calls use — or only ever see one hardcoded hook, and
the tracking epic's own description promises the former while the plan's
behaviors test only the latter; (2) the `Options.hooks.PreToolUse` extension
point is unit-tested in isolation but never proven wired into a real `query()`
call; (3)-(4) two of the plan's own precedent citations for "never emit
undefined" and "never fabricate zero usage" point at the wrong code and, if
trusted literally, would cause an implementer to skip guards the new provider
must write itself; (5) the plan's zod-compatibility analysis checks only
third-party dependency ranges, never this repo's own first-party zod imports,
which are the actual bump risk.

| Category          | Status |           Issues Found |
| ----------------- | -----: | ---------------------: |
| Contracts         |     ⚠️ | 2 critical, 3 warnings |
| Interfaces        |     ⚠️ | 0 critical, 3 warnings |
| Promises          |     ⚠️ | 2 critical, 2 warnings |
| Data Models       |     ⚠️ | 1 critical, 2 warnings |
| APIs              |     ⚠️ | 0 critical, 2 warnings |
| Workflow Closure  |     ⚠️ |  2 critical, 1 warning |
| Test-Spec Quality |     ⚠️ | 0 critical, 4 warnings |

Counts overlap deliberately — the hook-bridge gap is one root cause
surfacing under both Contracts and Workflow Closure; the two mis-citations
surface under both Promises and Test-Spec Quality.

---

## Contract Review

### Well-Defined

- ✅ Registry insertion points are exact and compile-enforced. `ChatModelConstructorMap` (`src/types/llm.ts:205-207`, confirmed verbatim) is mapped over the full `Providers` enum, not `Partial` — so the three insertion points B0 names (`ClientOptions` union ending `:153`, `ProviderOptionsMap` ending `:186`, `ChatModelMap` ending `:202`, all confirmed exact) are genuinely compile-enforced, not a convention that can be silently skipped.
- ✅ The central architectural premise is confirmed **and understated**. `Graph.ts:2400-2406` constructs `initializeModel(...)` fresh on every `createCallModel` invocation, confirmed verbatim, with no memoization anywhere on the path (`this.overrideModel` is the only escape hatch, and `Graph.ts:2402` doesn't use it). Stronger than the plan states: `Graph.ts:4636` (`.addEdge(toolNode, ... agentNode)`) means the model node re-executes on every inner tool-loop iteration too, not once per user turn — a `ChatClaudeAgentSDK` instance is constructed several times _within_ a single turn. Session continuity as JS instance state is even less viable than the plan's own argument claims; worth tightening the plan's own wording, not a defect.
- ✅ `bindTools` throw contract: precondition (non-empty `tools`) and postcondition (typed error, no SDK call) are both explicit and closure-tested (Closure D).
- ✅ Error contract (B8, B24) enumerates all three exported error types with what triggers each.
- ✅ `canUseTool`'s two-branch allow/deny contract, and the ask→deny-with-explanation degradation, are both explicit preconditions/postconditions with an explicit liveness guarantee (Promise always resolves).

### Missing or Unclear

- ❌ **CRITICAL — Hook-bridge composability is undefined.** The plan never states whether Claude-internal tool calls route through this repo's `HookRegistry`/`executeHooks` (the aggregating machinery every other provider's `ToolNode`-routed tool call goes through, folding multiple registered `PreToolUse` hooks via `deny > ask > allow` precedence — confirmed at `src/hooks/executeHooks.ts:180-205`) or only ever see a single hardcoded hook function passed via this provider's own client options. B20's Red step wraps one `createToolPolicyHook({...})` instance directly (`toSdkPreToolUseHook(policyHook)`); no behavior touches `HookRegistry.ts` or `executeHooks.ts`, and neither is named anywhere in the plan. This matters because `createWorkspacePolicyHook`'s own docs (`src/hooks/createWorkspacePolicyHook.ts:1-48`, confirmed) explicitly say it's meant to be _composed_ with `createToolPolicyHook` — "register both; `executeHooks` precedence... sorts out which decision wins" — which is exactly the composition every other provider gets automatically via `HookRegistry`. Tellingly, the tracking epic this plan's own session created (`bd show AF-xcnf`) describes the bridge as going "via... `createToolPolicyHook`/`HookRegistry`" — a promise the plan's concrete behaviors don't implement a path for or test. If the single-hook design is intentional, it needs to be stated as a scope cut (it isn't — it doesn't appear in "What We're NOT Doing"); if it's an oversight, a host with both hooks registered silently gets workspace-boundary enforcement for OpenAI/Anthropic tool calls but not for Claude-internal ones.
- ❌ **CRITICAL — `usage_metadata`'s "never fabricate zero" postcondition is not actually guaranteed by the code this plan reuses.** B7 requires no fabricated-zero `usage_metadata` when `modelUsage` is absent, citing `src/llm/stream/chunkAdapters.ts:15-35` as the repo-wide convention. Verified: those lines are `cloneGenerationChunkPiece`, the stream smoother's piece-deduplication logic — unrelated to usage fabrication, and not a "repo-wide" convention (the real, stated convention is BAML-module-local: `src/llm/baml/types.ts:39-42`, `src/llm/baml/callMeta.ts:47-60`). Worse: `src/llm/anthropic/utils/message_outputs.ts:103-107` — part of the _exact_ converter code B6 designates the "load-bearing reuse target" for streaming translation — **does fabricate a zero** on the `message_delta` path (`input_tokens: 0` when `cumulativeUsageMetadata` is unset). B7's own `usage.ts` must independently enforce omit-don't-fabricate; it cannot inherit the guarantee from the reused Anthropic converters, and the plan's citation currently implies it can.
- ⚠️ `hitlResolver`'s precondition contract (what happens if it throws/rejects, whether it's sync or async) is never stated — see Interface Review.
- ⚠️ Session-registry eviction (B14) silently starts a fresh session for a thread that was mid-conversation, with no observable signal — inconsistent with this same plan's own standard elsewhere (B25: "never silently dropped without a trace"; B21: the ask-degradation is explicitly worded to be distinguishable). See Data Model Review.
- ⚠️ `manualToolStreamProviders` (`src/llm/providers.ts:38-41`, confirmed — currently `{ANTHROPIC, BEDROCK}`) is never addressed by the plan. Given this provider never emits `tool_calls`, confirm explicitly that it needs no entry here (the default of not being in the set) rather than leaving it implicit.

### Recommendations

- State explicitly whether `ChatClaudeAgentSDK`'s hook bridge consumes this repo's `HookRegistry`/`executeHooks` (composing all registered `PreToolUse` hooks, matching every other provider's tool-execution path) or a single hook passed via client options — and if the latter, add it to "What We're NOT Doing" with the consequence spelled out (a host must manually compose hooks itself for Claude-internal tool calls).
- Re-cite B7's "no fabricated zero" precedent to `src/llm/baml/callMeta.ts:47-60`, and add an explicit fixture/edge case proving `usage.ts` overrides `message_outputs.ts:103-107`'s fabrication behavior rather than inheriting it.
- Add a one-line disposition for `manualToolStreamProviders`.

---

## Interface Review

### Well-Defined

- ✅ `ClaudeAgentSDKClientOptions extends BaseChatModelParams` matches every sibling `*ClientOptions` type's shape.
- ✅ `queryFn` as an internal, test-only constructor override (defaulting to the SDK's real `query`) is a clean, minimal test seam, consistent with `ChatBAML`'s own approach of accepting a real-port-shaped injectable.
- ✅ Public error classes (`ClaudeAgentSDKToolsUnsupportedError`, `ClaudeAgentSDKResultError`, `ClaudeAgentSDKSessionResumeError`) are named, typed, and each behavior states exactly what triggers which.

### Missing or Unclear

- ⚠️ **`hitlResolver`'s own interface is never declared.** It's referenced three separate times (What We're NOT Doing, the Deferred table, B21/B22) as the seam "something can plug into later," and its _output_ mapping (`approve`/`reject`/`edit`/`respond` → `PermissionResult`) is specified via `ToolApprovalDecision` (confirmed real at `src/types/hitl.ts:80-84`) — but its _input_ signature (what args it receives — tool name, input, the SDK's `canUseTool` context including `matchedAskRule`? sync or async? what happens if it throws?) is never given as a type in `types.ts`. Since this is explicitly the extension point a future bridge is meant to build against, its shape should be nailed down now, not left implicit.
- ⚠️ **Citation imprecision on the `bindTools`-throw precedent.** The plan says the new provider's throwing `bindTools()` "mirrors `ChatBAML.withStructuredOutput()`'s precedent exactly." Verified: `ChatBAML`'s own `bindTools()` is fully _implemented_ (`ChatBAML.ts:67-75`, delegates to `createToolBinding`), not a thrower — only `withStructuredOutput()` throws. The _error-shape_ pattern (typed `Error` subclass, `never` return, message naming the workaround) transfers cleanly and independently justifies this plan's choice, but the citation currently implies BAML's own `bindTools()` behaves the same way, which it doesn't. Re-ground the justification in this plan's own architecture (Claude Code owns its tool loop entirely; BAML's tool loop is host-executed) rather than an analogy to a method BAML implements differently.
- ⚠️ `sessionRegistry`'s public method signatures (`get`/`set` return/param types, especially whether `get` returns `{sessionId, cwd} | undefined`) aren't given formally — only informally referenced. Low severity since B11-B14 exercise it concretely, but worth stating for `sessionRegistry.ts`'s own file.

### Recommendations

- Add `hitlResolver`'s TypeScript signature to `src/llm/claudeAgentSdk/types.ts` before B21's Green step.
- Correct the `bindTools` precedent citation to reference the error-shape pattern generically (or `withStructuredOutput`'s error class directly) rather than implying `ChatBAML.bindTools()` itself throws.

---

## Promise Review

### Well-Defined

- ✅ Closure C's liveness guarantee (`canUseTool` always resolves, never left pending) is explicit and closure-tested, directly answering the SDK's own "no park deadline" warning.
- ✅ Abort/cancellation (B18): forwarding `config.signal` into `Options.abortController` correctly identifies that `attemptInvoke` itself does **not** supply abort semantics generically — verified: `attemptInvoke` only checks `config.signal` for a `StreamLimitExceededError` reason (`invoke.ts:863-876`), and the `options.signal?.throwIfAborted()` pattern the plan cites lives in the model subclasses themselves (`ChatBAML.ts:102-103,173,223`, `openai/index.ts:835,1613,2646`). The plan correctly scopes this responsibility to `ChatClaudeAgentSDK.ts` itself rather than assuming `attemptInvoke` provides it.
- ✅ `respond`'s honest-degradation promise (B22) is explicit: never a fabricated `allow`, and the property table covers all four `ToolApprovalDecision` variants.

### Missing or Unclear

- ❌ **CRITICAL — B6's "empty stream → empty content, never `undefined`" guarantee is mis-cited and, as cited, unenforced.** The plan attributes this to `src/llm/invoke.ts:1032-1039`, "mirrors BAML's B10." Verified: those exact lines do the opposite — `finalChunk` is declared `undefined` (`invoke.ts:859`) and is only ever assigned inside the stream-drain loops; if a provider's stream yields nothing, line 1039 (`return { messages: [finalChunk as AIMessageChunk] }`) **casts a genuinely-undefined value**, handing the graph `{messages: [undefined]}` typed as a message. The real guarantee is the _provider's own_ responsibility, demonstrated at `ChatBAML.ts:225,244,266-271`'s explicit `!yielded` guard that yields a `{content: ''}` chunk when nothing else was yielded. As written, an implementer trusting the plan's citation would conclude `attemptInvoke` already handles this and skip writing the equivalent guard in `ChatClaudeAgentSDK`'s `_streamResponseChunks` — silently failing B6's own edge case.
- ⚠️ Session-registry `cwd` field has no stated read/consistency promise — see Data Model Review (cross-referenced, not double-counted in the critical tally here).
- ⚠️ The `PermissionResult.deny` branch's `interrupt?` field (named in the research doc's Follow-up-Research pass — `{behavior:'deny', message, interrupt?}` — but never confirmed or denied in the plan's own tarball-verified "Key Discoveries" citation of `sdk.d.ts:2193-2205`) is unaddressed by B21/B22. Given how much of this plan's design effort goes into why this repo's own `interrupt()` is incompatible with `canUseTool`, a same-named field on the SDK's own return type deserves an explicit disposition (ignored / mapped / confirmed absent), not silence.

### Recommendations

- Add an explicit behavior (or fold into B6) requiring `ChatClaudeAgentSDK._streamResponseChunks` to yield a `{content: ''}` fallback chunk when no assistant messages were seen before the terminal result, mirroring `ChatBAML.ts:266-271` — and correct the citation.
- Before B21's Green step, re-read `sdk.d.ts:2193-2205` directly and state whether `PermissionResult.deny.interrupt?` exists and what this adapter does with it if so.

---

## Data Model Review

### Well-Defined

- ✅ `ClaudeAgentSDKResultError{subtype, errors}` cleanly carries the SDK's own discriminated union without inventing a parallel shape.
- ✅ `ToolApprovalDecision`'s four-variant vocabulary (confirmed exact at `src/types/hitl.ts:80-84`) is reused as-is for the `hitlResolver` mapping rather than inventing a new one.
- ✅ zod-resolution outcome is modeled as data (a fixed compile/install-time assertion, B0), not left as prose.

### Missing or Unclear

- ❌ **CRITICAL — B0's zod-compatibility analysis never checks this repo's own first-party zod usage.** Verified: `zod` has no `package.json` entry today (confirmed absent from dependencies/devDependencies/peerDependencies/overrides), resolves transitively at `3.25.67`, **and is imported directly by 10+ `src/` files** (`src/types/run.ts:6` and others). B0's table walks every _third-party_ dependency's declared zod range and confirms compatibility with v4 — genuinely careful work — but never asks whether this repo's _own_ source, written against whatever zod-v3 behavior those files assume, would break under the resolved top-level bump to v4 (zod v3→v4 has real breaking changes in error formatting, `.parse()` semantics, and schema introspection). This is exactly the category of risk the plan's "verified, not assumed" framing was built to catch, applied one layer short.
- ⚠️ `sessionRegistry`'s `Map<threadId, {sessionId, cwd}>` stores `cwd`, but no behavior (B11-B14) ever reads it back, and B15 recomputes `cwd` independently via `getLocalCwd(config)` on every call without consulting the registry. Either `cwd` is a dead field, or there's a missing behavior for what happens when a thread resumes with a _different_ resolved `cwd` than the one its session was created under (the SDK subprocess's on-disk session state is tied to its original working directory) — worth an explicit decision either way.
- ⚠️ B14's session-registry bound has no formal type surface (option name, default, whether zero/negative disables eviction) in `types.ts`'s stated files-touched list, despite being a real constructor option per "Decisions needed" item 2.

### Recommendations

- Add a fixture/behavior confirming this repo's own direct zod consumers (`src/types/run.ts` etc.) still typecheck/behave correctly under the resolved v4, not just that third-party ranges accept it.
- Either delete `cwd` from the session-registry value type, or add a behavior specifying resume-time cwd-consistency handling.

---

## API Review

### Well-Defined

- ✅ The public surface (errors, client options, `bindTools` throw) is the actual "API" here (no new HTTP/RPC endpoints), and it's fully enumerated with stable, typed exports from `errors.ts`.
- ✅ No packaged-boundary/npm-subpath surface is needed or claimed, correctly matching `CustomAnthropic`'s posture (a direct dependency, not BAML's optional-port shape) — confirmed: BAML's own `"./baml"` subpath (`package.json:17-21`) exists specifically because it's optionally registered; this provider's static registration needs no equivalent.

### Missing or Unclear

- ⚠️ No stated dependency-pin policy for `@anthropic-ai/claude-agent-sdk` itself, despite the plan's own "note on sourcing" flagging real version-drift risk (mismatched WebFetch summaries, explicit "re-verify... since the version may have moved by then"). State whether `package.json` pins the exact verified `0.3.233` or uses a caret/tilde range, and what CI does if a minor SDK bump silently changes an enum/type shape.
- ⚠️ `hitlResolver` is effectively a second, unversioned public extension API (see Interface Review) — once its type lands, changing its shape later is a breaking change for whatever the deferred "live human-response transport" work builds against it. Worth flagging as an evolution consideration even though the transport itself is out of scope.

### Recommendations

- State the SDK dependency's version-pin policy explicitly in B0 or B26 (host docs).

---

## Workflow Closure Review

### Well-Defined

- ✅ Closures A-D are structurally complete against the closure-test-framework template (SOURCE/TRIGGER/DRIVERS/OBSERVE/FORBIDDEN SPAN/RED-AT-SEAM/DRIVABILITY/EXECUTION all present for each).
- ✅ Closure B's boundary correctly identifies `highest_new_connector` (the session-registry read/write inside the new provider's `_generate`, not `attemptInvoke` itself, which is pre-existing and untouched) and places TRIGGER at/above it (`attemptInvoke`, an existing, unmodified entrypoint) — satisfying the framework's boundary rule.
- ✅ No BLOCKING closure is gated behind `describe.skip`/infra flags — the plan explicitly separates the opt-in `*.live.test.ts` suite from the always-run closures, honoring framework §4 rule 6 ("fails-closed, not skip-to-green").
- ✅ Mocking the fake `Query`/`queryFn` is framework-compliant: the `@anthropic-ai/claude-agent-sdk` subprocess boundary is a genuine third-party system boundary outside the map, exactly where §4 rule 3 permits a mock.
- ✅ Closure D's classification override (naming it BLOCKING despite being synchronous/same-module by the framework's default rule) is explicit and reasoned ("the failure mode... is high-cost enough to warrant a closure-style proof") — this is extra rigor, not a rule violation.

### Missing or Unclear

- ❌ **CRITICAL — same root cause as the Contract-Review hook-bridge finding, restated as a closure gap.** B20 (`toSdkPreToolUseHook`/`PostToolUse` translation) is tested by calling the returned adapter function directly with a hand-built SDK-shaped input (`const out = await sdkHook({hook_event_name: 'PreToolUse', ...}, 'x', {signal: ...})`) — the textbook gap-faithful pattern the closure framework exists to catch (§1: "calls an internal function directly"). No behavior's "Files touched" list includes `ChatClaudeAgentSDK.ts` for wiring this adapter into `Options.hooks`, and the plan's own Production Operation Chain diagram shows only the `canUseTool` edge, never `hooks.PreToolUse`/`PostToolUse`. Closure C only proves the `canUseTool` fallback path is real (which it does, correctly, by having the fake `Query` invoke `options.canUseTool` itself) — it says nothing about whether `Options.hooks.PreToolUse` is ever constructed, or how its precedence relative to `canUseTool` (hooks fire first, per the SDK's own documented evaluation order the plan itself cites) is actually realized. Either promote this to a fifth closure (a fake `Query` that itself calls `options.hooks.PreToolUse[...]`, mirroring Closure C's shape exactly) or state explicitly that this phase does not wire `Options.hooks` at all and relies solely on `canUseTool` — in which case B20's adapter has no production caller in this plan's scope and should be cut or deferred alongside the rest of the hitlResolver-adjacent seam work.
- ⚠️ Several behaviors cross the same async subprocess-stream boundary or session-registry store boundary as the four named BLOCKING closures, but aren't tagged BLOCKING/LEAF the way B9/B10/B12/B21 are (e.g. B6, B7, B8, B11, B13, B17). They're defensible as Tier-2 support tests underneath Closure A/B's umbrella coverage, but the framework's own checklist requires the tag be printed, not left to be inferred — an unclassified behavior defaults to BLOCKING by the framework's own rule (§3), so silence here is itself a (minor) framework-compliance gap.

### Recommendations

- Add a closure test (or explicit non-goal) for the `hooks.PreToolUse`/`PostToolUse` wiring path, symmetric to Closure C's `canUseTool` proof.
- Tag B6, B7, B8, B11, B13, B17 with `[part of Closure A/B]` or an explicit `LEAF: <reason>`, matching the rigor already applied to B9/B10/B12/B21.

---

## Test-Spec-Quality Review

### Well-Defined

- ✅ Given/When/Then throughout is concrete and falsifiable (e.g. B5: `content === "hello"` and the `tool_calls` key _absent_, not an empty array; B10: exact `.length === 0` assertions on both `tool_calls` and `tool_call_chunks` on the final composed chunk).
- ✅ Edge cases are domain-specific, not generic placeholders (B0's "zod resolving to two copies is the _expected_ outcome" is a good example of a real, non-obvious edge case grounded in the plan's own research, not a boilerplate list).
- ✅ Where Property fields are present (B6, B7, B9, B10, B13, B20, B22) they're genuinely table-driven with named rows tied to the behavior's actual domain, honoring the ratified table-driven-not-generative decision (confirmed real and current: `bd show AF-d9m`, closed 2026-08-09, "no fast-check dependency").
- ✅ B0's `no property` line explicitly states its reason ("fixed compile/install-time assertion") rather than leaving the field silently blank.

### Missing or Unclear

- ⚠️ **The plan's own stated Red/Green/Refactor coverage doesn't match its content.** The intro line ("Full Red/Green/Refactor cycles are given for the load-bearing behaviors (B0, B4, B10, B17, B22)") is inaccurate: B10, B17, and B22 show only Given/When/Then narrative in the document, no 🔴/🟢/🔵 code blocks, while B12 and B20 (not named in that list) do have full or closure-spec-referenced cycles. B10 in particular is described in its own text as "the single most important behavior in this plan" — it deserves a concrete, shown Red-step assertion, not narrative alone, precisely to guard against the failure mode this review dimension targets (an implementer satisfying the letter of a narrative spec without the shown test actually existing).
- ⚠️ B8 has a real, explicitly enumerated 4-variant domain in its own Given clause (`error_max_turns` / `error_during_execution` / `error_max_budget_usd` / `error_max_structured_output_retries`) — exactly the shape B7, one section above it, turns into a 3-row table-driven Property — yet B8 has no Property field and no stated skip reason.
- ⚠️ B14's eviction-boundary domain (entries under/at/over the configured bound) is a textbook property-testing case (off-by-one correctness at a numeric bound) but has no table-driven Property, only prose.
- ⚠️ B1-B5 lack even a one-line "no property, because..." statement the way B0 models it — a minor internal-consistency nit given several of them (B4 in particular: throws iff `tools.length > 0`) do have a small, real boolean domain.

### Recommendations

- Either fill in B10/B17/B22's Red steps with real code, or correct the intro sentence to name the behaviors that actually have them (B0, B4, B12, B20).
- Add a 4-row table-driven Property to B8 mirroring B7's shape.
- Add a boundary-value table-driven Property to B14 (bound−1, bound, bound+1 entries).

---

## Critical Issues (Must Address Before Implementation)

1. **Hook-bridge composability is undefined (Contracts + Workflow Closure).**
   - Impact: Claude-internal tool calls may silently receive weaker policy enforcement than every other provider's `ToolNode`-routed tool calls if a host's multiple registered `PreToolUse` hooks (the documented `createToolPolicyHook` + `createWorkspacePolicyHook` composition) aren't actually composed for this provider.
   - Recommendation: State explicitly whether the bridge consumes `HookRegistry`/`executeHooks` or a single client-option hook; add a closure test proving whichever is chosen.

2. **`Options.hooks.PreToolUse`/`PostToolUse` wiring has no production caller or closure test (Workflow Closure).**
   - Impact: B20's adapter may be dead code, or its precedence relative to `canUseTool` may be entirely unverified in production.
   - Recommendation: Add a fifth closure symmetric to Closure C, or explicitly cut this extension point from phase 0.

3. **B6's "never `undefined`" guarantee is mis-cited to code that does the opposite (Promises).**
   - Impact: an implementer trusting the citation skips writing the required `!yielded` guard; B6's own edge case silently fails.
   - Recommendation: Add the explicit guard behavior, correct the citation to `ChatBAML.ts:266-271`.

4. **B7's "no fabricated zero" guarantee is mis-cited, and the reused converter code contains a live counter-example (Promises + Contracts).**
   - Impact: `usage.ts` may inherit a zero-fabricating code path from the reused Anthropic converters instead of overriding it.
   - Recommendation: Re-cite to `baml/callMeta.ts:47-60`; add a fixture proving the override.

5. **B0's zod analysis omits this repo's own first-party zod consumers (Data Models).**
   - Impact: a v4 bump verified safe for every third-party dependency could still break this repo's own direct zod usage (10+ files) if it relies on v3-specific behavior.
   - Recommendation: Add a first-party-consumer check to B0's success criteria.

## Suggested Plan Amendments

```diff
# In "Testing Strategy" / Phase 4 (Hook / permission bridging)

+ Add: an explicit statement of whether the PreToolUse/PostToolUse bridge
+   consumes this repo's HookRegistry/executeHooks (composing all registered
+   hooks) or a single client-option hook, plus a closure test proving it.
+ Add: a fifth closure test ("a real PreToolUse hook decision reaches the
+   SDK's hooks.PreToolUse channel and is actually consulted before
+   canUseTool") symmetric to Closure C.

# In B6 (streaming content reuse)

~ Modify: add an explicit `!yielded` fallback-chunk requirement, and
+   correct its citation from `invoke.ts:1032-1039` to `ChatBAML.ts:266-271`.

# In B7 (usage_metadata derivation)

~ Modify: re-cite the no-fabricated-zero convention to
+   `src/llm/baml/callMeta.ts:47-60`, and add a fixture proving `usage.ts`
+   overrides `message_outputs.ts:103-107`'s fabrication behavior.

# In B0 (type closure & dependency verification)

+ Add: a check that this repo's own direct zod consumers (src/types/run.ts
+   and others) still typecheck/behave correctly under the resolved v4.
```

## Approval Status

- [ ] Ready for Implementation — No critical issues
- [x] **Needs Minor Revision** — Address the five critical items above (all are scoped, single-behavior amendments, not a redesign) before implementation proceeds; everything else here is a warning-level polish item that can be resolved during implementation.
- [ ] Needs Major Revision — Critical issues must be resolved first
