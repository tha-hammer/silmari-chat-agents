import { describe, expect, it, jest } from '@jest/globals';
import { HumanMessage, AIMessageChunk } from '@langchain/core/messages';
import {
  assistantMessage,
  userMessage,
  resultSuccess,
  resultError,
  textBlock,
  thinkingBlock,
  toolUseBlock,
  toolResultParam,
  unknownMessage,
} from './fixtures';
import { ChatClaudeAgentSDK } from '@/llm/claudeAgentSdk/ChatClaudeAgentSDK';
import { ClaudeAgentSDKResultError } from '@/llm/claudeAgentSdk/errors';
import { fakeQuery } from './fakeQuery';

async function collectChunks(
  model: ChatClaudeAgentSDK
): Promise<AIMessageChunk[]> {
  const chunks: AIMessageChunk[] = [];
  for await (const chunk of await model.stream([new HumanMessage('hi')])) {
    chunks.push(chunk);
  }
  return chunks;
}

function finalOf(chunks: AIMessageChunk[]): AIMessageChunk {
  return chunks.reduce((a, b) => a.concat(b));
}

describe('B5 — an unbound turn returns a final answer from the terminal success result', () => {
  it('returns an AIMessage with the result text and no tool_calls', async () => {
    const queryFn = fakeQuery([[resultSuccess({ result: 'hello' })]]);
    const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });

    const result = await model.invoke([new HumanMessage('hi')]);

    expect(result.content).toBe('hello');
    expect(result.tool_calls ?? []).toHaveLength(0);
  });
});

describe('B6 — streaming text/thinking content reuses the existing Anthropic converters [part of Closure A]', () => {
  it.each([
    { label: '0 content blocks', blocks: [] },
    { label: '1 content block', blocks: [textBlock('one')] },
    {
      label: '3 content blocks',
      blocks: [textBlock('a'), thinkingBlock('b'), textBlock('c')],
    },
    {
      label: '8 content blocks',
      blocks: Array.from({ length: 8 }, (_, i) =>
        i % 2 === 0 ? textBlock(`t${i}`) : thinkingBlock(`k${i}`)
      ),
    },
  ])(
    '$label: streamed concatenation equals the non-streaming _generate content',
    async ({ blocks }) => {
      const script = [
        ...(blocks.length === 0 ? [] : [assistantMessage({ content: blocks })]),
        resultSuccess({ result: blocks.length === 0 ? 'fallback' : '' }),
      ];

      const streamed = await collectChunks(
        new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn: fakeQuery([script]) })
      );
      const fromStream = finalOf(streamed).content;

      const generated = await new ChatClaudeAgentSDK({
        cwd: '/tmp',
        queryFn: fakeQuery([script]),
      }).invoke([new HumanMessage('hi')]);

      expect(fromStream).toEqual(generated.content);
    }
  );

  it('yields an empty-content chunk fallback to nothing (never undefined) when the stream has no assistant text', async () => {
    const queryFn = fakeQuery([[resultSuccess({ result: '' })]]);
    const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });

    const result = await model.invoke([new HumanMessage('hi')]);

    expect(result.content).toBe('');
  });
});

type ModelUsageFixture = Parameters<
  typeof resultSuccess
>[0]['modelUsage'] extends Record<string, infer U> | undefined
  ? U
  : never;

describe('B7 — usage_metadata is derived from modelUsage, never usage [part of Closure A]', () => {
  it.each([
    {
      label: 'modelUsage present with >0 tokens across 2 model keys',
      modelUsage: {
        'claude-sonnet-4-5': {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          webSearchRequests: 0,
          costUSD: 0,
          contextWindow: 0,
          maxOutputTokens: 0,
        },
        'claude-haiku-4-5': {
          inputTokens: 3,
          outputTokens: 2,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          webSearchRequests: 0,
          costUSD: 0,
          contextWindow: 0,
          maxOutputTokens: 0,
        },
      },
      expected: { input_tokens: 13, output_tokens: 7, total_tokens: 20 },
    },
    {
      label: 'modelUsage present but empty object',
      modelUsage: {} as Record<string, ModelUsageFixture>,
      expected: undefined,
    },
    {
      label: 'modelUsage absent',
      modelUsage: undefined as Record<string, ModelUsageFixture> | undefined,
      expected: undefined,
    },
  ])('$label', async ({ modelUsage, expected }) => {
    const queryFn = fakeQuery([
      [
        resultSuccess({
          result: 'hi',
          ...(modelUsage == null ? {} : { modelUsage }),
        }),
      ],
    ]);
    const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });

    const result = await model.invoke([new HumanMessage('hi')]);

    expect(result.usage_metadata).toEqual(expected);
  });

  it('carries session_id/num_turns/total_cost_usd in response_metadata', async () => {
    const queryFn = fakeQuery([
      [
        resultSuccess({
          result: 'hi',
          session_id: 's42',
          num_turns: 3,
          total_cost_usd: 0.5,
        }),
      ],
    ]);
    const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });

    const result = await model.invoke([new HumanMessage('hi')]);

    expect(result.response_metadata.session_id).toBe('s42');
    expect(result.response_metadata.num_turns).toBe(3);
    expect(result.response_metadata.total_cost_usd).toBe(0.5);
  });
});

