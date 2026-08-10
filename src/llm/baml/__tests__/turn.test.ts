import { describe, expect, it } from '@jest/globals';
import { HumanMessage } from '@langchain/core/messages';
import type { AIMessageChunk } from '@langchain/core/messages';
import type * as t from '@/types';
import { createFakeFunctionSet } from '@/llm/baml/__tests__/fakeFunctionSet';
import { BamlTurnError } from '@/llm/baml/errors';
import { ChatBAML } from '@/llm/baml/ChatBAML';
import { attemptInvoke } from '@/llm/invoke';
import { getChunkContent } from '@/stream';
import { Providers } from '@/common';

const declaredWeather = [
  { name: 'get_weather', schemaFingerprint: 'fp-get-weather' },
];

async function drain(
  stream: AsyncIterable<AIMessageChunk>
): Promise<AIMessageChunk[]> {
  const chunks: AIMessageChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('B8 — an unbound turn returns an answer', () => {
  it('answers with no tools bound at all', async () => {
    const functions = createFakeFunctionSet({
      results: [{ kind: 'answer', text: 'A Tale of Two Cities' }],
    });
    const model = new ChatBAML({ functions });

    const result = await model.invoke([
      new HumanMessage('Title this conversation.'),
    ]);

    expect(result.content).toBe('A Tale of Two Cities');
    expect(result.tool_calls ?? []).toStrictEqual([]);
  });

  it('sends an empty allowedTools list when nothing is bound', async () => {
    const functions = createFakeFunctionSet({
      declaredTools: declaredWeather,
      results: [{ kind: 'answer', text: 'ok' }],
    });

    await new ChatBAML({ functions }).invoke([new HumanMessage('hi')]);

    expect(functions.calls[0].allowedTools).toStrictEqual([]);
  });
});

describe('B9 — a failure result surfaces as a typed error', () => {
  it('throws a BamlTurnError carrying the failure code', async () => {
    const functions = createFakeFunctionSet({
      results: [
        {
          kind: 'failure',
          failure: { code: 'model_error', message: 'upstream refused' },
        },
      ],
    });

    await expect(
      new ChatBAML({ functions }).invoke([new HumanMessage('hi')])
    ).rejects.toThrow(BamlTurnError);
  });

  it('carries the code, message, and tool name onto the error', async () => {
    const functions = createFakeFunctionSet({
      results: [
        {
          kind: 'failure',
          failure: {
            code: 'parse_error',
            message: 'could not parse arguments',
            toolName: 'get_weather',
          },
        },
      ],
    });

    const thrown = await new ChatBAML({ functions })
      .invoke([new HumanMessage('hi')])
      .then(
        () => undefined,
        (error: unknown) => error
      );

    expect(thrown).toBeInstanceOf(BamlTurnError);
    const failure = thrown as BamlTurnError;
    expect(failure.code).toBe('parse_error');
    expect(failure.toolName).toBe('get_weather');
    expect(failure.message).toContain('could not parse arguments');
  });

  it('throws when a failure arrives mid-stream', async () => {
    const functions = createFakeFunctionSet({
      chunks: [
        [
          { kind: 'text', text: 'thinking' },
          {
            kind: 'failure',
            failure: { code: 'model_error', message: 'stream died' },
          },
        ],
      ],
    });

    await expect(
      drain(await new ChatBAML({ functions }).stream([new HumanMessage('hi')]))
    ).rejects.toThrow(BamlTurnError);
  });
});

describe('B10 — streaming yields chunks and an empty stream is defined', () => {
  it('yields one chunk per text delta, in order', async () => {
    const functions = createFakeFunctionSet({
      chunks: [
        [
          { kind: 'text', text: 'It is ' },
          { kind: 'text', text: 'sunny' },
          { kind: 'text', text: '.' },
        ],
      ],
    });

    const chunks = await drain(
      await new ChatBAML({ functions }).stream([new HumanMessage('weather?')])
    );

    expect(chunks.map((chunk) => chunk.content)).toStrictEqual([
      'It is ',
      'sunny',
      '.',
    ]);
  });

  it('emits chunks the stream handler can read content from', async () => {
    const functions = createFakeFunctionSet({
      chunks: [
        [
          { kind: 'text', text: 'It is ' },
          { kind: 'text', text: 'sunny.' },
        ],
      ],
    });

    const chunks = await drain(
      await new ChatBAML({ functions }).stream([new HumanMessage('weather?')])
    );

    expect(
      chunks.map((chunk) =>
        getChunkContent({
          chunk,
          provider: Providers.BAML,
          reasoningKey: 'reasoning',
        })
      )
    ).toStrictEqual(['It is ', 'sunny.']);
  });

  it('concatenates to the full answer through attemptInvoke', async () => {
    const functions = createFakeFunctionSet({
      chunks: [
        [
          { kind: 'text', text: 'It is ' },
          { kind: 'text', text: 'sunny.' },
        ],
      ],
    });

    const model: t.ChatModel = new ChatBAML({ functions });
    const result = await attemptInvoke({
      model,
      onChunk: (): void => undefined,
      messages: [new HumanMessage('weather?')],
      provider: Providers.BAML,
    });

    expect(result.messages?.[0].content).toBe('It is sunny.');
  });

  it('resolves an empty stream to a chunk with empty content, never undefined', async () => {
    const functions = createFakeFunctionSet({ chunks: [[]] });

    const chunks = await drain(
      await new ChatBAML({ functions }).stream([new HumanMessage('hi')])
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBeDefined();
    expect(chunks[0].content).toBe('');
  });

  it('never drains an empty stream to undefined inside attemptInvoke', async () => {
    const functions = createFakeFunctionSet({ chunks: [[]] });

    const model: t.ChatModel = new ChatBAML({ functions });
    const result = await attemptInvoke({
      model,
      onChunk: (): void => undefined,
      messages: [new HumanMessage('hi')],
      provider: Providers.BAML,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages?.[0]).toBeDefined();
    expect(result.messages?.[0].content).toBe('');
  });

  it('closes the port stream when the consumer stops early', async () => {
    const functions = createFakeFunctionSet({
      chunks: [
        [
          { kind: 'text', text: 'one' },
          { kind: 'text', text: 'two' },
          { kind: 'text', text: 'three' },
        ],
      ],
    });

    const stream = await new ChatBAML({ functions }).stream([
      new HumanMessage('hi'),
    ]);
    for await (const _chunk of stream) {
      break;
    }

    expect(functions.closedStreams()).toBe(1);
  });
});
