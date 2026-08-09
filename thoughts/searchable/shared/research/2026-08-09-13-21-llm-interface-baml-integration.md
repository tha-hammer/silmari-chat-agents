---
date: 2026-08-09T13:21:12-04:00
researcher: tha-hammer
git_commit: 1256cdcb060639b64cdd03891c98702acff1ac6e
branch: main
repository: silmari-chat-agents (npm package `@librechat/agents` v3.4.3)
topic: "LLM interface architecture, in preparation for BAML integration"
tags: [research, codebase, llm, providers, langchain, langgraph, structured-output, streaming, tools, baml]
status: complete
last_updated: 2026-08-09
last_updated_by: tha-hammer
---

# Research: LLM Interface Architecture (BAML Integration Prep)

**Date**: 2026-08-09T13:21:12-04:00
**Researcher**: tha-hammer
**Git Commit**: `1256cdcb060639b64cdd03891c98702acff1ac6e`
**Branch**: `main` (HEAD is contained in `origin/main` and `upstream/main`)
**Repository**: `/home/maceo/Dev/silmari-chat-agents` — published as `@librechat/agents`
**Permalink base**: `https://github.com/tha-hammer/silmari-chat-agents/blob/1256cdcb060639b64cdd03891c98702acff1ac6e/<path>#L<line>`
(inline references below are kept as `file:line` for editor navigability)

## Research Question

Research the LLM interface in this repo (TypeScript utilities for building agent workflows for `../silmari-chat`) in order to integrate BAML. Focus on: how LLM calls are currently made, provider abstraction, prompt construction, structured output/schema handling, streaming, tool/function calling, config and model selection, and where a BAML bridge (`typescript/node`) would plug in.

## Summary

Every LLM call in this repository passes through **two functions**, and only two:

| Function | Location | Role |
| --- | --- | --- |
| `initializeModel` | `src/llm/init.ts:18` | The single construction site for a chat model. Resolves `Providers` → concrete class via `getChatModelClass`, patches a few provider-gated fields, and optionally calls `.bindTools(tools)`. |
| `attemptInvoke` | `src/llm/invoke.ts:702` | The single call site. Sanitizes messages per provider, then calls `model.stream(...)` (`src/llm/invoke.ts:858`) or `model.invoke(...)` (`src/llm/invoke.ts:1042`). |

