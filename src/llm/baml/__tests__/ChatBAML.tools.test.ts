import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { describe, expect, it } from '@jest/globals';
import { HumanMessage } from '@langchain/core/messages';
import type { GoogleAIToolType } from '@langchain/google-common';
import type {
  BamlDeclaredTool,
  BamlFunctionSet,
  BamlPromptInput,
  BamlTurnChunk,
  BamlTurnResult,
} from '@/llm/baml/types';
import type * as t from '@/types';
import { createFakeFunctionSet } from '@/llm/baml/__tests__/fakeFunctionSet';
import { BAML_TOOL_FAILURES_KEY, ChatBAML } from '@/llm/baml/ChatBAML';
import { BAML_PORT_VERSION } from '@/llm/baml/types';
import { toolsCondition } from '@/tools/ToolNode';

const DECLARED_TOOLS: readonly BamlDeclaredTool[] = [
  { name: 'get_weather', schemaFingerprint: 'weather@1' },
  { name: 'web_search', schemaFingerprint: 'search@1' },
];

function makeTool(name: string): t.GenericTool {
  return tool(() => `${name} ran`, {
    name,
    description: `${name}, for tests`,
    schema: z.object({ query: z.string() }),
  });
}

interface RecordingPort extends BamlFunctionSet {
  readonly calls: BamlPromptInput[];
}

/**
 * A real port that answers from what it was *told* rather than from a script:
 * it selects the first tool the turn allows, and answers when the turn allows
 * none.
 *
 * B15 invokes two differently-bound runnables concurrently against **one**
 * function set, so a shared FIFO of scripted outcomes would hand one turn the
 * other turn's result. Deriving the outcome from `allowedTools` makes each
 * turn's answer depend only on its own binding — which is exactly the property
 * under test.
 */
function createFirstAllowedPort(
  declaredTools: readonly BamlDeclaredTool[]
): RecordingPort {
  const calls: BamlPromptInput[] = [];

  const outcome = (input: BamlPromptInput): BamlTurnResult => {
    if (input.allowedTools.length === 0) {
      return { kind: 'answer', text: 'nothing to call' };
    }
    return {
      kind: 'tool_calls',
      calls: [{ name: input.allowedTools[0], args: { query: 'now' } }],
      failures: [],
    };
  };

  return {
    version: BAML_PORT_VERSION,
    declaredTools,
    calls,
    takeTurn(input: BamlPromptInput): Promise<BamlTurnResult> {
      calls.push(input);
      return Promise.resolve(outcome(input));
    },
    async *streamTurn(
      input: BamlPromptInput
    ): AsyncGenerator<BamlTurnChunk, void, undefined> {
      calls.push(input);
      const result = outcome(input);
      yield result.kind === 'answer'
        ? { kind: 'text', text: result.text }
        : result;
    },
  };
}

