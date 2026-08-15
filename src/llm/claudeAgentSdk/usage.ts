import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UsageMetadata } from '@langchain/core/messages';

/**
 * Derives `usage_metadata` from `modelUsage` (per-model, includes
 * subagents/sidechains) — never from the sibling `usage` field, which is
 * main-loop-only (B7). Sums every `modelUsage` entry's `inputTokens`/
 * `outputTokens`.
 *
 * Omits the field entirely rather than fabricating a zero when `modelUsage`
 * is absent or empty (e.g. an early `error_max_budget_usd` that never ran a
 * model call) — the convention this repo already applies in
 * `src/llm/baml/callMeta.ts:47-60`, not the zero-fill
 * `src/llm/anthropic/utils/message_outputs.ts:103-107`'s `message_delta`
 * path falls back to when cumulative usage is unset. This provider's own
 * `usage.ts` must enforce the omission itself — it does not inherit the
 * guarantee from the reused Anthropic converters.
 */
export function usageMetadataFromResult(
  result: SDKResultMessage
): UsageMetadata | undefined {
  const entries = Object.values(result.modelUsage);
  if (entries.length === 0) {
    return undefined;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  for (const entry of entries) {
    inputTokens += entry.inputTokens;
    outputTokens += entry.outputTokens;
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
  };
}

/** `session_id`/`num_turns`/`total_cost_usd` — carried on every terminal chunk. */
export function responseMetadataFromResult(
  result: SDKResultMessage
): Record<string, unknown> {
  return {
    session_id: result.session_id,
    num_turns: result.num_turns,
    total_cost_usd: result.total_cost_usd,
  };
}
