import { describe, expect, it } from '@jest/globals';
import type { ClaudeAgentSDKClientOptions } from '@/llm/claudeAgentSdk/types';

describe('B0 — public type closure lands with the enum', () => {
  it('ClaudeAgentSDKClientOptions accepts a cwd field', () => {
    const options: ClaudeAgentSDKClientOptions = { cwd: '/tmp/x' };

    expect(options.cwd).toBe('/tmp/x');
  });
});
