// CJS consumer — published artifacts only. Proves the dual CJS+ESM decision:
// `require('@librechat/agents/baml')` loads dist/cjs/llm/baml/index.cjs, which
// registers into the SAME dist/cjs registry singleton that the CJS root reads.
// An ESM-only subpath beside a CJS root would create two registries and this
// would fail — which is exactly why the reversal to dual format matters.
const assert = require('node:assert/strict');
require('@librechat/agents/baml'); // side-effect via the require path
const { BAML_PORT_VERSION } = require('@librechat/agents/baml');
const { Providers, getChatModelClass, initializeModel } = require('@librechat/agents');

const ctor = getChatModelClass(Providers.BAML);
assert.equal(typeof ctor, 'function', 'BAML ctor should resolve after requiring ./baml');
assert.equal(ctor.name, 'ChatBAML', 'resolved ctor should be ChatBAML');

const functions = {
  version: BAML_PORT_VERSION,
  declaredTools: [],
  takeTurn: async () => ({ kind: 'answer', text: 'ok' }),
  streamTurn: async function* () {},
};
const model = initializeModel({ provider: Providers.BAML, clientOptions: { functions } });
assert.equal(model.constructor.name, 'ChatBAML', 'initializeModel should build a ChatBAML');

console.log('dual-format require path shares one registry with the CJS root');
