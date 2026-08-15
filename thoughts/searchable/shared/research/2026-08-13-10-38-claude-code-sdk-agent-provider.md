---
date: 2026-08-13T10:38:12-04:00
researcher: tha-hammer
git_commit: 3f5dc561fc07fe710e9183de7f8a5015bda0751c
branch: main
repository: silmari-chat-agents (npm package `@librechat/agents` v3.4.3)
topic: 'Adding the Claude Code SDK (Claude Agent SDK) as a provider in the agent/provider registry'
tags:
  [
    research,
    codebase,
    llm,
    providers,
    baml,
    subagent,
    local-execution-engine,
    claude-code,
    claude-agent-sdk,
    sandbox,
  ]
status: complete
last_updated: 2026-08-15
last_updated_by: tha-hammer
last_updated_note: 'Resolved the three remaining open questions (subprocess lifecycle/multi-tenancy, hook bridging, createSdkMcpServer tool exposure) via parallel research'
---

# Research: Adding the Claude Code SDK as a Provider ("agent harness")

**Date**: 2026-08-13T10:38:12-04:00
**Researcher**: tha-hammer
**Git Commit**: [`3f5dc56`](https://github.com/tha-hammer/silmari-chat-agents/blob/3f5dc561fc07fe710e9183de7f8a5015bda0751c)
**Branch**: `main`
**Repository**: `silmari-chat-agents`, published as `@librechat/agents` v3.4.3

## Research Question

The user wants to "add the claude code sdk to the list of agents so we can use the claude code agent harness." This research documents: (1) what "the list of agents" is in this codebase, (2) every existing touchpoint required to wire in a new provider, using the standard pattern (Anthropic) and the newest, structurally closest precedent (BAML) as worked examples, (3) what pre-existing infrastructure in this codebase already mirrors or references Claude Code's own design (tool/hook vocabulary, sandbox runtime, subagent delegation), and (4) whether any prior planning documents already exist for this specific integration.

## Summary

This repository (`@librechat/agents`) is not an "agent picker" application — it is a TypeScript library that other applications (chiefly LibreChat) embed to run LLM agent graphs. "The list of agents" the user is referring to is the **`Providers` enum** (`src/common/enum.ts:87-101`) plus the **`llmProviders` registry** (`src/llm/providers.ts:22-36`), which together map a provider identifier to a concrete LangChain `BaseChatModel`-derived class that the LangGraph-based agent graph invokes.

There is currently **no Claude Code / Claude Agent SDK provider** in this codebase, and no `@anthropic-ai/claude-code` or `@anthropic-ai/claude-agent-sdk` package dependency exists. However, the codebase already borrows extensively from Claude Code's own design vocabulary in three unrelated subsystems:

1. **`@anthropic-ai/sandbox-runtime`** is already an optional peer/dev dependency (`package.json:271,274,283`), lazily loaded by the "local coding engine" (`src/tools/local/LocalExecutionEngine.ts:331-360`) to OS-sandbox its own bash/file tools.
2. **`createToolPolicyHook.ts`** explicitly states it "Uses the Claude Code Agent SDK permission vocabulary (`allowed_tools` / `disallowed_tools` / `permissionMode`)" (`src/hooks/createToolPolicyHook.ts:6-7`) and mirrors Claude Code's "deny rules are checked first" guarantee.
3. Comments throughout the codebase (compaction, cache breakpoints, `AskUserQuestion` semantics, subagent finalization) cite Claude Code's behavior as design inspiration without importing any Claude Code package.

Two existing providers are the relevant reference patterns for how a Claude Code SDK integration would be structured:

- **Anthropic (`CustomAnthropic`)** is the standard pattern: a class that directly extends LangChain's `ChatAnthropicMessages` (itself extending `BaseChatModel`), so registration, streaming, and event dispatch are all "free" — the graph and event system operate purely against the LangChain `BaseChatModel` interface, not against anything Anthropic-specific.
- **BAML (`ChatBAML`, `Providers.BAML`)** is the closest precedent for a provider whose backing implementation is **not** a thin chat-completions wrapper but its own SDK with its own internal turn/tool logic — exactly the shape the Claude Code SDK has (it drives its own bash/file/grep/glob tool loop internally). BAML's solution: define a narrow "port" interface (`BamlFunctionSet`) that a **host application** implements over the real external SDK, keep `ChatBAML` itself a thin `BaseChatModel` subclass that calls the port once per turn and converts whatever the port returns into standard LangChain `tool_calls`, then let the _existing_ `ToolNode`/`toolsCondition` graph machinery do all tool execution and looping — identical to every other provider. BAML is also **physically isolated** as a separate npm subpath export (`@librechat/agents/baml`) with its own build entry, imported nowhere from the root barrel, and registered into the `llmProviders` map only as an import side-effect (`registerChatModel(Providers.BAML, ChatBAML)`, `src/llm/baml/index.ts:10`) — a deliberate departure from every other provider, which is a static entry in `llmProviders`'s object literal.

Separately, this codebase already has a **subagent delegation mechanism** (`Constants.SUBAGENT`, `SubagentExecutor`) that is the closest existing structural analog to "a tool call that, instead of doing simple work, drives a bounded external execution loop and streams back only progress + a final result" — but as implemented today it always spawns another in-process LangGraph workflow, not an external process or SDK session, and does not itself provide a template for spawning a real Claude Code SDK session.

No planning, research, or handoff documents in `thoughts/` mention Claude Code or Claude Agent SDK integration. Six related documents exist, all describing the **BAML** provider integration effort (2026-08-09) — the closest prior-art plan for "add a new, non-standard provider to the registry."

## Detailed Findings

### The provider registry ("the list of agents")

- `src/common/enum.ts:87-101` — the `Providers` enum: `OPENAI`, `VERTEXAI`, `BEDROCK`, `ANTHROPIC`, `MISTRALAI`, `MISTRAL`, `GOOGLE`, `AZURE`, `DEEPSEEK`, `OPENROUTER`, `XAI`, `MOONSHOT`, `BAML`. This string-valued enum is the canonical discriminant used everywhere else in the codebase (registry maps, `Set`s like `manualToolStreamProviders`, callback metadata, content-type comments).
- `src/llm/providers.ts:22-36` — `llmProviders: Partial<ChatModelConstructorMap>`, a static object literal mapping every `Providers` value (except `BAML`) to its constructor class, e.g. `[Providers.ANTHROPIC]: CustomAnthropic`.
- `src/llm/providers.ts:38-41` — `manualToolStreamProviders`, a `Set<Providers | string>` containing exactly `ANTHROPIC` and `BEDROCK` — providers whose streamed tool-call content needs a manual post-concatenation reconciliation pass because LangChain's naive chunk `concat()` doesn't correctly merge their tool-use content blocks.
- `src/llm/providers.ts:48-61` — `registerChatModel<P>(provider, ctor)`: a **plugin-style** registration function. Writing the same constructor twice is a no-op (safe to re-run as a module side-effect); a different constructor for an already-populated slot throws `Provider already registered: ${provider}`. This is the mechanism BAML uses instead of a static object-literal entry, and is the mechanism a Claude Code provider would also use if it should ship as an optionally-imported subpath rather than a core dependency.
- `src/llm/providers.ts:68-77` — `__resetChatModelRegistry()`: test-only snapshot/restore seam so registry tests can register/delete/clobber without leaking state across tests.
- `src/llm/providers.ts:79-88` — `getChatModelClass<P>(provider)`: throws `Unsupported LLM provider: ${provider}` if nothing has registered that provider yet.

### The three type maps a new provider must join

`src/types/llm.ts`:

- `ProviderOptionsMap` (`src/types/llm.ts:173-187`) — maps each `Providers` value to its constructor-input options type. BAML's entry: `[Providers.BAML]: BamlClientOptions;` (`src/types/llm.ts:186`).
- `ChatModelMap` (`src/types/llm.ts:189-203`) — maps each `Providers` value to its concrete instance type. BAML's entry: `[Providers.BAML]: ChatBAML;` (`src/types/llm.ts:202`).
- `ChatModelConstructorMap` (`src/types/llm.ts:205-207`) — derived automatically as a mapped type `{ [P in Providers]: new (config: ProviderOptionsMap[P]) => ChatModelMap[P] }`; no manual entry is needed once the two maps above are populated.
- `ChatModelInstance = ChatModelMap[Providers]` and `ModelWithTools` (`src/types/llm.ts:209-213`) are the generic types `initializeModel`/`invoke.ts` operate over.

### Pattern A — the standard provider shape (Anthropic, `CustomAnthropic`)

`src/llm/anthropic/index.ts:452` — `export class CustomAnthropic extends ChatAnthropicMessages` (which itself extends LangChain's `BaseChatModel`). `CustomAnthropic` does **not** extend the further-derived `ChatAnthropic`; it sits one level up, directly subclassing `ChatAnthropicMessages`.

Key overrides:

- `static lc_name()` (`src/llm/anthropic/index.ts:469-471`) returns `'LibreChatAnthropic'`, LangChain's serialization name.
- `invocationParams(options)` (`src/llm/anthropic/index.ts:476-562`) builds the Anthropic request payload: tool-choice resolution, beta-header resolution (`ANTHROPIC_TOOL_BETAS`, `index.ts:54-63`), and calls the **inherited** `formatStructuredToolToAnthropic` from `ChatAnthropicMessages` — it is not reimplemented.
- `_streamResponseChunks` (`src/llm/anthropic/index.ts:650-786`) is the primary streaming path used by `BaseChatModel.stream()`. It converts raw Anthropic SSE events to LangChain `AIMessageChunk`s via `_makeMessageChunkFromAnthropicEvent` (`src/llm/anthropic/utils/message_outputs.ts`), tracks cumulative usage, and pipes chunks through `smoothStream` for UI pacing.
- `createStreamWithRetry`/`completionWithRetry` (`src/llm/anthropic/index.ts:607-625`) delegate to `super.*` but first pipe the request through `stripUnsupportedAssistantPrefill`.

Because `CustomAnthropic` is a `BaseChatModel`, **no explicit wiring is needed** at the graph or event level:

- `src/graphs/Graph.ts` node/edge construction (`createAgentNode`, `createWorkflow`) is entirely provider-agnostic — it operates against `agentContext.provider`/`agentContext.clientOptions` generically and the structural `t.ChatModel` interface.
- `CHAT_MODEL_START`/`CHAT_MODEL_STREAM`/`CHAT_MODEL_END` (`src/common/enum.ts:42-48`) are LangChain's own automatic callback-manager events, emitted by `BaseChatModel` internals — never dispatched manually per-provider.
- The custom `GraphEvents.ON_RUN_STEP` event (`src/common/enum.ts:13`) is dispatched by `Graph.dispatchRunStep` (`src/graphs/Graph.ts:685,4725`), called from `ChatModelStreamHandler` (`src/stream.ts`) — which operates on the already-normalized `AIMessageChunk`/`ContentTypes` shape any `BaseChatModel` subclass produces. The only provider-specific step in that whole chain is the raw-event-to-`AIMessageChunk` conversion inside the provider's own `_streamResponseChunks`.

The only Anthropic-specific branches that exist _outside_ `src/llm/anthropic/` are:

- `src/llm/invoke.ts:234-241` — `projectMessagesForProvider` strips tool-output content into Anthropic's single-text-block shape for `Providers.ANTHROPIC`.
- `src/graphs/Graph.ts:2340-2344` — prompt-cache breakpoint stamping on tool definitions, gated on `agentContext.provider === Providers.ANTHROPIC && clientOptions.promptCache === true`.
- `src/utils/llm.ts:29-41` (`isAnthropicLike`) — used by `invoke.ts:809` to decide handoff-cue insertion; true for `ANTHROPIC` unconditionally and for `BEDROCK` when the model name matches `/claude/i`.
- `ContentTypes.THINKING = 'thinking'` (`src/common/enum.ts:135`, commented `/** Anthropic */`) — Anthropic's reasoning-block discriminant, already understood generically by the shared message-pruning/summarization/streaming pipeline (`src/messages/format.ts`, `src/messages/prune.ts`, `src/messages/core.ts:228`) without further per-provider changes once a provider emits blocks of this type.

### Pattern B — the "external SDK with its own tool loop" shape (BAML, `ChatBAML`)

This is the structurally relevant precedent, since the Claude Code SDK (like BAML) drives its own internal agent loop rather than exposing a raw chat-completions surface.

**Directory** `src/llm/baml/`:

| File             | Purpose                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.ts`       | Public entry for the `./baml` subpath; calls `registerChatModel(Providers.BAML, ChatBAML)` as a module side-effect (`src/llm/baml/index.ts:10`), then re-exports `ChatBAML`, `./errors`, `./types`.                |
| `ChatBAML.ts`    | The `BaseChatModel` subclass: `_generate`, `_streamResponseChunks`, `bindTools`, `withStructuredOutput` (throws — unsupported), cancellation guard, usage/metadata attachment.                                     |
| `types.ts`       | The port contract: `BAML_PORT_VERSION`, `BamlFunctionSet`, `BamlPromptInput`, `BamlTurnResult`/`BamlTurnChunk`, `BamlCallMeta`, `BamlTranscriptEntry`, `BamlClientOptions`.                                        |
| `toolBinding.ts` | `createToolBinding`/`emitToolCalls` — validates each tool selection against the current binding and converts it to LangChain `ToolCall`/`ToolCallChunk`s; rejects anything unbound rather than passing it through. |
| `transcript.ts`  | `projectTranscript`/`restoreTranscript` — converts `BaseMessage[]` history to/from the port's serializable transcript entries.                                                                                     |
| `callMeta.ts`    | Maps the port's optional `BamlCallMeta` onto LangChain `usage_metadata`/`response_metadata`, never fabricating zero counts.                                                                                        |
| `errors.ts`      | Five public error classes (`BamlNotRegisteredError`, `BamlPortVersionError`, `BamlToolNotBoundError`, `BamlTurnError`, `BamlUnsupportedError`).                                                                    |

**Class shape**: `ChatBAML extends BaseChatModel<ChatBAMLCallOptions>` (identical base to every other provider). Notable divergences from a typical thin API wrapper:

- `bindTools(tools, kwargs)` (`ChatBAML.ts:67-75`) calls `createToolBinding(...)` and freezes the result via `this.withConfig({ toolBinding })`, returning a **new** runnable rather than mutating the receiver — proven safe for concurrent differently-bound invocations by `ChatBAML.tools.test.ts:83-160`.
- `withStructuredOutput()` (`ChatBAML.ts:84-88`) is deliberately overridden to throw `BamlUnsupportedError`, because the tool union is compiled/frozen at build time.
- `_generate`/`_streamResponseChunks` (`ChatBAML.ts:168-199,218-272`) call `this.functions.takeTurn`/`streamTurn` — i.e., **one call to the external port per model turn**, producing either a text answer or a set of tool selections. The port itself (the real generated BAML SDK code) is entirely external and opaque to this library; the host application implements `BamlFunctionSet`.
- Both paths call `options.signal?.throwIfAborted()` before ever reaching the port, because `BaseChatModel` enters the generator body before checking the signal itself (`ChatBAML.ts:90-104`).

**How BAML's tool loop is reconciled with the host graph**: BAML does **not** run its own tool-dispatch loop inside this library. One port call → one LLM decision → converted to standard `tool_calls` → the existing `toolsCondition`/`ToolNode` machinery (`src/tools/ToolNode.ts`) executes tools exactly as it would for any provider → results are fed back as `ToolMessage`s → the transcript (including tool results) is re-projected and handed to a **second** port call. `src/llm/baml/__tests__/toolLoop.closure.test.ts` (`describe('B18 — the full tool loop closes', ...)`, confirmed at line 127) exercises this end-to-end using a real `ToolNode`, real `attemptInvoke`, and a scripted-but-real `BamlFunctionSet` whose second-turn answer is derived from the actual transcript handed to it — not hardcoded — so the test only passes if the tool result genuinely round-tripped.

**Registration divergence**: BAML is the only provider among the twelve `Providers` values that is **not** a static entry in `llmProviders`'s object literal (`src/llm/providers.ts:22-36`). Instead, `src/llm/baml/index.ts:10` calls `registerChatModel(Providers.BAML, ChatBAML)` as an **import side-effect** — only importing `@librechat/agents/baml` populates the registry slot. `getChatModelClass`'s `Unsupported LLM provider` failure mode is what a consumer sees if they forget that import; `BamlNotRegisteredError`'s message (`src/llm/baml/errors.ts:15-24`) documents the remediation.

**Packaged boundary** (verified in `package.json:17-21`):

```json
"./baml": {
  "import": "./dist/esm/llm/baml/index.mjs",
  "require": "./dist/cjs/llm/baml/index.cjs",
  "types": "./dist/types/llm/baml/index.d.ts"
}
```

`config/package-entries.mjs` declares `'llm/baml/index': 'src/llm/baml/index.ts'` as a **separate build entry**, alongside `main`, `openai/index`, `responses/index`, etc. The root barrel `src/index.ts` never imports `src/llm/baml/index.ts` (the type maps in `src/types/llm.ts` import `ChatBAML` from the class file directly, not from the registering `index.ts` — so importing the root package's types alone never triggers registration). This means BAML support (and by the same pattern, a future Claude Code SDK provider) ships without adding a dependency to every consumer of the root `@librechat/agents` package. `docs/providers/baml.md` documents this explicitly: this package declares **no** dependency (not even optional peer) on the real BAML bridge package — the host owns that entirely; `ChatBAML` only knows the port interface.

**Public errors**: five classes in `src/llm/baml/errors.ts`, exported through the `./baml` subpath and documented as the stable public surface consumers should branch on by class, not message text (`docs/providers/baml.md:223-235`).

**Streaming/cancellation/usage specifics** (relevant if a Claude Code SDK provider needs the same treatment):

- `_streamResponseChunks` guarantees at least one chunk is yielded even if the port's stream produces zero, because `attemptInvoke` accumulates into a `finalChunk` that would otherwise be force-cast from `undefined` (`ChatBAML.ts:201-206,225,244,266-271`; `src/llm/invoke.ts:859,1039`).
- `usage_metadata` is attached only once, on the first chunk that reports it, via a local `usageEmitted` flag (`ChatBAML.ts:226-238`), matching the repo-wide convention in `src/llm/stream/chunkAdapters.ts:15-35`.
- Cancellation mid-flight is explicitly the **port implementation's** responsibility to observe via `options.signal` forwarded into `BamlPromptInput.signal` (`ChatBAML.ts:119-129`) — `attemptInvoke` itself only inspects `config.signal` for `StreamLimitExceededError`.

### Pre-existing Claude Code vocabulary already in this codebase

No `@anthropic-ai/claude-code`, `@anthropic-ai/claude-agent-sdk`, or `ClaudeAgentSDK` import exists anywhere. However:

- **`@anthropic-ai/sandbox-runtime`** is an optional peer dependency (`package.json:271`, `peerDependenciesMeta` at `:274`) and a devDependency (`:283`), lazily imported by `loadSandboxRuntime()` (`src/tools/local/LocalExecutionEngine.ts:331-360`) and used via `SandboxManager.wrapWithSandbox(...)` (`LocalExecutionEngine.ts:549-566`) to OS-sandbox the local coding engine's own bash execution when `config.sandbox.enabled === true`. Without it installed and enabled, `maybeWarnSandboxOff()` fires a one-time console warning that "the agent has full access to the host filesystem and network" (`LocalExecutionEngine.ts:356`).
- **`src/hooks/createToolPolicyHook.ts:1-50`** — a `PreToolUse` hook factory whose doc comment states it "Uses the Claude Code Agent SDK permission vocabulary (`allowed_tools` / `disallowed_tools` / `permissionMode`)" (lines 6-7), mirrors Claude Code's `permissionMode` (`default`/`dontAsk`/`bypass`, lines 15-26), and replicates "Claude Code's 'deny rules are checked first' guarantee" (line 43).
- Scattered inspiration comments (not integrations): `docs/prompt-cache-benchmark.md:4` ("the Claude Code approach" to cache breakpoints), `docs/summarization-behavior.md:5` ("inspired by Claude Code's compaction approach"), `src/prompts/activityLabel.ts:8` ("synthesized from Claude Code's tool-use summary prompt"), `src/tools/subagent/SubagentExecutor.ts:3401` ("matches Claude Code's behavior in `agentToolUtils.finalizeAgentTool`"), `src/tools/local/bashAst.ts:12` ("claude-code's tree-sitter AST validator"), `src/messages/prune.ts:2473` ("inspired by Claude Code's staged compaction"), `src/types/hitl.ts:171` ("Claude Code's `AskUserQuestion` semantic"), `src/messages/cache.ts:449` ("mirroring the Claude Code strategy"), `src/hooks/HookRegistry.ts:83` and `src/hooks/types.ts:8,348` (hook event surface and async-output shape modeled on Claude Code documentation).

### The local coding engine (closest tool-surface analog)

`src/tools/local/LocalCodingTools.ts:1364-1386` — `createLocalCodingTools(config)` bundles 11 `DynamicStructuredTool`s: `read_file`, `write_file`, `edit_file`, `grep_search`, `glob_search`, `list_directory`, `compile_check`, `bash_tool`, `execute_code`, and two programmatic-tool-calling variants. This is **provider-agnostic** — bound into whichever agent's tool set generically inside `Graph.ts`'s per-turn tool-binding step (`src/graphs/Graph.ts:2321-2324`) whenever `RunConfig.toolExecution.engine === 'local'`, regardless of which `Providers` value is configured. There is no dedicated "local coding agent" provider type; the engine choice (`'sandbox'` remote HTTP API, `'local'` host-process execution, `'cloudflare-sandbox'` container) is orthogonal to the LLM provider choice.

Execution boundary: `spawnLocalProcess()` (`src/tools/local/LocalExecutionEngine.ts:709-905`) wraps `child_process.spawn`, enforces timeouts and output-size caps, and optionally wraps the command through `@anthropic-ai/sandbox-runtime` as described above. Filesystem access is clamped through `resolveWorkspacePathSafe()`/`getWorkspaceRoots()` (`LocalExecutionEngine.ts:1319-1346,227-316`) with symlink-escape detection. A second, host-controlled negotiation layer, `src/hooks/createWorkspacePolicyHook.ts`, sits on top as a `PreToolUse` hook that can turn out-of-workspace access into an `ask`/HITL interrupt rather than a hard error — explicitly documented as composable with `createToolPolicyHook.ts`'s Claude-Code-style permission vocabulary.

### The subagent mechanism (closest delegation analog)

`Constants.SUBAGENT = 'subagent'` (`src/common/enum.ts:211`) names a tool that, per-agent, is constructed inline inside `Graph.createAgentNode()` (`src/graphs/Graph.ts:4297-4327`, confirmed: `const executor = new SubagentExecutor({...})` at line 4297, `this.registerSubagentExecutor(executor)` at line 4327) whenever `agentContext.subagentConfigs` is non-empty. Its handler (`src/tools/subagent/SubagentExecutor.ts`, ~3500 lines) builds a full nested LangGraph `StandardGraph`/`MultiAgentGraph`, compiles it, and `workflow.invoke(childInput, ...)` runs it to completion **in-process** — it is not a child OS process or an external SDK session. Progress is forwarded to the parent via `GraphEvents.ON_SUBAGENT_UPDATE` envelopes wrapping the child's custom events only (native LangChain stream events do not propagate). Depth-bounded (`agentContext.maxSubagentDepth`), independently checkpointable/resumable across HITL interrupts.

This is documented (not evaluated) because its _shape_ — a single `tool()` call whose handler owns spawn → run-to-completion-or-interrupt → return final text, reporting progress via a side-channel event distinct from the parent's own model stream — is structurally the same integration point a host would need for something that drives a bounded external execution loop. As implemented today, though, it only knows how to construct another in-process LangGraph workflow; there is no generic "child executor" abstraction, process-spawn primitive, or external-SDK-session concept in this codebase.

## Code References

- `src/common/enum.ts:87-101` — `Providers` enum, the canonical "list of agents"
- `src/llm/providers.ts:22-88` — `llmProviders` registry, `registerChatModel`, `getChatModelClass`, `__resetChatModelRegistry`, `manualToolStreamProviders`
- `src/types/llm.ts:173-213` — `ProviderOptionsMap`, `ChatModelMap`, `ChatModelConstructorMap`, `ChatModelInstance`, `ModelWithTools`
- `src/llm/anthropic/index.ts:452-786` — `CustomAnthropic`, the standard `BaseChatModel`-subclass pattern
- `src/llm/baml/index.ts:1-15` — the "port" provider's registration side-effect and public exports
- `src/llm/baml/ChatBAML.ts:44-272` — the port-bridging `BaseChatModel` subclass
- `src/llm/baml/toolBinding.ts:180-216` — `emitToolCalls`, converting external-SDK tool selections into LangChain `tool_calls`
- `src/llm/baml/__tests__/toolLoop.closure.test.ts:127` — end-to-end proof the port pattern round-trips through the real `ToolNode`
- `package.json:17-21` — the `"./baml"` npm subpath export (packaged-boundary pattern)
- `package.json:271,274,283` — `@anthropic-ai/sandbox-runtime` optional peer/dev dependency
- `src/tools/local/LocalExecutionEngine.ts:331-360,549-566` — lazy-loaded Claude Code sandbox runtime usage
- `src/hooks/createToolPolicyHook.ts:1-50` — explicit "Claude Code Agent SDK permission vocabulary" reuse
- `src/tools/local/LocalCodingTools.ts:1364-1386` — `createLocalCodingTools`, the provider-agnostic local tool bundle
- `src/graphs/Graph.ts:4297-4327` — `SubagentExecutor` construction inside `createAgentNode`
- `src/llm/init.ts:18-63` — `initializeModel`, the single runtime entry point that resolves `Providers` → constructed model
- `src/graphs/Graph.ts:2400-2406,3552-3560` — where a graph node actually constructs and invokes a provider's model
- `src/llm/invoke.ts:702-1050` — `attemptInvoke`, the shared streaming/invoking funnel every provider flows through

## Architecture Documentation

The provider-registration architecture has two independent axes:

1. **Static registration** (every provider except BAML): the constructor is a direct key in the `llmProviders` object literal in `src/llm/providers.ts`, always available the moment `@librechat/agents` (the root package) is imported.
2. **Side-effect registration** (BAML, and by the same template, a future Claude Code SDK provider): the constructor is registered only when a dedicated subpath module (e.g. `@librechat/agents/baml`) is imported, via the generic, idempotent `registerChatModel()` function. This lets a provider that depends on a large or optional external SDK ship without adding that dependency to every consumer of the root package.

Once registered (by either path), a provider only needs to satisfy the LangChain `BaseChatModel` structural contract (`_generate`/`_streamResponseChunks`, optionally `bindTools`) to participate fully in graph construction, event dispatch (`CHAT_MODEL_START/STREAM/END`, `ON_RUN_STEP`), streaming, and tool execution — all of which are implemented generically against that interface, not against any provider-specific type. Providers whose backing SDK already drives its own internal tool/turn loop (BAML today; the Claude Code SDK would be the same shape) reconcile with this generic machinery by treating the external SDK as an opaque "one turn in, one decision out" port, converting that decision into standard LangChain `tool_calls`, and letting the existing `ToolNode`/`toolsCondition` graph edges execute tools and drive the next turn — rather than letting the external SDK's own tool-execution loop run independently of the host graph.

## Workflow Closure Map

This maps the **existing** production chain a new provider (BAML, used as the concrete example) plugs into — from registration to an observable event a host application consumes. No code was added or changed by this research; the map documents current wiring that a Claude Code SDK provider would need to join in the same way.

```text
registerChatModel side-effect (module import)
  -> llmProviders registry populated
    -> initializeModel resolves Providers -> constructs BaseChatModel instance
      -> Graph.createCallModel invokes model via attemptInvoke (model.stream)
        -> provider's _streamResponseChunks emits AIMessageChunk w/ tool_calls
          -> ToolNode executes tools, returns ToolMessage(s)
            -> run.ts's streamEvents() loop dispatches ON_RUN_STEP / CHAT_MODEL_STREAM to the host's registered handler
```

Per-edge evidence:

| Edge                      | Producer                                                                                                             | Consumer                                                                          | Registration point                                                                                                             | Evidence                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| registration → registry   | `src/llm/baml/index.ts:10` (`registerChatModel(Providers.BAML, ChatBAML)`)                                           | `src/llm/providers.ts:22` (`llmProviders` object)                                 | Import of the `@librechat/agents/baml` subpath (`package.json:17-21`) — a module-load-time side effect, not a runtime API call | Verified by direct Read of `src/llm/baml/index.ts` and `package.json`                             |
| registry → construction   | `src/llm/providers.ts:79-88` (`getChatModelClass`)                                                                   | `src/llm/init.ts:18-63` (`initializeModel`)                                       | Called from `Graph.createCallModel` (`src/graphs/Graph.ts:2400-2406`) on every agent turn                                      | Verified by codebase-analyzer citations and direct Read of `providers.ts`                         |
| construction → invocation | `initializeModel`'s constructed `Runnable`                                                                           | `src/llm/invoke.ts` `attemptInvoke` (`model.stream(...)`, line ~858)              | Called from `Graph.ts:3552-3560` inside `withLangfuseRuntimeScope`                                                             | Reported by codebase-analyzer; not independently re-Read line-by-line                             |
| invocation → tool_calls   | `ChatBAML._streamResponseChunks` (`src/llm/baml/ChatBAML.ts:218-272`) via `emitToolCalls` (`toolBinding.ts:180-216`) | LangGraph's `toolsCondition` routing                                              | Standard LangChain `BaseChatModel` streaming contract — automatic, no manual registration                                      | `src/llm/baml/__tests__/toolLoop.closure.test.ts:127` asserts routing occurs                      |
| tool_calls → execution    | `toolsCondition`                                                                                                     | `src/tools/ToolNode.ts` (`toolMap` dispatch, ~line 826)                           | `ToolNode` instance added as a graph node in `createAgentNode` (`src/graphs/Graph.ts:4489-4497`)                               | Reported by codebase-analyzer; `toolLoop.closure.test.ts` exercises a real `ToolNode.invoke(...)` |
| execution → observable    | `ToolMessage`s appended to graph state                                                                               | `src/run.ts:1024,1037-1087` (`graphRunnable.streamEvents(...)`, handler dispatch) | Host application registers a `HandlerRegistry` handler for `GraphEvents.ON_RUN_STEP`/`CHAT_MODEL_STREAM`                       | Reported by codebase-analyzer                                                                     |

Labels: every node in this chain is **production-called** — `registerChatModel`, `initializeModel`, `attemptInvoke`, `ToolNode`, and the `run.ts` event loop are all exercised by the real (non-mocked) production code path in `src/llm/baml/__tests__/toolLoop.closure.test.ts`, which uses a real `ToolNode` and real `attemptInvoke` rather than mocks (confirmed by direct citation of that test's structure in the BAML analysis above).

**adds_or_changes**: false on every node — this research changed no code; it documents the existing chain a Claude Code SDK provider would need to join by the same pattern (its own `ChatX`/`ChatXxx` class registered via `registerChatModel`, its own npm subpath boundary if it depends on an external Claude Code SDK package). `highest_new_connector` is therefore not applicable to this research pass.

### ClosureMap (structured — derive() input)

```json
{
  "behavior": "A registered LLM provider is resolved, invoked to produce a model turn, and any tool calls it emits are executed and looped back, producing an observable run-step/message event a host application consumes.",
  "git_commit": "3f5dc561fc07fe710e9183de7f8a5015bda0751c",
  "repo": "/home/maceo/Dev/silmari-chat-agents",
  "nodes": [
    {
      "id": "register",
      "module": "src/llm/baml/index.ts",
      "is_entrypoint": false,
      "adds_or_changes": false,
      "read_path": null,
      "seedable_store": "llmProviders (src/llm/providers.ts:22)"
    },
    {
      "id": "resolve_construct",
      "module": "src/llm/init.ts",
      "is_entrypoint": true,
      "adds_or_changes": false,
      "read_path": null,
      "seedable_store": null
    },
    {
      "id": "invoke",
      "module": "src/llm/invoke.ts",
      "is_entrypoint": false,
      "adds_or_changes": false,
      "read_path": null,
      "seedable_store": null
    },
    {
      "id": "stream_turn",
      "module": "src/llm/baml/ChatBAML.ts",
      "is_entrypoint": false,
      "adds_or_changes": false,
      "read_path": null,
      "seedable_store": null
    },
    {
      "id": "tool_execute",
      "module": "src/tools/ToolNode.ts",
      "is_entrypoint": false,
      "adds_or_changes": false,
      "read_path": null,
      "seedable_store": null
    },
    {
      "id": "observe_run_step",
      "module": "src/run.ts",
      "is_entrypoint": false,
      "adds_or_changes": false,
      "read_path": "graphRunnable.streamEvents (src/run.ts:1024)",
      "seedable_store": null
    }
  ],
  "edges": [
    { "is_async": false, "cross_boundary": true, "driver": null },
    { "is_async": false, "cross_boundary": false, "driver": null },
    { "is_async": false, "cross_boundary": false, "driver": null },
    { "is_async": false, "cross_boundary": true, "driver": null },
    { "is_async": false, "cross_boundary": false, "driver": null }
  ]
}
```

Notes on rule application: no edge is queue/scheduler/outbox/event-replay-based — the entire chain executes in-process within one `graphRunnable.streamEvents(...)` call, so every edge is `is_async: false` with `driver: null`. `cross_boundary: true` is set only where a real module/registration boundary exists: `register → resolve_construct` crosses the npm-subpath boundary (`@librechat/agents/baml` is not imported by the root barrel), and `stream_turn → tool_execute` crosses the LangGraph `StateGraph` node boundary (agent node → tools node, registered via `.addNode`/`.addConditionalEdges` in `src/graphs/Graph.ts:4489-4497`).

### Closure adapter (staged proposal — `2026-08-13-10-38-claude-code-sdk-agent-provider.closure-adapter.py`)

```python
"""Closure adapter (STAGED PROPOSAL — not wired into the repo).
Derived from the ClosureMap for: provider registration -> invocation -> tool loop -> observable run step.
Pin: 3f5dc561fc07fe710e9183de7f8a5015bda0751c.
Promote into silmari-chat-agents and complete each TODO(promote) before use.
Speaks the 7-op contract apps/closure-oracle already talks to (mock_adapter.py).
"""
import http.server, json, sys
ASYNC_EDGES = []                                   # no async edges in this chain (all in-process)
CONNECTOR = {e: True for e in ASYNC_EDGES}
SINK = []                                          # Phase-0 /seed_sink target

def handle(op, p):
    if op == "/reset":        SINK.clear(); CONNECTOR.update({e: True for e in ASYNC_EDGES}); return {"ok": True}
    if op == "/set_connector": CONNECTOR[p["edge"]] = p["enabled"]; return {"ok": True}
    if op == "/seed_sink":     SINK.append(p["value"]); return {"ok": True}
    if op == "/seed":
        # TODO(promote): populate llmProviders via registerChatModel(provider, ctor) with p["data"]
        #                (src/llm/providers.ts:48-61, src/llm/baml/index.ts:10)
        return {"ok": True}
    if op == "/trigger":
        # TODO(promote): call initializeModel({ provider, clientOptions, tools }) with p["args"]
        #                (src/llm/init.ts:18-63)
        return {"ok": True}
    if op == "/drive":
        if not CONNECTOR.get(p["edge"], True): return {"ok": True}  # oracle disabled = red-at-seam
        # No async driver required — chain is fully synchronous within attemptInvoke/streamEvents.
        return {"ok": True}
    if op == "/observe":
        # TODO(promote): return json.dumps(<host's ON_RUN_STEP/CHAT_MODEL_STREAM handler capture>())
        #                (src/run.ts:1024,1037-1087)
        return {"ok": True, "value": json.dumps(SINK)}
    return {"ok": False, "error": "unknown op"}

class Hn(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        out = json.dumps(handle(self.path, json.loads(self.rfile.read(n) or "{}"))).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), Hn).serve_forever()
```

## Historical Context (from thoughts/)

All six existing thought documents relate to the **BAML** provider integration (2026-08-09) — the direct prior-art precedent for "add a new, non-standard provider to the registry." No document mentions Claude Code or Claude Agent SDK.

- `thoughts/shared/research/2026-08-09-13-21-llm-interface-baml-integration.md` — "LLM Interface Architecture (BAML Integration Prep)." Maps the two chokepoints every LLM call passes through (`initializeModel` and `attemptInvoke`), the provider map, and the graph/streaming architecture — effectively an earlier version of this same research question, aimed at BAML instead of Claude Code.
- `thoughts/shared/plans/2026-08-09-providers-baml-port-scope.md` — early scoping doc: Phase 0-4 (packaging seam → tool-schema codegen → `ChatBAML` class → streaming/events → cross-cutting integration).
- `thoughts/shared/plans/2026-08-09-15-57-tdd-providers-baml-phase0.md` — the detailed TDD plan, including the "seam grammar" (S1 package boundary, S2 registration, S3 construction, S4 invocation, S5 port to host adapter) that a Claude Code SDK provider plan would likely mirror.
- `thoughts/shared/plans/2026-08-09-15-57-tdd-providers-baml-phase0-REVIEW.md` — plan review covering contract/interface/promise/data-model completeness.
- `thoughts/shared/handoffs/general/2026-08-09_19-26-20_providers-baml-drive-to-completion.md` — mid-flight handoff, B0-B17 in progress.
- `thoughts/shared/handoffs/general/2026-08-09_21-09-33_providers-baml-phase0-complete.md` — B0-B21 complete, branch unmerged/unpushed at that time (subsequently merged — see commit `8495f8b` "Merge pull request #1 from tha-hammer/providers-baml-2026-08-09-19-16" in current git log).

## Related Research

- `thoughts/shared/research/2026-08-09-13-21-llm-interface-baml-integration.md` — the direct predecessor to this research, same chokepoints, different target provider.

## Open Questions

- **Integration shape**: Would a Claude Code SDK provider follow BAML's "port" pattern (host application implements a narrow interface over the real `@anthropic-ai/claude-agent-sdk`, keeping the SDK dependency out of the root package), or would this library take a direct dependency on `@anthropic-ai/claude-agent-sdk` itself (similar to how `@anthropic-ai/sdk` and `@langchain/anthropic` are direct dependencies today)? BAML's rationale for the port pattern (no dependency on the real bridge package) may or may not apply, since `@anthropic-ai/sandbox-runtime` is already a first-party Anthropic package this repo optionally depends on.

  **Resolved 2026-08-13** (see Follow-up Research below): direct dependency, added to `package.json`.

- **Tool-loop ownership**: The Claude Code SDK's internal tool loop (bash, file read/write/edit, grep, glob) substantially overlaps with this repo's own "local coding engine" (`src/tools/local/`). A design question outside this research's scope: would a Claude Code SDK provider disable/bypass its own internal tool loop and defer entirely to this repo's `ToolNode`/local-engine tools (matching the BAML pattern), or would it run its own tool loop internally and only expose turn-level results to the host graph (more like the `SubagentExecutor` "opaque bounded execution" shape)? These are two different integration shapes with different implications for HITL/hooks/workspace-policy enforcement, and this research does not take a position on which fits.

  **Resolved 2026-08-13**: use Claude Code's own tool loop (not this repo's `ToolNode`). See Follow-up Research below for the architectural consequence this has.

- **No existing package.json dependency**: neither `@anthropic-ai/claude-code` nor `@anthropic-ai/claude-agent-sdk` appears anywhere in `package.json` (dependencies, devDependencies, or peerDependencies) — confirmed by direct inspection alongside the sandbox-runtime/anthropic-sdk entries. Resolution above means this dependency is now planned to be added directly.

## Follow-up Research 2026-08-13T10:50:05-04:00

The user made three integration-shape decisions on the open questions above: (1) direct dependency on the real SDK rather than BAML's host-implemented port pattern, (2) let Claude Code drive its own internal tool loop rather than delegating tool execution to this repo's `ToolNode`, (3) add the dependency to `package.json`. Since none of this SDK's actual API exists in this codebase or in prior `thoughts/` docs, a web-research pass was run against Anthropic's official documentation and the npm registry to ground these decisions in verified facts rather than assumption. Full agent report retained in session; key verified findings below with citations.

### Verified Claude Agent SDK facts (external — not in this codebase)

- **Package identity**: the SDK was renamed on npm from `@anthropic-ai/claude-code` to **`@anthropic-ai/claude-agent-sdk`** (breaking change at SDK v0.1.0). The old package name is deprecated/frozen. Current latest version confirmed live via direct npm registry fetch: **0.3.231**. ([npm registry](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/latest), [Migration guide](https://code.claude.com/docs/en/agent-sdk/migration-guide))
- **Execution model — the load-bearing fact for this integration**: the SDK is **Node.js-only and spawns a native `claude` CLI subprocess over stdio**. It is not an in-process API client. "When your code calls `query()`, the SDK spawns a separate `claude` CLI process and talks to it over stdio." One agent session = one subprocess with its own shell, working directory, and on-disk session files, none of which survive a container restart unless a `SessionStore` adapter is wired up. ([Hosting the Agent SDK](https://code.claude.com/docs/en/agent-sdk/hosting))
- **Core entry point**: `query({ prompt: string | AsyncIterable<SDKUserMessage>, options?: Options }): Query`, where `Query extends AsyncGenerator<SDKMessage, void>` plus control methods (`interrupt()`, `rewindFiles()`, `setPermissionMode()`, `setModel()`, `close()`, etc.). String `prompt` is single-shot/stateless mode; `AsyncIterable<SDKUserMessage>` is the "recommended" streaming-input mode required for image attachments, mid-session interrupts, queued messages, and dynamic `setPermissionMode()`/`setModel()`. ([TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript))
- **Message stream shape**: `SystemMessage` (session init/metadata), `AssistantMessage` (wraps the raw Anthropic message; content blocks include `text`, `thinking`, `tool_use`), `UserMessage` (tool results fed back to Claude), optional `StreamEvent` (raw partial deltas, only if `includePartialMessages: true`), and a terminal `ResultMessage` (`subtype`: `success`/`error_max_turns`/`error_max_budget_usd`/`error_during_execution`/`error_max_structured_output_retries`; carries `total_cost_usd`, `usage`, `modelUsage` including subagent rollups, `num_turns`, `session_id`, `stop_reason`). ([Agent loop docs](https://code.claude.com/docs/en/agent-sdk/agent-loop), [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript))
- **Tool loop is automatic but not opaque**: "Turns continue until Claude produces output with no tool calls" without yielding control back to host code — but the host's iteration over `query()` still receives an `AssistantMessage` (`tool_use` blocks) and matching `UserMessage` (tool result) for every individual built-in tool call, so intermediate activity is observable in the stream even though the host never has to drive the loop itself. The one exception: a spawned `Agent`/subagent's own intermediate tool calls are not surfaced to the parent — only its final summarized result is. ([Agent loop docs](https://code.claude.com/docs/en/agent-sdk/agent-loop))
- **Permission/hook surface maps closely onto this repo's existing hook vocabulary**: `Options` includes `allowedTools`/`disallowedTools` (supports scoped rules like `Bash(rm *)` and glob patterns), `permissionMode` (`default`, `acceptEdits`, `plan`, `dontAsk`, `auto`, `bypassPermissions`), `hooks` (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStart`/`Stop`, `PreCompact`, etc.), and a `canUseTool` fallback callback. Documented evaluation order: **hooks → deny rules → ask rules → permission mode → allow rules → `canUseTool` callback**. This is the exact vocabulary `src/hooks/createToolPolicyHook.ts:6-7,17,43` already cites as its design source — that hook was written anticipating this permission model, before any actual SDK dependency existed. ([Permissions docs](https://code.claude.com/docs/en/agent-sdk/permissions))
- **Custom tools run in-process, not in the subprocess**: `createSdkMcpServer({ name, version, tools: [tool(name, description, zodSchema, handler)] })` registers host-defined tools (named `mcp__{server}__{tool}`) that execute as regular JS functions in the host application — only the SDK's _built-in_ tools (Bash, Read, Write, Edit, Grep, Glob, WebSearch, WebFetch, etc.) run inside the subprocess. This means a host could in principle expose this repo's own local-coding-engine tools or other tools to a Claude Code session via this mechanism, independent of whether Claude's built-in tool loop is also used. ([Custom tools docs](https://code.claude.com/docs/en/agent-sdk/custom-tools))
- **Cancellation**: `options.abortController: AbortController` cancels a running query; the returned `Query` also exposes `interrupt()` for streaming-input sessions.
- **Browser/edge support is unverified**: the package lists a `./browser-sdk.js` export, but no documentation describes what it does, and every architecture doc describes subprocess-over-stdio as the sole execution model. Treated as an open gap, not a confirmed capability.

### Architectural implication of the three decisions together

Choosing (a) a direct SDK dependency and (b) Claude Code's own tool loop, together, means the resulting provider **cannot follow either existing pattern in this codebase cleanly**:

- It doesn't fit the **standard pattern** (`CustomAnthropic`, and every provider except BAML): those are thin `BaseChatModel` subclasses where one `_generate`/`_streamResponseChunks` call corresponds to one model turn, and tool calls flow out as LangChain `tool_calls` that this repo's own `ToolNode` executes. Here, tool execution is explicitly _not_ going through `ToolNode` — it happens inside the spawned subprocess, automatically, across what the SDK calls "turns" but what the host graph would see as a single bounded unit of work.
- It doesn't fit the **BAML port pattern** either: BAML's `ChatBAML` also does one port call per turn and defers ALL tool execution to this repo's `ToolNode` — the opposite of decision (2).
- It is structurally closest to the **`SubagentExecutor` shape already in this codebase** (`src/tools/subagent/SubagentExecutor.ts`, `src/graphs/Graph.ts:4297-4327`): a call that spawns a bounded external execution (there: another in-process LangGraph workflow; here: a `claude` CLI subprocess via `query()`), runs it to completion (or until interrupted), and reports intermediate progress via a side-channel event distinct from the parent's own model-stream (there: `GraphEvents.ON_SUBAGENT_UPDATE`; here: the SDK's own `AssistantMessage`/`UserMessage`/`StreamEvent` stream would need to be translated into some equivalent progress event). Unlike `SubagentExecutor`, though, the child unit of work here is an OS subprocess with its own filesystem/cwd and on-disk session state, not an in-process LangGraph invocation — closer in _operational_ shape to the local coding engine's `spawnLocalProcess()` (`src/tools/local/LocalExecutionEngine.ts:709-905`) than to anything provider- or subagent-shaped.
- Whether this should still be registered as a `Providers` enum member / `ChatModelConstructorMap` entry (so it can sit in the same "main model" slot Anthropic/OpenAI/BAML occupy today) or as a different kind of construct entirely (e.g., a subagent-like delegate, or its own top-level entry point outside the `Providers` registry) is an open architectural question this research surfaces but does not resolve — it depends on whether the intended usage is "the whole agent's main LLM is a Claude Code session" or "one tool call within a normal agent delegates to a Claude Code session." The user's phrasing ("add the claude code sdk to the list of agents") suggests the former, which is the harder integration to make consistent with the rest of the registry, since every other registry member is stateless-per-call by contrast to a stateful, filesystem-bound subprocess session.

### Updated code references

- Prospective new dependency: `@anthropic-ai/claude-agent-sdk` (not yet in `package.json`), peer-depends on `zod ^4.0.0`, `@anthropic-ai/sdk >=0.93.0` (already present, `package.json:234`), `@modelcontextprotocol/sdk ^1.29.0`.
- `src/hooks/createToolPolicyHook.ts:6-7,17,43` — pre-existing hook already modeled on this SDK's exact permission vocabulary/evaluation order; a strong candidate for direct reuse/translation once the dependency is added.
- `src/tools/local/LocalExecutionEngine.ts:709-905` (`spawnLocalProcess`) — the closest existing precedent in this repo for managing a spawned OS subprocess with timeout/output-cap/sandbox concerns, relevant to subprocess lifecycle management for `query()` sessions.
- `src/tools/subagent/SubagentExecutor.ts`, `src/graphs/Graph.ts:4297-4327` — closest existing precedent for "bounded external execution reporting progress via a side-channel event," relevant to how intermediate `SDKMessage`s might be surfaced to a host without going through `ToolNode`.

### Open questions raised by this follow-up

- ~~Should a Claude Code SDK integration be a `Providers` enum member (occupying the "main agent model" slot) or a structurally different construct (e.g. `SUBAGENT`-adjacent delegate, or a new top-level entry point)?~~ **Resolved 2026-08-13**: `Providers` enum member — it occupies the "main agent model" slot, registered like `ANTHROPIC`/`BAML` in `llmProviders`, selectable as the graph's main model. This is the harder integration to make consistent with the registry's stateless-per-call contract (see architectural implication above) and is exactly what a subsequent TDD plan needs to design for.
- ~~Subprocess lifecycle and multi-tenancy: this repo's other providers are stateless per call; a `claude` CLI subprocess per session has real resource cost (~1 GiB RAM/1 CPU per session per Anthropic's own hosting guidance) and on-disk state. How should session `cwd`/workspace isolation, concurrent-session limits, and `SessionStore` persistence be handled in a library meant to be embedded in arbitrary host applications (e.g. LibreChat, potentially multi-tenant)?~~ **Resolved 2026-08-15**: reuse this repo's existing workspace-clamping (`resolveWorkspacePathSafe`), treat concurrent-session scaling as a host concern (not this library's), and forward `sessionStore` as a thin pass-through option. See Follow-up Research below.
- ~~Whether/how the SDK's built-in permission `hooks`/`canUseTool` surface should be bridged to this repo's own `HookRegistry`/`createToolPolicyHook`/`createWorkspacePolicyHook` (they already share the same vocabulary, per the finding above, but bridging them concretely — e.g., translating this repo's `PreToolUse` hook results into the SDK's `canUseTool` return shape — has not been designed).~~ **Resolved 2026-08-15**: mechanical for allow/deny; `ask`/`respond` need an explicit adapter decision, not a 1:1 mapping. See Follow-up Research below.
- ~~Whether custom tools from this repo (local coding engine, subagent delegation, etc.) should also be exposed into a Claude Code session via `createSdkMcpServer`, or whether the integration should rely solely on Claude Code's own built-in tools per decision (2).~~ **Resolved 2026-08-15**: expose nothing from the local-coding-engine bundle (pure duplication); defer programmatic-tool-calling and subagent-delegation exposure to a later phase. See Follow-up Research below.

