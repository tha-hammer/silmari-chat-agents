---
date: 2026-08-16T12:24:01-04:00
researcher: GoldStream
git_commit: 2b41826d40d36af36c43150af497f8c1ebfe57aa
branch: claude-agent-sdk-2026-08-16-12-13
repository: claude-agent-sdk-2026-08-16-12-13
bead: AF-t37e
topic: Claude Agent SDK result model metadata propagation
tags: [research, claude-agent-sdk, usage, context-window]
status: complete
---

# AF-t37e: Claude Agent SDK result model metadata propagation

## Research question

Where does `SDKResultMessage.modelUsage` become LangChain message metadata, which
consumers observe it, and how can `contextWindow`, `maxOutputTokens`, and
`canonicalModel` be preserved without guessing which record entry represents
the main agent when a result contains more than one model?

## Summary

`ChatClaudeAgentSDK` currently reduces every `modelUsage` entry to aggregate
token counts and independently creates terminal response metadata containing
only session, turn, and cost fields. The SDK's installed type exposes the three
missing model fields on each `ModelUsage`, but the terminal result has no
contracted primary-model field and `modelUsage` is an unordered semantic set.

The production stream does expose the identity needed to resolve the main
entry: every main-loop `SDKAssistantMessage` carries the serving model in
`message.model`. The safe implementation is therefore to remember the latest
main-loop assistant model, select the exact keyed `modelUsage` entry (or an
entry whose `canonicalModel` matches), and fall back only when `modelUsage`
contains exactly one entry. If multiple entries remain ambiguous, aggregate
token counts as today but omit the singular model/limit fields rather than
publishing a subagent's limits.

The selected values need to be attached to both `usage_metadata` and
`response_metadata`: the agents library's `ModelEndHandler` collects only
`usage_metadata`, while its independent metadata aggregator collects
`response_metadata`. This keeps both established downstream paths lossless and
lets the sibling `silmari-chat` repository wire the fields later without any
changes here beyond the provider adapter.

## Current architecture and behavior

### SDK contract

The direct dependency is `@anthropic-ai/claude-agent-sdk@0.3.233`. Its installed
`ModelUsage` requires `contextWindow` and `maxOutputTokens`, and optionally
provides `canonicalModel`; the documentation says the canonical value may
differ from the raw record key because it is the pricing-lookup identifier
(`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1267-1283`). Both success
and error terminal result variants carry `modelUsage: Record<string,
ModelUsage>` (`sdk.d.ts:4529-4557`, `:4561-4600`). Neither variant identifies a
primary entry or specifies ordering semantics.

### Translation path

1. `_streamResponseChunks` iterates the SDK `Query` and recognizes main-loop
   assistant messages using `parent_tool_use_id == null`
   (`src/llm/claudeAgentSdk/ChatClaudeAgentSDK.ts:544-554`,
   `src/llm/claudeAgentSdk/messages.ts:36-41`).
2. Main-loop assistant messages are converted to `AIMessageChunk`s, but their
   per-message usage is intentionally not copied because terminal
   `modelUsage` is authoritative (`src/llm/claudeAgentSdk/messages.ts:68-101`).
3. On terminal success, `usageMetadataFromResult` and
   `responseMetadataFromResult` are called, then attached to the terminal
   `AIMessageChunk` (`ChatClaudeAgentSDK.ts:564-582`).
4. `usageMetadataFromResult` enumerates every entry, sums only input/output
   token counts, and drops all per-model limit/identity fields
   (`src/llm/claudeAgentSdk/usage.ts:19-39`).
5. `responseMetadataFromResult` returns only `session_id`, `num_turns`, and
   `total_cost_usd` (`usage.ts:41-50`).
6. The stream assembly path concatenates chunks and preserves their message
   metadata (`src/llm/invoke.ts:1003-1021`). `ModelEndHandler` subsequently
   collects only `data.output.usage_metadata` (`src/events.ts:67-91`), while
   `createMetadataAggregator` collects `message.response_metadata`
   (`src/events.ts:211-235`).

### Existing tests and seams

- `fakeQuery` implements the real SDK `Query` async-iteration contract and
  scripts messages without mocking SDK internals
  (`src/llm/claudeAgentSdk/__tests__/fakeQuery.ts:12-109`).
- `assistantMessage` produces a main-loop `BetaMessage` whose model is
  `claude-sonnet-4-5` (`__tests__/fixtures.ts:80-110`).
- The B7 stream tests prove aggregate tokens come from `modelUsage`, cover
  empty usage, and assert the three legacy response fields
  (`__tests__/ChatClaudeAgentSDK.stream.test.ts:90-169`).
- Closure A drives the real `initializeModel -> attemptInvoke -> provider`
  boundary with a single Sonnet usage entry containing context/output limits,
  but currently asserts only aggregate tokens and legacy response fields
  (`__tests__/turnTranslation.closure.test.ts:45-111`).
- Baseline verification before changes passed both targeted suites: 2 suites,
  23 tests.

### Negative searches

