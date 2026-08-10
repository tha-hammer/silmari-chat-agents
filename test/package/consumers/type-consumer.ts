// Type consumer — published types only. Implements the port against the types
// exported from `@librechat/agents/baml` with NO casts (the B0 contract), and
// references the full public error surface (the S1 grammar) to prove it is
// reachable from the packaged entry. Type-checked under both bundler
// (exports.types) and node10 (typesVersions); see the two tsconfigs and the
// resolution-mode note in run.mjs.
import '@librechat/agents/baml';
import { BAML_PORT_VERSION } from '@librechat/agents/baml';
import type {
  BamlClientOptions,
  BamlFunctionSet,
  BamlTurnResult,
} from '@librechat/agents/baml';
import {
  BamlNotRegisteredError,
  BamlPortVersionError,
  BamlToolNotBoundError,
  BamlTurnError,
  BamlUnsupportedError,
} from '@librechat/agents/baml';

// A compile-only host adapter implementing the port — no `as` casts anywhere.
const functions: BamlFunctionSet = {
  version: BAML_PORT_VERSION,
  declaredTools: [],
  takeTurn: async (): Promise<BamlTurnResult> => ({ kind: 'answer', text: '' }),
  streamTurn: async function* () {},
};
const options: BamlClientOptions = { functions };
void options;

// The public error classes ship from `./baml` at both type and value level.
void [
  BamlNotRegisteredError,
  BamlPortVersionError,
  BamlToolNotBoundError,
  BamlTurnError,
  BamlUnsupportedError,
];
