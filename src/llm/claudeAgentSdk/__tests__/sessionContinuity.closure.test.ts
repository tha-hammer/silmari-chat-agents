import { describe, expect, it } from '@jest/globals';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import type { FakeQueryCall } from './fakeQuery';
import { SessionRegistry } from '@/llm/claudeAgentSdk/sessionRegistry';
import { attemptInvoke } from '@/llm/invoke';
import { initializeModel } from '@/llm/init';
import { resultSuccess } from './fixtures';
import { fakeQuery } from './fakeQuery';
import { Providers } from '@/common';

describe('B11 — a first turn with no prior session starts fresh and records the new session id [part of Closure B]', () => {
  it('records the session under thread_id and sent no resume on the first call', async () => {
    const registry = new SessionRegistry();
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery(
      [[resultSuccess({ result: 'hi', session_id: 's1' })]],
      calls
    );
    const config = { configurable: { thread_id: 't1' } };

    await attemptInvoke(
      {
        model: initializeModel({
          provider: Providers.CLAUDE_AGENT_SDK,
          clientOptions: { queryFn, sessionRegistry: registry },
        }),
        messages: [new HumanMessage('turn 1')],
        provider: Providers.CLAUDE_AGENT_SDK,
        onChunk: () => {},
      },
      config
    );

    expect(registry.get('t1')).toMatchObject({ sessionId: 's1' });
    expect(calls[0].options?.resume).toBeUndefined();
  });
});

describe('B12 — a second turn in the same thread resumes the recorded session [BLOCKING CLOSURE — Closure B]', () => {
  it('the second, freshly-constructed instance receives the first turn\'s session_id as resume', async () => {
    const registry = new SessionRegistry();
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery(
      [
        [resultSuccess({ result: 'reply 1', session_id: 's1' })],
        [resultSuccess({ result: 'reply 2', session_id: 's1' })],
      ],
      calls
    );
    const config = { configurable: { thread_id: 't1' } };

    await attemptInvoke(
      {
        model: initializeModel({
          provider: Providers.CLAUDE_AGENT_SDK,
          clientOptions: { queryFn, sessionRegistry: registry },
        }),
        messages: [new HumanMessage('turn 1')],
        provider: Providers.CLAUDE_AGENT_SDK,
        onChunk: () => {},
      },
      config
    );
    await attemptInvoke(
      {
        model: initializeModel({
          provider: Providers.CLAUDE_AGENT_SDK,
          clientOptions: { queryFn, sessionRegistry: registry },
        }), // a second, independently-constructed instance
        messages: [
          new HumanMessage('turn 1'),
          new AIMessage('reply 1'),
          new HumanMessage('turn 2'),
        ],
        provider: Providers.CLAUDE_AGENT_SDK,
        onChunk: () => {},
      },
      config // same thread_id
    );

    expect(calls[1].options?.resume).toBe('s1');
  });

  it('the resumed call sends only the content appended since the last call as the prompt', async () => {
    const registry = new SessionRegistry();
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery(
      [
        [resultSuccess({ result: 'reply 1', session_id: 's1' })],
        [resultSuccess({ result: 'reply 2', session_id: 's1' })],
      ],
      calls
    );
    const config = { configurable: { thread_id: 't1' } };

    await attemptInvoke(
      {
        model: initializeModel({
          provider: Providers.CLAUDE_AGENT_SDK,
          clientOptions: { queryFn, sessionRegistry: registry },
        }),
        messages: [new HumanMessage('turn 1')],
        provider: Providers.CLAUDE_AGENT_SDK,
        onChunk: () => {},
      },
      config
    );
    await attemptInvoke(
      {
        model: initializeModel({
          provider: Providers.CLAUDE_AGENT_SDK,
          clientOptions: { queryFn, sessionRegistry: registry },
        }),
        messages: [
          new HumanMessage('turn 1'),
          new AIMessage('reply 1'),
          new HumanMessage('turn 2'),
        ],
        provider: Providers.CLAUDE_AGENT_SDK,
        onChunk: () => {},
      },
      config
    );

    expect(calls[1].prompt).toBe('turn 2');
  });
});