Both are `production-called` with no test-only callers (verified with the Semgrep closure mapper — see [Workflow Closure Map](#workflow-closure-map)). `initializeModel` has exactly 5 production callers; `attemptInvoke` has 3. This is a deliberately narrow waist, documented as such in the source: *"This is the single entry point for model creation across the codebase"* (`src/llm/init.ts:13-14`) and *"the single funnel for primary, fallback and summarization calls"* (`src/llm/invoke.ts:783-785`).

Architecturally the library is **LangChain/LangGraph-native, all the way down**:

- **Provider abstraction** is a `Providers`-enum-keyed map of *LangChain chat-model subclasses* (`llmProviders`, `src/llm/providers.ts:22`). Every provider entry is a locally-defined subclass of an upstream `@langchain/*` chat model, overriding `invocationParams` / `_generate` / `_streamResponseChunks` for wire-level fixes. `bindTools` and `withStructuredOutput` are **never overridden** — they are inherited from upstream everywhere.
- **Orchestration** is LangGraph `StateGraph`s. `Run` (`src/run.ts:210`) compiles a graph and drives it with `graphRunnable.streamEvents(...)` (`src/run.ts:1024`). The model is constructed *per model turn* inside `StandardGraph.createCallModel` (`src/graphs/Graph.ts:2400-2406`), never cached across turns.
- **Prompts are not templated in any framework sense.** The agent's system prompt is assembled by string concatenation in `AgentContext` (`src/agents/AgentContext.ts:582-600`, `607-630`, `931-997`) and prepended by a `RunnableLambda` (`src/agents/AgentContext.ts:709-747`). LangChain `PromptTemplate`/`ChatPromptTemplate` appears in exactly three places (title generation, fan-in edge prompts), all outside the agent loop.
- **Schemas are plain JSON Schema object literals, not zod.** No `.ts` file under `src/tools/` imports zod. `zod` (3.25.67) and `zod-to-json-schema` (3.25.2) are resolved **transitively only** — neither is declared in `package.json` `dependencies`/`devDependencies`/`peerDependencies`/`overrides`, yet `src/utils/schema.ts:2-3` imports both.
- **Structured output is nearly absent.** `withStructuredOutput` has exactly **one production call site**: title generation (`src/utils/title.ts:49,52`), and it is passed a raw JSON-Schema literal, not zod. Every other model-derived value in the library — activity labels (`src/run.ts:2036-2058`), summaries (`src/summarization/node.ts:1441-1472`) — is extracted by walking `response.content` blocks and normalizing whitespace. There is **no** JSON-parse-with-retry loop, **no** regex JSON extraction, and **no** `response_format` usage in production code.
- **Streaming is the load-bearing path.** Output does not return as a value; it is dispatched as events to host-registered `EventHandler` objects, then folded into `contentParts` by `createContentAggregator` (`src/stream.ts:2056`). A provider-agnostic pacing engine (`src/llm/stream/smoother.ts:196`) sits between the raw SDK stream and every consumer.

The concrete implication for a BAML bridge: this codebase has **no schema-constrained-generation layer for BAML to replace** — it has an agentic tool-calling loop plus a handful of unconstrained text extractions. The seams where BAML-generated functions could be invoked are enumerated factually in [Integration Seams](#integration-seams-as-they-exist-today).

### BAML toolchain state in this repo (as of this commit)

| Fact | Evidence |
| --- | --- |
| BAML CLI installed on this machine | `/home/maceo/.baml/bin/baml`; `baml wrapper 0.2.0`, `baml toolchain 0.15.0` |
| `.baml/` directory exists | contains only `profiles/*.bamlprof` (3 files, dated 2026) |
| `.baml/.gitignore` contents | `*` — the whole directory is self-ignored |
| `baml_src/` | does not exist |
| `baml init` / `baml bridge add` artifacts | none present |
| Any `baml` reference in `src/`, `package.json`, docs, or `.gitignore` | none (grep over `*.ts`, `*.json`, `*.md`, `*.mjs` returned zero hits) |
| `node_modules/` | not currently installed in the working tree |

---

## Detailed Findings

### A. Provider layer — `src/llm/`

#### A.1 The provider map

`src/llm/providers.ts:22-36` is a `Partial<ChatModelConstructorMap>` keyed by the `Providers` enum:

```ts
export const llmProviders: Partial<ChatModelConstructorMap> = {
  [Providers.XAI]: ChatXAI,
  [Providers.OPENAI]: ChatOpenAI,
  [Providers.AZURE]: AzureChatOpenAI,
  [Providers.VERTEXAI]: ChatVertexAI,
  [Providers.DEEPSEEK]: ChatDeepSeek,
  [Providers.MISTRALAI]: CustomChatMistralAI,
  [Providers.MISTRAL]: CustomChatMistralAI,
  [Providers.ANTHROPIC]: CustomAnthropic,
  [Providers.OPENROUTER]: ChatOpenRouter,
  [Providers.BEDROCK]: CustomChatBedrockConverse,
  // [Providers.ANTHROPIC]: ChatAnthropic,
  [Providers.GOOGLE]: CustomChatGoogleGenerativeAI,
  [Providers.MOONSHOT]: ChatMoonshot,
};
```

`getChatModelClass(provider)` (`src/llm/providers.ts:43-52`) reads the map and throws `Unsupported LLM provider: ${provider}` when absent. `manualToolStreamProviders` (`src/llm/providers.ts:38-41`) is a sibling `Set` containing `ANTHROPIC` and `BEDROCK`, consulted at `src/llm/invoke.ts:1011`.

The `Providers` enum (`src/common/enum.ts:87-100`) has 12 members with string values that are *not* uniformly the key name: `OPENAI='openAI'`, `AZURE='azureOpenAI'`, `VERTEXAI='vertexai'`, `BEDROCK='bedrock'`, `ANTHROPIC='anthropic'`, `MISTRALAI='mistralai'`, `MISTRAL='mistral'`, `GOOGLE='google'`, `DEEPSEEK='deepseek'`, `OPENROUTER='openrouter'`, `XAI='xai'`, `MOONSHOT='moonshot'`.

#### A.2 The single construction site

`src/llm/init.ts:18-63` (verified verbatim):

```ts
export function initializeModel({ provider, clientOptions, tools, override }): Runnable {
  const model = override ?? new (getChatModelClass(provider))(clientOptions ?? ({} as never));
  // ... provider-gated field patches (OpenAI-like, VertexAI) ...
  if (!tools || tools.length === 0) {
    return model as unknown as Runnable;
  }
  return (model as t.ModelWithTools).bindTools(tools);
}
```

Notable properties:

- **The model name is not a parameter.** It lives inside `clientOptions` (`.model` or `.modelName` depending on provider — `extractClientOptionsModel`, `src/llm/invoke.ts:1109-1122`), which is passed unmodified as the constructor's sole argument.
- **`override`** short-circuits construction entirely, accepting a pre-built model instance (used for test fakes and `this.overrideModel` in the graph, `src/graphs/Graph.ts:2400`).
- **Post-construction field patches** (`src/llm/init.ts:33-56`) reassign `temperature`/`topP`/`frequencyPenalty`/`presencePenalty`/`n` for OpenAI-like providers and a seven-field set for VertexAI, working around upstream constructor option handling. The identical block is duplicated at `src/run.ts:1713-1729`.
- **`bindTools` is called here and nowhere else in production** (the only other non-test call is a manual script, `src/scripts/openrouter_prompt_cache_live.ts:244`). No options object is passed — `tool_choice`/`strict`/`parallel_tool_calls` are supplied via `clientOptions` and handled in each subclass's `invocationParams`.

Production callers (closure-mapper verified, `production-called`, 0 test-only callers):

| Caller | Purpose | Tools bound |
| --- | --- | --- |
| `src/graphs/Graph.ts:2402` | main agent turn (`createCallModel`) | yes |
| `src/llm/invoke.ts:1193` | fallback provider retry (`tryFallbackProviders`) | yes |
| `src/run.ts:1708` | title generation | no |
| `src/run.ts:1996` | activity-label generation | no |
| `src/summarization/node.ts:659` | compaction / summarization | yes |

#### A.3 Custom chat-model subclasses

Every provider entry is a locally-defined subclass. Full inventory:

| Provider | This repo's class | Upstream base | Overridden methods |
| --- | --- | --- | --- |
| `ANTHROPIC` | `CustomAnthropic` (`src/llm/anthropic/index.ts:452`) | `ChatAnthropicMessages` (`@langchain/anthropic`) | `invocationParams`, `createStreamWithRetry`, `completionWithRetry`, `_streamChatModelEvents`, `_streamResponseChunks` |
| `BEDROCK` | `CustomChatBedrockConverse` (`src/llm/bedrock/index.ts:153`) | `ChatBedrockConverse` (`@langchain/aws`) | `invocationParams`, `_generateNonStreaming`, `_streamResponseChunks` (fully reimplemented over the AWS `ConverseStreamCommand`) |
| `GOOGLE` | `CustomChatGoogleGenerativeAI` (`src/llm/google/index.ts:40`) | `ChatGoogleGenerativeAI` (`@langchain/google-genai`) | ctor re-validation, `_isMultimodalModel`, `invocationParams`, `_generate`, `_streamResponseChunks` |
| `VERTEXAI` | `ChatVertexAI` (`src/llm/vertexai/index.ts:477`) | `ChatGoogle` (`@langchain/google-gauth`) | ctor, `invocationParams`, `_streamResponseChunks`, `buildConnection` |
| `MISTRAL(AI)` | `CustomChatMistralAI` (`src/llm/mistral/index.ts:9`) | `ChatMistralAI` (`@langchain/mistralai`) | `_streamResponseChunks` only |
| `OPENAI` | `ChatOpenAI` (`src/llm/openai/index.ts:2405`) | `ChatOpenAI` (`@langchain/openai`) | ctor (swaps completions/responses delegates), `_getClientOptions`, `_streamResponseChunks`, `_streamRawResponseChunks` |
| `AZURE` | `AzureChatOpenAI` (`src/llm/openai/index.ts:2502`) | `AzureChatOpenAI` (`@langchain/openai`) | ctor, `_getClientOptions`, `getReasoningParams`, `_streamResponseChunks` |
| `DEEPSEEK` | `ChatDeepSeek` (`src/llm/openai/index.ts:2614`) | `ChatDeepSeek` (`@langchain/deepseek`) | `_convertDeepSeekMessages`, `_generate` |
| `MOONSHOT` | `ChatMoonshot` (`src/llm/openai/index.ts:3120`) | *this repo's* `ChatOpenAI` | ctor only |
| `XAI` | `ChatXAI` (`src/llm/openai/index.ts:3135`) | `ChatXAI` (`@langchain/xai`) | ctor, `_getClientOptions`, `_streamResponseChunks` |
| `OPENROUTER` | `ChatOpenRouter` (`src/llm/openrouter/index.ts:117`) | *this repo's* `ChatOpenAI` | ctor, `invocationParams`, `_streamResponseChunks` |

`src/llm/openai/index.ts` additionally defines four module-internal delegate subclasses (`LibreChatOpenAICompletions` `:1506`, `LibreChatOpenAIResponses` `:1931`, `LibreChatAzureOpenAICompletions` `:2080`, `LibreChatAzureOpenAIResponses` `:2218`) that carry the actual `invocationParams`/message-conversion logic, mirroring `@langchain/openai`'s Chat-Completions vs Responses split.

**No subclass overrides `bindTools` or `withStructuredOutput`** — both are inherited from upstream throughout.

`src/langchain/language_models/chat_models.ts` is a one-line type re-export facade (`export type { BindToolsInput } from '@langchain/core/language_models/chat_models';`); no chat-model classes are defined under `src/langchain/`.

#### A.4 Per-provider message projection

`projectMessagesForProvider` (`src/llm/invoke.ts:185-263`) runs immediately before every model call (`src/llm/invoke.ts:766`), branching on provider:

```
nativeOpenAIResponses → projectOpenAIResponsesToolMessageContent
OPENROUTER            → projectOpenRouterToolMessageContent
isOpenAILike          → projectOpenAIChatToolMessageContent
ANTHROPIC             → projectSingleTextToolOutputsToText
BEDROCK               → projectCacheControlledToolOutputsToText
default               → projectStructuredToolOutputsToText
```

`usesNativeOpenAIResponses` (`src/llm/invoke.ts:110-178`) walks the `RunnableBinding`/`RunnableSequence` wrapper stack looking for `_useResponsesApi()` or a constructor name containing `'Responses'`.

Other provider-gated seams in the same file: `manualToolStreamProviders.has(provider)` (`:1011`), `strictAlternationProviders.has(provider)` (`:819`, set at `src/messages/alternation.ts:16`), `isAnthropicLike(...)` handoff-cue gating (`:809`).

Small provider-keyed helpers live in `src/llm/request.ts` (verified verbatim): `isThinkingEnabled(provider, clientOptions)` (`:9`) and `getMaxOutputTokensKey(provider)` (`:49`, returns `'maxOutputTokens'` for Google/Vertex else `'maxTokens'`).

`isOpenAILike` (`src/utils/llm.ts:4-17`) is true for `OPENAI, AZURE, OPENROUTER, XAI, DEEPSEEK`; siblings `isGoogleLike` (`:19`) and `isAnthropicLike` (`:29`) exist.

---

### B. Orchestration layer — `src/run.ts`, `src/graphs/`, `src/agents/`

#### B.1 `Run`

`class Run<_T extends t.BaseGraphState>` at `src/run.ts:210`.

- **Factory**: `Run.create<T>(config: t.RunConfig)` at `src/run.ts:603`.
- **Constructor** (private, `src/run.ts:253-315`): requires `runId` + `graphConfig`; seeds a `HandlerRegistry` from `config.customHandlers` (`:266-276`); selects `createMultiAgentGraph` vs `createLegacyGraph` on `graphConfig.type === 'multi-agent'` (`:294-305`).
- **Main entry**: `processStream(inputs, callerConfig, streamOptions?)` at `src/run.ts:802`. Accepts `t.IState` or a LangGraph `Command` (resume). Drives the graph at `src/run.ts:1024`:

  ```ts
  const stream = graphRunnable.streamEvents(inputs as t.IState, config, {
    raiseError: true,
    ignoreCustomEvent: true,
  });
  ```

  `ignoreCustomEvent: true` suppresses LangChain's own custom-event processing because the SDK routes custom events itself via `createCustomEventCallback` (`src/run.ts:676-713`). The `for await` loop (`:1037-1115`) checks for interrupts, then dispatches: `this.handlerRegistry?.getHandler(eventName)?.handle(eventName, data, metadata, this.Graph)` (`:1084-1087`).
- **Resume**: `resume(...)` at `src/run.ts:1420`, wraps a `Command({ resume, update?, goto? })` and re-enters `processStream` (`:1442`).
- **Out-of-graph LLM calls**: `generateTitle` (`src/run.ts:1616-1801`) and `generateActivityLabel` (`src/run.ts:1812-2101`) each build a model directly with `initializeModel` and bypass the graph entirely.

#### B.2 Graph structure

`createGraph({ kind, input })` (`src/graphs/createGraph.ts:10-15`) dispatches to `StandardGraph` or `MultiAgentGraph`, injecting a `graphFactory` so subagents can recursively build either kind.

`StandardGraph` (`src/graphs/Graph.ts:1164`) builds **two nested graphs**:

1. **Inner per-agent subgraph** — `createAgentNode(agentId)` (`src/graphs/Graph.ts:4227-4639`), compiled once per agent:

   ```ts
   const workflow = new StateGraph(StateAnnotation)
     .addNode(agentNode,     this.createCallModel(agentId))
     .addNode(toolNode,      this.initializeTools({ ... }))
     .addNode(summarizeNode, createSummarizeNode({ ... }))
     .addEdge(START, agentNode)
     .addConditionalEdges(agentNode, routeMessage)
     .addEdge(summarizeNode, agentNode)
     .addEdge(toolNode, agentContext.toolEnd ? END : agentNode);
   return workflow.compile();
   ```
   (`src/graphs/Graph.ts:4488-4636`; node names `agent=<id>`, `tools=<id>`, `summarize=<id>` from `GraphNodeKeys`, `src/common/enum.ts:102-109`.)

2. **Outer wrapper** — `createWorkflow()` (`src/graphs/Graph.ts:4641`, verified verbatim) mounts the compiled subgraph as a single node and compiles with `this.compileOptions`.

`MultiAgentGraph` (`src/graphs/MultiAgentGraph.ts:179`) extends `StandardGraph`; `createAgentSubgraph(agentId)` (`:753-759`) is literally `return this.createAgentNode(agentId)`, so **single-agent and multi-agent runs share the identical LLM invocation path**. Its `createWorkflow()` override (`:1015-1441`) adds `agentMessages` and `subagentResult` channels and wraps each subgraph in an `agentWrapper` node that handles handoff reception and returns LangGraph `Command`s for routing.

#### B.3 The model turn — `createCallModel`

`src/graphs/Graph.ts:2264` onwards. The two load-bearing statements (both verified verbatim):

```ts
// src/graphs/Graph.ts:2400-2410
let model =
  this.overrideModel ??
  initializeModel({
    tools: toolsForBinding,
    provider: agentContext.provider,
    clientOptions: agentContext.clientOptions,
  });

if (agentContext.systemRunnable) {
  model = agentContext.systemRunnable.pipe(model as Runnable);
}
```

```ts
// src/graphs/Graph.ts:3544-3561
result = await withLangfuseRuntimeScope(
  resolveLangfuseRuntimeScope({ ... }),
  () =>
    attemptInvoke(
      {
        model: (this.overrideModel ?? model) as t.ChatModel,
        messages: finalMessages,
        provider: agentContext.provider,
        context: this,
      },
      invokeConfig
    )
);
```

Between these two statements sit ~1100 lines of prompt-cache partitioning (`:2339-2398`), pruning, summarization triggering, orphan-tool-block sanitization (`:3253-3261`), tail cache-control placement (`:3287-3328`), and context-usage dispatch (`:3446-3450`). After it sits context-overflow recovery and `tryFallbackProviders`.

#### B.4 `AgentContext` — config → runnable

`AgentContext.fromConfig(agentConfig, tokenCounter?, indexTokenCountMap?)` (`src/agents/AgentContext.ts:59`) consumes `t.AgentInputs` (`src/types/graph.ts:800-873`) and is the sole owner of instruction assembly:

- `buildStableInstructionsString()` (`:582-600`) — identity preamble + `instructions` + programmatic-tool docs, `'\n\n'`-joined.
- `buildDynamicInstructionsString()` (`:607-630`) — `additional_instructions` + cross-run summary. Kept separate to preserve the prompt-cache prefix (comment `:602-606`).
- `buildSystemMessage(...)` (`:931-997`) — the single `new SystemMessage(...)` site, branching per prompt-cache provider (Anthropic array + `cache_control`, OpenRouter array, Bedrock `cachePoint`, otherwise plain joined string). Returns `undefined` when there is no instruction text at all.
- `systemRunnable` getter (`:545-562`) → `buildSystemRunnable()` (`:664-748`) returns a `RunnableLambda` that prepends the system message: `RunnableLambda.from((messages) => [...prefix, ...body]).withConfig({ runName: 'prompt' })` (`:709-747`). This is what gets `.pipe()`d in front of the bound model.
- `getToolsForBinding()` (`:1753-1765`) — returns schema-only stubs + `graphTools` in event-driven mode, otherwise filtered instance tools + `graphTools`.

#### B.5 Graph state

`src/types/graph.ts:75-93`: `BaseGraphState = { messages: BaseMessage[] }`, `AgentSubgraphState = BaseGraphState & { summarizationRequest? }`, `MultiAgentGraphState = BaseGraphState & { agentMessages?, subagentResult? }`.

Reducer: `messagesStateReducer(left, right)` (`src/messages/reducer.ts:62-118`) — auto-assigns uuids, merges by message `id`, honors `RemoveMessage` and the `createRemoveAllMessage()` sentinel (`:9-30`) used by compaction.

---

### C. Streaming — `src/stream.ts`, `src/llm/stream/`, `src/events.ts`

#### C.1 Two-layer design

**Layer 1 (provider → paced chunks).** Each provider's `_streamResponseChunks` wraps the raw SDK generator in a pacing engine:

- `smoothStream<TEmit>({ source, delayMs, signal, abortUpstream })` (`src/llm/stream/smoother.ts:196-574`) — bounded producer/consumer queue (`MAX_STREAM_QUEUE_CHUNKS=256`, `MAX_STREAM_QUEUE_TEXT_CHARS=8192`), adaptive piece sizing (`computeAdaptivePieceSize`, `:82-97`), word/punctuation boundary splitting (`findStreamChunkBoundary`, `:55-74`), `DEFAULT_STREAM_DELAY = 25` ms (`:1`).
- `toGenerationSmoothItem(chunk, ...)` (`src/llm/stream/chunkAdapters.ts:223-279`) classifies each chunk `splittable` / `atomic` / `passthrough`. Reasoning-bearing and tool-call-bearing chunks are forced atomic so their `additional_kwargs` are never duplicated across pieces.
- `smoothGenerationChunks(...)` (`src/llm/stream/chunkAdapters.ts:287-317`) is used directly by Google, VertexAI, Mistral; Anthropic, Bedrock, and the OpenAI family build their own `SmoothItem` sources (OpenAI's local variant at `src/llm/openai/index.ts:1135-1203`, wrapped by `delayStreamChunks` `:1243-1271`).
- Metadata hygiene: only the first split piece keeps `usage_metadata` (`src/llm/stream/chunkAdapters.ts:15-35`), and `dropRepeatedScalarMetadata` (`src/llm/openai/streamMetadata.ts:41-95`) strips repeated `finish_reason`/`model_name`/`service_tier`/`system_fingerprint`.

**Layer 2 (graph events → host).** `Run.processStream` drives `streamEvents` and dispatches each event to a registered `EventHandler`.

#### C.2 The handler contract

`EventHandler` is `{ handle(event, data, metadata?, graph?): void | Promise<void> }` (`src/types/graph.ts:128-149`). `HandlerRegistry` (`src/events.ts:13-23`) is a `Map<string, EventHandler>`; `composeEventHandlers(...)` (`src/events.ts:25-65`) merges handler sets.

Event names are the `GraphEvents` enum (`src/common/enum.ts:7-85`), split into custom events (`ON_RUN_STEP`, `ON_RUN_STEP_DELTA`, `ON_RUN_STEP_COMPLETED`, `ON_MESSAGE_DELTA`, `ON_REASONING_DELTA`, `ON_TOOL_EXECUTE`, `ON_SUMMARIZE_*`, `ON_SUBAGENT_UPDATE`, `ON_AGENT_LOG`, `ON_CONTEXT_USAGE`, `ON_AGENT_UPDATE`) and LangChain's official vocabulary (`CHAT_MODEL_START/STREAM/END`, `LLM_*`, `CHAIN_*`, `TOOL_START/END`, `RETRIEVER_*`, `PROMPT_*`).

#### C.3 `ChatModelStreamHandler` and content aggregation

`ChatModelStreamHandler` (`src/stream.ts:1512`) is the handler a host binds to `CHAT_MODEL_STREAM`. Its `handle()` (`:1515-1967`) performs, in order: stream-limit accounting (`:1584-1642`), `getChunkContent()` extraction (`:1286-1352`, provider-specific reasoning-field handling), server-tool-result short-circuit (`:1651-1659`), `handleReasoning()` token-type state machine (`:1968-2053`, `TEXT` / `THINK` / `'think_and_text'`), Google server-side tool parts (`:1682-1691`), complete `tool_calls` → `handleToolCalls` plus eager-execution prestart (`:1693-1737`), streaming `tool_call_chunks` → `handleToolCallChunks` (`:1756-1804`), and finally text/reasoning delta dispatch (`:1814-1966`).

`createContentAggregator()` (`src/stream.ts:2056-2697`) returns `{ contentParts, aggregateContent, stepMap }`. `updateContent(index, contentPart, finalUpdate?)` (`:2221-2403`) concatenates text (`:2251-2255`) and reasoning (`:2266-2271`), and merges streamed tool-call argument fragments by string concatenation until `ON_RUN_STEP_COMPLETED` supplies authoritative args (`:2335-2397`).

`src/scripts/simple.ts:34-146` is the canonical consumer wiring — `createContentAggregator()` + `customHandlers` mapping each `GraphEvents` member, passed to `Run.create`, then `run.processStream(inputs, config)` (`src/scripts/simple.ts:167`).

---

### D. Prompt construction & message formatting

#### D.1 Prompts

`src/prompts/` contains four files:

| File | Exports | Consumed by |
| --- | --- | --- |
| `src/prompts/activityLabel.ts:13` | `ACTIVITY_LABEL_PROMPT` (template literal) | `src/run.ts:49,2029` |
| `src/prompts/activityLabel.ts:134` | `buildActivityLabelPrompt()` (string concatenation → `sections.join('\n\n')`) | `src/run.ts:51,1987` |
| `src/prompts/collab.ts:2` | `supervisorPrompt` (`{members}` placeholder) | **no in-repo consumer** |
| `src/prompts/taskmanager.ts:1` | `taskManagerPrompt` + four JSON-schema constants | **no in-repo consumer** |

`src/prompts/index.ts` is not re-exported from `src/index.ts` and has no importers.

LangChain `PromptTemplate` / `ChatPromptTemplate` appears in exactly three production places, all outside the agent loop:

- `src/utils/title.ts:54-56` — `ChatPromptTemplate.fromTemplate(_titlePrompt ?? defaultTitlePrompt)` with `{convo}`.
- `src/run.ts:1697-1699` — `PromptTemplate.fromTemplate('User: {input}\nAI: {output}')`, whose rendered output becomes `{convo}`.
- `src/graphs/MultiAgentGraph.ts:1373-1377` — `PromptTemplate.fromTemplate(prompt)` with `{results}` for fan-in edges.

Everything else is template-literal interpolation: `buildSummarizationInstruction` (`src/summarization/node.ts:1474-1489`), `AgentContext.buildSummaryHumanMessage` (`src/agents/AgentContext.ts:750-774`), `buildIdentityPreamble` (`:636-658`), `buildProgrammaticOnlyToolsInstructions` (`:466-507`).

#### D.2 Message pipeline

`formatAgentMessages(...)` (`src/messages/format.ts:1491`) converts host `TPayload` messages to `BaseMessage[]`. It handles media ordering per endpoint (`formatMediaMessage`, `:60-95`), splits assistant content into `AIMessage` + synthesized `ToolMessage` pairs (`formatAssistantMessage`, `:505-887`), accumulates reasoning blocks into `additional_kwargs.reasoning_content` (`:548-572`), replays `STEER` parts as `HumanMessage`s (`:783-840`), and applies the cross-run summary boundary (`applySummaryBoundary`, `:1354-1386`). It deliberately does **not** synthesize a `SystemMessage` — that is `AgentContext`'s job (comment `:1558-1561`).

Provider wire converters:

- **Anthropic** `src/llm/anthropic/utils/message_inputs.ts` — `_formatContent()` (`:642+`), `_ensureMessageContents()` (`:301+`, merges `ToolMessage`s into `tool_result` blocks), `_convertMessagesToAnthropicPayload()` (`:1100-1218`, hoists `SystemMessage.content` to the request `system` field), `normalizeAnthropicToolCallId()` (`:123-147`, SHA-256 suffix fallback for the `^[a-zA-Z0-9_-]{1,64}$` constraint).
- **Bedrock** `src/llm/bedrock/utils/message_inputs.ts` — `convertLangChainContentBlockToConverseContentBlock()` (`:512+`), `getDefaultCachePoint()` (`:484-507`).
- **Google** `src/llm/google/utils/common.ts` — `messageContentMedia()` (`:148-167`), `convertMessageContentToParts()` (`:469+`), `convertBaseMessagesToContent()` (`:586+`).

#### D.3 Prompt caching

`src/messages/cache.ts` — `buildAnthropicCacheControl(ttl?)` (`:54-60`), `buildBedrockCachePoint(ttl?)` (`:70-74`), `DEFAULT_PROMPT_CACHE_TTL = '1h'` (`:33`). The production strategy is a **single tail breakpoint**: `addTailCacheControl()` (`:463-552`) / `addBedrockTailCacheControl()` (`:956-1061`), applied at `src/agents/AgentContext.ts:736-745`, `src/graphs/Graph.ts:3294-3327`, and `src/summarization/node.ts:1627-1631`. Legacy last-N-messages variants (`addCacheControl` `:296-382`, `addBedrockCacheControl` `:829-937`) remain exported but are not on the primary send path.

Tool-definition caching is separate: `partitionAndMarkAnthropicToolCache` (`src/messages/anthropicToolCache.ts:189-264`), `partitionAndMarkOpenRouterToolCache` (`src/llm/openrouter/toolCache.ts:78`), `partitionAndMarkBedrockToolCache` (`src/llm/bedrock/toolCache.ts:111`), all invoked from `src/graphs/Graph.ts:2339-2398`.

#### D.4 Token accounting and pruning

`src/messages/prune.ts` — `createPruneMessages(...)` (`:2049+`) returns a stateful closure. Core: `getMessagesWithinTokenLimit()` (`:785-1111`) walks newest→oldest against `maxContextTokens - instructionsTokenCount`. Constants: `REPLY_PRIMER_TOKENS = 3` (`:50`), `DEFAULT_RESERVE_RATIO = 0.05` (`:47`), `PRESSURE_THRESHOLD_MASKING = 0.8` (`:53`), `MASKED_RESULT_MAX_CHARS = 300` (`:64`). A calibration EMA (`clampCalibrationRatio`, `:103-108`, bounds `[0.5, 5]`) reconciles local counts against provider `usageMetadata`.

Separate opt-in position-based pruning lives in `src/messages/contextPruning.ts:61-198` with defaults at `src/messages/contextPruningSettings.ts:34-49` (disabled by default).

---

### E. Structured output and schema handling — the BAML-relevant surface

This is the thinnest layer in the codebase.

#### E.1 `withStructuredOutput` — one production call site

`src/utils/title.ts:42-60` (verified verbatim):

```ts
export const createTitleRunnable = async (
  model: t.ChatModelInstance,
  _titlePrompt?: string
): Promise<Runnable> => {
  /* @ts-ignore */
  const titleLLM = model.withStructuredOutput(titleSchema);
  /* @ts-ignore */
  const combinedLLM = model.withStructuredOutput(combinedSchema);

  const titlePrompt = ChatPromptTemplate.fromTemplate(
    _titlePrompt ?? defaultTitlePrompt
  ).withConfig({ runName: 'BuildTitlePrompt' });

  const titleOnlyInnerChain = RunnableSequence.from([titlePrompt, titleLLM]);
  const combinedInnerChain = RunnableSequence.from([titlePrompt, combinedLLM]);
  ...
```

`titleSchema` (`src/utils/title.ts:14-24`) and `combinedSchema` (`:26-40`) are **plain JSON-Schema object literals with `as const`**, not zod. Both `withStructuredOutput` calls carry `/* @ts-ignore */` because the JSON-Schema literal does not satisfy the overload's type. Consumed at `src/run.ts:1744` → `fullChain.invoke(...)` (`src/run.ts:1772`).

An alternative non-structured path exists in the same file: `createCompletionTitleRunnable` (`src/utils/title.ts:135-177`) uses plain `model.invoke()` plus an `extractContent` `RunnableLambda` (`:144-160`) that walks content blocks and `.trim()`s. Selected via `TitleMethod.COMPLETION` (`src/common/enum.ts:275-279`, `src/run.ts:1624,1741-1744`).

All other `withStructuredOutput` occurrences are in `.spec.ts` files: `src/llm/anthropic/llm.spec.ts:2724,2738,2955`, `src/llm/anthropic/inherited-strict.spec.ts:193,287`, `src/llm/google/llm.spec.ts:602,617`, `src/llm/openai/inherited-deepseek.spec.ts:336`. These exercise `{ method: 'functionCalling' | 'jsonSchema' | 'jsonMode' }` and `{ strict }` against zod schemas, documenting that the inherited upstream API works — but no production code uses it.

#### E.2 Zod usage and the schema helper

`src/utils/schema.ts` (verified verbatim, 36 lines) is the only file in `src/` importing `zod-to-json-schema`:

```ts
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';

export function isZodSchema(schema: unknown): schema is ZodTypeAny {          // :6
  return schema != null && typeof schema === 'object' && '_def' in (schema as object);
}

export function toJsonSchema(schema, name?, description?): Record<string, unknown> {  // :16
  if (isZodSchema(schema)) { /* describe + zodToJsonSchema */ }
  return schema as Record<string, unknown>;                                    // passthrough
}
```

Its only consumer is `src/agents/AgentContext.ts:1157-1164`, which uses it for **token-budget accounting** of tool schemas — not for constraining any LLM call.

**Dependency status**: `zod` (3.25.67) and `zod-to-json-schema` (3.25.2) appear in `package-lock.json:12782` and `:12791` but are absent from `package.json` `dependencies`, `devDependencies`, `peerDependencies`, and `overrides` — they resolve transitively through the `@langchain/*` packages.

A second, distinct zod→JSON-Schema path uses `toJsonSchema` from `@langchain/core/utils/json_schema`: `src/llm/google/utils/zod_to_genai_parameters.ts:1-71` (`schemaToGenerativeAIParameters`, strips `$schema`/`additionalProperties`/`strict`) and `src/llm/openai/llm.spec.ts:48`.

Zod-defined `tool()` schemas appear only in dev scripts and tests: `src/scripts/memory.ts:32-41`, `src/scripts/preempt-scenarios.ts:132`, `src/llm/anthropic/inherited-strict.spec.ts:8-57`, `src/specs/ask-user-question-batch.test.ts:55,65`.

#### E.3 `response_format` / `json_schema` / JSON mode

No production code sets `response_format`. The only handling is on the receive side — `src/llm/openai/utils/index.ts:1043-1049`:

```ts
} else if (chunk.type === 'response.completed') {
  const msg = _convertOpenAIResponsesMessageToBaseMessage(chunk.response);
  usage_metadata = chunk.response.usage;
  if (chunk.response.text?.format?.type === 'json_schema') {
    additional_kwargs.parsed ??= JSON.parse(msg.text);
  }
```

This is the **only** `JSON.parse` of model output text in the library, and it has no try/catch and no retry.

`src/llm/openai/llm.spec.ts:1242-1413` documents the strict-mode inference rules implemented in `src/llm/openai/index.ts:1298-1371`: a `json_schema` response format defaults per-tool `strict` to `true` for the Completions delegate (but not the Responses delegate), and `stripIntentFromStrictTools` removes the optional `intent` marker property because OpenAI strict schemas require every property to be `required`.

#### E.4 Unconstrained extraction patterns (what the codebase uses instead)

| Behavior | Prompt | Call | Extraction | Consume |
| --- | --- | --- | --- | --- |
| **Title** | `ChatPromptTemplate` `{convo}` (`src/utils/title.ts:8-12`) | `withStructuredOutput` chain (`:49,52`) | none (typed object) | `src/run.ts:1772-1776` |
| **Activity label** | `ACTIVITY_LABEL_PROMPT` + `buildActivityLabelPrompt()` (`src/prompts/activityLabel.ts:13,134`) | `model.invoke([SystemMessage, HumanMessage])` (`src/run.ts:2027-2033`) | `extractLabel()` (`src/run.ts:2036-2058`): joins text parts, `.replace(/\s+/g,' ').trim().replace(/^["']\|["']$/g,'')` | `{ label }` (`src/run.ts:2096-2097`) |
| **Summarization** | `DEFAULT_SUMMARIZATION_PROMPT` (`src/summarization/node.ts:71-120`) | `attemptInvoke(...)` (`src/summarization/node.ts:1633`) | `extractResponseText()` (`:1441-1472`): concatenates only `type === 'text'` blocks, skipping thinking/reasoning | `enrichSummary` → `buildSummaryBlock` → `agentContext.setSummary` (`:254,459,1356`) |

There is **no retry-on-parse-failure loop anywhere in `src/`**, and no regex-based JSON extraction from model text.

---

### F. Tools and function calling

#### F.1 Definition patterns — JSON Schema, not zod

Three shapes exist:

1. **Class-based `Tool`** — `src/tools/Calculator.ts:9-46` (`CalculatorSchema` literal + `class Calculator extends Tool`).
2. **`tool()` factory with JSON-Schema literal** — `src/tools/search/tool.ts:344-392` (web search, `responseFormat: Constants.CONTENT_AND_ARTIFACT`), `src/tools/local/LocalExecutionTools.ts:101-128`. Schemas are assembled from field fragments in `src/tools/search/schema.ts:41-116`.
3. **Schema-only `LCTool` stubs** — `src/tools/schema.ts:9-28` (verified verbatim):

   ```ts
   export function createSchemaOnlyTool(definition: LCTool): StructuredToolInterface {
     const { name, description, parameters, responseFormat } = definition;
     return tool(
       async () => {
         throw new Error(
           `Tool "${name}" should not be invoked directly in event-driven mode. ` +
             'ToolNode should dispatch ON_TOOL_EXECUTE events instead.'
         );
       },
       {
         name,
         description: description ?? '',
         schema: parameters ?? { type: 'object', properties: {} },
         responseFormat: responseFormat ?? 'content_and_artifact',
       }
     );
   }
   ```

   `createSchemaOnlyTools(definitions)` (`:33-37`) maps over an array; called from `src/graphs/Graph.ts:2016-2017` when `agentContext.toolDefinitions` is non-empty, which flips the graph into event-driven mode.

`LCTool` (`src/types/tools.ts:483-501`) is the registry shape: `{ name, description?, parameters?: JsonSchemaType, defer_loading?, allowed_callers?, responseFormat?, serverName?, toolType? }`.

**No file under `src/tools/` imports zod.**

#### F.2 `ToolNode`

`class ToolNode<T> extends RunnableCallable<T, T>` (`src/tools/ToolNode.ts:654`), `trace = false` (`:658`).

- `run(input, config)` (`:4253`) partitions calls into direct vs event entries (`:4541-4574`).
- Direct: `runTool` (`:1160`) → `tool.invoke(invokeParams, runtime)` (`:1387`) with a LangGraph 1.4 `ToolRuntime` shape (`:1370-1382`); wrapped by `runDirectToolWithLifecycleHooks` (`:1642`) for `PreToolUse`/`PostToolUse` hooks and approval interrupts.
- Event: `dispatchToolEvents` (`:2600`) emits a single `GraphEvents.ON_TOOL_EXECUTE` (`:3388-3421`) for the host to execute out-of-process.
- Errors (`:1490-1592`): rethrows `GraphInterrupt` and `StreamLimitExceededError`; otherwise produces an error `ToolMessage` with `status: 'error'`.
- `toolsCondition(state, toolNode, invokedToolIds)` (`:5116-5131`) is the conditional edge used at `src/graphs/Graph.ts:4436-4457`.

#### F.3 Provider tool formatting

| Provider | Converter |
| --- | --- |
| OpenAI | `_convertToOpenAITool` (`src/llm/openai/index.ts:1348-1371`), `stripIntentFromStrictTools` (`:1298-1346`) |
| Anthropic | inherited `formatStructuredToolToAnthropic`, invoked from `CustomAnthropic.invocationParams` (`src/llm/anthropic/index.ts:510-515`); `handleToolChoice` (`src/llm/anthropic/utils/tools.ts:4-35`) |
| Google | `convertToolsToGenAI` (`src/llm/google/utils/tools.ts:20-37`) — **not referenced from `src/llm/google/index.ts`**; the production class relies on upstream conversion |
| Bedrock | `openAIToBedrockTool` (`src/llm/bedrock/toolCache.ts:59+`), `insertBedrockToolCachePoint` (`:146`) |
| OpenRouter | `toOpenRouterTool` (`src/llm/openrouter/toolCache.ts:40-50`) |

#### F.4 Subagents and HITL

`buildSubagentToolParams(configs)` (`src/tools/SubagentTool.ts:57-87`) produces a runtime schema with `subagent_type.enum` populated from configured types; the executable tool is created at `src/graphs/Graph.ts:4329-4383` and tagged `SUBAGENT_REPLAY_CONTROLLER` (`:4384-4399`). `SubagentExecutor.execute` (`src/tools/subagent/SubagentExecutor.ts:1888`) builds a child `StandardGraphInput` (`:2096-2114`) and invokes a child workflow with **detached callbacks** (`:2381-2384`) — only `ON_TOOL_EXECUTE`/`ON_SUBAGENT_UPDATE` and usage cross the boundary.

`src/hitl/` contains exactly one runtime export, `askUserQuestion(question, options?)` (`src/hitl/askUserQuestion.ts:62-85`). Tool **approval** HITL lives inside `ToolNode`: `buildToolApprovalInterruptPayload` (`src/tools/ToolNode.ts:447-478`), `normalizeApprovalDecisions` (`:488-514`), single-call interrupt (`:1947-1954`), batched interrupt (`:2992-3033`). Decision kinds: `'approve' | 'reject' | 'edit' | 'respond'` (`src/types/hitl.ts:32-36`).

---

### G. Types, configuration, public API, build

#### G.1 Provider-typed maps

`src/types/llm.ts` (verified verbatim, `:170-208`):

- `ProviderOptionsMap` (`:170-183`) — `Providers` → client-options type.
- `ChatModelMap` (`:185-198`) — `Providers` → concrete class type.
- `ChatModelConstructorMap` (`:200-202`) — `{ [P in Providers]: new (config: ProviderOptionsMap[P]) => ChatModelMap[P] }`.
- `ChatModelInstance = ChatModelMap[Providers]` (`:204`), `ModelWithTools = ChatModelInstance & { bindTools(tools: CommonToolType[]): Runnable }` (`:206-208`).
- `ClientOptions` (`:141-150`) is the union of ten per-provider option types.
- `LLMConfig = SharedLLMConfig & ClientOptions & { fallbacks?: FallbackConfig[] }` (`:164-168`).

Note `ChatModelConstructorMap` is a **total** mapped type over `Providers`, while `llmProviders` is typed `Partial<ChatModelConstructorMap>` — adding an enum member does not force a map entry at compile time; the miss surfaces at runtime in `getChatModelClass` (`src/llm/providers.ts:47-49`).

#### G.2 Public API surface

`src/index.ts` re-exports 28 barrels (`:2-53`), six LangGraph symbols (`:61-69`), and an explicit LLM block (`:72-103`, verified verbatim) exporting `getChatModelClass`, `initializeModel`, `attemptInvoke`, `tryFallbackProviders`, `isThinkingEnabled`, `getMaxOutputTokensKey`, `canSealPreempt`, `CustomOpenAIClient`, `ChatOpenRouter`, `CustomChatMistralAI`, `FakeChatModel`, `createFakeStreamingLLM`, the `smoothStream` family, and the stream-limits family.

`package.json:11-77` declares 13 subpath exports (root, `./openai`, `./responses`, `./langchain`, and nine `./langchain/*` facades), each with `import`/`require`/`types` triples. `typesVersions` (`:78-93`) mirrors them.

#### G.3 Build pipeline

`config/package-entries.mjs` (verified verbatim, 15 entries) is the single source of truth for entry points, consumed by `tsdown.config.mjs:4,7` and `config/circular-deps.mjs:5,16`.

`tsdown.config.mjs` (verified verbatim):

- `dts: false` (`:12`) — declarations come from a separate `tsc -p tsconfig.build.json` pass (`package.json` `build`: `"tsdown && tsc -p tsconfig.build.json"`).
- `unbundle: true` (`:14-16`) — one output file per source module.
- `fixedExtension: true` (`:17-19`) — `.mjs` / `.cjs`.
- `alias: { '@': './src' }` (`:20`) — build-time resolution of the `@/*` alias.
- `deps.neverBundle` (`:25-28`) — nothing third-party is bundled.
- Two targets: `{ format: 'esm', outDir: 'dist/esm' }` and `{ format: 'cjs', outDir: 'dist/cjs' }` (`:32-35`).

The `@/*` alias is resolved **three separate ways**: `tsconfig.json:14-16` `paths` (typecheck/IDE), `tsdown.config.mjs:20` `alias` (build), and `jest.config.mjs:29-31` `pathsToModuleNameMapper` (test). A fourth path exists for ad-hoc scripts: the custom ESM loader `tsconfig-paths-bootstrap.mjs:19-27`.

`jest.config.mjs:28` hard-stubs `'^@langchain/mistralai$'` → `<rootDir>/test/stubs/mistralai.ts` because the real package is ESM-only and breaks Jest's CJS collection whenever a suite transitively imports `src/llm/providers.ts` (rationale comment `:13-27`).

`.gitignore` ignores `dist/`, `.turbo`, `.claude/`, `.codex/`, `.cursor/` — there is **no** `.baml` entry (the `.baml/.gitignore` file contains `*`, ignoring itself). `engines.node` is `>=24.0.0` (`package.json:109-111`); local Node is v24.16.0.

#### G.4 Environment

`.env.example` (25 lines) declares `OPENAI_API_KEY`, `MISTRAL_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `BEDROCK_AWS_REGION`/`_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY`, `LANGFUSE_PUBLIC_KEY`/`_SECRET_KEY`/`_BASE_URL`/`_FORCE_FLUSH_ON_DISPOSE`, `TAVILY_API_KEY`, `NASA_API_KEY`. Two further env vars are referenced in code but absent from the example: `LIBRECHAT_CODE_BASEURL` and `CODE_API_RUN_TIMEOUT_MS` (`src/common/enum.ts:281-284`).

---

## Code References

### The narrow waist

| Reference | Description |
| --- | --- |
| `src/llm/init.ts:18` | `initializeModel` — the single chat-model construction site |
| `src/llm/init.ts:31` | `new (getChatModelClass(provider))(clientOptions ?? ({} as never))` |
| `src/llm/init.ts:62` | `(model as t.ModelWithTools).bindTools(tools)` — the only production `bindTools` |
| `src/llm/invoke.ts:702` | `attemptInvoke` — the single model-call funnel |
| `src/llm/invoke.ts:858` | `await model.stream(messagesForProvider, streamConfig)` |
| `src/llm/invoke.ts:1042` | `await model.invoke(messagesForProvider, config)` |
| `src/llm/invoke.ts:1133` | `tryFallbackProviders` |
| `src/llm/invoke.ts:185` | `projectMessagesForProvider` — per-provider message sanitizer |
| `src/llm/providers.ts:22` | `llmProviders` — the provider→constructor map |
| `src/llm/providers.ts:43` | `getChatModelClass` |

### Orchestration

| Reference | Description |
| --- | --- |
| `src/run.ts:210` | `class Run` |
| `src/run.ts:603` | `Run.create` static factory |
| `src/run.ts:802` | `Run.processStream` — main entry |
| `src/run.ts:1024` | `graphRunnable.streamEvents(...)` |
| `src/run.ts:1084-1087` | handler dispatch loop |
| `src/graphs/Graph.ts:2402` | `initializeModel` call in `createCallModel` |
| `src/graphs/Graph.ts:3552` | `attemptInvoke` call in `createCallModel` |
| `src/graphs/Graph.ts:4227` | `createAgentNode` — inner agent subgraph |
| `src/graphs/Graph.ts:4641` | `createWorkflow` — outer StateGraph |
| `src/graphs/MultiAgentGraph.ts:753` | `createAgentSubgraph` → `createAgentNode` |
| `src/agents/AgentContext.ts:59` | `AgentContext.fromConfig` |
| `src/agents/AgentContext.ts:931` | `buildSystemMessage` — the only `new SystemMessage(...)` |
| `src/agents/AgentContext.ts:1753` | `getToolsForBinding` |

### Streaming

| Reference | Description |
| --- | --- |
| `src/stream.ts:1512` | `ChatModelStreamHandler` |
| `src/stream.ts:2056` | `createContentAggregator` |
| `src/stream.ts:1286` | `getChunkContent` |
| `src/llm/stream/smoother.ts:196` | `smoothStream` pacing engine |
| `src/llm/stream/chunkAdapters.ts:287` | `smoothGenerationChunks` |
| `src/events.ts:13` | `HandlerRegistry` |
| `src/common/enum.ts:7-85` | `GraphEvents` enum |

### Schema / structured output

| Reference | Description |
| --- | --- |
| `src/utils/title.ts:49,52` | the only production `withStructuredOutput` calls |
| `src/utils/title.ts:14-40` | `titleSchema` / `combinedSchema` JSON-Schema literals |
| `src/utils/schema.ts:16` | `toJsonSchema` (zod-or-passthrough) — *corrected from an initial `:11` citation* |
| `src/utils/schema.ts:6` | `isZodSchema` |
| `src/tools/schema.ts:9` | `createSchemaOnlyTool` |
| `src/types/tools.ts:483` | `LCTool` registry shape |
| `src/llm/openai/utils/index.ts:1048` | the only `JSON.parse` of model output |
| `src/run.ts:2036-2058` | `extractLabel` — whitespace/quote normalization |
| `src/summarization/node.ts:1441-1472` | `extractResponseText` — content-block concatenation |

### Types / config / build

| Reference | Description |
| --- | --- |
| `src/common/enum.ts:87-100` | `Providers` enum, 12 members |
| `src/types/llm.ts:170-202` | `ProviderOptionsMap` / `ChatModelMap` / `ChatModelConstructorMap` |
| `src/index.ts:72-103` | explicit LLM public exports |
| `config/package-entries.mjs:1-16` | build entry-point manifest |
| `tsdown.config.mjs:12,14,20` | `dts:false`, `unbundle:true`, `alias {'@':'./src'}` |
| `jest.config.mjs:28-31` | mistralai stub + `@/*` mapping |
| `package-lock.json:12782,12791` | `zod@3.25.67`, `zod-to-json-schema@3.25.2` (transitive only) |

---

## Architecture Documentation

Patterns and conventions observed in the current implementation:

1. **Narrow-waist funnel.** Two functions (`initializeModel`, `attemptInvoke`) mediate 100% of LLM traffic, and both are explicitly documented as such in-source. Every feature that needs to affect every model call (prompt caching, message projection, stream limits, fallbacks, Langfuse scoping, usage capture) is implemented at one of these two points.

2. **Provider differences live in subclasses, not in branches at the call site.** The library extends LangChain chat models rather than wrapping them, and confines wire-format quirks to `invocationParams` / `_streamResponseChunks` overrides. The exceptions — the six-way `projectMessagesForProvider` branch (`src/llm/invoke.ts:198-262`) and provider `Set`s (`manualToolStreamProviders`, `strictAlternationProviders`) — handle cross-message-shape concerns the subclass boundary cannot reach.

3. **Model instances are per-turn, never cached.** `initializeModel` runs on every model turn inside the graph node (`src/graphs/Graph.ts:2402`); the only reuse mechanism is the explicit `override` parameter.

4. **JSON Schema object literals over zod.** Tool parameters, title schemas, and `LCTool` registry entries are all plain `as const` object literals. `zod` support exists only as a passthrough branch in `src/utils/schema.ts:21-33` and in test fixtures.

5. **Output is streamed as events, not returned as values.** The public contract is `EventHandler` objects registered on `Run.create({ customHandlers })`, folded into `contentParts` by `createContentAggregator`. There is no request/response API on the package surface.

6. **Prompt assembly is string concatenation with cache-boundary discipline.** The stable/dynamic instruction split (`src/agents/AgentContext.ts:602-630`) exists specifically so the cacheable prefix is not invalidated by per-turn text.

7. **Text extraction over schema constraint.** Where a typed value is needed from the model, the codebase overwhelmingly walks `response.content` blocks and normalizes strings rather than constraining generation.

8. **Everything is a LangChain `Runnable`.** The system prompt is a `RunnableLambda` piped in front of the model; tools are `StructuredToolInterface`; the graph is a compiled LangGraph `StateGraph`. Any new call path must produce something `.pipe()`-able and `.stream()`-able to participate.

---

## Integration Seams (as they exist today)

Factual enumeration of the extension points present in the code — not recommendations.

**To register a new provider** (the seams a `Providers.BAML`-style entry would touch):

| Seam | Location |
| --- | --- |
| Enum member | `src/common/enum.ts:87` |
| Constructor map entry | `src/llm/providers.ts:22` |
| `ProviderOptionsMap` entry | `src/types/llm.ts:170` |
| `ChatModelMap` entry | `src/types/llm.ts:185` |
| `ClientOptions` union member | `src/types/llm.ts:141` |
| Optional: `isOpenAILike`/`isGoogleLike`/`isAnthropicLike` | `src/utils/llm.ts:4,19,29` |
| Optional: `manualToolStreamProviders` | `src/llm/providers.ts:38` |
| Optional: `strictAlternationProviders` | `src/messages/alternation.ts:16` |
| Optional: `getMaxOutputTokensKey` branch | `src/llm/request.ts:49` |
| Optional: `isThinkingEnabled` branch | `src/llm/request.ts:9` |
| Optional: `projectMessagesForProvider` branch | `src/llm/invoke.ts:198-262` |

The contract such a class must satisfy is `ChatModelConstructorMap[P]` — a single-argument constructor plus, at minimum, `.bindTools()` (`src/types/llm.ts:206-208`), `.invoke()`, and `.stream()` (`src/llm/invoke.ts:858,1042`). Streaming participation additionally requires emitting `AIMessageChunk`s that `getChunkContent` (`src/stream.ts:1286`) can read.

**To add a discrete typed-output call** (the seams a standalone BAML function would touch), the two existing precedents are:

| Precedent | Pattern |
| --- | --- |
| `Run.generateTitle` (`src/run.ts:1616`) | `initializeModel` (no tools) → `createTitleRunnable` → `withStructuredOutput` → `RunnableSequence.invoke` |
| `Run.generateActivityLabel` (`src/run.ts:1812`) | `initializeModel` (no tools, `streaming: false`) → `model.invoke([SystemMessage, HumanMessage])` → manual `extractLabel` |

Both are methods on `Run` that bypass the graph entirely, are exported through `src/index.ts:2` (`export * from './run'`), and take `provider` + `clientOptions` directly rather than reading `AgentContext`.

**Build-pipeline seams a generated-code directory would touch**: `config/package-entries.mjs:1` (entry manifest), `package.json:11` (`exports` map), `tsconfig.json:14-16` / `tsdown.config.mjs:20` / `jest.config.mjs:29-31` (the three `@/*` alias resolutions), `tsconfig.build.json:12-20` (declaration-pass excludes), `eslint.config.mjs:8-18` (`globalIgnores`), and `.gitignore` (currently has no `.baml` or generated-client entry).

---

## Workflow Closure Map

**Behavior mapped**: *A conversation turn submitted to `Run.processStream` reaches a provider LLM and its streamed output becomes assistant content parts the host can read from its content aggregator.*

This is the belt any change to the LLM interface — including routing a call through a BAML-generated function — would have to keep closed.

### Nodes and edges

| # | Node | Module | Production registration | Label | Depth |
| --- | --- | --- | --- | --- | --- |
| 0 | `graph-message-state` (SOURCE) | `src/messages/reducer.ts` | `messagesStateReducer` wired as the `messages` channel reducer at `src/graphs/Graph.ts:4644-4656` and `:4459-4471` | `production-called` | 0 |
| 1 | `run-process-stream` (ENTRYPOINT) | `src/run.ts` | `Run.create` (`src/run.ts:603`) → `processStream` (`:802`); callers `src/run.ts:1442` (resume), `src/scripts/simple.ts:167` | `production-called` | 1 |
| 2 | `agent-node-call-model` | `src/graphs/Graph.ts` | node `agent=<id>` added in `createAgentNode` (`:4489`), compiled by `createWorkflow` (`:4641`), mounted by `Run.createLegacyGraph` (`src/run.ts:381`) / `createMultiAgentGraph` (`:419`) | `production-called` | 2 |
| 3 | `provider-model-call` | `src/llm/invoke.ts` | `attemptInvoke` (`:702`) called at `src/graphs/Graph.ts:3552`; model built by `initializeModel` (`src/llm/init.ts:18`) at `src/graphs/Graph.ts:2402` | `production-called` | 3 |
| 4 | `chat-model-stream-handler` | `src/stream.ts` | `ChatModelStreamHandler` (`:1512`) registered by the host into `HandlerRegistry` via `Run.create({ customHandlers })` (`src/run.ts:266-276`); dispatched at `src/run.ts:1084-1087` | `production-called` | 4 |
| 5 | `content-aggregator` (OBSERVABLE) | `src/stream.ts` | `createContentAggregator` (`:2056`), consumer wiring at `src/scripts/simple.ts:34` | `production-called` | 5 |

| Edge | Producer → Consumer | Async | Cross-boundary | Contract / runtime context | Error behavior | Tests exercising this exact edge |
| --- | --- | --- | --- | --- | --- | --- |
| 0→1 | state seeded into `processStream(inputs)` — `src/run.ts:802` | no | no | `t.IState = { messages: BaseMessage[] }` (`src/types/graph.ts:75`); ids auto-assigned by `messagesStateReducer` (`src/messages/reducer.ts:62-118`) | none — direct argument | `src/specs/azure.simple.test.ts` |
| 1→2 | `graphRunnable.streamEvents(...)` — `src/run.ts:1024` → compiled node | no (drained by the `for await` loop at `src/run.ts:1037-1115`) | yes (graph compile/mount boundary) | `RunnableConfig` carries `runId`, callbacks, Langfuse handler (`src/run.ts:912-972`), `recursionLimit` (`:838-840`) | `raiseError: true`; `GraphInterrupt` detected via `isInterrupted(data.chunk)` (`:1059-1082`); hook halt breaks the loop (`:1110-1114`) | `src/specs/durability-checkpoint.integration.test.ts:145,149,212,221,233` |
| 2→3 | `attemptInvoke(...)` — `src/graphs/Graph.ts:3552` | no | no | `{ model, messages, provider, context }`; messages already pruned, sanitized, cache-marked | `catch (primaryError)` at `src/graphs/Graph.ts:3562` → context-overflow recovery / `tryFallbackProviders` (`src/llm/invoke.ts:1133`) | `src/graphs/__tests__/Graph.breakerLifecycle.test.ts:157,191` |
| 3→4 | `model.stream(...)` (`src/llm/invoke.ts:858`) chunks surface as LangChain `on_chat_model_stream` events, dispatched at `src/run.ts:1084-1087` | no | yes (callback/handler registration boundary) | `AIMessageChunk`; `usage_metadata` kept only on the first split piece (`src/llm/stream/chunkAdapters.ts:15-35`) | `StreamLimitExceededError` rethrown (`src/tools/ToolNode.ts:1495-1505`); stream-limit breaker at `src/stream.ts:1584-1642` | `src/llm/invoke.test.ts` (~25 sites), `src/llm/invoke.streamLimits.test.ts:108,129` |
| 4→5 | `ChatModelStreamHandler` dispatches `ON_MESSAGE_DELTA`/`ON_REASONING_DELTA`/`ON_RUN_STEP*` (`src/stream.ts:1814-1966`) → host handler calls `aggregateContent` | no | yes (host-supplied handler) | `t.MessageDeltaEvent` / `t.RunStep` / `t.RunStepDeltaEvent` (`src/types/stream.ts:52-277`) | tool-call args stay provisional until `ON_RUN_STEP_COMPLETED` supplies authoritative args (`src/stream.ts:2335-2397`) | `src/stream.test.ts`, `src/stream.dispatch.test.ts`, `src/aggregator.test.ts` |

**Negative-evidence pass.** The Semgrep closure mapper (`retrieval: "semgrep"`, no errors) returned `production-called` for all seven load-bearing symbols with **zero test-only callers**: `initializeModel` (5 prod callers), `attemptInvoke` (3), `createWorkflow` (2), `processStream` (2), `createContentAggregator` (1), `createTitleRunnable` (1), `createSchemaOnlyTool` (1). No `unmounted` or `not-found` verdicts. Tests that bypass the chain do exist and are labelled as such: `src/llm/invoke.test.ts` injects a mocked `model` object directly into `attemptInvoke` (bypassing `initializeModel` and the graph), and `src/graphs/__tests__/Graph.contextOverflow.test.ts` / `src/llm/__tests__/fallbackOverflow.test.ts` mock the `initializeModel` module (bypassing real construction).

**`highest_new_connector`**: none. This pass is documentation-only — no node is being added or changed, so every `adds_or_changes` below is `false` and `derive()` will bound the trigger at the entrypoint node.

### ClosureMap (structured — derive() input)

```json
{
  "behavior": "A conversation turn submitted to Run.processStream reaches a provider LLM and its streamed output becomes assistant content parts the host reads from its content aggregator.",
  "git_commit": "1256cdcb060639b64cdd03891c98702acff1ac6e",
  "repo": "/home/maceo/Dev/silmari-chat-agents",
  "nodes": [
    { "id": "graph-message-state",       "module": "src/messages/reducer.ts", "is_entrypoint": false, "adds_or_changes": false, "read_path": null,                      "seedable_store": "messagesStateReducer" },
    { "id": "run-process-stream",        "module": "src/run.ts",              "is_entrypoint": true,  "adds_or_changes": false, "read_path": null,                      "seedable_store": null },
    { "id": "agent-node-call-model",     "module": "src/graphs/Graph.ts",     "is_entrypoint": false, "adds_or_changes": false, "read_path": null,                      "seedable_store": null },
    { "id": "provider-model-call",       "module": "src/llm/invoke.ts",       "is_entrypoint": false, "adds_or_changes": false, "read_path": null,                      "seedable_store": null },
    { "id": "chat-model-stream-handler", "module": "src/stream.ts",           "is_entrypoint": false, "adds_or_changes": false, "read_path": null,                      "seedable_store": null },
    { "id": "content-aggregator",        "module": "src/stream.ts",           "is_entrypoint": false, "adds_or_changes": false, "read_path": "createContentAggregator", "seedable_store": null }
  ],
  "edges": [
    { "is_async": false, "cross_boundary": false, "driver": null },
    { "is_async": false, "cross_boundary": true,  "driver": null },
    { "is_async": false, "cross_boundary": false, "driver": null },
    { "is_async": false, "cross_boundary": true,  "driver": null },
    { "is_async": false, "cross_boundary": true,  "driver": null }
  ]
}
```

Every named symbol resolves at this commit: `messagesStateReducer` (`src/messages/reducer.ts:62`), `createContentAggregator` (`src/stream.ts:2056`, Semgrep-verified). No edge is `is_async`, so no `driver` is required — `processStream`'s `for await` loop (`src/run.ts:1037-1115`) fully drains the graph stream before returning, and every handler dispatch inside it is awaited (`src/run.ts:1086`).

### Closure adapter (staged proposal — `2026-08-09-13-21-llm-interface-baml-integration.closure-adapter.py`)

Staged read-only as a sibling file next to this document. It is **not** wired into the repo, not imported, and not registered. Promotion is a separate, deliberate step.

```python
"""Closure adapter (STAGED PROPOSAL — not wired into the repo).
Derived from the ClosureMap for: a conversation turn submitted to Run.processStream
reaches a provider LLM and its streamed output becomes assistant content parts.
Pin: 1256cdcb060639b64cdd03891c98702acff1ac6e.
Promote into /home/maceo/Dev/silmari-chat-agents and complete each TODO(promote) before use.
Speaks the 7-op contract apps/closure-oracle already talks to (mock_adapter.py).
"""
import http.server, json, sys
ASYNC_EDGES = []                                   # no is_async edges in this map
CONNECTOR = {e: True for e in ASYNC_EDGES}
SINK = []                                          # Phase-0 /seed_sink target

def handle(op, p):
    if op == "/reset":         SINK.clear(); CONNECTOR.update({e: True for e in ASYNC_EDGES}); return {"ok": True}
    if op == "/set_connector": CONNECTOR[p["edge"]] = p["enabled"]; return {"ok": True}
    if op == "/seed_sink":     SINK.append(p["value"]); return {"ok": True}
    if op == "/seed":
        # TODO(promote): seed the graph `messages` channel via messagesStateReducer with p["data"]
        #                (src/messages/reducer.ts:62; channel wired at src/graphs/Graph.ts:4644)
        return {"ok": True}
    if op == "/trigger":
        # TODO(promote): call Run.processStream(p["args"])   (src/run.ts:802; factory src/run.ts:603)
        return {"ok": True}
    if op == "/drive":
        if not CONNECTOR.get(p["edge"], True): return {"ok": True}   # oracle disabled = red-at-seam
        # No async edges in this map — processStream drains its own stream (src/run.ts:1037-1115).
        return {"ok": True}
    if op == "/observe":
        # TODO(promote): return json.dumps(createContentAggregator().contentParts)  (src/stream.ts:2056)
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

---

## Historical Context (from thoughts/)

No `thoughts/` directory existed at this commit — it was created by this research pass. There are no prior research documents, plans, or notes to draw on.

The repository's own in-tree documentation was read directly instead:

- `AGENTS.md` — project overview, code style (never-nesting, no `any`, import ordering), dependency-management policy, testing philosophy ("real logic over mocks"), and the **Langfuse Trace Shaping** section (`AGENTS.md:122-157`), which states that trace quality is a product feature and that *"any change that touches graphs, node naming, callbacks, tool execution, message serialization, streaming, or providers must keep traces well-shaped."* Its invariants include stable operation-describing span names (`agent`, `tool-dispatch`, `llm` — never provider class names), correct observation types (LLM calls are `generation`s), and per-provider usage/cost accuracy.
- `CONTEXT.md` — a 44-line domain glossary for Durable Subagent Execution (Execution Record, Invocation Binding, Effective Definition Binding, Resume Projection).
- `CLAUDE.md` — one line, delegating to `AGENTS.md`.

## Related Research

None. This is the first document in `thoughts/searchable/shared/research/`.

## Open Questions

1. **Which BAML integration shape is intended** — a new `Providers` entry backed by a BAML-generated client (touching the seams in [Integration Seams](#integration-seams-as-they-exist-today)), or standalone BAML functions called alongside the graph in the style of `generateTitle` / `generateActivityLabel`? The two touch disjoint sets of files.
2. **Streaming participation.** BAML's TS bridge output would need to emit `AIMessageChunk`s readable by `getChunkContent` (`src/stream.ts:1286`) and paced through `smoothStream` to participate in the existing event contract. Whether that is in scope is not determinable from the code.
3. **Where BAML-generated code would live relative to the build.** `config/package-entries.mjs` is a frozen literal manifest, `tsdown` runs with `unbundle: true` and `deps.neverBundle` for anything non-relative, `dts` comes from a separate `tsc` pass that excludes `src/scripts/**` and `src/specs/**`, and `.gitignore` has no entry for generated clients. No existing generated-code directory exists to model on.
4. **The undeclared zod dependency.** `src/utils/schema.ts:2-3` imports `zod-to-json-schema` and `zod` types, neither of which is declared in `package.json`; both resolve transitively via `@langchain/*`. Whether that is intentional is not recorded anywhere in the repo.
5. **`convertToolsToGenAI`** (`src/llm/google/utils/tools.ts:20`) has no in-repo consumer — `CustomChatGoogleGenerativeAI` relies on upstream conversion instead. Its intended role is not documented.
6. **`src/prompts/collab.ts` and `src/prompts/taskmanager.ts`** export prompts and JSON-schema function definitions with no importers anywhere in `src/`, and `src/prompts/index.ts` is not re-exported from the package root.
7. **`node_modules/` is not installed** in the working tree at this commit, so nothing in this document was verified by executing the library — all findings are from source reading, Semgrep structural verification, and the lockfile.
