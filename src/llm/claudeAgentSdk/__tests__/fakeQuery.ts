import type {
  Query,
  SDKMessage,
  Options,
} from '@anthropic-ai/claude-agent-sdk';

export interface FakeQueryCall {
  prompt: string;
  options?: Options;
}

/**
 * A real implementation of `query()`'s contract — an
 * `AsyncGenerator<SDKMessage, void>` plus the `Query` control-method surface
 * — never a `jest.mock()` of the SDK package. Mirrors BAML's
 * `fakeFunctionSet.ts` philosophy: script what it yields per call, and
 * record every call's `{prompt, options}` so a closure test can assert on
 * `options.resume`, `options.canUseTool`, `options.hooks`, etc.
 *
 * `scripts` is one `SDKMessage[]` per successive call to the returned
 * `queryFn`; the last script repeats for any call beyond `scripts.length`.
 */
export function fakeQuery(
  scripts: readonly SDKMessage[][],
  calls: FakeQueryCall[] = []
): (params: { prompt: string; options?: Options }) => Query {
  let callIndex = 0;
  return (params) => {
    calls.push({ prompt: params.prompt, options: params.options });
    const script = scripts[Math.min(callIndex, scripts.length - 1)] ?? [];
    callIndex += 1;
    return makeFakeQuery(script);
  };
}

/**
 * `queryFn`-style factory whose generator body can inspect (and actually
 * call) the `options` the production code passed — `options.canUseTool`,
 * `options.hooks.PreToolUse[...]`, etc. — rather than just yielding a
 * pre-scripted message list. Used by the hook/permission closures (C, E),
 * which must prove the adapter is wired end-to-end: the fake "wants" to run
 * a tool, calls the real extension point with real SDK-shaped arguments,
 * and branches on the real returned decision.
 */
export function fakeQueryFromGenerator(
  makeGenerate: (params: {
    prompt: string;
    options?: Options;
  }) => () => AsyncGenerator<SDKMessage, void>,
  calls: FakeQueryCall[] = []
): (params: { prompt: string; options?: Options }) => Query {
  return (params) => {
    calls.push({ prompt: params.prompt, options: params.options });
    return queryFromGenerator(makeGenerate(params));
  };
}

/**
 * Only the async-iteration protocol and `interrupt()`/`close()` (the sole
 * `Query` control methods this phase's cancellation behavior, B18, uses) are
 * real. Every other control method (`setModel`, `setPermissionMode`, etc.)
 * throws if called — this provider's "single-shot prompt mode only" scope
 * (see the plan's "What We're NOT Doing") means production code should never
 * reach them; a throw catches an accidental call loudly instead of silently
 * resolving `undefined`.
 */
function makeFakeQuery(messages: readonly SDKMessage[]): Query {
  return queryFromGenerator(async function* (): AsyncGenerator<
    SDKMessage,
    void
    > {
    for (const message of messages) {
      yield message;
    }
  });
}

function queryFromGenerator(
  generate: () => AsyncGenerator<SDKMessage, void>
): Query {
  const iterator = generate();

  const real = {
    next: iterator.next.bind(iterator),
    return: iterator.return.bind(iterator),
    throw: iterator.throw.bind(iterator),
    [Symbol.asyncIterator](): AsyncGenerator<SDKMessage, void> {
      return real as unknown as AsyncGenerator<SDKMessage, void>;
    },
    interrupt: async () => undefined,
    close: (): void => {
      void iterator.return(undefined);
    },
  };

  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      return () => {
        throw new Error(
          `fakeQuery: Query.${String(prop)}() is not implemented — this ` +
            'provider only uses single-shot prompt mode (interrupt/close), ' +
            'so production code should never call it.'
        );
      };
    },
  }) as unknown as Query;
}
