import { z } from 'zod';
import { describe, expect, it } from '@jest/globals';
import { createPortFixture } from '@/llm/baml/__tests__/portFixture';
import { BamlUnsupportedError } from '@/llm/baml/errors';
import { ChatBAML } from '@/llm/baml/ChatBAML';

/**
 * B16. `BaseChatModel`'s inherited `withStructuredOutput` binds a *synthetic*
 * tool, which cannot exist in a build-time-frozen compiled union — it would
 * reach B11's gate at request time and be rejected as unbound, surfacing as a
 * confusing per-tool failure far from the call that caused it. Failing at the
 * call site is the honest place.
 */
describe('B16 — withStructuredOutput is explicitly unsupported this phase', () => {
  const schema = z.object({ title: z.string() });

  it('throws BamlUnsupportedError rather than binding a synthetic tool', () => {
    const model = new ChatBAML({ functions: createPortFixture() });

    expect(() => model.withStructuredOutput(schema)).toThrow(
      BamlUnsupportedError
    );
  });

  it('names the unsupported method and the workaround', () => {
    const model = new ChatBAML({ functions: createPortFixture() });

    expect(() => model.withStructuredOutput(schema)).toThrow(
      /withStructuredOutput/
    );
    expect(() => model.withStructuredOutput(schema)).toThrow(/completion/i);
  });

  it('throws for the raw-output variant too', () => {
    const model = new ChatBAML({ functions: createPortFixture() });

    expect(() =>
      model.withStructuredOutput(schema, { includeRaw: true })
    ).toThrow(BamlUnsupportedError);
  });

  it('leaves the model usable after the refusal', async () => {
    const model = new ChatBAML({ functions: createPortFixture() });

    expect(() => model.withStructuredOutput(schema)).toThrow(
      BamlUnsupportedError
    );
    await expect(model.invoke('still fine')).resolves.toBeDefined();
  });
});