describe('B15 — bindings are immutable and invocation-local', () => {
  it('returns a new runnable and leaves the receiver unbound', async () => {
    const functions = createFirstAllowedPort(DECLARED_TOOLS);
    const model = new ChatBAML({ functions });

    const bound = model.bindTools([makeTool('get_weather')]);
    await bound.invoke([new HumanMessage('weather?')]);
    await model.invoke([new HumanMessage('weather?')]);

    expect(bound).not.toBe(model);
    expect(functions.calls[0].allowedTools).toStrictEqual(['get_weather']);
    expect(functions.calls[1].allowedTools).toStrictEqual([]);
  });

  it('does not cross-contaminate two differently-bound runnables invoked concurrently', async () => {
    const functions = createFirstAllowedPort(DECLARED_TOOLS);
    const model = new ChatBAML({ functions });
    const weatherOnly = model.bindTools([makeTool('get_weather')]);
    const searchOnly = model.bindTools([makeTool('web_search')]);

    const [weatherResult, searchResult] = await Promise.all([
      weatherOnly.invoke([new HumanMessage('weather?')]),
      searchOnly.invoke([new HumanMessage('search?')]),
    ]);

    expect(weatherResult.tool_calls?.map((call) => call.name)).toStrictEqual([
      'get_weather',
    ]);
    expect(searchResult.tool_calls?.map((call) => call.name)).toStrictEqual([
      'web_search',
    ]);
    expect(
      functions.calls.map((call) => [...call.allowedTools]).sort()
    ).toEqual([['get_weather'], ['web_search']]);
  });

  it('rebinding does not disturb an earlier binding', async () => {
    const functions = createFirstAllowedPort(DECLARED_TOOLS);
    const model = new ChatBAML({ functions });
    const weatherOnly = model.bindTools([makeTool('get_weather')]);

    model.bindTools([makeTool('web_search')]);
    await weatherOnly.invoke([new HumanMessage('weather?')]);

    expect(functions.calls[0].allowedTools).toStrictEqual(['get_weather']);
  });

  it('binds a duplicated name once', async () => {
    const functions = createFirstAllowedPort(DECLARED_TOOLS);
    const model = new ChatBAML({ functions });

    await model
      .bindTools([makeTool('get_weather'), makeTool('get_weather')])
      .invoke([new HumanMessage('weather?')]);

    expect(functions.calls[0].allowedTools).toStrictEqual(['get_weather']);
  });

  it('binds the heterogeneous Google tool shape', async () => {
    const functions = createFirstAllowedPort(DECLARED_TOOLS);
    const model = new ChatBAML({ functions });
    const googleTools: GoogleAIToolType[] = [
      {
        functionDeclarations: [
          { name: 'get_weather', description: 'weather' },
          { name: 'web_search', description: 'search' },
        ],
      },
    ];

    await model.bindTools(googleTools).invoke([new HumanMessage('weather?')]);

    expect(functions.calls[0].allowedTools).toStrictEqual([
      'get_weather',
      'web_search',
    ]);
  });
});

