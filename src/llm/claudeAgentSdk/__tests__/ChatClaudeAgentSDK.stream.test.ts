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
import {
  usageMetadataFromResult,
  responseMetadataFromResult,
} from '@/llm/claudeAgentSdk/usage';
import { ChatClaudeAgentSDK } from '@/llm/claudeAgentSdk/ChatClaudeAgentSDK';
import { ClaudeAgentSDKResultError } from '@/llm/claudeAgentSdk/errors';
import { fakeQueryFromGenerator, fakeQuery } from './fakeQuery';

const MAIN_MODEL = 'claude-sonnet-4-5';
const CANONICAL_MAIN_MODEL = 'claude-sonnet-4-5-20250929';
const SECONDARY_MODEL = 'claude-haiku-4-5';

type ModelUsageFixture = Parameters<
  typeof resultSuccess
>[0]['modelUsage'] extends Record<string, infer U> | undefined
  ? U
  : never;

function modelUsage(
  fields: Partial<ModelUsageFixture> = {}
): ModelUsageFixture {
  return {
    inputTokens: 10,
    outputTokens: 5,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
    costUSD: 0,
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    ...fields,
  };
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise = (): void => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

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
      label: 'modelUsage omitted from fixture input',
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

  it('responseMetadataFromResult returns selected model limits with every legacy field', () => {
    const result = resultSuccess({
      result: 'hi',
      session_id: 's42',
      num_turns: 3,
      total_cost_usd: 0.5,
      modelUsage: {
        [MAIN_MODEL]: modelUsage({ canonicalModel: CANONICAL_MAIN_MODEL }),
      },
    });

    expect(responseMetadataFromResult(result, MAIN_MODEL)).toEqual({
      session_id: 's42',
      num_turns: 3,
      total_cost_usd: 0.5,
      model: CANONICAL_MAIN_MODEL,
      canonical_model: CANONICAL_MAIN_MODEL,
      context_window: 200_000,
      max_output_tokens: 8_192,
    });
  });

  it('selects the main-loop record without changing aggregate token totals', async () => {
    const script = [
      assistantMessage({ content: [textBlock('hi')], model: MAIN_MODEL }),
      resultSuccess({
        result: '',
        modelUsage: {
          [SECONDARY_MODEL]: modelUsage({
            inputTokens: 3,
            outputTokens: 2,
            contextWindow: 100_000,
            maxOutputTokens: 4_096,
          }),
          [MAIN_MODEL]: modelUsage({ canonicalModel: CANONICAL_MAIN_MODEL }),
        },
      }),
    ];
    const streamed = await collectChunks(
      new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn: fakeQuery([script]) })
    );
    const terminal = streamed[streamed.length - 1];
    const firstContentChunk = streamed[0];
    const reduced = finalOf(streamed);
    const invoked = await new ChatClaudeAgentSDK({
      cwd: '/tmp',
      queryFn: fakeQuery([script]),
    }).invoke([new HumanMessage('hi')]);

    const expectedUsage = {
      input_tokens: 13,
      output_tokens: 7,
      total_tokens: 20,
      canonical_model: CANONICAL_MAIN_MODEL,
      context_window: 200_000,
      max_output_tokens: 8_192,
    };
    const expectedResponse = {
      model: CANONICAL_MAIN_MODEL,
      canonical_model: CANONICAL_MAIN_MODEL,
      context_window: 200_000,
      max_output_tokens: 8_192,
    };

    expect(terminal.usage_metadata).toMatchObject(expectedUsage);
    expect(reduced.usage_metadata).toMatchObject(expectedUsage);
    expect(invoked.usage_metadata).toMatchObject(expectedUsage);
    expect(invoked.usage_metadata).not.toHaveProperty('model');
    expect(terminal.response_metadata).toMatchObject(expectedResponse);
    expect(reduced.response_metadata).toMatchObject(expectedResponse);
    expect(invoked.response_metadata).toMatchObject(expectedResponse);
    expect(firstContentChunk.usage_metadata).toBeUndefined();
  });

  it('selects a unique canonical match when the raw record key differs', async () => {
    const result = await new ChatClaudeAgentSDK({
      cwd: '/tmp',
      queryFn: fakeQuery([
        [
          assistantMessage({
            content: [textBlock('hi')],
            model: CANONICAL_MAIN_MODEL,
          }),
          resultSuccess({
            result: '',
            modelUsage: {
              'provider-specific-alias': modelUsage({
                canonicalModel: CANONICAL_MAIN_MODEL,
              }),
              [SECONDARY_MODEL]: modelUsage({ contextWindow: 100_000 }),
            },
          }),
        ],
      ]),
    }).invoke([new HumanMessage('hi')]);

    expect(result.response_metadata).toMatchObject({
      model: CANONICAL_MAIN_MODEL,
      canonical_model: CANONICAL_MAIN_MODEL,
      context_window: 200_000,
      max_output_tokens: 8_192,
    });
  });

  it.each([
    {
      label: 'multiple entries without a preferred model',
      preferredModel: undefined,
      usage: {
        [MAIN_MODEL]: modelUsage({ canonicalModel: undefined }),
        [SECONDARY_MODEL]: modelUsage({ canonicalModel: undefined }),
      },
    },
    {
      label: 'duplicate canonical matches',
      preferredModel: CANONICAL_MAIN_MODEL,
      usage: {
        [MAIN_MODEL]: modelUsage({ canonicalModel: CANONICAL_MAIN_MODEL }),
        [SECONDARY_MODEL]: modelUsage({
          canonicalModel: CANONICAL_MAIN_MODEL,
          contextWindow: 100_000,
        }),
      },
    },
  ])('omits singular fields for $label', ({ preferredModel, usage }) => {
    const result = resultSuccess({ result: 'hi', modelUsage: usage });
    const metadata = responseMetadataFromResult(result, preferredModel);
    const usageMetadata = usageMetadataFromResult(result, preferredModel);

    expect(metadata).not.toHaveProperty('model');
    expect(metadata).not.toHaveProperty('canonical_model');
    expect(metadata).not.toHaveProperty('context_window');
    expect(metadata).not.toHaveProperty('max_output_tokens');
    expect(usageMetadata).toMatchObject({
      input_tokens: 20,
      output_tokens: 10,
      total_tokens: 30,
    });
    expect(usageMetadata).not.toHaveProperty('canonical_model');
    expect(usageMetadata).not.toHaveProperty('context_window');
    expect(usageMetadata).not.toHaveProperty('max_output_tokens');
  });

  it('exact raw-key match wins over duplicate canonical matches', () => {
    const metadata = responseMetadataFromResult(
      resultSuccess({
        result: 'hi',
        modelUsage: {
          [MAIN_MODEL]: modelUsage({
            canonicalModel: MAIN_MODEL,
            contextWindow: 200_000,
          }),
          [SECONDARY_MODEL]: modelUsage({
            canonicalModel: MAIN_MODEL,
            contextWindow: 100_000,
          }),
        },
      }),
      MAIN_MODEL
    );

    expect(metadata.context_window).toBe(200_000);
  });

  it('preserves selected zero values and does not mutate frozen SDK data', () => {
    const entry = Object.freeze(
      modelUsage({
        inputTokens: 0,
        outputTokens: 0,
        contextWindow: 0,
        maxOutputTokens: 0,
      })
    );
    const entries = Object.freeze({ [MAIN_MODEL]: entry });
    const result = Object.freeze(
      resultSuccess({ result: 'hi', modelUsage: entries })
    );

    expect(responseMetadataFromResult(result, MAIN_MODEL)).toMatchObject({
      model: MAIN_MODEL,
      context_window: 0,
      max_output_tokens: 0,
    });
    expect(usageMetadataFromResult(result, MAIN_MODEL)).toMatchObject({
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      context_window: 0,
      max_output_tokens: 0,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(entries)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
  });

  it('does not let a later subagent model replace the main-loop selection', async () => {
    const result = await new ChatClaudeAgentSDK({
      cwd: '/tmp',
      queryFn: fakeQuery([
        [
          assistantMessage({ content: [textBlock('main')], model: MAIN_MODEL }),
          assistantMessage({
            content: [textBlock('sub')],
            model: SECONDARY_MODEL,
            parentToolUseId: 'tu1',
          }),
          resultSuccess({
            result: '',
            modelUsage: {
              [MAIN_MODEL]: modelUsage({
                canonicalModel: CANONICAL_MAIN_MODEL,
              }),
              [SECONDARY_MODEL]: modelUsage({ contextWindow: 100_000 }),
            },
          }),
        ],
      ]),
    }).invoke([new HumanMessage('hi')]);

    expect(result.response_metadata.context_window).toBe(200_000);
  });

  it('captures a latest main-loop model even when its tool-only content is stripped', async () => {
    const result = await new ChatClaudeAgentSDK({
      cwd: '/tmp',
      queryFn: fakeQuery([
        [
          assistantMessage({ content: [textBlock('main')], model: MAIN_MODEL }),
          assistantMessage({
            content: [toolUseBlock({ id: 'tu1', name: 'Bash' })],
            model: SECONDARY_MODEL,
          }),
          resultSuccess({
            result: '',
            modelUsage: {
              [MAIN_MODEL]: modelUsage({ contextWindow: 200_000 }),
              [SECONDARY_MODEL]: modelUsage({
                contextWindow: 100_000,
                maxOutputTokens: 4_096,
              }),
            },
          }),
        ],
      ]),
    }).invoke([new HumanMessage('hi')]);

    expect(result.content).toBe('main');
    expect(result.response_metadata).toMatchObject({
      model: SECONDARY_MODEL,
      context_window: 100_000,
      max_output_tokens: 4_096,
    });
  });

  it('isolates preferred models across concurrent streams on one instance', async () => {
    const firstStarted = createDeferred();
    const releaseFirst = createDeferred();
    let callIndex = 0;
    const queryFn = fakeQueryFromGenerator(() => {
      const currentCall = callIndex;
      callIndex += 1;
      const selectedModel = currentCall === 0 ? MAIN_MODEL : SECONDARY_MODEL;
      const contextWindow = currentCall === 0 ? 200_000 : 100_000;

      return async function* () {
        yield assistantMessage({
          content: [textBlock(selectedModel)],
          model: selectedModel,
        });
        if (currentCall === 0) {
          firstStarted.resolve();
          await releaseFirst.promise;
        } else {
          releaseFirst.resolve();
        }
        yield resultSuccess({
          result: '',
          modelUsage: {
            [selectedModel]: modelUsage({ contextWindow }),
          },
        });
      };
    });
    const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });

    const firstResultPromise = model.invoke([new HumanMessage('first')]);
    await firstStarted.promise;
    const secondResultPromise = model.invoke([new HumanMessage('second')]);
    const [first, second] = await Promise.all([
      firstResultPromise,
      secondResultPromise,
    ]);

    expect(first.response_metadata.context_window).toBe(200_000);
    expect(second.response_metadata.context_window).toBe(100_000);
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

  it('still throws a typed result error after capturing a main-loop model', async () => {
    const model = new ChatClaudeAgentSDK({
      cwd: '/tmp',
      queryFn: fakeQuery([
        [
          assistantMessage({
            content: [textBlock('partial')],
            model: MAIN_MODEL,
          }),
          resultError({ subtype: 'error_max_turns', errors: ['too many'] }),
        ],
      ]),
    });

    await expect(model.invoke([new HumanMessage('hi')])).rejects.toBeInstanceOf(
      ClaudeAgentSDKResultError
    );
  });

  it('still throws the missing-terminal error after capturing a main-loop model', async () => {
    const model = new ChatClaudeAgentSDK({
      cwd: '/tmp',
      queryFn: fakeQuery([
        [
          assistantMessage({
            content: [textBlock('partial')],
            model: MAIN_MODEL,
          }),
        ],
      ]),
    });

    await expect(model.invoke([new HumanMessage('hi')])).rejects.toThrow(
      'the query() stream ended without a terminal result message'
    );
  });
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
