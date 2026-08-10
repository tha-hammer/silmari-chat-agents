// ESM consumer — published artifacts only, no @/ aliases, no src/ paths.
// Proves the `./baml` side-effect import registers into the SAME registry the
// root's `getChatModelClass` / `initializeModel` read.
import assert from 'node:assert/strict';
import '@librechat/agents/baml'; // side-effect: registerChatModel(BAML, ChatBAML)
import { BAML_PORT_VERSION } from '@librechat/agents/baml';
import { Providers, getChatModelClass, initializeModel } from '@librechat/agents';

const ctor = getChatModelClass(Providers.BAML);
assert.equal(typeof ctor, 'function', 'BAML ctor should resolve after importing ./baml');
assert.equal(ctor.name, 'ChatBAML', 'resolved ctor should be ChatBAML');

const functions = {
  version: BAML_PORT_VERSION,
  declaredTools: [],
  takeTurn: async () => ({ kind: 'answer', text: 'ok' }),
  streamTurn: async function* () {},
};
const model = initializeModel({ provider: Providers.BAML, clientOptions: { functions } });
assert.ok(model, 'initializeModel should return a model');
assert.equal(model.constructor.name, 'ChatBAML', 'initializeModel should build a ChatBAML');

console.log('./baml registered; root initializeModel resolved BAML from the packed package');
