import type { BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import type { StreamSmoothingOptions } from '@/types/llm';
import type { JsonObject, JsonValue } from '@/session';

/**
 * The port contract version. A host adapter declares the version it was built
 * against; a mismatch is a construction-time failure rather than a wrong answer
 * at request time.
 */
export const BAML_PORT_VERSION = 1 as const;

export type BamlPortVersion = typeof BAML_PORT_VERSION;

/** A tool present in the host's compiled BAML union. */
export interface BamlDeclaredTool {
  readonly name: string;
  /** Stable fingerprint of the compiled schema; enables mismatch detection. */
  readonly schemaFingerprint: string;
}

/** A tool the model chose this turn. Ids are synthesized by ChatBAML, not the port. */
export interface BamlSelectedTool {
  readonly name: string;
  readonly args: JsonObject;
}

export type BamlFailureCode =
  | 'unbound'
  | 'schema_mismatch'
  | 'model_error'
  | 'parse_error';

export interface BamlToolFailure {
  readonly code: BamlFailureCode;
  readonly message: string;
  readonly toolName?: string;
}

/**
 * Optional call metadata. Every field is optional and none may be fabricated:
 * absent metadata means no `usage_metadata` is emitted, never zeros.
 */
export interface BamlCallMeta {
  readonly model?: string;
  readonly finishReason?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export type BamlTranscriptRole = 'system' | 'user' | 'assistant' | 'tool';

/** A prior tool call as it appears in the transcript, carrying the id it was emitted with. */
export interface BamlTranscriptToolCall extends BamlSelectedTool {
  readonly id: string;
}

/** Versioned, replay-safe projection of the conversation. Serializable by construction. */
export interface BamlTranscriptEntry {
  readonly role: BamlTranscriptRole;
  readonly content: JsonValue;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly BamlTranscriptToolCall[];
}

export interface BamlPromptInput {
  readonly version: BamlPortVersion;
  readonly transcript: readonly BamlTranscriptEntry[];
  /** The CURRENT bound subset, never the compiled superset. */
  readonly allowedTools: readonly string[];
  readonly signal?: AbortSignal;
}

/** The whole answer, produced by a non-streaming turn. */
export interface BamlAnswerOutcome {
  readonly kind: 'answer';
  readonly text: string;
  readonly meta?: BamlCallMeta;
}

/** One content delta of a streaming turn. */
export interface BamlTextChunk {
  readonly kind: 'text';
  readonly text: string;
  readonly meta?: BamlCallMeta;
}

/** Selections plus the per-tool failures that did not become selections. */
export interface BamlToolCallsOutcome {
  readonly kind: 'tool_calls';
  readonly calls: readonly BamlSelectedTool[];
  readonly failures: readonly BamlToolFailure[];
  readonly meta?: BamlCallMeta;
}

/** The turn itself failed, as a value rather than a rejection. */
export interface BamlFailureOutcome {
  readonly kind: 'failure';
  readonly failure: BamlToolFailure;
  readonly meta?: BamlCallMeta;
}

export type BamlTurnResult =
  | BamlAnswerOutcome
  | BamlToolCallsOutcome
  | BamlFailureOutcome;

export type BamlTurnChunk =
  | BamlTextChunk
  | BamlToolCallsOutcome
  | BamlFailureOutcome;

/**
 * The seam a host implements over its generated BAML SDK. This package never
 * imports the bridge; the host wires its adapter in through `functions`.
 *
 * Two obligations, both load-bearing:
 * 1. Neither method rejects for a per-tool failure — failures are values.
 *    Rejection is reserved for transport and abort.
 * 2. `meta` is optional and must never be fabricated.
 */
export interface BamlFunctionSet {
  readonly version: BamlPortVersion;
  readonly declaredTools: readonly BamlDeclaredTool[];
  takeTurn(input: BamlPromptInput): Promise<BamlTurnResult>;
  streamTurn(input: BamlPromptInput): AsyncIterable<BamlTurnChunk>;
}

export type BamlClientOptions = BaseChatModelParams &
  StreamSmoothingOptions & {
    /** Host-supplied port. Executable, and therefore not serializable across session restore. */
    functions: BamlFunctionSet;
    model?: string;
  };
