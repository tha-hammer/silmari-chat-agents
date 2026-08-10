import { describe, expect, it } from '@jest/globals';
import type { BamlToolFailure } from '@/llm/baml/types';
import {
  BamlNotRegisteredError,
  BamlPortVersionError,
  BamlToolNotBoundError,
  BamlTurnError,
  BamlUnsupportedError,
} from '@/llm/baml/errors';
import { BAML_PORT_VERSION } from '@/llm/baml/types';

/**
 * B20 — public errors are actionable: stable typed classes, not message
 * fragments. All five ship from `@/llm/baml/errors`; callers branch on the
 * class and read structured fields rather than matching on message text.
 */
describe('B20 — public BAML errors are actionable', () => {
  describe('BamlNotRegisteredError', () => {
    it('is an Error subclass with a stable name', () => {
      const err = new BamlNotRegisteredError();
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('BamlNotRegisteredError');
    });

    it('carries the remediation — importing the ./baml entry', () => {
      const err = new BamlNotRegisteredError();
      expect(err.message).toContain('@librechat/agents/baml');
    });

    it('accepts a caller-supplied message when a call site has more context', () => {
      const err = new BamlNotRegisteredError('custom remediation');
      expect(err.message).toBe('custom remediation');
    });
  });

  describe('BamlPortVersionError', () => {
    it('reports both the expected and the received port version', () => {
      const err = new BamlPortVersionError(2);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('BamlPortVersionError');
      expect(err.expected).toBe(BAML_PORT_VERSION);
      expect(err.received).toBe(2);
      expect(err.message).toContain(String(BAML_PORT_VERSION));
      expect(err.message).toContain('2');
    });
  });

  describe('BamlToolNotBoundError', () => {
    it('names the offending tool and the current bound set', () => {
      const err = new BamlToolNotBoundError('web_search', ['get_weather']);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('BamlToolNotBoundError');
      expect(err.toolName).toBe('web_search');
      expect(err.boundTools).toEqual(['get_weather']);
      expect(err.message).toContain('web_search');
      expect(err.message).toContain('get_weather');
    });

    it('omits the bound set from state and message when not supplied', () => {
      const err = new BamlToolNotBoundError('web_search');
      expect(err.boundTools).toBeUndefined();
      expect(err.message).toContain('web_search');
    });
  });

  describe('BamlTurnError (existing signature — preserved, not changed)', () => {
    it('carries the failure code and tool name from a BamlToolFailure', () => {
      const failure: BamlToolFailure = {
        code: 'model_error',
        message: 'boom',
        toolName: 'get_weather',
      };
      const err = new BamlTurnError(failure);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('BamlTurnError');
      expect(err.code).toBe('model_error');
      expect(err.toolName).toBe('get_weather');
      expect(err.message).toContain('model_error');
    });

    it('tolerates an absent tool name', () => {
      const failure: BamlToolFailure = { code: 'parse_error', message: 'bad' };
      const err = new BamlTurnError(failure);
      expect(err.toolName).toBeUndefined();
    });
  });

  describe('BamlUnsupportedError (existing signature — preserved, not changed)', () => {
    it('wraps a caller-supplied message', () => {
      const err = new BamlUnsupportedError(
        'withStructuredOutput is unsupported'
      );
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('BamlUnsupportedError');
      expect(err.message).toContain('withStructuredOutput');
    });
  });
});
