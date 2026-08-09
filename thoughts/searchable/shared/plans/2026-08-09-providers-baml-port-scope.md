---
date: 2026-08-09T14:05:00-04:00
researcher: tha-hammer
git_commit: 1256cdcb060639b64cdd03891c98702acff1ac6e
branch: main
repository: silmari-chat-agents (@librechat/agents v3.4.3)
topic: "Scope: Providers.BAML port into @librechat/agents"
tags: [plan, scope, baml, providers, llm, packaging]
status: scope-only
last_updated: 2026-08-09
last_updated_by: tha-hammer
---

# Scope: `Providers.BAML` port into `@librechat/agents`

Scope only — no implementation. Grounded in
[the LLM-interface research](../research/2026-08-09-13-21-llm-interface-baml-integration.md)
and the verified spike in `../silmari-chat/scripts/baml-toolloop/` (35 offline checks).

## Two things to decide before anything is built

**1. There is a packaging blocker that outranks every tool-calling problem.**

`@boundaryml/baml-bridge@0.15.0` is ESM-only — `exports` has `import`, no `require`:

```
$ node -e "require('@boundaryml/baml-bridge')"
ERR_PACKAGE_PATH_NOT_EXPORTED
```

`@librechat/agents` ships **dual CJS + ESM** (`tsdown.config.mjs:32-35` →
`dist/cjs/**/*.cjs`), and the natural place to register a provider —
`src/llm/providers.ts:22` — statically imports every provider class. Adding
`ChatBAML` there pulls an un-`require`-able package into the CJS build *and* into
every Jest suite. `AGENTS.md:28` forbids dynamic imports as the escape hatch.

This repo has already been bitten by exactly this shape and documented it at
`jest.config.mjs:12-27` (`@mistralai/mistralai`), including why transforming
doesn't help: *"Node decides module kind from the package's `type` field."* That
workaround is a test-time stub — it does nothing for the shipped CJS output.

The bridge also carries 8 platform-specific native binaries as
`optionalDependencies` (`baml-bridge-{darwin,linux,win32}-*`).

**2. Nothing meaningful is "traded away."** An earlier draft of this scope claimed
the port sacrificed tool-call ids, streamed tool deltas, prompt caching, and
reasoning blocks. That was asserted, not tested. All four were then checked
against toolchain 0.15.0 with live local capture/SSE servers, and the claim does
not hold:

| Claim | Verdict | Evidence |
|---|---|---|
| Streamed tool deltas lost | **Wrong** | works, and is *better* than the raw-string deltas other providers give — see below |
| Reasoning blocks lost | **Wrong** | an extended-thinking block streams through and the typed value parses cleanly; the thinking *text* is simply not surfaced by the generated stream API |
| Prompt caching lost | **Overstated** | `PrimitiveClientOptions` declares `headers` and `request_body` — exactly the hatches for beta flags and `cache_control`; they are declared-but-unplumbed on 0.15.0, a bug class, not a design exclusion |
| Native tool-call ids lost | **Overstated** | no provider-assigned id, true; correlation is unaffected and ids are synthesized host-side anyway (`uuid` is already a dependency) |

Streaming tool calls, captured live from a local SSE server:

```
partial 3: [{"tool":"get_weather","city":null}]                    <- tool known, args pending
partial 4: [{"tool":"get_weather","city":"Bosto"}]                 <- args arriving
partial 5: [{"tool":"get_weather","city":"Boston"}]                <- first complete
partial 6: [..., {"tool":"web_search","query":null}]               <- second begins
partial 8: [..., {"tool":"web_search","query":"baml"}]             <- both complete
```

These are *typed, already-merged* partials. `handleToolCallChunks`
(`src/stream.ts:1756-1804`) currently has to accumulate raw argument strings and
reconcile cumulative-vs-delta provider quirks via `mergeToolCallArgsText`; BAML
hands it structure directly. **Phase 3 is the easiest phase, not the riskiest.**

What the wire probe actually found (all on 0.15.0, all live-captured):

- `headers` in client options never reach the request — `anthropic-beta` absent.
- `request_body` is emitted as a **literal nested `request_body` key** rather than
  merged into the top-level body, so it cannot yet carry `tools`, `tool_choice`,
  `thinking`, or `cache_control`.
