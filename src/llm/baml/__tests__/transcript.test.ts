import { describe, expect, it } from '@jest/globals';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type {
  BamlTranscriptEntry,
  BamlTranscriptRole,
} from '@/llm/baml/types';
import { projectTranscript, restoreTranscript } from '@/llm/baml/transcript';

function buildToolLoopHistory(): BaseMessage[] {
  return [
    new SystemMessage('You are a helpful assistant.'),
    new HumanMessage('Weather in Paris and Berlin?'),
    new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'call_paris',
          name: 'get_weather',
          args: { city: 'Paris' },
          type: 'tool_call',
        },
        {
          id: 'call_berlin',
          name: 'get_weather',
          args: { city: 'Berlin' },
          type: 'tool_call',
        },
      ],
    }),
    new ToolMessage({ tool_call_id: 'call_paris', content: 'Paris: 18C' }),
    new ToolMessage({ tool_call_id: 'call_berlin', content: 'Berlin: 15C' }),
  ];
}

function collectEmittedCallIds(entries: BamlTranscriptEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    for (const call of entry.toolCalls ?? []) {
      ids.add(call.id);
    }
  }
  return ids;
}

function collectResultCallIds(entries: BamlTranscriptEntry[]): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry.role === 'tool' && entry.toolCallId != null) {
      ids.push(entry.toolCallId);
    }
  }
  return ids;
}

interface RoundtripCase {
  name: string;
  messages: BaseMessage[];
  roles: BamlTranscriptRole[];
}

const roundtripCases: RoundtripCase[] = [
  {
    name: 'empty history',
    messages: [],
    roles: [],
  },
  {
    name: 'system and user only',
    messages: [new SystemMessage('be terse'), new HumanMessage('hi')],
    roles: ['system', 'user'],
  },
  {
    name: 'a plain answer with no tools',
    messages: [
      new HumanMessage('2 + 2?'),
      new AIMessage({ content: 'Four.' }),
    ],
    roles: ['user', 'assistant'],
  },
  {
    name: 'a full tool loop',
    messages: buildToolLoopHistory(),
    roles: ['system', 'user', 'assistant', 'tool', 'tool'],
  },
  {
    name: 'the same tool selected twice',
    messages: [
      new HumanMessage('compare Paris and Paris'),
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'call_a',
            name: 'get_weather',
            args: { city: 'Paris' },
            type: 'tool_call',
          },
          {
            id: 'call_b',
            name: 'get_weather',
            args: { city: 'Paris' },
            type: 'tool_call',
          },
        ],
      }),
      new ToolMessage({ tool_call_id: 'call_b', content: 'second' }),
      new ToolMessage({ tool_call_id: 'call_a', content: 'first' }),
    ],
    roles: ['user', 'assistant', 'tool', 'tool'],
  },
  {
    name: 'two sequential tool rounds',
    messages: [
      new HumanMessage('chain them'),
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'round_1',
            name: 'lookup',
            args: { q: 'a' },
            type: 'tool_call',
          },
        ],
      }),
      new ToolMessage({ tool_call_id: 'round_1', content: 'a-result' }),
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'round_2',
            name: 'lookup',
            args: { q: 'a-result' },
            type: 'tool_call',
          },
        ],
      }),
      new ToolMessage({ tool_call_id: 'round_2', content: 'b-result' }),
      new AIMessage({ content: 'done' }),
    ],
    roles: ['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant'],
  },
];