describe('B11 — the safety gate holds at the model boundary', () => {
  it('sends the bound subset across the port, never the declared superset', async () => {
    const functions = createFakeFunctionSet({
      declaredTools: DECLARED_TOOLS,
      results: [{ kind: 'answer', text: 'ok' }],
    });

    await new ChatBAML({ functions })
      .bindTools([makeTool('get_weather')])
      .invoke([new HumanMessage('hi')]);

    expect(functions.calls[0].allowedTools).toStrictEqual(['get_weather']);
  });

  /**
   * The whole point of the gate: an unbound name that survived to
   * `toolsCondition` would route to `ToolNode` and be dispatched by the host
   * (`src/tools/ToolNode.ts:4541-4568`).
   */
  it('never emits a declared-but-unbound selection as a tool_call', async () => {
    const functions = createFakeFunctionSet({
      declaredTools: DECLARED_TOOLS,
      results: [
        {
          kind: 'tool_calls',
          calls: [{ name: 'web_search', args: { query: 'anything' } }],
          failures: [],
        },
      ],
    });

    const result = await new ChatBAML({ functions })
      .bindTools([makeTool('get_weather')])
      .invoke([new HumanMessage('search the web')]);

    expect(result.tool_calls ?? []).toStrictEqual([]);
    expect(toolsCondition([result], 'tools')).toBe('__end__');
  });

  /**
   * "Rejected" must not mean "vanished": without a record, a host whose port
   * keeps choosing an unbound tool sees an empty assistant turn and no way to
   * find out why.
   */
  it('records the rejection rather than dropping it', async () => {
    const functions = createFakeFunctionSet({
      declaredTools: DECLARED_TOOLS,
      results: [
        {
          kind: 'tool_calls',
          calls: [{ name: 'web_search', args: { query: 'anything' } }],
          failures: [],
        },
      ],
    });

    const result = await new ChatBAML({ functions })
      .bindTools([makeTool('get_weather')])
      .invoke([new HumanMessage('search the web')]);

    expect(result.response_metadata[BAML_TOOL_FAILURES_KEY]).toEqual([
      {
        code: 'unbound',
        message: expect.stringContaining('web_search'),
        toolName: 'web_search',
      },
    ]);
  });

  it('keeps the port\'s own failures alongside the gate\'s', async () => {
    const functions = createFakeFunctionSet({
      declaredTools: DECLARED_TOOLS,
      results: [
        {
          kind: 'tool_calls',
          calls: [{ name: 'web_search', args: { query: 'anything' } }],
          failures: [
            { code: 'parse_error', message: 'bad json', toolName: 'run_code' },
          ],
        },
      ],
    });

    const result = await new ChatBAML({ functions })
      .bindTools([makeTool('get_weather')])
      .invoke([new HumanMessage('search the web')]);

    expect(result.response_metadata[BAML_TOOL_FAILURES_KEY]).toHaveLength(2);
  });

  it('records nothing when every selection is authorized', async () => {
    const functions = createFakeFunctionSet({
      declaredTools: DECLARED_TOOLS,
      results: [
        {
          kind: 'tool_calls',
          calls: [{ name: 'get_weather', args: { query: 'Austin' } }],
          failures: [],
        },
      ],
    });

    const result = await new ChatBAML({ functions })
      .bindTools([makeTool('get_weather')])
      .invoke([new HumanMessage('weather?')]);

    expect(BAML_TOOL_FAILURES_KEY in result.response_metadata).toBe(false);
  });

  it('keeps the authorized calls when a turn mixes bound and unbound selections', async () => {
    const functions = createFakeFunctionSet({
      declaredTools: DECLARED_TOOLS,
      results: [
        {
          kind: 'tool_calls',
          calls: [
            { name: 'web_search', args: { query: 'first' } },
            { name: 'get_weather', args: { query: 'second' } },
          ],
          failures: [],
        },
      ],
    });

    const result = await new ChatBAML({ functions })
      .bindTools([makeTool('get_weather')])
      .invoke([new HumanMessage('both please')]);

    expect(result.tool_calls?.map((call) => call.name)).toStrictEqual([
      'get_weather',
    ]);
  });
});

describe('B12 — emitted calls are routable', () => {
  it('carries a non-empty id and name on every call, so toolsCondition routes', async () => {
    const functions = createFakeFunctionSet({
      declaredTools: DECLARED_TOOLS,
      results: [
        {
          kind: 'tool_calls',
          calls: [
            { name: 'get_weather', args: { query: 'Austin' } },
            { name: 'get_weather', args: { query: 'Denver' } },
          ],
          failures: [],
        },
      ],
    });

    const result = await new ChatBAML({ functions })
      .bindTools([makeTool('get_weather')])
      .invoke([new HumanMessage('two cities')]);

    const calls = result.tool_calls ?? [];
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((call) => call.id)).size).toBe(2);
    for (const call of calls) {
      expect(call.id).toBeTruthy();
      expect(call.name).toBe('get_weather');
    }
    expect(toolsCondition([result], 'tools')).toBe('tools');
  });

  it('emits a numeric index on the streamed tool_call_chunks', async () => {
    const functions = createFakeFunctionSet({
      declaredTools: DECLARED_TOOLS,
      chunks: [
        [
          {
            kind: 'tool_calls',
            calls: [{ name: 'get_weather', args: { query: 'Austin' } }],
            failures: [],
          },
        ],
      ],
    });

    const stream = await new ChatBAML({ functions })
      .bindTools([makeTool('get_weather')])
      .stream([new HumanMessage('weather?')]);

    const indexes: unknown[] = [];
    for await (const chunk of stream) {
      for (const toolCallChunk of chunk.tool_call_chunks ?? []) {
        indexes.push(toolCallChunk.index);
      }
    }
    expect(indexes).toStrictEqual([0]);
  });
});
