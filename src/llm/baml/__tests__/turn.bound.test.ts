import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { describe, expect, it } from '@jest/globals';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createFakeFunctionSet } from '@/llm/baml/__tests__/fakeFunctionSet';
import { BAML_PORT_VERSION } from '@/llm/baml/types';
import { ChatBAML } from '@/llm/baml/ChatBAML';

const weatherTool = tool(async (): Promise<string> => 'sunny', {
  name: 'get_weather',
  description: 'Look up the weather for a city.',
  schema: z.object({ city: z.string() }),
});

const declaredWeather = [
  { name: 'get_weather', schemaFingerprint: 'fp-get-weather' },
];

describe('B7 — a bound turn that selects no tools returns a final answer', () => {
  it('returns the answer text with no tool calls', async () => {
    const functions = createFakeFunctionSet({
      declaredTools: declaredWeather,
      results: [{ kind: 'answer', text: 'It is sunny in Paris.' }],
    });
    const bound = new ChatBAML({ functions }).bindTools([weatherTool]);

    const result = await bound.invoke([
      new SystemMessage('be brief'),
      new HumanMessage('weather in Paris?'),
    ]);

    expect(result.content).toBe('It is sunny in Paris.');
    expect(result.tool_calls ?? []).toStrictEqual([]);
  });

  it('sends the current binding as allowedTools, not the declared superset', async () => {
    const functions = createFakeFunctionSet({
      declaredTools: [
        ...declaredWeather,
        { name: 'web_search', schemaFingerprint: 'fp-web-search' },
        { name: 'run_code', schemaFingerprint: 'fp-run-code' },
      ],
      results: [{ kind: 'answer', text: 'done' }],
    });
    const bound = new ChatBAML({ functions }).bindTools([weatherTool]);

    await bound.invoke([new HumanMessage('hi')]);

    expect(functions.calls).toHaveLength(1);
    expect(functions.calls[0].allowedTools).toStrictEqual(['get_weather']);
  });

  it('sends a versioned, projected transcript across the port', async () => {
    const functions = createFakeFunctionSet({
      declaredTools: declaredWeather,
      results: [{ kind: 'answer', text: 'done' }],
    });
    const bound = new ChatBAML({ functions }).bindTools([weatherTool]);

    await bound.invoke([
      new SystemMessage('be brief'),
      new HumanMessage('weather in Paris?'),
    ]);

    expect(functions.calls[0].version).toBe(BAML_PORT_VERSION);
    expect(functions.calls[0].transcript).toStrictEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'weather in Paris?' },
    ]);
  });
});
