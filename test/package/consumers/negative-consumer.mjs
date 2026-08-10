// Negative consumer — the closure's fail-closed half. Importing ONLY the root
// (never `@librechat/agents/baml`) must leave BAML unregistered. This proves the
// root barrel does not name the provider and does not transitively pull in the
// registration side-effect; if it ever did, B19 would silently pass for the
// wrong reason and B5's red-at-seam proof would stop proving anything.
import assert from 'node:assert/strict';
import { Providers, getChatModelClass } from '@librechat/agents';

assert.throws(
  () => getChatModelClass(Providers.BAML),
  /Unsupported LLM provider: baml/,
  'root-only import must NOT register BAML',
);

console.log('root-only import leaves BAML unregistered (fails closed as required)');