- `Collector` exposes `logs`/`last`/`usage`/`clear`/`id` — the Langfuse feed
  exists — but codegen does not expose `collectors` in `$opts`
  (`unknown optional argument "collectors"`), even though the low-level
  `callFunction(rt, fn, kwargs, ctx, collectors, callCtx)` accepts it.
- The generated **sync** functions block the Node event loop: a `$stream` driven
  in the same process as an in-process HTTP server deadlocks. `_async` variants
  exist for every companion and are what this library must use throughout.

So the real risk is not capability loss. It is that several intended seams —
`request_body`, `headers`, `collectors`, `$types` on the request path — are
declared but not yet plumbed on 0.15.0. That is one coherent class of upstream
gap, and it moves together.

Neither point is a refusal; both are decisions that belong to you. The scope
below assumes you proceed.

---

## Phase 0 — Packaging seam (blocking, small)

Goal: let a `ChatBAML` exist without dragging an ESM-only dependency into the CJS
build or the default test run.

| Change | File | Note |
|---|---|---|
| Add `registerChatModel(provider, ctor)` | `src/llm/providers.ts:22` | surgical: `llmProviders` and `getChatModelClass` keep their current shape; the map becomes writable through one function |
| Add `BAML = 'baml'` | `src/common/enum.ts:87` | |
| New **ESM-only** subpath entry `./baml` | `config/package-entries.mjs:1`, `package.json:11` | omit the `require` condition deliberately — mirrors the existing 13-subpath pattern |
| `@boundaryml/baml-bridge` as **optional peerDependency** | `package.json:261` | precedent: `@anthropic-ai/sandbox-runtime` is already an optional peer |
| Keep it out of the default Jest run | `jest.config.mjs` | BAML suites opt in, like `test:live:handoffs` |

The host (`silmari-chat`, ESM) then does `import '@librechat/agents/baml'` and the
provider registers itself. Nothing in the root barrel references BAML.

**Exit criteria:** `npm run build` emits both CJS and ESM with no BAML import in
`dist/cjs/**`; `npx jest` passes without the bridge installed.

---

## Phase 1 — Tool-schema codegen (the largest new machinery)

BAML tools must exist in `.baml` at build time. `getToolsForBinding()`
(`src/agents/AgentContext.ts:1753`) returns runtime tools whose schemas are
JSON-Schema objects (`LCTool.parameters`, `src/types/tools.ts:483`).

Required: a build step that emits `.baml` classes from the tool registry, then
runs `baml generate`.

Constraints the spike already pinned:

| Constraint | Consequence for codegen |
|---|---|
| Rendered schema carries **no type names** | every emitted class needs a literal `tool: "<name>"` discriminator |
| A `type` alias as an LLM return type breaks `$parse` (`Unknown type alias: …$stream`) | the union must be **inlined** in the signature |
| A bare top-level union can't be parsed (`Unions must be flattened`) | use the list form `(A \| B \| C)[]` |
| `$types` binds only on `$parse`, not the request path | the **superset** is compile-time; `$types` narrows per turn |

**Unaudited:** which JSON-Schema constructs BAML can express. `oneOf`/`anyOf`,
`$ref`, `additionalProperties`, deep nesting, and `enum` on non-strings all need
a coverage pass against the real tool set (`src/tools/search/schema.ts`,
`src/tools/CodeExecutor.ts`, plus every MCP tool).

**Hard limit:** MCP tools discovered at runtime cannot enter the union. Sites
that grow the tool set mid-run — `markToolsAsDiscovered`, `defer_loading`,
`toolRegistry` — degrade to "declared superset only."

> If upstream fixes the `output_format.rs:608` panic
> (`TypeVar("T") should not reach output_format`), this entire phase collapses
> into a `$types` binding and the runtime limitation disappears. Worth filing
> first — `runtime-union-probe.mjs` R5 is a three-line repro.

---

## Phase 2 — The `ChatBAML` class

Unlike every other entry in `llmProviders`, there is no upstream LangChain class
to subclass — this extends `BaseChatModel` directly and implements everything.

