import { describe, expect, it } from '@jest/globals';
import type * as t from '@/types';
import { ClaudeAgentSDKToolsUnsupportedError } from '@/llm/claudeAgentSdk/errors';
import { initializeModel } from '@/llm/init';
import { Providers } from '@/common';

const oneTool: t.GraphTools = [
  {
    name: 'get_weather',
    description: 'look up the weather',
    schema: { type: 'object', properties: {} },
  },
];

describe('Closure D — bindTools throws before any SDK call is made [BLOCKING — safety]', () => {
  it('throws ClaudeAgentSDKToolsUnsupportedError from initializeModel with a non-empty tool list', () => {
    expect(() =>
      initializeModel({
        provider: Providers.CLAUDE_AGENT_SDK,
        clientOptions: { cwd: '/tmp' },
        tools: oneTool,
      })
    ).toThrow(ClaudeAgentSDKToolsUnsupportedError);
  });
});
