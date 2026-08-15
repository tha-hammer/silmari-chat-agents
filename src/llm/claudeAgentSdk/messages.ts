import { AIMessageChunk } from '@langchain/core/messages';
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKResultSuccess,
  SDKResultError,
} from '@anthropic-ai/claude-agent-sdk';
import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicMessageResponse } from '@/llm/anthropic/types';
import { anthropicResponseToChatMessages } from '@/llm/anthropic/utils/message_outputs';

/**
 * Content-block types that represent the main loop's own commentary/output.
 * An allowlist, not a denylist: a block type this SDK adds in a future
 * version defaults to stripped, the safe failure mode given B10's "never
 * tool_calls" requirement outranks completeness here.
 */
const MAIN_LOOP_BLOCK_TYPES = new Set([
  'text',
  'thinking',
  'redacted_thinking',
]);

/**
 * Drops every Claude-internal tool_use/tool_result-shaped block (and any
 * block type outside the main-loop allowlist), so no future content-block
 * variant can accidentally reach `AIMessageChunk.tool_calls` (B10).
 */
export function stripInternalToolActivity(
  blocks: readonly Anthropic.Beta.BetaContentBlock[]
): Anthropic.Beta.BetaContentBlock[] {
  return blocks.filter((block) => MAIN_LOOP_BLOCK_TYPES.has(block.type));
}

/** `parent_tool_use_id == null` — the main agent loop, not a subagent turn. */
export function isMainLoopAssistantMessage(
  message: SDKMessage
): message is SDKAssistantMessage {
  return message.type === 'assistant' && message.parent_tool_use_id == null;
}

/** `parent_tool_use_id != null` — a subagent's own turn (B9: dropped). */
export function isSubagentAssistantMessage(
  message: SDKMessage
): message is SDKAssistantMessage {
  return message.type === 'assistant' && message.parent_tool_use_id != null;
}

export function isResultMessage(
  message: SDKMessage
): message is SDKResultMessage {
  return message.type === 'result';
}

export function isResultSuccess(
  message: SDKResultMessage
): message is SDKResultSuccess {
  return message.subtype === 'success';
}

export function isResultError(
  message: SDKResultMessage
): message is SDKResultError {
  return message.subtype !== 'success';
}

/**
 * Converts one main-loop `SDKAssistantMessage` into an `AIMessageChunk`,
 * reusing `anthropicResponseToChatMessages` (`src/llm/anthropic/utils/message_outputs.ts`)
 * for the actual block-to-LangChain-content translation (B6) — adaptation of
 * existing, tested code, not a new parser. `message.message` is a real
 * Anthropic `BetaMessage`; its `content` blocks are stripped of any
 * tool_use/tool_result-shaped block (B10) before conversion, so the reused
 * converter's own tool-call extraction never has anything to find.
 *
 * No `usage`/`id`-bearing `additionalKwargs` is passed through: per-message
 * usage_metadata is never attached here — B7 derives it once, from the
 * terminal `SDKResultMessage`'s `modelUsage`, not from individual assistant
 * messages.
 *
 * Returns `null` when nothing survives stripping (e.g. a message that was
 * pure `tool_use`), so callers can skip yielding an empty chunk.
 */
export function mainLoopChunkFromAssistantMessage(
  message: SDKAssistantMessage
): AIMessageChunk | null {
  const blocks = stripInternalToolActivity(message.message.content);
  if (blocks.length === 0) {
    return null;
  }

  const [generation] = anthropicResponseToChatMessages(
    blocks as unknown as AnthropicMessageResponse[],
    {}
  );

  return new AIMessageChunk({
    content: generation.message.content,
    response_metadata: generation.message.response_metadata,
  });
}