| Method | Work |
|---|---|
| `constructor(clientOptions)` | single-arg, per `src/llm/init.ts:31`; map to BAML client options |
| `bindTools(tools)` | store bound tools; compute the per-turn `$types` subset |
| `_generate` | flatten messages → call `SelectTools`/`AnswerWithTools` → synthesize `AIMessage` |
| `_streamResponseChunks` | drive `$parse_stream`; pipe through `smoothStream` like every other provider |

**Message flattening is lossy and needs a defined projection.** BAML takes typed
scalars; `baml.llm.PromptMessage` is `{ role: string, content: string }`. LangChain
messages carry `tool_use` / `tool_result` / `thinking` / `image_url` /
`cache_control` blocks (`src/types/stream.ts:400-423`). The spike's
`build_transcript(names[], args[], results[])` is the proven shape — primitives
only, because arrays of class instances lower to maps and panic.

**Tool-call ids must be synthesized.** BAML returns a typed value with no call id;
`ToolNode` and `toolsCondition` (`src/tools/ToolNode.ts:5116`) key on
`tool_calls[].id`, and Anthropic-style id constraints apply downstream
(`normalizeAnthropicToolCallId`).

**Dispatch happens host-side.** A host value passed into a union-typed BAML
parameter coerces into the first variant and throws
(`Missing field 'city' in external Instance`) — read the literal discriminator in
TypeScript instead.

---

## Phase 3 — Streaming and events

The library's output contract is events, not return values. Chunks must satisfy:

- `getChunkContent` (`src/stream.ts:1286`) — text/reasoning extraction
- `handleToolCallChunks` (`src/stream.ts:1756-1804`) — incremental `tool_call_chunks`
- `ModelEndHandler` (`src/events.ts:76-91`) — `usage_metadata` on the terminal event

BAML side: driven and **verified** against a live SSE server. `$stream` yields
typed, already-merged partials (`{"tool":"get_weather","city":null}` →
`"Bosto"` → `"Boston"`), so the adapter *simplifies* into
`handleToolCallChunks` rather than fighting it. Usage comes from `Collector`
(`logs`/`last`/`usage`) and `StreamAccumulator`
(`input_tokens`/`output_tokens`/`model`/`finish_reason`).

Two real constraints: codegen does not expose `collectors` in `$opts` on 0.15.0,
and the **sync** companions block the event loop — use `_async` throughout.

**This phase is now the lowest-risk of the three,** not the highest.

---

## Phase 4 — Cross-cutting integration

| Concern | Site |
|---|---|
| Langfuse: `generation` observation, model name, accurate usage/cost | `AGENTS.md:122-157` — non-negotiable, "trace quality is a product feature" |
| `projectMessagesForProvider` branch | `src/llm/invoke.ts:198-262` |
| Tool-schema token accounting | `src/agents/AgentContext.ts:1157` |
| Prompt caching | `src/messages/cache.ts` — blocked only by the unplumbed `request_body`/`headers` hatches, not by design |
| Fallbacks, stream limits, preemption/seals, overflow recovery | `src/llm/invoke.ts`, `src/llm/streamLimits.ts`, `src/llm/preempt.ts` |
| Optional provider-gated sets | `manualToolStreamProviders`, `strictAlternationProviders`, `isOpenAILike`, `getMaxOutputTokensKey`, `isThinkingEnabled` |

---

## Effort

**E4–E5.** Phases 1–3 are the bulk: roughly 1,500–2,500 LOC of new source plus a
codegen build step, against a provider contract that 11 existing classes satisfy
only by inheriting from upstream LangChain packages.

Phase 0 is small and independently useful — the `registerChatModel` seam benefits
any out-of-tree provider, ESM-only or not.

## Spike before committing

1. ~~Drive `$parse_stream` end to end~~ — **done**, it works (see above).
2. **File the `output_format.rs:608` panic** and see if it lands. A fix removes
   the entire compile-time-superset limitation.
3. **Audit JSON Schema → BAML coverage** across the real tool set.
4. **Confirm BAML's provider layer** covers the models this library serves
   (`baml.llm` has Anthropic/Azure/Google/Vertex/Bedrock options; OpenRouter,
   xAI, DeepSeek, Moonshot, Mistral are unverified).

## Recommendation

Do Phase 0 and spike #1 and #2 first — together they are a few days, and #2 could
change the entire shape of Phases 1–3. Do not start Phase 1 until the panic's
status is known, because a fix makes most of that phase unnecessary.
