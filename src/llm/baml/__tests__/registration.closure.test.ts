import { describe, expect, it } from '@jest/globals';
import type { BamlDeclaredTool } from '@/llm/baml';
import { createPortFixture } from '@/llm/baml/__tests__/portFixture';
import { BAML_PORT_VERSION, ChatBAML } from '@/llm/baml';
import { initializeModel } from '@/llm/init';
import { Providers } from '@/common';

/**
 * BLOCKING CLOSURE (B5). The trigger is importing '@/llm/baml' above — a
 * module side-effect — and the observation is made through `initializeModel`.
 *
 * This is the only test that runs against the production registry singleton,
 * so it must never reach into the seam: it does not import, read, or write
 * `llmProviders`, never calls `registerChatModel`, and never constructs
 * `ChatBAML` itself. Everything it knows, it learns through `initializeModel`.
 */
describe('B5 — importing the baml entry registers the provider', () => {
  it('resolves Providers.BAML into a ChatBAML through initializeModel', () => {
    const model = initializeModel({
      provider: Providers.BAML,
      clientOptions: { functions: createPortFixture() },
    });

    expect(model).toBeInstanceOf(ChatBAML);
  });

  it('carries the host-supplied port onto the model it constructs', () => {
    const declaredTools: readonly BamlDeclaredTool[] = [
      { name: 'get_weather', schemaFingerprint: 'sha256:get_weather@1' },
    ];
    const functions = createPortFixture(declaredTools);

    const model = initializeModel({
      provider: Providers.BAML,
      clientOptions: { functions },
    });

    if (!(model instanceof ChatBAML)) {
      throw new Error('initializeModel did not return a ChatBAML');
    }
    expect(model.functions).toBe(functions);
    expect(model.functions.version).toBe(BAML_PORT_VERSION);
  });

  it('publishes the port contract from the same entry that registers', () => {
    expect(BAML_PORT_VERSION).toBe(1);
  });
});
