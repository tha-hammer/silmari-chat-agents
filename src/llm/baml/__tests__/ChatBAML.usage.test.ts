import { describe, expect, it } from '@jest/globals';
import { HumanMessage } from '@langchain/core/messages';
import type { AIMessageChunk } from '@langchain/core/messages';
import { createFakeFunctionSet } from '@/llm/baml/__tests__/fakeFunctionSet';
import { ChatBAML } from '@/llm/baml/ChatBAML';

async function drain(
  stream: AsyncIterable<AIMessageChunk>
): Promise<AIMessageChunk[]> {
  const chunks: AIMessageChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('B17 — usage metadata is carried', () => {
  it('reports the counts the port supplied', async () => {
    const functions = createFakeFunctionSet({
      results: [
        {
          kind: 'answer',
          text: 'hello',
          meta: { model: 'gpt-4o', inputTokens: 12, outputTokens: 5 },
        },
      ],
    });

    const result = await new ChatBAML({ functions }).invoke([
      new HumanMessage('hi'),
    ]);

    expect(result.usage_metadata).toEqual({
      input_tokens: 12,
      output_tokens: 5,
      total_tokens: 17,
    });
  });

  it('attributes the model the port reported', async () => {
    const functions = createFakeFunctionSet({
      results: [
        {
          kind: 'answer',
          text: 'hello',
          meta: { model: 'gpt-4o', finishReason: 'stop' },
        },
      ],
    });

    const result = await new ChatBAML({ functions }).invoke([
      new HumanMessage('hi'),
    ]);

    expect(result.response_metadata.model_name).toBe('gpt-4o');
    expect(result.response_metadata.finish_reason).toBe('stop');
  });

  /**
   * Matches every other provider: `chunkAdapters` preserves usage on the first
   * split piece and never creates it (`src/llm/stream/chunkAdapters.ts:15-35`).
   * Repeating it per chunk would multiply the counts when the aggregator merges.
   */
  it('reports usage once even when every chunk repeats it', async () => {
    const meta = { inputTokens: 12, outputTokens: 5 };
    const functions = createFakeFunctionSet({
      chunks: [
        [
          { kind: 'text', text: 'hel', meta },
          { kind: 'text', text: 'lo', meta },
          { kind: 'text', text: '!', meta },
        ],
      ],
    });

    const chunks = await drain(
      await new ChatBAML({ functions }).stream([new HumanMessage('hi')])
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].usage_metadata).toEqual({
      input_tokens: 12,
      output_tokens: 5,
      total_tokens: 17,
    });
    for (const chunk of chunks.slice(1)) {
      expect(chunk.usage_metadata).toBeUndefined();
    }
  });

  /**
   * Ports commonly know token counts only once the turn ends. "First chunk
   * only" is a rule against *duplication* — the aggregator sums usage across
   * merged chunks — not a rule that usage must arrive first. Keying on chunk
   * index 0 would silently discard usage from every port that reports it late.
   */
  it('still reports usage when the port only knows the counts at the end', async () => {
    const functions = createFakeFunctionSet({
      chunks: [
        [
          { kind: 'text', text: 'hel' },
          { kind: 'text', text: 'lo' },
          {
            kind: 'text',
            text: '!',
            meta: { inputTokens: 12, outputTokens: 5 },
          },
        ],
      ],
    });

    const chunks = await drain(
      await new ChatBAML({ functions }).stream([new HumanMessage('hi')])
    );

    const reported = chunks.filter((chunk) => chunk.usage_metadata != null);
    expect(reported).toHaveLength(1);
    expect(reported[0].usage_metadata).toEqual({
      input_tokens: 12,
      output_tokens: 5,
      total_tokens: 17,
    });
  });
});

describe('B17 — usage metadata is never fabricated', () => {
  it('emits no usage_metadata when the port supplied no meta', async () => {
    const functions = createFakeFunctionSet({
      results: [{ kind: 'answer', text: 'hello' }],
    });

    const result = await new ChatBAML({ functions }).invoke([
      new HumanMessage('hi'),
    ]);

    expect(result.usage_metadata).toBeUndefined();
  });

  it('emits no usage_metadata when meta carries no token counts', async () => {
    const functions = createFakeFunctionSet({
      results: [{ kind: 'answer', text: 'hello', meta: { model: 'gpt-4o' } }],
    });

    const result = await new ChatBAML({ functions }).invoke([
      new HumanMessage('hi'),
    ]);

    expect(result.usage_metadata).toBeUndefined();
    expect(result.response_metadata.model_name).toBe('gpt-4o');
  });

  /** Zeros are the specific fabrication B17 forbids: they read as a real,
   * free call and silently corrupt cost accounting. */
  it('never substitutes zeros for absent counts', async () => {
    const functions = createFakeFunctionSet({
      results: [{ kind: 'answer', text: 'hello', meta: { inputTokens: 12 } }],
    });

    const result = await new ChatBAML({ functions }).invoke([
      new HumanMessage('hi'),
    ]);

    expect(result.usage_metadata).toBeUndefined();
    expect(result.usage_metadata).not.toEqual({
      input_tokens: 12,
      output_tokens: 0,
      total_tokens: 12,
    });
  });

  it('emits no usage_metadata on any chunk when the stream carries no meta', async () => {
    const functions = createFakeFunctionSet({
      chunks: [
        [
          { kind: 'text', text: 'hel' },
          { kind: 'text', text: 'lo' },
        ],
      ],
    });

    const chunks = await drain(
      await new ChatBAML({ functions }).stream([new HumanMessage('hi')])
    );

    for (const chunk of chunks) {
      expect(chunk.usage_metadata).toBeUndefined();
    }
  });
});
