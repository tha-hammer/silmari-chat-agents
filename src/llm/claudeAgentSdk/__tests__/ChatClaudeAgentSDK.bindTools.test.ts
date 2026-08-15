import { describe, expect, it } from '@jest/globals';
import type * as t from '@/types';
import { ClaudeAgentSDKToolsUnsupportedError } from '@/llm/claudeAgentSdk/errors';
import { ChatClaudeAgentSDK } from '@/llm/claudeAgentSdk/ChatClaudeAgentSDK';
import { initializeModel } from '@/llm/init';
import { Providers } from '@/common';

const fakeTool = {
  name: 'get_weather',
  description: 'look up the weather',
  schema: { type: 'object', properties: {} },
};

describe('B4 — bindTools throws a typed, named error [safety — Closure D]', () => {
  it('throws ClaudeAgentSDKToolsUnsupportedError when called directly', () => {
    const model = new ChatClaudeAgentSDK({ cwd: '/tmp' });

    expect(() => model.bindTools([fakeTool])).toThrow(
      ClaudeAgentSDKToolsUnsupportedError
    );
  });

  /**
   * Table-driven over initializeModel's tool-list domain — the production
   * caller, not a direct bindTools() call. initializeModel skips bindTools
   * entirely for an empty list (src/llm/init.ts:58-60), so only a non-empty
   * list ever reaches — and throws from — bindTools.
   */
  it.each([
    { label: 'empty array', tools: [] as t.GraphTools, throws: false },
    { label: 'one tool', tools: [fakeTool] as t.GraphTools, throws: true },
    {
      label: 'three tools',
      tools: [fakeTool, fakeTool, fakeTool] as t.GraphTools,
      throws: true,
    },
  ])('$label: throws iff tools.length > 0', ({ tools, throws }) => {
    const invoke = () =>
      initializeModel({
        provider: Providers.CLAUDE_AGENT_SDK,
        clientOptions: { cwd: '/tmp' },
        tools,
      });

    if (throws) {
      expect(invoke).toThrow(ClaudeAgentSDKToolsUnsupportedError);
    } else {
      expect(invoke).not.toThrow();
    }
  });
});
