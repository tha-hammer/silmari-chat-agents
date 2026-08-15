---
date: 2026-08-15T12:01:15-04:00
researcher: tha-hammer
git_commit: 3f5dc561fc07fe710e9183de7f8a5015bda0751c
branch: main
repository: silmari-chat-agents (@librechat/agents v3.4.3)
topic: 'TDD plan: Providers.CLAUDE_AGENT_SDK — registry entry + ChatClaudeAgent, no host-visible tool loop'
tags:
  [
    plan,
    tdd,
    claude-agent-sdk,
    claude-code,
    providers,
    llm,
    subprocess,
    hooks,
    permissions,
  ]
status: ready-for-review
last_updated: 2026-08-15
last_updated_by: tha-hammer
---

# `Providers.CLAUDE_AGENT_SDK` — TDD Implementation Plan

## Overview

Add the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) as a provider: a
`BaseChatModel` subclass whose `_generate`/`_streamResponseChunks` drive one
bounded `query()` session — spawn (or resume) a `claude` CLI subprocess,
translate its message stream into `AIMessageChunk`s, and surface the terminal
result as usage/cost/session metadata. **This provider never emits
`tool_calls` to the host graph** — Claude Code's own tool loop runs entirely
inside the subprocess (per the resolved architecture decision below), so
`toolsCondition` always routes to `END` for it. Permission decisions for that
internal tool loop are bridged to this repo's own `createToolPolicyHook`/HITL
system via the SDK's `hooks`/`canUseTool` extension points.

Eighteen behaviors (B0–B17). Two are BLOCKING closure tests. Grounded
throughout in the **real, installed package types** (`@anthropic-ai/claude-agent-sdk@0.3.233`,
downloaded and inspected directly — see "A note on sourcing" below), not
scraped documentation.

## A note on sourcing (read before trusting any field name below)

