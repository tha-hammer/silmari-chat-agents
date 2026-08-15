import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultSuccess,
  SDKResultError,
  NonNullableUsage,
  SDKAuthStatusMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type Anthropic from '@anthropic-ai/sdk';

const NIL_UUID = '00000000-0000-0000-0000-000000000000' as const;

/** An SDKMessage variant outside the named subset (B25) — small and simple. */
export function unknownMessage(): SDKAuthStatusMessage {
  return {
    type: 'auth_status',
    isAuthenticating: false,
    output: [],
    uuid: NIL_UUID,
    session_id: 's1',
  };
}

export function textBlock(text: string): Anthropic.Beta.BetaTextBlock {
  return { type: 'text', text, citations: null };
}

export function thinkingBlock(
  thinking: string,
  signature = 'sig'
): Anthropic.Beta.BetaThinkingBlock {
  return { type: 'thinking', thinking, signature };
}

export function toolUseBlock(fields: {
  id: string;
  name: string;
  input?: Record<string, unknown>;
}): Anthropic.Beta.BetaToolUseBlock {
  return {
    type: 'tool_use',
    id: fields.id,
    name: fields.name,
    input: fields.input ?? {},
  };
}

export function toolResultParam(fields: {
  toolUseId: string;
  content?: string;
}): Anthropic.ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: fields.toolUseId,
    content: fields.content ?? 'ok',
  };
}

/** Every field `BetaUsage` declares, filled with honest, zeroed defaults. */
function nonNullableUsage(): NonNullableUsage {
  return {
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    fallback_credit: { status: { type: 'not_applied', reason: 'not_enabled' } },
    inference_geo: '',
    input_tokens: 0,
    iterations: [],
    output_tokens: 0,
    output_tokens_details: { thinking_tokens: 0 },
    server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
    service_tier: 'standard',
    speed: 'standard',
  };
}

function betaMessage(
  content: Anthropic.Beta.BetaContentBlock[]
): Anthropic.Beta.BetaMessage {
  return {
    id: 'msg_fake',
    container: null,
    content,
    context_management: null,
    diagnostics: null,
    model: 'claude-sonnet-4-5',
    role: 'assistant',
    stop_details: null,
    stop_reason: 'end_turn',
    stop_sequence: null,
    type: 'message',
    usage: nonNullableUsage(),
  };
}

export function assistantMessage(fields: {
  content: Anthropic.Beta.BetaContentBlock[];
  parentToolUseId?: string | null;
  sessionId?: string;
}): SDKAssistantMessage {
  return {
    type: 'assistant',
    message: betaMessage(fields.content),
    parent_tool_use_id: fields.parentToolUseId ?? null,
    uuid: NIL_UUID,
    session_id: fields.sessionId ?? 's1',
  };
}

export function userMessage(fields: {
  content: Anthropic.ToolResultBlockParam[];
  parentToolUseId?: string | null;
}): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: fields.content },
    parent_tool_use_id: fields.parentToolUseId ?? null,
  };
}

export function resultSuccess(
  fields: Partial<SDKResultSuccess> & { result?: string }
): SDKResultSuccess {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 1,
    result: fields.result ?? '',
    stop_reason: null,
    total_cost_usd: 0,
    usage: nonNullableUsage(),
    modelUsage: {},
    permission_denials: [],
    uuid: NIL_UUID,
    session_id: 's1',
    ...fields,
  };
}

export function resultError(
  fields: Partial<SDKResultError> &
    Pick<SDKResultError, 'subtype'> & { errors?: string[] }
): SDKResultError {
  return {
    type: 'result',
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: nonNullableUsage(),
    modelUsage: {},
    permission_denials: [],
    errors: fields.errors ?? [],
    uuid: NIL_UUID,
    session_id: 's1',
    ...fields,
  };
}
