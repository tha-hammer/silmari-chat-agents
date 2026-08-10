import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { describe, expect, it } from '@jest/globals';
import { HumanMessage } from '@langchain/core/messages';
import type {
  AIMessageChunk,
  BaseMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type {
  BamlTranscriptEntry,
  BamlFunctionSet,
  BamlPromptInput,
  BamlTurnChunk,
} from '@/llm/baml/types';
import type * as t from '@/types';
import { createFakeFunctionSet } from '@/llm/baml/__tests__/fakeFunctionSet';
import '@/llm/baml';
import type { OnChunk } from '@/llm/invoke';
import { ToolNode, toolsCondition } from '@/tools/ToolNode';
import { attemptInvoke } from '@/llm/invoke';
import { initializeModel } from '@/llm/init';
import { Providers } from '@/common';

const WEATHER_READING = '24C and clear';
const TOOL_NAME = 'get_weather';
const DECLARED_TOOLS = [
  { name: TOOL_NAME, schemaFingerprint: 'sha256:get_weather@1' },
];

const weatherTool = tool(
  (input: { city: string }) => `${input.city}: ${WEATHER_READING}`,
  {
    name: TOOL_NAME,
    description: 'Look up the current weather for a city.',
    schema: z.object({ city: z.string() }),
  }
);

/**
 * The port's answer is DERIVED from the transcript it was handed, exactly as a
 * real host adapter's would be — the model can only answer from what it was
 * shown. This is what gives B18 its red-at-seam: with the S7 projection
 * disabled there is no tool entry to read, so the final answer cannot contain
 * the reading no matter what the script says.
 */
function answerFromTranscript(
  transcript: readonly BamlTranscriptEntry[]
): string {
  const toolEntry = transcript.find((entry) => entry.role === 'tool');
  if (toolEntry == null) {
    return 'I have no tool result to report.';
  }
  return `The forecast came back: ${JSON.stringify(toolEntry.content)}`;
}

/**
 * cc_2's scripted fake underneath — it records every `BamlPromptInput` and
 * throws when called more often than it was scripted, which is how an extra
 * provider round-trip announces itself. The wrapper only rewrites the answer
 * text so it depends on the transcript rather than on the script.
 */
function createAnsweringPort(): BamlFunctionSet & {
  readonly calls: BamlPromptInput[];
  } {
  const scripted = createFakeFunctionSet({
    declaredTools: DECLARED_TOOLS,
    chunks: [
      [
        {
          kind: 'tool_calls',
          calls: [{ name: TOOL_NAME, args: { city: 'Denver' } }],
          failures: [],
        },
      ],
      [{ kind: 'text', text: '(replaced by the transcript-derived answer)' }],
    ],
  });

  return {
    ...scripted,
    streamTurn(input: BamlPromptInput): AsyncIterable<BamlTurnChunk> {
      const upstream = scripted.streamTurn(input);
      return (async function* (): AsyncGenerator<
        BamlTurnChunk,
        void,
        undefined
        > {
        for await (const chunk of upstream) {
          yield chunk.kind === 'text'
            ? { ...chunk, text: answerFromTranscript(input.transcript) }
            : chunk;
        }
      })();
    },
  };
}

/**
 * A real stream consumer. `attemptInvoke`'s default path dispatches run steps
 * into a graph, and B18's cycle does not involve one — `onChunk` is the
 * documented override for exactly that, and it still drains the same stream
 * through the same `concat` accumulation and `assertNotTruncatedToolCall`
 * guard the tool edge depends on.
 */
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

function textOf(message: BaseMessage): string {
  if (typeof message.content !== 'string') {
    throw new Error(`expected string content, got ${typeof message.content}`);
  }
  return message.content;
}

describe('B18 — the full tool loop closes', () => {
  it('feeds a real ToolNode result into a second turn and answers from it', async () => {
    const functions = createAnsweringPort();
    const tools: t.GenericTool[] = [weatherTool];
    const model = initializeModel({
      provider: Providers.BAML,
      clientOptions: { functions },
      tools,
    });
    const toolNode = new ToolNode<{ messages: BaseMessage[] }>({ tools });
    const question = new HumanMessage('What is the weather in Denver?');
    const streamed: AIMessageChunk[] = [];

    const firstTurn = await attemptInvoke({
      model,
      messages: [question],
      provider: Providers.BAML,
      onChunk: collectChunks(streamed),
    });
    const selection = onlyMessage(firstTurn);

    expect(toolsCondition([selection], 'tools')).toBe('tools');

    const dispatched: { messages: BaseMessage[] } = await toolNode.invoke({
      messages: [selection],
    });
    const toolMessages: BaseMessage[] = dispatched.messages;

    const secondTurn = await attemptInvoke({
      model,
      messages: [question, selection, ...toolMessages],
      provider: Providers.BAML,
      onChunk: collectChunks(streamed),
    });

    expect(textOf(onlyMessage(secondTurn))).toContain(WEATHER_READING);
    expect(functions.calls).toHaveLength(2);
  });

  it('pairs the tool result with the id the first turn emitted', async () => {
    const functions = createAnsweringPort();
    const tools: t.GenericTool[] = [weatherTool];
    const model = initializeModel({
      provider: Providers.BAML,
      clientOptions: { functions },
      tools,
    });
    const toolNode = new ToolNode<{ messages: BaseMessage[] }>({ tools });
    const question = new HumanMessage('What is the weather in Denver?');
    const streamed: AIMessageChunk[] = [];

    const firstTurn = await attemptInvoke({
      model,
      messages: [question],
      provider: Providers.BAML,
      onChunk: collectChunks(streamed),
    });
    const selection = onlyMessage(firstTurn);

    const dispatched: { messages: BaseMessage[] } = await toolNode.invoke({
      messages: [selection],
    });
    const toolMessages: ToolMessage[] = dispatched.messages.filter(
      (message): message is ToolMessage => message._getType() === 'tool'
    );

    await attemptInvoke({
      model,
      messages: [question, selection, ...toolMessages],
      provider: Providers.BAML,
      onChunk: collectChunks(streamed),
    });

    const secondTranscript = functions.calls[1]?.transcript ?? [];
    const assistantEntry = secondTranscript.find(
      (entry) => entry.role === 'assistant'
    );
    const toolEntry = secondTranscript.find((entry) => entry.role === 'tool');

    expect(assistantEntry?.toolCalls?.[0]?.id).toBeTruthy();
    expect(toolEntry?.toolCallId).toBe(assistantEntry?.toolCalls?.[0]?.id);
    expect(toolMessages[0]?.tool_call_id).toBe(toolEntry?.toolCallId);
  });
});
