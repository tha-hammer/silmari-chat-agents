---
date: 2026-08-16T12:40:00-04:00
reviewer: GoldStream
plan: thoughts/searchable/shared/plans/2026-08-16-AF-t37e-claude-agent-sdk-result-metadata.md
bead: AF-t37e
status: changes-required
---

# Plan review: AF-t37e Claude Agent SDK result metadata

## Verdict

Changes are required before implementation. The selected-model precedence is
contract-safe, but the draft plan missed a runtime aggregation boundary:
LangChain discards nonstandard `usage_metadata` properties whenever
`AIMessageChunk`s are concatenated. The plan also treated `usage_metadata.model`
as passive even though the sibling billing layer uses it to select a price.

The enhanced plan must solve both issues without moving provider-specific
selection into generic invocation/event code.

## Evidence reproduced during review

`AIMessageChunk.concat` calls `mergeUsageMetadata`
(`node_modules/@langchain/core/dist/messages/ai.js:219-238`). That function
constructs a fresh object containing only token counts and token-detail objects
(`node_modules/@langchain/core/dist/messages/metadata.js:26-33`). A direct
runtime reproduction with a content chunk followed by a terminal metadata
chunk produced:

```json
{
  "usage": {
    "input_tokens": 7,
    "output_tokens": 4,
    "total_tokens": 11,
    "input_token_details": {},
    "output_token_details": {}
  },
  "response": {
    "canonical_model": "claude-sonnet",
    "context_window": 200000,
    "max_output_tokens": 4096
  }
}
```

The custom usage fields disappeared while the open-ended response fields
survived. This occurs in both provider `_generate` aggregation and
`attemptInvoke` aggregation.

The sibling billing path also uses `usage.model ?? configuredModel` as its
transaction model (`/home/maceo/Dev/silmari-chat/packages/api/src/agents/usage.ts:590-604`).
Adding canonical `usage_metadata.model` would therefore change pricing
behavior, contrary to this bug fix's compatibility requirement.

## Required changes

### Critical

1. Add a concat-survival contract and provider-local preservation mechanism.
   A Claude-specific `AIMessageChunk` subtype is appropriate because
   LangChain's virtual `concat` method is the exact lossy boundary. Every
   Claude assistant and terminal chunk must use it so the left operand retains
   the override. Its override should call the base concat, then construct a new
   Claude chunk with the standard merged token counts plus one unsummed model
   projection. It must not mutate either operand.
2. Split the two metadata projections. `response_metadata` may contain
   `model`, `canonical_model`, `context_window`, and `max_output_tokens`.
   `usage_metadata` must contain the latter three but must not introduce
   `model`, preserving existing billing identity.
3. Retain the exported `responseMetadataFromResult` named in AF-t37e's
   acceptance criterion. Retain `usageMetadataFromResult` symmetrically; both
   are typed wrappers over a combined translator. Production calls only the
   combined helper, so it traverses `modelUsage` once.

### High

4. Make preferred-model state generator-local, never a class/session field.
   Assign it immediately inside the main-loop assistant branch before content
   stripping or yielding. Add a concurrency test using one model instance and
   two interleaved streams.
5. Make subagent ordering and tool-only latest-main-loop cases mandatory:
   subagent messages never replace the preferred model, while a main-loop
   message whose content is fully stripped still does.
6. Specify flat selector state: aggregate totals, entry count, sole candidate,
   exact candidate, canonical candidate, and canonical-match count. Resolve
   after the loop using ordered early returns. Comparisons run only when
   `preferredModel != null`; duplicate canonical matches remain ambiguous.
7. Use explicit provider-local types:
   `ClaudeAgentSDKUsageMetadata extends UsageMetadata`,
   `ClaudeAgentSDKResponseMetadata extends ResponseMetadata`, a selected-model
   projection, and a combined result type. Introduce no `any`, broad
   `Record<string, unknown>`, or `as unknown as` assertions.

### Warnings

8. Distinguish the boundaries: response metadata satisfies result
   introspection and the bead's direct criterion; usage metadata is the only
   current route into `ModelEndHandler.collectedUsage`. Generic event/invoke
   modules should remain unchanged because provider-local chunks can preserve
   the fields through their existing calls.
9. Document that token counts remain aggregate across every `modelUsage`
   entry, while context/model limits describe only the selected main-loop
   entry. Downstream consumers must not compare aggregate multi-model input
   directly to that one model's context window.
10. Rename “absent modelUsage” claims to “empty modelUsage”; absence is outside
    the pinned SDK contract and the fixture's apparent absent case actually
    supplies its default empty record.
11. Add exact tests for duplicate canonical matches, no preferred model,
    exact-key precedence over a duplicate canonical value, zero-valued limits,
    frozen input, raw terminal projection, final stream concat, `invoke`, and
    `attemptInvoke` after nonempty assistant content.
12. Preserve error/incomplete-stream behavior after model capture: assistant
    then terminal error still throws the typed error; assistant then iterator
    completion still throws the existing missing-terminal error.
13. Re-sort every changed import group per AGENTS.md and keep type imports
    standalone. Use named test model constants to prevent branch-changing
    string typos.

## Acceptance-criterion matrix required in enhanced plan

| Acceptance criterion                                 | Required proof                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `responseMetadataFromResult` includes the new fields | direct helper test                                                   |
| values match the selected entry                      | exact equality for canonical/context/max output                      |
| legacy session/turn/cost keys remain                 | existing response test unchanged plus extension assertion            |
| aggregate input/output totals remain                 | existing two-record aggregation test unchanged                       |
| future usage-event transport is lossless             | nonempty-content concat and `attemptInvoke` final-message assertions |
| no guessed multi-model limit                         | unmatched and duplicate-canonical ambiguity tests                    |

## Cleanup review

The seven referenced cleanup rules were read before review; no project/user
customization directory exists. The enhanced plan must require pure control
expressions, accumulator mutation only in the loop body, a separate flat
resolver, immutable inputs/operands, and the provider-local subclass only at
the polymorphic LangChain boundary. No literals representing serialized field
names should be externalized.