describe('B8 — each terminal error subtype becomes a distinct typed error [part of Closure A]', () => {
  it.each([
    'error_max_turns',
    'error_during_execution',
    'error_max_budget_usd',
    'error_max_structured_output_retries',
  ] as const)(
    'subtype %s throws ClaudeAgentSDKResultError',
    async (subtype) => {
      const queryFn = fakeQuery([[resultError({ subtype, errors: ['boom'] })]]);
      const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });

      await expect(
        model.invoke([new HumanMessage('hi')])
      ).rejects.toMatchObject({
        name: 'ClaudeAgentSDKResultError',
        subtype,
        errors: ['boom'],
      });
      await expect(
        model.invoke([new HumanMessage('hi')])
      ).rejects.toBeInstanceOf(ClaudeAgentSDKResultError);
    }
  );
});

describe('B9 — subagent-originated messages never leak into the terminal answer [part of Closure A]', () => {
  it.each([
    {
      label: 'all main-loop',
      messages: [
        assistantMessage({ content: [textBlock('a')] }),
        assistantMessage({ content: [textBlock('b')] }),
      ],
      // Distinct from `expected` — proves the answer came from the streamed
      // main-loop blocks, not the terminal result's own fallback text.
      resultText: 'RESULT-MARKER-NOT-USED',
      expected: 'ab',
    },
    {
      label: 'all subagent',
      messages: [
        assistantMessage({
          content: [textBlock('sub-a')],
          parentToolUseId: 'tu1',
        }),
      ],
      // No main-loop content at all triggers B5/B6's empty-stream fallback
      // to the terminal result's own text (by design) — set to '' so this
      // row unambiguously proves 'sub-a' never leaks, independent of that
      // fallback mechanism.
      resultText: '',
      expected: '',
    },
    {
      label: '3 messages alternating main-loop/subagent',
      messages: [
        assistantMessage({ content: [textBlock('main1')] }),
        assistantMessage({
          content: [textBlock('sub1')],
          parentToolUseId: 'tu1',
        }),
        assistantMessage({ content: [textBlock('main2')] }),
      ],
      resultText: 'RESULT-MARKER-NOT-USED',
      expected: 'main1main2',
    },
  ])(
    '$label: final answer is main-loop-only text',
    async ({ messages, resultText, expected }) => {
      const queryFn = fakeQuery([
        [...messages, resultSuccess({ result: resultText })],
      ]);
      const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });

      const result = await model.invoke([new HumanMessage('hi')]);

      expect(result.content).toBe(expected);
    }
  );
});

describe('B10 — tool_calls are never emitted, on any chunk, ever [BLOCKING — Closure A]', () => {
  it.each([
    {
      label: 'no tool_use',
      messages: [assistantMessage({ content: [textBlock('hi')] })],
    },
    {
      label: 'one tool_use',
      messages: [
        assistantMessage({
          content: [toolUseBlock({ id: 'tu1', name: 'Bash' })],
        }),
        userMessage({ content: [toolResultParam({ toolUseId: 'tu1' })] }),
      ],
    },
    {
      label:
        'three interleaved tool_use/tool_result pairs across main-loop and subagent messages',
      messages: [
        assistantMessage({
          content: [toolUseBlock({ id: 'tu1', name: 'Bash' })],
        }),
        userMessage({ content: [toolResultParam({ toolUseId: 'tu1' })] }),
        assistantMessage({
          content: [toolUseBlock({ id: 'tu2', name: 'Read' })],
          parentToolUseId: 'tu1',
        }),
        userMessage({
          content: [toolResultParam({ toolUseId: 'tu2' })],
          parentToolUseId: 'tu1',
        }),
        assistantMessage({
          content: [toolUseBlock({ id: 'tu3', name: 'Grep' })],
        }),
        userMessage({ content: [toolResultParam({ toolUseId: 'tu3' })] }),
      ],
    },
  ])('$label', async ({ messages }) => {
    const queryFn = fakeQuery([
      [...messages, resultSuccess({ result: 'done' })],
    ]);
    const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });

    const chunks: AIMessageChunk[] = [];
    for await (const chunk of await model.stream([
      new HumanMessage('run ls'),
    ])) {
      chunks.push(chunk);
    }
    const final = chunks.reduce((a, b) => a.concat(b));

    expect(final.tool_calls ?? []).toHaveLength(0);
    expect(final.tool_call_chunks ?? []).toHaveLength(0);
    for (const chunk of chunks) {
      expect(chunk.tool_calls ?? []).toHaveLength(0);
      expect(chunk.tool_call_chunks ?? []).toHaveLength(0);
    }
  });
});

describe('B25 — SDKMessage variants outside the named subset are a safe, logged passthrough', () => {
  it('does not throw, is not forwarded as content, and is logged at debug level', async () => {
    const queryFn = fakeQuery([
      [
        unknownMessage(),
        assistantMessage({ content: [textBlock('hi')] }),
        resultSuccess({ result: 'fallback-unused' }),
      ],
    ]);
    const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});

    const result = await model.invoke([new HumanMessage('hi')]);

    expect(result.content).toBe('hi');
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('auth_status')
    );
    debugSpy.mockRestore();
  });
});
