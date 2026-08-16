/**
 * Live Claude Agent SDK bare-turn verification.
 *
 * Run with:
 * npm run test:live:claude-agent-sdk
 * CLAUDE_AGENT_SDK_LIVE_MODEL=<model> npm run test:live:claude-agent-sdk
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { AIMessageChunk, HumanMessage } from '@langchain/core/messages';
import { describe, expect, it } from '@jest/globals';
import { initializeModel } from '@/llm/init';
import { Providers } from '@/common';

const LIVE_MODEL_ENV = 'CLAUDE_AGENT_SDK_LIVE_MODEL';
const RUN_LIVE_ENV = 'RUN_CLAUDE_AGENT_SDK_LIVE_TESTS';
const LIVE_ENABLED_VALUE = '1';
const LIVE_TEST_TIMEOUT_MS = 120_000;
const MAX_TURNS = 1;

const shouldRunLive = process.env[RUN_LIVE_ENV] === LIVE_ENABLED_VALUE;
const describeIfLive = shouldRunLive ? describe : describe.skip;
const liveModel = process.env[LIVE_MODEL_ENV]?.trim();
const modelOptions =
  liveModel == null || liveModel === '' ? {} : { model: liveModel };

describeIfLive('Claude Agent SDK bare turn (live)', () => {
  it(
    'returns a real assistant response without host tool calls',
    async () => {
      const marker = `CLAUDE_AGENT_SDK_LIVE_${Date.now()}`;
      const model = initializeModel({
        provider: Providers.CLAUDE_AGENT_SDK,
        clientOptions: {
          cwd: process.cwd(),
          maxTurns: MAX_TURNS,
          ...modelOptions,
        },
        tools: undefined,
      });

      const response = await model.invoke([
        new HumanMessage(
          `Reply with exactly ${marker} and nothing else. Do not use tools.`
        ),
      ]);

      if (!AIMessageChunk.isInstance(response)) {
        throw new TypeError(
          'Expected Claude Agent SDK to return an AI message chunk'
        );
      }

      const text =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
      const usage = response.usage_metadata;

      expect(text).not.toBe('');
      expect(text).toContain(marker);
      expect(response.tool_calls ?? []).toHaveLength(0);
      expect(response.tool_call_chunks ?? []).toHaveLength(0);
      expect(usage).toBeDefined();

      if (usage == null) {
        throw new TypeError('Expected Claude Agent SDK usage metadata');
      }

      expect(usage.input_tokens).toBeGreaterThan(0);
      expect(usage.output_tokens).toBeGreaterThan(0);
      expect(usage.total_tokens).toBe(usage.input_tokens + usage.output_tokens);
      expect(response.response_metadata.session_id).toEqual(expect.any(String));
      expect(response.response_metadata.session_id).not.toBe('');
      expect(response.response_metadata.num_turns).toBeGreaterThanOrEqual(1);
    },
    LIVE_TEST_TIMEOUT_MS
  );
});