The predecessor research doc's first pass verified the SDK against Anthropic's
hosted docs via `WebFetch`. A second `WebFetch` of the same TypeScript
reference page, run while preparing this plan, returned a **materially
different and partially contradictory** description of `SDKMessage` and
`Options` (different variant names, a fabricated `stop_reason` enum on the
result message that doesn't exist). `WebFetch` explicitly processes pages
through "a small, fast model" and warns results may be summarized — it is not
a reliable source for exact field names, and this plan does not use it for
any type-level claim.

Instead: `npm pack @anthropic-ai/claude-agent-sdk@latest` was run directly,
the tarball extracted, and every type cited below is copied verbatim (via
`Grep`+`Read`, never `cat`) from the real `sdk.d.ts`/`sdk-tools.d.ts` files at
version **0.3.233**. Line numbers cited under "SDK facts" refer to that
extracted `sdk.d.ts`. Re-verify against `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
once the dependency is installed — the version may have moved.

## Current State Analysis

Continues from
[the research doc](../research/2026-08-13-10-38-claude-code-sdk-agent-provider.md),
which already made three binding decisions (2026-08-13) and resolved three
follow-up open questions (2026-08-15):

1. **Direct dependency** on `@anthropic-ai/claude-agent-sdk`, not BAML's
   host-implemented port pattern.
2. **Claude Code drives its own tool loop** — not routed through this repo's
   `ToolNode`.
3. **`Providers` enum member**, registered like `ANTHROPIC`/`BAML`, occupying
   the "main agent model" slot.
4. Session/workspace isolation reuses `resolveWorkspacePathSafe`; concurrent-session
   scaling is a host concern; `sessionStore` is a thin pass-through.
5. Hook bridging is mechanical for `allow`/`deny`; `respond` has no SDK analog.
6. Nothing from the local-coding-engine tool bundle is exposed via
   `createSdkMcpServer` — pure duplication of Claude's own built-ins.

This plan is the TDD design for (1)+(2)+(3), refining (4)+(5) with the real
SDK types below.

### Key discoveries

- **`llmProviders` is a static object literal, not the BAML side-effect
  pattern** (`src/llm/providers.ts:22-36`). Decision 1 (direct dependency)
  means this provider does **not** need BAML's `registerChatModel` side-effect
  registration or a separate npm subpath (`config/package-entries.mjs`,
  `package.json` `exports`) at all — it can be a normal, always-present entry
  like `CustomAnthropic`. This eliminates the single largest source of
  complexity in the BAML precedent plan (S1 packaging boundary, the
  ESM-only/dual-CJS-ESM decision, `config/circular-deps.test.mjs`'s 13→14
  count).
- **No tool-schema codegen phase is needed at all** (BAML's hardest phase).
  Decision 2+6 mean this repo's tool registry never crosses into the
  subprocess — Claude Code only ever runs its own built-in tools.
- **`SDKAssistantMessage.message` is typed as the real `Anthropic.Beta.BetaMessage`**
  (verified: `sdk.d.ts:3021-3070`, field `message: BetaMessage`) — the exact
  same shape `@anthropic-ai/sdk`'s own Messages API returns, which
  `src/llm/anthropic/utils/message_outputs.ts` already converts to LangChain
  content/messages (`getAnthropicUsageMetadata`, `:19-42`;
  `_makeMessageChunkFromAnthropicEvent`, `:55`; `anthropicResponseToChatMessages`,
  `:312-351`, which itself calls `getAnthropicUsageMetadata` and
  `toLangChainContent` on a content-block array shaped exactly like
  `BetaMessage.content`). **This is the load-bearing reuse target for B4/B5**
  — translation is adaptation of existing, tested code, not new logic from
  scratch. Verify exact structural compatibility once the dependency installs
  (B4's Red step); a version-skew content-block type (e.g. a block type this
  repo's `@anthropic-ai/sdk@^0.115.0` doesn't know about yet) is the realistic
  failure mode, not a wholesale mismatch.
- **`SDKResultMessage = SDKResultSuccess | SDKResultError`**
  (`sdk.d.ts:4559`), discriminated by `subtype`
  (`'success'` vs. `'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries'`,
  `sdk.d.ts:4529-4593`) — confirms the _original_ (2026-08-13) research pass's
  claim and refutes the second `WebFetch`'s fabricated `stop_reason` enum.
  Both variants carry `usage: NonNullableUsage`, `modelUsage: Record<string, ModelUsage>`,
  `total_cost_usd`, `num_turns`, `session_id`, `stop_reason: string | null`
  (a plain string, not a literal union).
- **`CanUseTool`'s context object already carries `matchedAskRule`**
  (`sdk.d.ts:254-265`) — "Set when a user-configured ask RULE
  (`permissions.ask`) forced this prompt" — and returns strictly
  `Promise<PermissionResult | null>`, where `PermissionResult` (`sdk.d.ts:2193-2205`)
  is a two-branch `{behavior:'allow',...} | {behavior:'deny',...}` union with
  **no ask/pause branch**. `canUseTool` _is_ the SDK's ask/HITL extension
  point.
- **A separate `PermissionRequestHookInput`/`PermissionRequestHookSpecificOutput`
  pair exists** (`sdk.d.ts:2173-2191`), tied to a distinct `'PermissionRequest'`
  hook event — also strictly two-branch allow/deny, no ask. Meanwhile
  `PreToolUseHookSpecificOutput.permissionDecision` (`sdk.d.ts:2334-2340`) is
  typed `HookPermissionDecision = 'allow' | 'deny' | 'ask' | 'defer'`
  (`sdk.d.ts:843`) — a hook _can_ return `'ask'`, but no type-level evidence
  shows what happens procedurally afterward (types don't encode control flow).
  **Design decision (B11)**: this repo's `PreToolUse` adapter never emits
  `'ask'`/`'defer'` — it only ever resolves `'allow'`/`'deny'`, or abstains
  (returns no `permissionDecision`) when this repo's own policy would say
  `'ask'`, letting evaluation fall through to `canUseTool` (B13), which is
  unambiguously the documented pause point. This sidesteps the hook-level
  `'ask'` ambiguity by construction rather than by assumption. A live
  behavioral check of hook-level `'ask'` (does it also reach `canUseTool`, or
  something else) is listed under Deferred — informative, not blocking, since
  the design never exercises that path.
- **`respond` (this repo's HITL outcome that substitutes a canned tool result
  without executing) has no SDK analog**, confirmed against the real
  `PermissionResult`/`CanUseTool` types: allow (optionally with `updatedInput`)
  or deny (with a `message`) are the only two branches, at both the hook layer
  and the `canUseTool` layer. `respond` must degrade to `deny` with an
  explanatory message (B13); this repo's own doc note that `respond` "does
  NOT fire the per-tool `PostToolUse` hook" (`src/types/hitl.ts:73-75`) is
  consistent with never letting `respond` reach the SDK's tool-execution path
  at all.
- **`Options.env` REPLACES the subprocess environment entirely, it does not
  merge with `process.env`** (`sdk.d.ts:1461-1479`, explicit in the JSDoc).
  Any multi-tenant `CLAUDE_CONFIG_DIR`/`CLAUDE_CODE_DISABLE_AUTO_MEMORY`
  isolation option (B8) that sets `env` must spread `process.env` itself or
  the subprocess loses `PATH`/`HOME`/credentials.
- **`Options.toolAliases`** (`sdk.d.ts:1422-1447`) lets a host redirect a
  built-in tool name (e.g. `Bash`) to an MCP tool name at the name-resolution
  layer, without changing what the model sees. This is a genuine, previously
  undiscovered mechanism for enforcing _this repo's own_ workspace/sandbox
  policy on Claude's built-in tools without duplicating them — a materially
  different (and more promising) shape than "expose our tools via
  `createSdkMcpServer`," which the prior research pass correctly rejected.
  Listed under Deferred, not in this phase's scope (it composes with the
  Deferred `createSdkMcpServer` question, doesn't replace it, and needs its
  own design pass).
- **Dependency compatibility is real but not blocking**, unlike BAML's
  ESM-only wall. Verified directly: this repo has **no `zod` entry in
  `package.json`** today; `zod@3.25.67` is present only transitively
  (`package-lock.json`). Every existing consumer of zod in this dependency
  tree already declares a dual range — `@langchain/core`, `@langchain/anthropic`,
  `@langchain/openai`: `zod@^3.25.76 || ^4`; `@langchain/langgraph` (peer):
  `^3.25.32 || ^4.2.0`; `@anthropic-ai/sdk` (peer): `^3.25.0 || ^4.0.0`;
  `@mistralai/mistralai`, `openai`, `zod-to-json-schema`: same shape — **except**
  `@anthropic-ai/sandbox-runtime`, which pins `zod@^3.24.1` with no v4 support
  declared. `@anthropic-ai/claude-agent-sdk`'s own peer dependency (confirmed
  via direct npm registry fetch) is strictly `zod: "^4.0.0"` — no v3 fallback.
  Adding `zod@^4` as a direct dependency satisfies every consumer except
  `sandbox-runtime`, which npm resolves with its own nested `zod@3.24.x` copy
  — safe here because `sandbox-runtime` and this new provider never share a
  zod schema instance (sandbox-runtime is used only by
  `LocalExecutionEngine`'s own bash sandboxing; this provider's only
  zod-consuming surface, `createSdkMcpServer`/`tool()`, is explicitly out of
  scope per decision 6). `@modelcontextprotocol/sdk` is a genuinely new
  dependency (absent even transitively today) — the SDK's own internals
  require it regardless of whether this repo calls `createSdkMcpServer`.
  **Verification, not assumption**: B0's Green step runs a real
  `npm install` and asserts no `ERESOLVE` and a single top-level `zod@4.x`
  resolution (`npm ls zod`).
- **Test style**: Jest + ts-jest, `*.test.ts` under `src/`, `@/` aliases, real
  logic over mocks (`AGENTS.md:112-118`, confirmed still current — same
  convention the BAML plan cites). `src/llm/__tests__/providers.registry.test.ts`
  already exists (extended by BAML) — this provider's registry behaviors
  extend it, not a new file.
- **Langfuse is non-negotiable for a provider** (`AGENTS.md:122-157`): "any
  change that touches... tool execution, message serialization, streaming, or
  providers must keep traces well-shaped." A `generation` observation with
  correct model attribution and accurate usage/cost is a per-provider
  requirement, not optional polish (B14).

## Desired End State

`initializeModel({ provider: Providers.CLAUDE_AGENT_SDK, clientOptions })`
returns a `ChatClaudeAgent` instance. `attemptInvoke`'s normal `.stream()`/`.invoke()`
path drives one bounded `query()` session per call: cwd resolved through this
repo's existing workspace clamp, permission decisions bridged to this repo's
own hook/HITL system, and the terminal result surfaced as an `AIMessage`/`AIMessageChunk`
carrying text content, usage metadata, and session/cost `response_metadata` —
**never** `tool_calls`. A Langfuse `generation` observation is produced with
correct attribution. Abort propagates. `sessionStore`/`resume` pass through
untouched.

### Observable behaviors

- Given `Providers.CLAUDE_AGENT_SDK` client options with no tools bound, when
  invoked, then a final `AIMessage` with the session's text result and
  `usage_metadata`, never `tool_calls`.
- Given a scripted multi-message session (assistant text chunks, then a
  terminal result), when streamed, then `AIMessageChunk`s concatenate to the
  same content, with `usage_metadata` attached exactly once, on the message
  carrying the terminal result.
- Given this repo's `createToolPolicyHook` would `allow`/`deny` a tool name,
  when the (test-injected, SDK-contract-shaped) session asks permission for
  that tool, then the SDK-facing decision matches — proving the bridge is
  wired, not just type-compatible.
- Given `config.signal` aborts mid-flight, when the injected session's abort
  branch fires, then no further messages are processed and the call rejects.
- Given a raw, unclamped `cwd` in client options that resolves outside the
  configured workspace roots, when constructing `Options.cwd`, then the same
  clamp `LocalExecutionEngine`'s tools already enforce applies — no separate,
  weaker check.

## What We're NOT Doing

- No tool-schema codegen, no translation of this repo's tool registry into
  anything Claude Code consumes (decision 2 makes this moot, unlike BAML).
- No `ToolNode`/`toolsCondition` involvement for this provider — it never
  emits `tool_calls`.
- No `registerChatModel` side-effect registration or separate npm subpath —
  direct dependency means a normal static `llmProviders` entry (decision 1
  supersedes BAML's packaging pattern here).
- No exposing this repo's local-coding-engine tools via `createSdkMcpServer`
  (research doc's resolved decision 6).
- No `toolAliases`-based redirection of Claude's built-ins to this repo's own
  sandboxed tools — a real, discovered opportunity, explicitly deferred (see
  Deferred).
- No `SessionStore` adapter implementation — accept and forward the option,
  implement nothing (decision 4).
- No subprocess-pool, concurrency limiter, or scaling layer — host concern
  (decision 4).
- No live/real `claude` CLI subprocess spawn in the default Jest run — fakes
  are real implementations of the SDK's own `Query`/`SDKMessage`/`Options`
  contracts (mirrors BAML's "fakes are real implementations of _our_ port, not
  mocks of BAML"); a real-subprocess suite is opt-in, mirroring this repo's
  existing `test:live:handoffs` pattern.
- No hook-level `'ask'`/`'defer'` support — deliberately never emitted by this
  repo's adapter (see Key Discoveries).

## Testing Strategy

- **Framework**: Jest + ts-jest, `*.test.ts` under `src/`.
- **Drivability seam**: `ChatClaudeAgent`'s client options accept an optional
  `queryFn` (defaults to the real `query` export of `@anthropic-ai/claude-agent-sdk`).
  Tests inject a fake `queryFn` returning a real `AsyncGenerator<SDKMessage, void>`
  that also implements the `Query` control methods used by this provider
  (minimally `close()`); this is a real implementation of the SDK's own
  contract, not a mock of this repo's code — the same principle as BAML's
  `fakeFunctionSet.ts`.
- **Hook/permission closure**: the fake `queryFn` is scripted to actually
  _call_ `options.hooks.PreToolUse[...].hooks[...](...)` and
  `options.canUseTool(...)` with real SDK-shaped arguments when it "wants" to
  run a tool, and to branch its subsequent yielded messages on the real
  returned decision — proving this repo's adapter is wired end-to-end, not
  merely type-compatible.
- **Live suite (opt-in, not default)**: a small number of tests that spawn a
  real `claude` CLI subprocess via the real `query()`, gated behind an env var
  (mirrors `test:live:handoffs`), for the Deferred "does hook-level `'ask'`
  reach `canUseTool`" verification and general drift detection against future
  SDK versions.
- **No `as never`** — if a fixture needs a cast, the public type is wrong.

## Workflow Closure

Two BLOCKING closure tests.

### Closure A: "a registered call produces an observable run-step" [BLOCKING]

Mirrors the parent research doc's own `ClosureMap` (register → resolve_construct
→ invoke → stream_turn → observe_run_step), minus the `tool_execute` node —
this provider never crosses that edge.

- **SOURCE (seed only)**: the injected fake `queryFn`'s scripted `SDKMessage` sequence
- **TRIGGER**: `attemptInvoke({ model, messages, provider: Providers.CLAUDE_AGENT_SDK })` (`src/llm/invoke.ts:702`)
- **DRIVERS**: none — the fake generator's own iteration is the synchronous driver; no sleeps
- **OBSERVE**: the final `AIMessage.content`/`usage_metadata` after `attemptInvoke` resolves, **and** the `ON_RUN_STEP`/`CHAT_MODEL_STREAM` event the host's registered handler receives via `run.ts`'s `streamEvents()` loop
- **FORBIDDEN SPAN**: the test never hand-constructs an `AIMessageChunk`, never calls `ChatClaudeAgent`'s private translation methods directly — only the public `.stream()`/`.invoke()` surface
- **RED-AT-SEAM**: swap the static registry entry back out (or delete the enum member's map entries) → `Unsupported LLM provider` → red
- **DRIVABILITY**: `queryFn` is the injected store seam; the span is fully synchronous end-to-end (the fake generator, `attemptInvoke`, `streamEvents` all run in-process) — no clock needed
- **EXECUTION**: in-process, no infra; fails closed if the entry does not resolve

### Closure B: "this repo's own hook/HITL decision is honored by the SDK bridge" [BLOCKING]

Crosses the permission-bridge boundary — the one Closure A cannot see, because
Closure A's fake session can stay green while `canUseTool`/`hooks` are simply
never wired into `Options` at all.

- **SOURCE (seed only)**: this repo's real `createToolPolicyHook`/HITL
  resolution logic (not re-implemented for the test) configured to `allow` one
  tool name and `deny` another
- **TRIGGER**: `attemptInvoke(...)` with the fake `queryFn` scripted to request
  permission for both tool names via the real arguments SDK sessions pass
  (`toolUseID`, `requestId`, `title`, etc., per `sdk.d.ts:206-266`)
- **DRIVERS**: the fake `queryFn`'s own control flow is the real synchronous
  driver — it must branch on the actual `PermissionResult`/hook output
  returned, not a canned value
- **OBSERVE**: the fake session's subsequent yielded messages (a tool-result
  path for the allowed tool, a blocked/denied path for the denied one) —
  proof the decision changed real downstream behavior, not just that a
  function was called
- **FORBIDDEN SPAN**: the test never calls this repo's `createToolPolicyHook`
  output directly into the assertion — it must flow through
  `ChatClaudeAgent`'s adapter into `Options.hooks`/`Options.canUseTool` and
  back out through the fake session's branching
- **RED-AT-SEAM**: stop passing `hooks`/`canUseTool` into `Options` at
  construction → the fake session's permission request receives `undefined`
  and cannot branch → red
- **DRIVABILITY**: the policy hook's decision inputs are the injected seam;
  synchronous throughout
- **EXECUTION**: in-process, no infra; fails closed if the adapter is absent

---

## Behaviors

### B0 — Public type closure lands with the enum, dependency compatibility verified

**Given** the typed surface and dependencies are added
**When** `npm install && npm ls zod` and `npx tsc --noEmit` run
**Then** install succeeds with a single top-level `zod@4.x`, no `ERESOLVE`,
and typecheck passes with no `as never`

`ChatModelConstructorMap` is a mapped type over `Providers`
(`src/types/llm.ts:205-207`) — adding the enum member alone is a compile
error until `ProviderOptionsMap`/`ChatModelMap` both gain matching entries.

**Edge cases**: `zod` resolves to two copies (v3 nested under
`sandbox-runtime`, v4 top-level) — assert this is what actually happens, not
assumed; a single shared v4 instance if npm's dedup happens to satisfy
`sandbox-runtime`'s range too (unlikely given `^3.24.1`, but check).
**Property**: no property — fixed compile-time/install-time assertion.
**Files touched**: `package.json` (`@anthropic-ai/claude-agent-sdk`, `zod@^4`,
`@modelcontextprotocol/sdk@^1.29.0`), `package-lock.json`, `src/common/enum.ts`,
`src/types/llm.ts`, `src/llm/claudeAgent/types.ts` (new)

#### 🔴 Red

```ts
// src/llm/claudeAgent/__tests__/types.compile.test.ts
const options: ClaudeAgentClientOptions = { model: 'claude-sonnet-5' };
expect(options).toBeDefined(); // red: ClaudeAgentClientOptions does not exist yet
```

Plus a non-Jest install check:

```bash
npm install && npm ls zod   # asserts in CI script, not jest
```

#### 🟢 Green

Add the enum member `CLAUDE_AGENT_SDK = 'claudeAgentSdk'`
(`src/common/enum.ts:100`, before the closing `}` at `:101`), the
`ClaudeAgentClientOptions` type, and both map entries
(`src/types/llm.ts:187`, `:203`). Add the three dependencies to `package.json`.

#### 🔵 Refactor

`ClaudeAgentClientOptions` extends `BaseChatModelParams` rather than
restating shared fields, matching every other `*ClientOptions` type in
`src/types/llm.ts`. Checklist: no duplication, intent-revealing names, no new
branches, matches existing conventions.

**Success criteria**: `npm install` clean · `npm ls zod` shows exactly the
expected resolution · `npx tsc --noEmit` clean · `npx eslint src/` clean

---

### B1 — Registered as a normal static entry (not a BAML-style side effect)

**Given** `Providers.CLAUDE_AGENT_SDK` exists with matching type-map entries
**When** `getChatModelClass(Providers.CLAUDE_AGENT_SDK)`
**Then** returns `ChatClaudeAgent` — no import side-effect required, unlike
BAML

**Files**: `src/llm/providers.ts` (add `[Providers.CLAUDE_AGENT_SDK]: ChatClaudeAgent`
to the `llmProviders` object literal, `:22-36`), extends
`src/llm/__tests__/providers.registry.test.ts`

### B2 — A registered class flows through `initializeModel`

Instance of `ChatClaudeAgent`, constructed with `clientOptions`; `bindTools`
is never meaningfully called for this provider in practice (decision 2), but
`initializeModel`'s existing `override ?? new ...` short-circuit
(`src/llm/init.ts:29-31`) and tool-binding branch (`:58-62`) are preserved
verbatim — **not** special-cased for this provider. If a host does bind tools
anyway, `bindTools` is a documented no-op (see B3's note) rather than a
runtime error, since decision 2 means tool_calls never surface regardless.

**Files**: `src/llm/claudeAgent/ChatClaudeAgent.ts`

### B3 — An unbound turn returns a final answer, never `tool_calls`

**Given** a fake `queryFn` whose generator yields only a terminal
`SDKResultSuccess` (`subtype: 'success'`, `result: string`)
**When** `invoke()`
**Then** an `AIMessage` with `content` equal to `result` and **no**
`tool_calls` field at all — not an empty array, absent

**Note on `bindTools`**: since this provider never emits `tool_calls`
regardless of binding, `bindTools(tools)` is implemented as an identity
no-op that returns `this` unchanged (documented, not silently ignored) —
there is no "bound subset" concept the way BAML has one.

**Edge cases**: `result` is an empty string; `SDKResultSuccess.structured_output`
present (not surfaced this phase — documented gap, see Deferred).
**Property**: no property — a fixed input/output pairing, not a domain to
generate over.
**Files touched**: `src/llm/claudeAgent/ChatClaudeAgent.ts`,
`src/llm/claudeAgent/__tests__/ChatClaudeAgent.answer.test.ts`,
`src/llm/claudeAgent/__tests__/fakeQuery.ts` (new — the reusable fake,
mirrors BAML's `fakeFunctionSet.ts`)

#### 🔴 Red

```ts
// src/llm/claudeAgent/__tests__/ChatClaudeAgent.answer.test.ts
const model = new ChatClaudeAgent({
  queryFn: fakeQuery([resultSuccess({ result: 'hi' })]),
});
const msg = await model.invoke([new HumanMessage('hello')]);
expect(msg.content).toBe('hi');
expect(msg.tool_calls).toBeUndefined();
```

#### 🟢 Green

`_generate` calls `this.queryFn({ prompt, options })`, iterates to the
terminal `SDKResultMessage`, and on `subtype === 'success'` returns a
`ChatGeneration` wrapping `new AIMessage({ content: result.result, ... })`
with no `tool_calls` key set.

#### 🔵 Refactor

Extract the terminal-message handling into `translateResultMessage(result)`
in `src/llm/claudeAgent/messageTranslation.ts`, shared with B5/B6's error
path. Checklist per template.

**Success criteria**: unit test green · no `tool_calls` key present
(`'tool_calls' in msg` is `false`, not `msg.tool_calls === undefined`)

---

### B4 — Streaming: intermediate assistant messages translate via reused Anthropic converters

**Given** a fake `queryFn` yielding `SDKAssistantMessage`s (each wrapping a
real-shaped `BetaMessage.content` block array) followed by a terminal
`SDKResultSuccess`
**When** `.stream()`
**Then** `AIMessageChunk`s are produced whose content matches what
`_makeMessageChunkFromAnthropicEvent`/`anthropicResponseToChatMessages`
would produce for the same content blocks via the standard Anthropic path,
concatenating correctly via `@langchain/core`'s `concat()`

This is adaptation, not new logic: `SDKAssistantMessage.message.content` is
type-identical to what `src/llm/anthropic/utils/message_outputs.ts`'s
functions already consume. The Red step's first job is proving that
structural compatibility against the _real_ installed types (not assumed).

**Edge cases**: empty stream (no `SDKAssistantMessage`s, only the terminal
result) resolves to an `AIMessageChunk` with empty content, never `undefined`
(mirrors BAML B10's same requirement, `src/llm/invoke.ts:1032-1039`); a
`thinking` content block; an `SDKAssistantMessageError` present on a
partial message (`sdk.d.ts:3025`) — surfaces as `response_metadata.error`,
never silently dropped.
**Property**: **Roundtrip-adjacent invariant** — concatenating every
streamed chunk's content produces the same text as the non-streaming `_generate`
path for the same scripted session. Domain: fake sessions built from a small
content-block generator (text/thinking blocks in varying counts/order),
reusing this repo's existing Anthropic test fixtures where they exist rather
than inventing new ones.

```ts
fc.assert(
  fc.property(
    fc.array(anthropicContentBlockArb(), { minLength: 0, maxLength: 8 }),
    (blocks) => {
      const streamed = concatAll(streamFromBlocks(blocks));
      const generated = generateFromBlocks(blocks);
      return streamed.content === generated.content;
    }
  )
);
```

**Files touched**: `src/llm/claudeAgent/messageTranslation.ts`,
`src/llm/claudeAgent/__tests__/messageTranslation.test.ts`

### B5 — Terminal usage/cost/session metadata attached once

**Given** a terminal `SDKResultSuccess`/`SDKResultError` carrying `usage`,
`total_cost_usd`, `session_id`, `num_turns`, `stop_reason`
**When** the terminal chunk is produced
**Then** `usage_metadata` is attached via the **reused**
`getAnthropicUsageMetadata`-shaped mapping (`usage.input_tokens`/`output_tokens`/`cache_creation_input_tokens`/`cache_read_input_tokens`
→ the same `UsageMetadata` shape every other provider emits), exactly once,
on that chunk only; `response_metadata` carries `session_id`, `num_turns`,
`total_cost_usd`, `stop_reason`, `model_provider: 'claude-agent-sdk'`

Matches the repo-wide convention BAML's B17 also follows
(`src/llm/stream/chunkAdapters.ts:15-35` preserves usage on split, never
fabricates it).

**Edge cases**: `usage` fields present but zero (real zero-usage turn) vs.
absent entirely — never fabricate zeros when the field is genuinely missing,
same principle as BAML B17.
**Property**: no property — a fixed mapping, verified by example.
**Files touched**: `src/llm/claudeAgent/messageTranslation.ts`

### B6 — An error result surfaces as a typed error, never silently swallowed

**Given** a terminal `SDKResultError` (`subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries'`)
**When** `invoke()`
**Then** throws `ClaudeAgentTurnError` carrying the `subtype` and `errors: string[]`
from the result, catchable by `attemptInvoke`'s existing error handling —
never returned as a normal `AIMessage`

