import type {
  BamlFailureCode,
  BamlPortVersion,
  BamlToolFailure,
} from '@/llm/baml/types';
import { BAML_PORT_VERSION } from '@/llm/baml/types';

/**
 * Raised when the root entry resolves `Providers.BAML` but nothing registered a
 * constructor for it — the consumer named the provider without importing the
 * `./baml` entry, whose module side-effect is the only registration point. The
 * default message carries the remediation so the failure is diagnosable rather
 * than the cryptic generic "Unsupported LLM provider".
 */
export class BamlNotRegisteredError extends Error {
  constructor(
    message = 'Providers.BAML is registered by a module side-effect, not the ' +
      'root barrel. Import the "@librechat/agents/baml" entry once (for its ' +
      'registration side-effect) before resolving or constructing a BAML model.'
  ) {
    super(message);
    this.name = 'BamlNotRegisteredError';
  }
}

/**
 * Raised at construction when the host adapter declares a port version this
 * build does not speak. Detecting it once, up front, turns a mismatch into a
 * clear failure instead of a wrong answer later at request time.
 */
export class BamlPortVersionError extends Error {
  readonly expected: BamlPortVersion;
  readonly received: number;

  constructor(received: number, expected: BamlPortVersion = BAML_PORT_VERSION) {
    super(
      `BAML port version mismatch: this build speaks version ${expected}, but ` +
        `the host adapter declared version ${received}. Regenerate the adapter ` +
        'against the matching @librechat/agents release.'
    );
    this.name = 'BamlPortVersionError';
    this.expected = expected;
    this.received = received;
  }
}

/**
 * Raised when a tool is asked for that is not part of the model's current
 * binding — the compiled superset is not the bound subset. Carries the offending
 * name and, when known, the bound set, so a caller can see what was available
 * without parsing the message.
 */
export class BamlToolNotBoundError extends Error {
  readonly toolName: string;
  readonly boundTools: readonly string[] | undefined;

  constructor(toolName: string, boundTools?: readonly string[]) {
    const bound =
      boundTools == null
        ? ''
        : ` Bound tools: ${boundTools.length === 0 ? '(none)' : boundTools.join(', ')}.`;
    super(
      `Tool "${toolName}" is not bound to this model and cannot be dispatched.${bound}`
    );
    this.name = 'BamlToolNotBoundError';
    this.toolName = toolName;
    this.boundTools = boundTools;
  }
}

/**
 * Raised when a turn resolves to a `failure` outcome. The port reports per-tool
 * failures as values rather than rejections, so this is the one place a failure
 * becomes throwable — carrying the code so a caller can branch on the kind of
 * failure instead of matching on message text.
 */
export class BamlTurnError extends Error {
  readonly code: BamlFailureCode;
  readonly toolName: string | undefined;

  constructor(failure: BamlToolFailure) {
    const named = failure.toolName == null ? '' : ` [${failure.toolName}]`;
    super(`BAML turn failed (${failure.code})${named}: ${failure.message}`);
    this.name = 'BamlTurnError';
    this.code = failure.code;
    this.toolName = failure.toolName;
  }
}

/**
 * Raised for a capability this phase deliberately does not support. Failing at
 * the call site is honest: the alternative is a confusing failure later, at
 * request time, from machinery the caller never asked for.
 */
export class BamlUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BamlUnsupportedError';
  }
}
