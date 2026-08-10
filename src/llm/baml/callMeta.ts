import type { UsageMetadata } from '@langchain/core/messages';
import type { BamlCallMeta } from '@/llm/baml/types';

/**
 * Maps a port's optional call metadata onto LangChain usage metadata, or
 * reports nothing.
 *
 * Nothing here is ever invented. `UsageMetadata` requires both counts, so a
 * turn that knows only one of them has no usage record to give: defaulting the
 * unknown side to zero would under-report cost everywhere the number lands
 * (Langfuse cost math, host billing). Absent beats wrong — a missing usage
 * record is visible, a fabricated one is not.
 *
 * Hosts that want usage attributed must supply **both** `inputTokens` and
 * `outputTokens`.
 */
export function toUsageMetadata(
  meta: BamlCallMeta | undefined
): UsageMetadata | undefined {
  const inputTokens = meta?.inputTokens;
  const outputTokens = meta?.outputTokens;
  if (inputTokens == null || outputTokens == null) {
    return undefined;
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
  };
}

/**
 * Maps a port's optional call metadata onto response metadata, under the keys
 * this repo already reads: `finish_reason` is one of the shapes
 * `getTruncationStopReason` recognizes (`src/llm/truncation.ts:51`), so a
 * truncated turn with an open tool call still raises `OutputTruncationError`.
 *
 * Token counts are deliberately absent — they are usage, and usage that
 * cannot be reported honestly is not reported at all.
 */
export interface BamlMessageMeta {
  readonly response_metadata: Record<string, string>;
  readonly usage_metadata?: UsageMetadata;
}

/**
 * The metadata fields a message built from this turn carries. `usage_metadata`
 * is *absent* rather than `undefined` when there is nothing honest to report,
 * so nothing downstream can read a fabricated zero off it.
 */
export function messageMetaFields(
  meta: BamlCallMeta | undefined
): BamlMessageMeta {
  const usage = toUsageMetadata(meta);
  return {
    response_metadata: toResponseMetadata(meta),
    ...(usage == null ? {} : { usage_metadata: usage }),
  };
}

export function toResponseMetadata(
  meta: BamlCallMeta | undefined
): Record<string, string> {
  const metadata: Record<string, string> = {};
  if (meta == null) {
    return metadata;
  }

  if (meta.model != null) {
    metadata.model_name = meta.model;
  }
  if (meta.finishReason != null) {
    metadata.finish_reason = meta.finishReason;
  }
  return metadata;
}
