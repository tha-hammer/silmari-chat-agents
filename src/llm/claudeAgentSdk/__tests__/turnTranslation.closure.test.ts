import { describe, expect, it } from '@jest/globals';
import { HumanMessage } from '@langchain/core/messages';
import type { AIMessageChunk, BaseMessage } from '@langchain/core/messages';
import type { OnChunk } from '@/llm/invoke';
import type * as t from '@/types';
import {
  assistantMessage,
  userMessage,
  resultSuccess,
  resultError,
  textBlock,
  toolUseBlock,
  toolResultParam,
} from './fixtures';
import { ClaudeAgentSDKResultError } from '@/llm/claudeAgentSdk/errors';
import { attemptInvoke } from '@/llm/invoke';
import { initializeModel } from '@/llm/init';
import { fakeQuery } from './fakeQuery';
import { Providers } from '@/common';

function collectChunks(into: AIMessageChunk[]): OnChunk {
  return (chunk: AIMessageChunk): void => {
    into.push(chunk);
  };
}

function onlyMessage(result: Partial<t.BaseGraphState>): BaseMessage {
  const message = result.messages?.[0];
  if (message == null) {
    throw new Error('attemptInvoke returned no message');
  }
  return message;
}

/**
 * Closure A: "a Claude Agent SDK turn's message stream becomes an
 * observable, correctly-classified final answer" [BLOCKING].
 *
 * Drives the real production chain — `initializeModel` -> `attemptInvoke` ->
 * this provider's `_streamResponseChunks` -> the fake `Query`'s own `for
 * await` iteration — and observes only what `attemptInvoke` itself returns
 * (`onChunk` + the final message), never a raw call to `messages.ts`'s
 * classification functions in isolation.
 */
describe('Closure A — a Claude Agent SDK turn becomes an observable, correctly-classified final answer [BLOCKING]', () => {
  it('surfaces main-loop text, drops subagent text, strips tool_use/tool_result, and carries usage/response metadata', async () => {
    const queryFn = fakeQuery([
      [
        assistantMessage({ content: [textBlock('main-loop says hi')] }),
        assistantMessage({
          content: [textBlock('SUBAGENT-LEAK-CANARY')],
          parentToolUseId: 'tu1',
        }),
        assistantMessage({
          content: [toolUseBlock({ id: 'tu1', name: 'Bash' })],
        }),
        userMessage({ content: [toolResultParam({ toolUseId: 'tu1' })] }),
        resultSuccess({
          result: '',
          session_id: 's-closure-a',
          num_turns: 2,
          total_cost_usd: 0.01,
          modelUsage: {
            'claude-sonnet-4-5': {
              inputTokens: 7,
              outputTokens: 4,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              webSearchRequests: 0,
              costUSD: 0.01,
              contextWindow: 200000,
              maxOutputTokens: 4096,
            },
          },
        }),
      ],
    ]);
    const model = initializeModel({
      provider: Providers.CLAUDE_AGENT_SDK,
      clientOptions: { cwd: '/tmp', queryFn },
    });
    const streamed: AIMessageChunk[] = [];

    const turn = await attemptInvoke({
      model,
      messages: [new HumanMessage('hi')],
      provider: Providers.CLAUDE_AGENT_SDK,
      onChunk: collectChunks(streamed),
    });
    const finalMessage = onlyMessage(turn);

    expect(finalMessage.content).toBe('main-loop says hi');
    expect(finalMessage.content).not.toContain('SUBAGENT-LEAK-CANARY');
    expect((finalMessage as AIMessageChunk).tool_calls ?? []).toHaveLength(0);
    expect(
      (finalMessage as AIMessageChunk).tool_call_chunks ?? []
    ).toHaveLength(0);

    const usageMetadata = (finalMessage as AIMessageChunk).usage_metadata;
    expect(usageMetadata).toMatchObject({
      input_tokens: 7,
      output_tokens: 4,
      total_tokens: 11,
    });
    const responseMetadata = finalMessage.response_metadata as Record<
      string,
      unknown
    >;
    expect(responseMetadata.session_id).toBe('s-closure-a');
    expect(responseMetadata.num_turns).toBe(2);
    expect(responseMetadata.total_cost_usd).toBe(0.01);

    // Every intermediate chunk `onChunk` observed is also tool_calls-free —
    // proving the invariant holds on the stream itself, not only the
    // concatenated final message.
    for (const chunk of streamed) {
      expect(chunk.tool_calls ?? []).toHaveLength(0);
      expect(chunk.tool_call_chunks ?? []).toHaveLength(0);
    }
  });

  it('surfaces a terminal error subtype as ClaudeAgentSDKResultError through attemptInvoke', async () => {
    const queryFn = fakeQuery([
      [resultError({ subtype: 'error_max_turns', errors: ['too many turns'] })],
    ]);
    const model = initializeModel({
      provider: Providers.CLAUDE_AGENT_SDK,
      clientOptions: { cwd: '/tmp', queryFn },
    });

    await expect(
      attemptInvoke({
        model,
        messages: [new HumanMessage('hi')],
        provider: Providers.CLAUDE_AGENT_SDK,
      })
    ).rejects.toBeInstanceOf(ClaudeAgentSDKResultError);
  });
});