describe('B6 — the transcript projection is versioned and replay-safe', () => {
  it('preserves role, order, tool_call_id pairing, and args across a tool loop', () => {
    const entries = projectTranscript(buildToolLoopHistory());

    expect(entries).toStrictEqual([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Weather in Paris and Berlin?' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_paris', name: 'get_weather', args: { city: 'Paris' } },
          { id: 'call_berlin', name: 'get_weather', args: { city: 'Berlin' } },
        ],
      },
      { role: 'tool', content: 'Paris: 18C', toolCallId: 'call_paris' },
      { role: 'tool', content: 'Berlin: 15C', toolCallId: 'call_berlin' },
    ]);
  });

  it('emits entries that survive JSON serialization unchanged', () => {
    const entries = projectTranscript(buildToolLoopHistory());

    expect(JSON.parse(JSON.stringify(entries))).toStrictEqual(entries);
  });

  it('projects an empty history to an empty transcript', () => {
    expect(projectTranscript([])).toStrictEqual([]);
  });

  it('preserves complex content blocks verbatim', () => {
    const entries = projectTranscript([
      new HumanMessage({
        content: [
          { type: 'text', text: 'Describe this' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
          },
        ],
      }),
    ]);

    expect(entries[0].content).toStrictEqual([
      { type: 'text', text: 'Describe this' },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
      },
    ]);
  });

  it('preserves reasoning blocks alongside text', () => {
    const entries = projectTranscript([
      new AIMessage({
        content: [
          { type: 'thinking', thinking: 'carry the one', signature: 'sig-1' },
          { type: 'text', text: 'The answer is 4.' },
        ],
      }),
    ]);

    expect(entries[0].content).toStrictEqual([
      { type: 'thinking', thinking: 'carry the one', signature: 'sig-1' },
      { type: 'text', text: 'The answer is 4.' },
    ]);
  });

  it('keeps a tool result whose call is absent, rather than dropping it', () => {
    const entries = projectTranscript([
      new HumanMessage('go'),
      new ToolMessage({ tool_call_id: 'orphan', content: 'stray result' }),
    ]);

    expect(entries).toStrictEqual([
      { role: 'user', content: 'go' },
      { role: 'tool', content: 'stray result', toolCallId: 'orphan' },
    ]);
  });

  it('does not truncate large content', () => {
    const bulk = 'x'.repeat(200_000);

    const entries = projectTranscript([new HumanMessage(bulk)]);

    expect(entries[0].content).toBe(bulk);
  });

  it('does not throw on self-referential content', () => {
    const block: Record<string, unknown> = { type: 'text', text: 'loop' };
    block.self = block;

    const entries = projectTranscript([
      new AIMessage({ content: [block] as AIMessage['content'] }),
    ]);

    expect(() => JSON.stringify(entries)).not.toThrow();
  });
});

describe('B6 roundtrip — projecting and restoring preserves order and pairing', () => {
  it.each(roundtripCases)(
    'preserves role order for $name',
    ({ messages, roles }) => {
      const entries = projectTranscript(messages);

      expect(entries.map((entry) => entry.role)).toStrictEqual(roles);
      expect(projectTranscript(restoreTranscript(entries))).toStrictEqual(
        entries
      );
    }
  );

  it.each(roundtripCases)(
    'preserves every tool_call_id pairing for $name',
    ({ messages }) => {
      const entries = projectTranscript(messages);
      const restored = projectTranscript(restoreTranscript(entries));

      expect(collectResultCallIds(restored)).toStrictEqual(
        collectResultCallIds(entries)
      );
      expect([...collectEmittedCallIds(restored)]).toStrictEqual([
        ...collectEmittedCallIds(entries),
      ]);
      for (const resultId of collectResultCallIds(restored)) {
        expect(collectEmittedCallIds(restored).has(resultId)).toBe(true);
      }
    }
  );

  it('restores messages whose types match the original sequence', () => {
    const original = buildToolLoopHistory();

    const restored = restoreTranscript(projectTranscript(original));

    expect(restored.map((message) => message._getType())).toStrictEqual(
      original.map((message) => message._getType())
    );
  });

  it('restores tool call ids onto the assistant message', () => {
    const restored = restoreTranscript(
      projectTranscript(buildToolLoopHistory())
    );
    const assistant = restored[2] as AIMessage;

    expect(assistant.tool_calls?.map((call) => call.id)).toStrictEqual([
      'call_paris',
      'call_berlin',
    ]);
  });

  it('restores tool_call_id onto each tool message', () => {
    const restored = restoreTranscript(
      projectTranscript(buildToolLoopHistory())
    );

    expect((restored[3] as ToolMessage).tool_call_id).toBe('call_paris');
    expect((restored[4] as ToolMessage).tool_call_id).toBe('call_berlin');
  });
});
