import type { ToolCall } from '@langchain/core/messages/tool';
import type { BaseMessage } from '@langchain/core/messages';
import type {
  BamlTranscriptEntry,
  BamlTranscriptRole,
  BamlTranscriptToolCall,
} from '@/llm/baml/types';
import type { SerializedSessionMessage } from '@/session/types';
import {
  deserializeMessage,
  getMessageRole,
  serializeMessage,
  toJsonObject,
} from '@/session/messageSerialization';

type MessageWithToolCalls = BaseMessage & { tool_calls?: ToolCall[] };

/**
 * The four conversational roles the port accepts. A message whose role is not
 * one of these — LangGraph's `RemoveMessage` control marker in particular —
 * carries no conversation and is not projected.
 */
const TRANSCRIPT_ROLES = new Map<string, BamlTranscriptRole>([
  ['system', 'system'],
  ['user', 'user'],
  ['assistant', 'assistant'],
  ['tool', 'tool'],
]);

const MESSAGE_TYPES: Readonly<Record<BamlTranscriptRole, string>> = {
  system: 'system',
  user: 'human',
  assistant: 'ai',
  tool: 'tool',
};

function projectToolCalls(
  message: BaseMessage
): readonly BamlTranscriptToolCall[] | undefined {
  const calls = (message as MessageWithToolCalls).tool_calls;
  if (calls == null || calls.length === 0) {
    return undefined;
  }
  return calls.map((call) => ({
    id: call.id ?? '',
    name: call.name,
    args: toJsonObject(call.args) ?? {},
  }));
}

function toEntry(
  message: BaseMessage,
  role: BamlTranscriptRole
): BamlTranscriptEntry {
  const serialized = serializeMessage(message);
  const toolCalls = projectToolCalls(message);
  return {
    role,
    content: serialized.content,
    ...(serialized.toolCallId == null
      ? {}
      : { toolCallId: serialized.toolCallId }),
    ...(toolCalls == null ? {} : { toolCalls }),
  };
}

function toSerialized(entry: BamlTranscriptEntry): SerializedSessionMessage {
  return {
    messageType: MESSAGE_TYPES[entry.role],
    content: entry.content,
    ...(entry.toolCallId == null ? {} : { toolCallId: entry.toolCallId }),
    ...(entry.toolCalls == null
      ? {}
      : {
        toolCalls: entry.toolCalls.map((call) => ({
          id: call.id,
          name: call.name,
          args: call.args,
          type: 'tool_call',
        })),
      }),
  };
}

/**
 * Projects conversation history onto the port's replay-safe transcript. Content
 * conversion is delegated to the session serializer, so circular references,
 * `NaN`, and `Error` values are handled the one way this repo already handles
 * them. Order is preserved, and so is every `tool_call_id` pairing: the ids a
 * prior turn emitted travel with the assistant entry, which is what lets the
 * next turn see its own tool results.
 */
export function projectTranscript(
  messages: BaseMessage[]
): BamlTranscriptEntry[] {
  return messages.flatMap((message) => {
    const role = TRANSCRIPT_ROLES.get(getMessageRole(message));
    return role == null ? [] : [toEntry(message, role)];
  });
}

/** Inverse of {@link projectTranscript}, for replay from a stored transcript. */
export function restoreTranscript(
  entries: readonly BamlTranscriptEntry[]
): BaseMessage[] {
  return entries.map((entry) => deserializeMessage(toSerialized(entry)));
}
