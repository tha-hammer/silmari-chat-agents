import { describe, expect, it } from '@jest/globals';
import type { BamlCallMeta } from '@/llm/baml/types';
import { toResponseMetadata, toUsageMetadata } from '@/llm/baml/callMeta';

describe('toUsageMetadata — B17, carried but never fabricated', () => {
  it('reports nothing when the port supplied no meta', () => {
    expect(toUsageMetadata(undefined)).toBeUndefined();
  });

  it('reports nothing when meta carries no token counts', () => {
    expect(
      toUsageMetadata({ model: 'gpt-4o', finishReason: 'stop' })
    ).toBeUndefined();
  });

  /**
   * A half-usage record is not a usage record. Defaulting the missing side to
   * zero would under-report cost, which is exactly the corruption B17 forbids.
   */
  it('reports nothing when only the input count is known', () => {
    expect(toUsageMetadata({ inputTokens: 12 })).toBeUndefined();
  });

  it('reports nothing when only the output count is known', () => {
    expect(toUsageMetadata({ outputTokens: 5 })).toBeUndefined();
  });

  it('carries both counts and their total when both are known', () => {
    expect(toUsageMetadata({ inputTokens: 12, outputTokens: 5 })).toEqual({
      input_tokens: 12,
      output_tokens: 5,
      total_tokens: 17,
    });
  });

  it('treats a genuine zero as a report, not as absence', () => {
    expect(toUsageMetadata({ inputTokens: 0, outputTokens: 0 })).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    });
  });

  const unreportable: ReadonlyArray<{
    label: string;
    meta: BamlCallMeta | undefined;
  }> = [
    { label: 'absent meta', meta: undefined },
    { label: 'empty meta', meta: {} },
    { label: 'model only', meta: { model: 'gpt-4o' } },
    { label: 'finish reason only', meta: { finishReason: 'stop' } },
    { label: 'input only', meta: { inputTokens: 40 } },
    { label: 'output only', meta: { outputTokens: 40 } },
  ];

  it.each(unreportable)('never invents zeros: $label', ({ meta }) => {
    expect(toUsageMetadata(meta)).toBeUndefined();
  });
});

describe('toResponseMetadata', () => {
  it('is empty when the port supplied no meta', () => {
    expect(toResponseMetadata(undefined)).toEqual({});
  });

  /** `finish_reason` is the key `getTruncationStopReason` reads
   * (`src/llm/truncation.ts:51`), so a truncated turn with an open tool call
   * still raises `OutputTruncationError`. */
  it('carries the model and finish reason under the keys the repo already reads', () => {
    expect(
      toResponseMetadata({ model: 'gpt-4o', finishReason: 'length' })
    ).toEqual({
      model_name: 'gpt-4o',
      finish_reason: 'length',
    });
  });

  it('omits absent keys rather than setting them to undefined', () => {
    const metadata = toResponseMetadata({ model: 'gpt-4o' });

    expect(Object.keys(metadata)).toEqual(['model_name']);
    expect('finish_reason' in metadata).toBe(false);
  });

  it('omits token counts — they belong to usage metadata or nowhere', () => {
    const metadata = toResponseMetadata({ inputTokens: 12, outputTokens: 5 });

    expect(metadata).toEqual({});
  });
});
