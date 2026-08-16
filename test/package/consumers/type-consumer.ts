// Type consumer — published types only. Implements the port against the types
// exported from `@librechat/agents/baml` with NO casts (the B0 contract), and
// references the complete public value/type surface to prove it is reachable
// from the packaged entry. Type-checked under bundler, node10, NodeNext, and
// Node16; see the consumer configs and the resolution-mode note in run.mjs.
import '@librechat/agents/baml';
import {
  BAML_PORT_VERSION,
  BamlNotRegisteredError,
  BamlPortVersionError,
  BamlToolNotBoundError,
  BamlTurnError,
  BamlUnsupportedError,
  ChatBAML,
} from '@librechat/agents/baml';
import type {
  BamlAnswerOutcome,
  BamlCallMeta,
  BamlClientOptions,
  BamlDeclaredTool,
  BamlFailureCode,
  BamlFailureOutcome,
  BamlFunctionSet,
  BamlPortVersion,
  BamlPromptInput,
  BamlSelectedTool,
  BamlTextChunk,
  BamlToolCallsOutcome,
  BamlToolFailure,
  BamlTranscriptEntry,
  BamlTranscriptRole,
  BamlTranscriptToolCall,
  BamlTurnChunk,
  BamlTurnResult,
} from '@librechat/agents/baml';

type PublicBamlTypes = readonly [
  BamlPortVersion,
  BamlDeclaredTool,
  BamlSelectedTool,
  BamlFailureCode,
  BamlToolFailure,
  BamlCallMeta,
  BamlTranscriptRole,
  BamlTranscriptToolCall,
  BamlTranscriptEntry,
  BamlPromptInput,
  BamlAnswerOutcome,
  BamlTextChunk,
  BamlToolCallsOutcome,
  BamlFailureOutcome,
  BamlTurnResult,
  BamlTurnChunk,
  BamlFunctionSet,
  BamlClientOptions,
];

declare const publicBamlTypes: PublicBamlTypes;
void publicBamlTypes;

// A compile-only host adapter implementing the port — no `as` casts anywhere.
const functions: BamlFunctionSet = {
  version: BAML_PORT_VERSION,
  declaredTools: [],
  takeTurn: async (): Promise<BamlTurnResult> => ({ kind: 'answer', text: '' }),
  streamTurn: async function* () {},
};
const options: BamlClientOptions = { functions };
void options;

// Every public runtime value ships from `./baml`.
void [
  ChatBAML,
  BAML_PORT_VERSION,
  BamlNotRegisteredError,
  BamlPortVersionError,
  BamlToolNotBoundError,
  BamlTurnError,
  BamlUnsupportedError,
];