**Edge cases**: all four `subtype` values, each producing a distinguishable
error; `SDKAssistantMessageError` on an intermediate assistant message
(different from a terminal result error — surfaces via `response_metadata`
per B4, does not itself throw).
**Files touched**: `src/llm/claudeAgent/errors.ts`,
`src/llm/claudeAgent/messageTranslation.ts`

---

### B7 — Workspace `cwd` is resolved and clamped, never passed raw

**Given** a configured workspace root and a requested session `cwd`
**When** `Options.cwd` is constructed
**Then** it has passed through the same `resolveWorkspacePathSafe`/`getWorkspaceRoots`
clamp `LocalExecutionEngine`'s own tools use
(`src/tools/local/LocalExecutionEngine.ts:227-260,1319-1346`) — including
symlink-escape detection — not a separate, weaker path

Reuses existing, tested logic rather than inventing session-scoped isolation
from scratch (resolved question 4 in the research doc).

**Edge cases**: requested `cwd` outside all configured roots (rejected, same
as the local engine); symlink pointing outside roots; no `cwd` requested
(falls back to `getLocalCwd`'s default).
**Property**: **Invariant** — for any requested path, the resolved `Options.cwd`
is always within `getWorkspaceRoots()` or construction throws; never silently
passes through an out-of-root path. Domain: paths built from the existing
workspace-root test fixtures plus adversarial symlink cases already covered
by `LocalExecutionEngine`'s own test suite (reused, not reinvented).
**Files touched**: `src/llm/claudeAgent/workspace.ts` (thin wrapper calling
into `LocalExecutionEngine`'s exported resolver)

### B8 — Multi-tenant isolation options default on when configured multi-tenant

**Given** `ClaudeAgentClientOptions.multiTenant: true`
**When** `Options` is constructed
**Then** `settingSources: []`, `env.CLAUDE_CONFIG_DIR` (per-tenant),
`env.CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1'` are set, and `env` is built by
**spreading `process.env` first** (per the Key Discoveries note that `env`
replaces rather than merges — losing `PATH`/`HOME`/credentials is a real
failure mode, not a hypothetical)

**Edge cases**: `multiTenant: false`/absent — none of the four options are
forced, `env` is left undefined (subprocess inherits `process.env` per the
SDK's own default).
**Files touched**: `src/llm/claudeAgent/ChatClaudeAgent.ts`

### B9 — Abort propagates

**Given** `config.signal` already aborted before the call
**When** `invoke`/`stream`
**Then** `this.queryFn` is never called
**Given** `config.signal` aborts mid-flight
**When** the fake session's abort branch fires
**Then** no further messages are processed and the call rejects with an
abort-shaped error — no follow-on `queryFn` call starts after abort

Threads `config.signal` into `Options.abortController`, mirroring how every
other provider threads `options.signal` (e.g. `src/llm/mistral/index.ts:26-30`,
cited in the BAML plan as the pattern to match).

**Files touched**: `src/llm/claudeAgent/ChatClaudeAgent.ts`

### B10 — `sessionStore`/`resume` pass through untouched

**Given** `ClaudeAgentClientOptions.sessionStore`/`resume` are set
**When** `Options` is constructed
**Then** both are forwarded verbatim — no adapter, no transformation, no
validation beyond the type system

This repo implements no `SessionStore`; it only forwards the option (resolved
question 4 — "a thin forward, not a reimplementation of BAML's port").

**Files touched**: `src/llm/claudeAgent/ChatClaudeAgent.ts`

---

### B11 — `PreToolUse`/`PostToolUse` hook adapters, `'allow'`/`'deny'` only

**Given** this repo's `PreToolUseHookOutput` (`decision: 'allow' | 'deny'`,
`src/hooks/types.ts:370-397`)
**When** translated to the SDK's `PreToolUseHookSpecificOutput`
**Then** `decision: 'allow'` → `{ permissionDecision: 'allow', updatedInput }`;
`decision: 'deny'` → `{ permissionDecision: 'deny', permissionDecisionReason: reason }`;
`decision: 'ask'` → **no `permissionDecision` field at all** (abstain — see
B13 for where `ask` is actually resolved)

**And**: `PostToolUseHookOutput`'s output-replacement field maps to the SDK's
`PostToolUseHookSpecificOutput.updatedToolOutput` (confirmed real field name,
`sdk.d.ts:2308-2319`; `updatedMCPToolOutput` exists but is explicitly
documented as MCP-only and superseded by `updatedToolOutput` — not used).

**Edge cases**: this repo's `updatedInput` present alongside `decision: 'deny'`
(nonsensical combination — the adapter drops `updatedInput` when denying,
never sends both); multiple matchers.
**Property**: **Invariant** — for any `PreToolUseHookOutput` with
`decision !== 'ask'`, the adapter's output always has a `permissionDecision`
matching that decision; for `decision === 'ask'`, the adapter's output never
has a `permissionDecision` key. Domain: the small closed set of
`PreToolUseHookOutput` shapes (3 decisions × presence/absence of
`updatedInput`/`reason`).
**Files touched**: `src/llm/claudeAgent/permissionBridge.ts`,
`src/llm/claudeAgent/__tests__/permissionBridge.hooks.test.ts`

### B12 — Bookkeeping fields with no repo-side equivalent are synthesized, not dropped

**Given** this repo's `PreToolUseHookInput` carries `runId`/`threadId`/`stepId`/`turn`/`executingAgentId`
that the SDK's `PreToolUseHookInput` (`sdk.d.ts:2327-2332`,
`BaseHookInput`, `sdk.d.ts:164-190`) does not provide
**When** the adapter constructs this repo's hook input from the SDK's
**Then** these fields are populated from the adapter's own call-site state
(the `ChatClaudeAgent` instance's run context), never left `undefined` when
this repo's hook implementation expects them

**Files touched**: `src/llm/claudeAgent/permissionBridge.ts`

### B13 — `canUseTool` bridges this repo's `ask`/`respond` to the SDK's allow/deny [BLOCKING CLOSURE]

**Given** this repo's policy would `ask` (raising a `ToolApprovalRequest`/HITL
interrupt, `src/types/hitl.ts:12-29`)
**When** the SDK calls `Options.canUseTool(toolName, input, { toolUseID, requestId, title, displayName, description, ... })`
(real signature, `sdk.d.ts:206-266`)
**Then** the adapter surfaces `title`/`displayName`/`description` into this
repo's `ToolApprovalRequest.description`, resolves the host's decision:
`'approve'` → `{ behavior: 'allow', updatedInput? }`; `'reject'` → `{ behavior: 'deny', message: reason }`;
`'edit'` → `{ behavior: 'allow', updatedInput: hostEditedInput }`;
`'respond'` → `{ behavior: 'deny', message: <explains no SDK path exists for injecting a substitute result> }`
(documented limitation, not a bug — see Key Discoveries)

Anchors above (Closure B). This is the only test that exercises the full
bridge — decision made by this repo's real policy/HITL resolution, through
`ChatClaudeAgent`'s adapter, into `Options`, back out through a scripted
session that branches on it for real.

**Edge cases**: `matchedAskRule` present in the `canUseTool` context (an
SDK-side ask rule, independent of this repo's own policy) — the adapter still
applies this repo's own decision; `signal` aborts while awaiting a HITL
response.
**Files touched**: `src/llm/claudeAgent/permissionBridge.ts`,
`src/llm/claudeAgent/__tests__/permissionBridge.canUseTool.closure.test.ts`

#### 🔴 Red

```ts
// permissionBridge.canUseTool.closure.test.ts
const policy = createToolPolicyHook({ ask: ['risky_tool'] }); // real repo hook
const model = new ChatClaudeAgent({ queryFn: fakeQuery(scriptRequestingPermission('risky_tool')), policyHook: policy });
// scripted session calls the real options.canUseTool(...) internally
const result = await model.invoke([...]);
expect(fakeSessionObservedDecision).toEqual({ behavior: 'deny', message: expect.any(String) }); // no HITL responder configured -> defaults deny, proving the call really reached the bridge
```

Red because `permissionBridge.ts` and the `canUseTool` wiring don't exist yet.

#### 🟢 Green

Implement `createCanUseToolBridge(policyHook, hitlResolver)` returning a
`CanUseTool`-shaped function; wire it into `Options.canUseTool` at
construction.

#### 🔵 Refactor

Checklist per template — no duplication with B11's `PreToolUse` mapping logic
(share the decision→SDK-shape mapping helper where the shapes coincide).

**Success criteria**: closure test green · the fake session's observed
decision genuinely came from the real policy hook, not a hardcoded stub in
the test

---

### B14 — Langfuse: a `generation` observation with correct attribution

**Given** a completed turn
**When** the Langfuse callback handler processes it
**Then** a `generation` observation exists with correct model name and
accurate usage/cost pulled from `SDKResultMessage.usage`/`total_cost_usd` —
non-negotiable per `AGENTS.md:122-157`, same requirement BAML's plan gates on
(`npx jest langfuse deterministic-trace-id`)

**Files touched**: verify existing Langfuse integration requires no
provider-specific branch (it shouldn't, per the research doc's finding that
event dispatch is generic against `BaseChatModel`) — if it does, that itself
is a finding to report, not silently patch around.

### B15 — The full chain closes end to end [BLOCKING CLOSURE]

Anchors above (Closure A). Registration → construction → invocation →
streaming → terminal observable event, with a real (fake-`queryFn`-driven)
session — no ToolNode edge, unlike BAML's B18.

### B16 — Public errors are actionable

`ClaudeAgentTurnError` (carries `subtype`/`errors`), plus a
`ClaudeAgentDependencyError` if `@anthropic-ai/claude-agent-sdk` somehow
fails to resolve at runtime despite being a direct dependency (defensive,
mirrors BAML's `BamlNotRegisteredError` remediation-message pattern, even
though the registration mechanism itself is simpler here).

### B17 — Host documentation ships with the feature

`docs/providers/claude-agent.md`: the "never emits `tool_calls`" architecture
choice and why (decision 2+3's consequence, stated plainly so a host doesn't
expect tool-routing to work); the `queryFn` injection seam and why it exists;
the `respond`-has-no-SDK-analog limitation; the `env` replace-not-merge
gotcha; multi-tenant isolation options; the zod v4 dependency note.

---

## Verification gates

```
npm install && npm ls zod         # B0 — dependency compatibility, not assumed
npx tsc --noEmit
npx eslint src/
npx jest                          # full suite, no real subprocess spawned
npx jest langfuse deterministic-trace-id   # AGENTS.md:155
npm run build
```

## Deferred — blocked or intentionally out of scope, not dropped

| Item                                                                                              | Why deferred                                                                                                                                                            | Unblocks when                                                                         |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Live behavioral check: does a `PreToolUse` hook's `permissionDecision: 'ask'` reach `canUseTool`? | Informative only — this repo's adapter (B11) never emits `'ask'` by design, so nothing in this plan depends on the answer                                               | A live-suite test against a real subprocess, or Anthropic clarifying the doc/type gap |
| `toolAliases`-based redirection of Claude's built-ins to this repo's own sandboxed tools          | Genuine opportunity discovered while reading the real `Options` type, but changes the tool-execution trust boundary — needs its own design pass, not a phase-0 addition | Follow-up design pass                                                                 |
| Exposing programmatic-tool-calling / subagent-delegation via `createSdkMcpServer`                 | Additive, not duplicative, but needs Zod-schema translation + a product decision (research doc, resolved question 6)                                                    | Follow-up phase                                                                       |
| `SessionStore` adapter implementation                                                             | Host-owned by design (decision 4) — this repo only forwards the option                                                                                                  | A specific host asks for one                                                          |
| Concurrent-session pooling/scaling                                                                | Host concern per the SDK's own hosting docs (decision 4)                                                                                                                | N/A — not this library's job                                                          |
| `structured_output`/`deferred_tool_use` fields on `SDKResultSuccess`                              | Not surfaced this phase (B3 edge case) — no current consumer                                                                                                            | A host needs structured output from a Claude Code turn                                |

## Decisions needed

1. **Enum member naming**: proposed `Providers.CLAUDE_AGENT_SDK = 'claudeAgentSdk'`,
   class `ChatClaudeAgent`, matching this repo's existing camelCase string-value
   convention (`AZURE = 'azureOpenAI'`). Confirm before B0's Green step.
2. **`multiTenant` as an explicit client option (B8) vs. inferred from host
   context**: this plan assumes an explicit boolean is simplest and least
   surprising; flag if the host actually wants it inferred from something else.
3. **`bd init`?** Already initialized; tracking issues below.

| Issue                                                                             | Scope |
| --------------------------------------------------------------------------------- | ----- |
| (create) epic — `Providers.CLAUDE_AGENT_SDK` provider                             |       |
| (create) B0–B2 — type closure + static registry entry                             |       |
| (create) B3–B6 — message translation, usage/errors (reuses Anthropic converters)  |       |
| (create) B7–B10 — workspace isolation, multi-tenancy, abort, session pass-through |       |
| (create) B11–B13 — hook/permission bridge **[B13 BLOCKING]**                      |       |
| (create) B14–B15 — Langfuse, full-chain closure **[B15 BLOCKING]**                |       |
| (create) B16–B17 — errors, docs                                                   |       |

## References

- Research: `thoughts/searchable/shared/research/2026-08-13-10-38-claude-code-sdk-agent-provider.md`
  (all three architecture decisions, the 2026-08-15 follow-up resolving the
  three remaining open questions)
- Precedent (structurally distant but the only prior TDD plan in this repo for
  "add a provider"): `thoughts/searchable/shared/plans/2026-08-09-15-57-tdd-providers-baml-phase0.md`
- Real SDK types (ground truth for every "SDK facts" citation above):
  `@anthropic-ai/claude-agent-sdk@0.3.233`'s `sdk.d.ts`, obtained via
  `npm pack @anthropic-ai/claude-agent-sdk@latest` — re-verify against
  `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` once installed
- Reuse targets: `src/llm/anthropic/utils/message_outputs.ts:19-42,55,312-351`
  · `src/tools/local/LocalExecutionEngine.ts:227-260,1319-1346`
- Patterns: `src/llm/providers.ts:22-36` · `src/llm/init.ts:18-63` ·
  `src/llm/invoke.ts:702,858,869` · `src/hooks/types.ts:36,370-397,489` ·
  `src/hooks/createToolPolicyHook.ts:129` ·
  `src/hooks/createWorkspacePolicyHook.ts:271` · `src/types/hitl.ts:12-75` ·
  `AGENTS.md:122-157`