These were design questions for a subsequent planning pass (e.g. a TDD plan); they are now resolved enough to inform that plan, though item 2's `ask` gap needs a live behavioral check before implementation (see below).

## Follow-up Research 2026-08-15T00:00:00-04:00

The three open questions above were researched in parallel (each grounded in both this repo's code and the Claude Agent SDK's official docs, `code.claude.com/docs/en/agent-sdk/*`) ahead of writing a TDD plan. Findings below.

### 1. Subprocess lifecycle & multi-tenancy

**This repo today**: `getLocalCwd`/`getWorkspaceRoots` (`src/tools/local/LocalExecutionEngine.ts:227-260`) resolve a per-config workspace root + `additionalRoots`; `resolveWorkspacePathSafe` (`:1319-1346`) symlink-resolves and clamps every path against those roots via `getWriteRoots`/`getReadRoots` (`:286-316`), honoring `workspace.allowWriteOutside`/`allowReadOutside`. `spawnLocalProcess` (`:709-905`) already manages one subprocess's lifecycle per call — `cwd`, timeout (`LOCAL_SPAWN_TIMEOUT_MS`, `:716,757-759`), in-memory + hard-kill byte caps (`:717-816`), optional `@anthropic-ai/sandbox-runtime` wrapping (`:727,742-747`). None of it is session-scoped; there is no `SessionStore`-equivalent anywhere in this repo.

