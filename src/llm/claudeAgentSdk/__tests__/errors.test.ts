import { describe, expect, it } from '@jest/globals';
import {
  ClaudeAgentSDKToolsUnsupportedError,
  ClaudeAgentSDKResultError,
  ClaudeAgentSDKSessionResumeError,
} from '@/llm/claudeAgentSdk/errors';

/**
 * B24 — public errors are actionable: stable typed classes, not message
 * fragments. All three ship from `@/llm/claudeAgentSdk/errors`; callers
 * branch on the class and read structured fields rather than matching on
 * message text — this provider carries no separate npm subpath (unlike
 * BAML), so this file path is the stable import surface, matching every
 * other static (non-BAML) provider's posture.
 */
describe('B24 — public errors are actionable', () => {
  describe('ClaudeAgentSDKToolsUnsupportedError', () => {
    it('is an Error subclass with a stable name (B4)', () => {
      const err = new ClaudeAgentSDKToolsUnsupportedError();
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ClaudeAgentSDKToolsUnsupportedError');
    });

    it('names the workaround so a caller is not stuck guessing', () => {
      const err = new ClaudeAgentSDKToolsUnsupportedError();
      expect(err.message).toContain('toolAliases');
      expect(err.message).toContain('createSdkMcpServer');
    });

    it('accepts a caller-supplied message', () => {
      const err = new ClaudeAgentSDKToolsUnsupportedError('custom message');
      expect(err.message).toBe('custom message');
    });
  });

  describe('ClaudeAgentSDKResultError', () => {
    it('carries subtype and errors verbatim (B8)', () => {
      const err = new ClaudeAgentSDKResultError('error_max_turns', [
        'boom',
        'again',
      ]);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ClaudeAgentSDKResultError');
      expect(err.subtype).toBe('error_max_turns');
      expect(err.errors).toEqual(['boom', 'again']);
      expect(err.message).toContain('error_max_turns');
      expect(err.message).toContain('boom');
    });

    it('tolerates an empty errors array', () => {
      const err = new ClaudeAgentSDKResultError('error_during_execution', []);
      expect(err.errors).toEqual([]);
    });
  });

  describe('ClaudeAgentSDKSessionResumeError', () => {
    it('names both the recorded and the newly-resolved cwd (B15)', () => {
      const err = new ClaudeAgentSDKSessionResumeError(
        '/workspace/original',
        '/workspace/moved'
      );
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ClaudeAgentSDKSessionResumeError');
      expect(err.recordedCwd).toBe('/workspace/original');
      expect(err.resolvedCwd).toBe('/workspace/moved');
      expect(err.message).toContain('/workspace/original');
      expect(err.message).toContain('/workspace/moved');
    });

    it('tolerates an undefined recorded cwd', () => {
      const err = new ClaudeAgentSDKSessionResumeError(
        undefined,
        '/workspace/moved'
      );
      expect(err.recordedCwd).toBeUndefined();
    });
  });
});