Repository-wide searches found no current producer of `canonical_model` and no
Claude Agent SDK producer of `context_window` or `max_output_tokens`. The only
production callers of the two result helpers are the adjacent calls in
`ChatClaudeAgentSDK.ts:571-572`. No SDK terminal result type or project wrapper
provides a primary-model field. LangChain's base `UsageMetadata` declares token
accounting fields, so the adapter will require a narrow explicit extension
rather than a broad `Record<string, unknown>` return type.

## Design constraints discovered

1. Preserve aggregate token semantics: `modelUsage` includes main loop,
   subagents, sidechains, and internal query-pipeline calls, so token counts
   must continue summing every entry.
2. Do not infer primary model from object order, maximum token count, or cost;
   none is guaranteed by the SDK contract.
3. Use the latest main-loop `SDKAssistantMessage.message.model` as the preferred
   record key. Exact raw-key match wins; canonical-value match is the secondary
   compatibility lookup.
4. A sole record entry is safe even when no assistant chunk was emitted. More
   than one unmatched entry is ambiguous and must not yield singular limits.
5. Publish `model`, `canonical_model`, `context_window`, and
   `max_output_tokens` on response metadata when a selection is available.
   Publish the latter three on usage metadata, but do not introduce
   `usage_metadata.model`: the sibling billing path treats it as an active
   pricing override. `model` is `canonicalModel` when present and otherwise
   the raw record key; `canonical_model` reflects only the SDK field.
6. Perform aggregation and selection in one pass over `modelUsage` in the
   production path. This follows the repository's iteration guidance and
   avoids two divergent interpretations of the same result.
7. LangChain's `AIMessageChunk.concat` reconstructs only standard usage token
   fields and drops custom usage properties (`node_modules/@langchain/core/dist/messages/metadata.js:26-33`).
   A provider-local concat adapter is required for the usage projection to
   reach the final message; response metadata already survives its open-ended
   merge.

## Workflow closure map

The behavior is synchronous inside an asynchronous SDK stream. The source is
the injected `Query` contract (seeded in tests by `fakeQuery`), the changed
connector is the terminal-result metadata translation, and the observable is
the final `AIMessageChunk` returned by the real `attemptInvoke` path.

```text
SOURCE                         CONNECTOR                        OBSERVABLE
SDK Query stream               ChatClaudeAgentSDK               attemptInvoke result
  assistant.message.model  --> terminal result translation --> AIMessageChunk metadata
  result.modelUsage            one-pass select + aggregate      usage + response fields
```

```json
{
  "behavior": "AF-t37e Claude Agent SDK result model metadata propagation",
  "nodes": [
    {
      "id": "sdk-query-stream",
      "module": "src/llm/claudeAgentSdk/__tests__/fakeQuery.ts",
      "is_entrypoint": false,
      "adds_or_changes": false,
      "read_path": null,
      "seedable_store": "fakeQuery"
    },
    {
      "id": "terminal-metadata-translation",
      "module": "src/llm/claudeAgentSdk/ChatClaudeAgentSDK.ts",
      "is_entrypoint": true,
      "adds_or_changes": true,
      "read_path": null,
      "seedable_store": null
    },
    {
      "id": "final-message-observation",
      "module": "src/llm/invoke.ts",
      "is_entrypoint": false,
      "adds_or_changes": false,
      "read_path": "attemptInvoke",
      "seedable_store": null
    }
  ],
  "edges": [
    {
      "from": "sdk-query-stream",
      "to": "terminal-metadata-translation",
      "mechanism": "callback",
      "crosses_module_boundary": true,
      "blocking": true,
      "driver": null
    },
    {
      "from": "terminal-metadata-translation",
      "to": "final-message-observation",
      "mechanism": "sync",
      "crosses_module_boundary": true,
      "blocking": true,
      "driver": null
    }
  ],
  "highest_new_connector": "terminal-metadata-translation",
  "closure_test": "src/llm/claudeAgentSdk/__tests__/turnTranslation.closure.test.ts"
}
```

The sibling staged adapter
`2026-08-16-12-24-AF-t37e-claude-agent-sdk-result-metadata.closure-adapter.py`
records the proposed selection and projection rules in executable form. It is
not wired into production; the implementation remains TypeScript in
`src/llm/claudeAgentSdk/usage.ts`.

## Verification notes

`silmari-oracle metadata` supplied the frontmatter commit/branch/timestamp.
The optional `ResearchSemgrep` verifier is not installed in this checkout, so
citations were verified with numbered source reads plus `rg` negative/caller
searches. The installed SDK declaration was read directly rather than inferred
from external documentation.

## Scope boundary and downstream follow-up

Only `silmari-chat-agents` is in scope. The sibling `silmari-chat` currently
defines its own usage event shape and static token-limit lookup; it will need a
follow-up to retain the new metadata in `packages/api/src/agents/usage.ts` and
consume the live context/model fields in
`client/src/hooks/Chat/useTokenLimits.ts`. No sibling file is modified here.