**SDK facts** (`hosting`, `session-storage` docs): one `query()` = one `claude` CLI subprocess with its own `cwd`, shell, and on-disk JSONL transcript (under `~/.claude/projects/` or `CLAUDE_CONFIG_DIR`) that does not survive a restart without a `SessionStore` adapter (`append`/`load` required; `listSessions`/`listSessionSummaries`/`delete`/`listSubkeys` optional) — a mirror of the subprocess's own disk writes, not a replacement. Multi-tenant isolation is four per-`query()` options: `cwd`, `settingSources: []`, `env.CLAUDE_CONFIG_DIR`, `env.CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. Resource sizing (~1 GiB RAM/1 CPU floor per session, `agents per host = (host RAM - overhead) / per-session RAM ceiling`, pin long-running sessions to a container via consistent hashing on `sessionId`) is explicitly host-owned in the docs.

**Recommendation**: don't build a subprocess-pool/scaling layer in this library — that's a hosting-application concern per the SDK's own docs, consistent with this repo's role as an embedded library. (1) Thread the provider's session `cwd` through the existing `getLocalCwd`/`resolveWorkspacePathSafe` clamp rather than inventing a new isolation mechanism, and set the four multi-tenant options by default when running multi-tenant. (2) Document concurrent-session limits as a host responsibility; at most expose a per-session `maxTurns`/timeout knob, analogous to `config.timeoutMs`. (3) Accept a pass-through `sessionStore` (typed as the SDK's `SessionStore`) plus `resume`/`cwd` fields on this provider's client options, implementing no adapter — a thin forward, not a reimplementation of BAML's port pattern (session storage is a separable axis from tool-loop ownership, so this doesn't reopen decision (1)).

### 2. Hook/permission bridging

**This repo today**: `PreToolUseHookOutput` is flat — `{ decision?: 'allow'|'deny'|'ask', reason?, updatedInput?, allowedDecisions? }` (`src/hooks/types.ts:370-397`); multiple hooks fold via `deny > ask > allow` precedence into `AggregatedHookResult` (`types.ts:550-598`). `ask` raises a `ToolApprovalRequest`/`AskUserQuestionInterruptPayload` HITL interrupt the host resumes with `approve|reject|edit|respond` (`src/types/hitl.ts:12-70,140-208`) — `respond` substitutes a successful `ToolMessage` without running the tool. The allow/deny/ask rule matching happens inside `createToolPolicyHook`/`createWorkspacePolicyHook` themselves (`createToolPolicyHook.ts:129-181`, `createWorkspacePolicyHook.ts:271-359`), not a separate declarative layer.

**SDK facts** (`permissions`, `hooks`, `user-input` docs): evaluation order is **hooks → deny rules → ask rules → permission mode → allow rules → `canUseTool`**; a hook `allow` does not skip the rules below it, only hook `deny` short-circuits. SDK `PreToolUse` hook output is nested: `{ hookSpecificOutput: { hookEventName:'PreToolUse', permissionDecision:'allow'|'deny'|'ask'|'defer', permissionDecisionReason?, updatedInput? } }`. `canUseTool(toolName, input, {signal, suggestions})` returns a two-branch union — `{behavior:'allow', updatedInput, updatedPermissions?}` or `{behavior:'deny', message, interrupt?}` — no third "ask" branch; `canUseTool` itself is the ask/HITL step, invoked only once nothing earlier resolved the call.

**Feasibility**: mechanical 1:1 for the easy cases — `deny`+`reason` → SDK `permissionDecision:'deny'`/`canUseTool` `behavior:'deny'`; `allow`+`updatedInput` maps both ways; `PostToolUse.updatedOutput` → SDK's `updatedToolOutput`. Two real gaps: (a) it's unconfirmed from the fetched docs what a _hook_ (vs. an _ask rule_) returning `permissionDecision:'ask'` actually does procedurally — needs a live behavioral check before an adapter is built, not an assumption; (b) `respond` (host substitutes a canned successful tool result without executing) has no SDK analog at all — `canUseTool` is binary allow/deny with optional input mutation only, so `respond` must be handled entirely on this repo's side before ever calling into the SDK layer, or degraded to `deny` with an explanatory message. Bookkeeping fields this repo's `PreToolUseHookInput` carries (`runId`, `threadId`, `stepId`, `turn`, `executingAgentId`) have no SDK equivalent in the hook input and must be synthesized by the adapter from its own call-site state.

**Adapter shape**: two thin translation functions (not a shared type), living in the new provider module: `toSdkPreToolUseHook(repoHook: HookCallback<'PreToolUse'>): (sdkInput) => SdkHookJSONOutput` and `toSdkCanUseTool(repoHitlResolver): CanUseTool`, each wrapping the existing `createToolPolicyHook`/`createWorkspacePolicyHook` output and re-shaping `decision`, with `ask` routed to whichever extension point is confirmed to actually pause (gap (a) above) and `respond` handled as a pre-check before the SDK ever sees the call.

### 3. Exposing this repo's own tools via `createSdkMcpServer`

**Local coding tools are near-total duplicates of Claude Code's built-ins**: `createLocalCodingTools` (`src/tools/local/LocalCodingTools.ts:1373-1385`) bundles `read_file`/`write_file`/`edit_file`/`grep_search`/`glob_search`/`list_directory`/`compile_check`/`bash_tool`/`execute_code` — functionally the same surface as Claude's native Read/Write/Edit/Grep/Glob/Bash, routed through this repo's own `LocalExecutionEngine` (workspace clamping, `createWorkspacePolicyHook`, optional sandbox-runtime) — a second, independent policy layer that would run in parallel with Claude Code's own evaluation if both toolsets were live, for zero new capability.

**Two tools are genuinely non-duplicative**: (1) programmatic tool calling (`LocalProgrammaticToolCalling.ts:651-673`, backed by `src/tools/ProgrammaticToolCalling.ts:110-121`) lets the model write Python/bash that calls the **rest of the parent LangGraph agent's bound tool set** (loops, conditionals, `asyncio.gather`) — Claude's own Bash tool can't invoke this repo's other structured tools by name; (2) subagent delegation (`Constants.SUBAGENT`, `SubagentExecutor` constructed at `src/graphs/Graph.ts:4297-4327`) spawns a differently-_configured_ in-process LangGraph workflow (different provider/model/system-prompt/toolset, own checkpointer/tracing/HITL) — not the same as Claude Code's own native subagent concept, which only spawns more Claude Code sessions on Claude's own model, so it complements rather than conflicts.

**API constraints confirmed** (`custom-tools` docs): `createSdkMcpServer({ name, version, tools })` runs strictly in-process; each tool surfaces as `mcp__{server}__{tool}` and must appear in `allowedTools` (or the `mcp__server__*` wildcard) to run without a permission prompt; the built-in `tools:` restriction list doesn't affect MCP tool visibility — that's controlled purely via allowed/disallowed lists.

**Recommendation**: expose nothing from the local-coding-engine file/search/bash bundle — it fights decision (2) and doubles the policy-enforcement surface for no gain. Defer a decision on exposing programmatic-tool-calling and subagent-delegation to a follow-up design pass, not the initial provider integration: both are additive rather than duplicative, but wiring either in requires translating LangChain `DynamicStructuredTool`/`ToolMessage` shapes into Zod schemas and MCP `CallToolResult`, plus a product decision on whether a Claude Code turn delegating into another provider's agent is desired for v1 — none of which blocks the core provider (registration → subprocess lifecycle → event translation).
