import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { describe, expect, it } from '@jest/globals';
import type { BindToolsInput } from '@langchain/core/language_models/chat_models';
import type { GoogleAIToolType } from '@langchain/google-common';
import type { BamlDeclaredTool, BamlSelectedTool } from '@/llm/baml/types';
import type * as t from '@/types';
import {
  createToolBinding,
  allowedToolNames,
  emitToolCalls,
} from '@/llm/baml/toolBinding';

const DECLARED_TOOLS: readonly BamlDeclaredTool[] = [
  { name: 'get_weather', schemaFingerprint: 'weather@1' },
  { name: 'web_search', schemaFingerprint: 'search@1' },
  { name: 'run_code', schemaFingerprint: 'code@1' },
];

function makeTool(name: string): t.GenericTool {
  return tool(() => `${name} ran`, {
    name,
    description: `${name}, for tests`,
    schema: z.object({ query: z.string() }),
  });
}

function select(
  name: string,
  args: BamlSelectedTool['args'] = {}
): BamlSelectedTool {
  return { name, args };
}

describe('createToolBinding', () => {
  it('binds a StructuredTool by its name', () => {
    const binding = createToolBinding(
      [makeTool('get_weather')],
      DECLARED_TOOLS
    );

    expect([...binding.keys()]).toEqual(['get_weather']);
    expect(binding.get('get_weather')?.schemaFingerprint).toBe('weather@1');
  });

  it('binds an OpenAI tool definition through function.name', () => {
    const tools: BindToolsInput[] = [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'search',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    const binding = createToolBinding(tools, DECLARED_TOOLS);

    expect([...binding.keys()]).toEqual(['web_search']);
    expect(binding.get('web_search')?.schemaFingerprint).toBe('search@1');
  });

  it('binds every Google functionDeclaration in one entry', () => {
    const tools: GoogleAIToolType[] = [
      {
        functionDeclarations: [
          { name: 'get_weather', description: 'weather' },
          { name: 'run_code', description: 'code' },
        ],
      },
    ];

    const binding = createToolBinding(tools, DECLARED_TOOLS);

    expect([...binding.keys()]).toEqual(['get_weather', 'run_code']);
  });

  it('keeps a duplicated name once, at the position it was first bound', () => {
    const tools: BindToolsInput[] = [
      { name: 'get_weather', description: 'first' },
      { name: 'run_code', description: 'second' },
      { name: 'get_weather', description: 'third' },
    ];

    const binding = createToolBinding(tools, DECLARED_TOOLS);

    expect([...binding.keys()]).toEqual(['get_weather', 'run_code']);
  });

  it('ignores entries carrying no usable name', () => {
    const tools: BindToolsInput[] = [
      { description: 'nameless' },
      { name: '', description: 'empty' },
      { name: 'run_code', description: 'usable' },
    ];

    const binding = createToolBinding(tools, DECLARED_TOOLS);

    expect([...binding.keys()]).toEqual(['run_code']);
  });

  it('records no fingerprint for a bound tool the port never declared', () => {
    const binding = createToolBinding([makeTool('rm_rf')], DECLARED_TOOLS);

    expect(binding.get('rm_rf')?.schemaFingerprint).toBeUndefined();
  });

  it('returns an independent binding per call', () => {
    const tools = [makeTool('get_weather')];

    const first = createToolBinding(tools, DECLARED_TOOLS);
    const second = createToolBinding(tools, DECLARED_TOOLS);

    expect(first).not.toBe(second);
    expect([...first.keys()]).toEqual([...second.keys()]);
  });

  it('binds nothing when no tools are supplied', () => {
    expect(createToolBinding(undefined, DECLARED_TOOLS).size).toBe(0);
    expect(createToolBinding([], DECLARED_TOOLS).size).toBe(0);
  });
});

describe('allowedToolNames', () => {
  /**
   * S5: `allowedTools` is "the CURRENT bound subset, never the compiled
   * superset". A port told about the superset would be free to select a tool
   * the host never bound.
   */
  it('is the bound subset in bind order, not the declared superset', () => {
    const binding = createToolBinding(
      [makeTool('get_weather')],
      DECLARED_TOOLS
    );

    expect(allowedToolNames(binding)).toEqual(['get_weather']);
  });

  it('preserves bind order across several tools', () => {
    const binding = createToolBinding(
      [makeTool('run_code'), makeTool('get_weather')],
      DECLARED_TOOLS
    );

    expect(allowedToolNames(binding)).toEqual(['run_code', 'get_weather']);
  });
});

describe('emitToolCalls — B11, the safety gate', () => {
  it('rejects a declared-but-unbound selection instead of emitting a tool_call', () => {
    const binding = createToolBinding(
      [makeTool('get_weather')],
      DECLARED_TOOLS
    );

    const emission = emitToolCalls(
      [select('web_search', { query: 'weather in Austin' })],
      binding,
      DECLARED_TOOLS
    );

    expect(emission.toolCalls).toEqual([]);
    expect(emission.toolCallChunks).toEqual([]);
    expect(emission.failures).toEqual([
      {
        code: 'unbound',
        message: expect.stringContaining('web_search'),
        toolName: 'web_search',
      },
    ]);
  });

  it('rejects a selection the port never declared', () => {
    const binding = createToolBinding([makeTool('rm_rf')], DECLARED_TOOLS);

    const emission = emitToolCalls([select('rm_rf')], binding, DECLARED_TOOLS);

    expect(emission.toolCalls).toEqual([]);
    expect(emission.failures[0]?.code).toBe('unbound');
  });

  it('rejects a bound name whose declared fingerprint drifted after bind time', () => {
    const binding = createToolBinding(
      [makeTool('get_weather')],
      DECLARED_TOOLS
    );
    const recompiled: readonly BamlDeclaredTool[] = [
      { name: 'get_weather', schemaFingerprint: 'weather@2' },
      { name: 'web_search', schemaFingerprint: 'search@1' },
      { name: 'run_code', schemaFingerprint: 'code@1' },
    ];

    const emission = emitToolCalls(
      [select('get_weather', { city: 'Austin' })],
      binding,
      recompiled
    );

    expect(emission.toolCalls).toEqual([]);
    expect(emission.failures).toEqual([
      {
        code: 'schema_mismatch',
        message: expect.stringContaining('get_weather'),
        toolName: 'get_weather',
      },
    ]);
  });

  it('emits the call when the fingerprint still matches', () => {
    const binding = createToolBinding(
      [makeTool('get_weather')],
      DECLARED_TOOLS
    );

    const emission = emitToolCalls(
      [select('get_weather', { city: 'Austin' })],
      binding,
      DECLARED_TOOLS
    );

    expect(emission.failures).toEqual([]);
    expect(emission.toolCalls).toHaveLength(1);
    expect(emission.toolCalls[0]?.name).toBe('get_weather');
  });
});

/**
 * B11's invariant, table-driven rather than generated: the repo carries no
 * property-testing framework and AF-d9m decided not to add one.
 */
describe('emitToolCalls — B11 invariant over selection sets', () => {
  const binding = createToolBinding(
    [makeTool('get_weather'), makeTool('run_code')],
    DECLARED_TOOLS
  );
  const allowed = allowedToolNames(binding);

  const cases: ReadonlyArray<{ label: string; selected: readonly string[] }> = [
    { label: 'empty', selected: [] },
    { label: 'all bound', selected: ['get_weather', 'run_code'] },
    { label: 'one declared-but-unbound', selected: ['web_search'] },
    {
      label: 'the full declared superset',
      selected: ['get_weather', 'web_search', 'run_code'],
    },
    {
      label: 'a repeated unbound name',
      selected: ['web_search', 'web_search'],
    },
    { label: 'a name outside the declaration', selected: ['rm_rf'] },
    {
      label: 'unbound and foreign interleaved with bound',
      selected: ['run_code', 'rm_rf', 'web_search', 'get_weather'],
    },
    {
      label: 'the same bound name twice',
      selected: ['get_weather', 'get_weather'],
    },
  ];

  it.each(cases)(
    'never emits a name outside the binding: $label',
    ({ selected }) => {
      const emission = emitToolCalls(
        selected.map((name) => select(name)),
        binding,
        DECLARED_TOOLS
      );

      for (const call of emission.toolCalls) {
        expect(allowed).toContain(call.name);
      }
      expect(emission.toolCalls.length + emission.failures.length).toBe(
        selected.length
      );
    }
  );
});

describe('emitToolCalls — B12, the mapping', () => {
  const binding = createToolBinding(
    [makeTool('get_weather'), makeTool('run_code')],
    DECLARED_TOOLS
  );

  it('preserves source order across interleaved failures', () => {
    const emission = emitToolCalls(
      [
        select('run_code', { query: 'a' }),
        select('web_search', { query: 'b' }),
        select('get_weather', { query: 'c' }),
      ],
      binding,
      DECLARED_TOOLS
    );

    expect(emission.toolCalls.map((call) => call.name)).toEqual([
      'run_code',
      'get_weather',
    ]);
    expect(emission.failures.map((failure) => failure.toolName)).toEqual([
      'web_search',
    ]);
  });

  it('gives every call a unique, non-empty id — including the same tool twice', () => {
    const emission = emitToolCalls(
      [
        select('get_weather', { city: 'Austin' }),
        select('get_weather', { city: 'Denver' }),
      ],
      binding,
      DECLARED_TOOLS
    );

    const ids = emission.toolCalls.map((call) => call.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id).not.toBe('');
    }
  });

  /**
   * `handleToolCallChunks` is never reached when the first chunk's `index` is
   * not a number (src/stream.ts:1756-1761) — streamed tool calls would go
   * nowhere, silently.
   */
  it('emits a dense numeric index on every tool_call_chunk', () => {
    const emission = emitToolCalls(
      [
        select('get_weather'),
        select('web_search'),
        select('run_code'),
        select('get_weather'),
      ],
      binding,
      DECLARED_TOOLS
    );

    expect(emission.toolCallChunks.map((chunk) => chunk.index)).toEqual([
      0, 1, 2,
    ]);
    for (const chunk of emission.toolCallChunks) {
      expect(typeof chunk.index).toBe('number');
    }
  });

  it('pairs each chunk with its call by id and name, and stringifies the args', () => {
    const emission = emitToolCalls(
      [select('get_weather', { city: 'Austin' })],
      binding,
      DECLARED_TOOLS
    );

    const [call] = emission.toolCalls;
    const [chunk] = emission.toolCallChunks;
    expect(chunk.id).toBe(call.id);
    expect(chunk.name).toBe('get_weather');
    expect(chunk.args).toBe('{"city":"Austin"}');
    expect(call.args).toEqual({ city: 'Austin' });
    expect(call.type).toBe('tool_call');
  });

  /** `attemptInvoke` silently drops any tool_call with a falsy name
   * (src/llm/invoke.ts:1032-1036), so a name is never optional. */
  it('always emits a name on the call', () => {
    const emission = emitToolCalls(
      [select('run_code'), select('get_weather')],
      binding,
      DECLARED_TOOLS
    );

    for (const call of emission.toolCalls) {
      expect(call.name).toBeTruthy();
    }
  });

  it('returns empty results for an empty selection list', () => {
    const emission = emitToolCalls([], binding, DECLARED_TOOLS);

    expect(emission).toEqual({
      toolCalls: [],
      toolCallChunks: [],
      failures: [],
    });
  });
});
