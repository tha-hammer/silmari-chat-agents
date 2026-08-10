import { describe, expect, it } from '@jest/globals';
import { HumanMessage } from '@langchain/core/messages';
import type { BamlPromptInput } from '@/llm/baml/types';
import { createFakeFunctionSet } from '@/llm/baml/__tests__/fakeFunctionSet';
import { ChatBAML } from '@/llm/baml/ChatBAML';

/**
 * Aborts from *inside* the turn, then rejects when the port's own signal
 * fires. Aborting from the test body instead would land before the request
 * ever started — `invoke` awaits its callback setup first — and would prove
 * only the pre-abort guard, never the mid-flight path.
 */
function abortDuringTurn(
  controller: AbortController
): (input: BamlPromptInput) => Promise<void> {
  return (input: BamlPromptInput) =>
    new Promise<void>((_resolve, reject) => {
      if (input.signal == null) {
        reject(new Error('the port was handed no signal'));
        return;
      }
      input.signal.addEventListener('abort', () => {
        reject(new Error('port observed abort'));
      });
      controller.abort();
    });
}

describe('B13 — abort propagates', () => {
  it('never reaches the port when the signal is already aborted', async () => {
    const functions = createFakeFunctionSet({
      results: [{ kind: 'answer', text: 'should never be produced' }],
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      new ChatBAML({ functions }).invoke([new HumanMessage('hi')], {
        signal: controller.signal,
      })
    ).rejects.toThrow();

    expect(functions.calls).toStrictEqual([]);
  });

  /**
   * `config.signal` is inspected by `attemptInvoke` only for
   * `StreamLimitExceededError` (`src/llm/invoke.ts:868-876`); general
   * cancellation is the provider's own job, threaded into the port the way
   * `src/llm/mistral/index.ts:26-30` threads `options.signal`.
   */
  it('hands the port a signal that fires when the caller aborts', async () => {
    const controller = new AbortController();
    const functions = createFakeFunctionSet({
      results: [{ kind: 'answer', text: 'too late' }],
      onTurn: abortDuringTurn(controller),
    });

    await expect(
      new ChatBAML({ functions }).invoke([new HumanMessage('hi')], {
        signal: controller.signal,
      })
    ).rejects.toThrow('port observed abort');

    expect(functions.calls).toHaveLength(1);
    expect(functions.calls[0].signal?.aborted).toBe(true);
  });

  it('starts no follow-on request after an abort', async () => {
    const controller = new AbortController();
    const functions = createFakeFunctionSet({
      results: [
        { kind: 'answer', text: 'first' },
        { kind: 'answer', text: 'second' },
      ],
      onTurn: abortDuringTurn(controller),
    });

    await expect(
      new ChatBAML({ functions }).invoke([new HumanMessage('hi')], {
        signal: controller.signal,
      })
    ).rejects.toThrow();

    expect(functions.calls).toHaveLength(1);
  });

  it('never reaches the port on a streaming call with an aborted signal', async () => {
    const functions = createFakeFunctionSet({
      chunks: [[{ kind: 'text', text: 'unreachable' }]],
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      (async () => {
        const stream = await new ChatBAML({ functions }).stream(
          [new HumanMessage('hi')],
          { signal: controller.signal }
        );
        for await (const _chunk of stream) {
          void _chunk;
        }
      })()
    ).rejects.toThrow();

    expect(functions.calls).toStrictEqual([]);
  });
});

describe('B14 — streams close cleanly', () => {
  it('closes the port iterator when the consumer returns early', async () => {
    const functions = createFakeFunctionSet({
      chunks: [
        [
          { kind: 'text', text: 'a' },
          { kind: 'text', text: 'b' },
          { kind: 'text', text: 'c' },
        ],
      ],
    });

    const stream = await new ChatBAML({ functions }).stream([
      new HumanMessage('hi'),
    ]);
    const received: string[] = [];
    for await (const chunk of stream) {
      received.push(String(chunk.content));
      break;
    }

    expect(received).toStrictEqual(['a']);
    expect(functions.closedStreams()).toBe(1);
  });

  it('closes the port iterator when the caller aborts mid-stream', async () => {
    const controller = new AbortController();
    const functions = createFakeFunctionSet({
      chunks: [
        [
          { kind: 'text', text: 'a' },
          { kind: 'text', text: 'b' },
          { kind: 'text', text: 'c' },
        ],
      ],
    });

    const stream = await new ChatBAML({ functions }).stream(
      [new HumanMessage('hi')],
      { signal: controller.signal }
    );
    const received: string[] = [];

    await expect(
      (async () => {
        for await (const chunk of stream) {
          received.push(String(chunk.content));
          controller.abort();
        }
      })()
    ).rejects.toThrow();

    expect(received).toStrictEqual(['a']);
    expect(functions.closedStreams()).toBe(1);
  });

  it('closes the port iterator on a fully drained stream', async () => {
    const functions = createFakeFunctionSet({
      chunks: [[{ kind: 'text', text: 'a' }]],
    });

    const stream = await new ChatBAML({ functions }).stream([
      new HumanMessage('hi'),
    ]);
    for await (const _chunk of stream) {
      void _chunk;
    }

    expect(functions.closedStreams()).toBe(1);
  });
});
