import { describe, expect, it } from '@jest/globals';
import type {
  BamlDeclaredTool,
  BamlClientOptions,
  BamlFunctionSet,
  BamlPromptInput,
  BamlTurnResult,
  BamlTurnChunk,
} from '@/llm/baml/types';
import type {
  ChatModelConstructorMap,
  ProviderOptionsMap,
  ClientOptions,
} from '@/types';
import { BAML_PORT_VERSION } from '@/llm/baml/types';
import { ChatBAML } from '@/llm/baml/ChatBAML';
import { Providers } from '@/common';

const declaredTools: readonly BamlDeclaredTool[] = [
  { name: 'get_weather', schemaFingerprint: 'sha256:get_weather@1' },
];

/**
 * A real implementation of our port, written with no casts. If this fixture
 * ever needs one, the public type is wrong — that is the point of B0.
 */
function createCompileFixture(): BamlFunctionSet {
  return {
    version: BAML_PORT_VERSION,
    declaredTools,
    takeTurn(input: BamlPromptInput): Promise<BamlTurnResult> {
      return Promise.resolve({
        kind: 'answer',
        text: `saw ${input.transcript.length} entries`,
      });
    },
    async *streamTurn(input: BamlPromptInput): AsyncIterable<BamlTurnChunk> {
      yield { kind: 'text', text: `saw ${input.transcript.length} entries` };
    },
  };
}

describe('B0 — public type closure lands with the enum', () => {
  it('exposes BAML as a Providers member', () => {
    expect(Providers.BAML).toBe('baml');
  });

  it('accepts BamlClientOptions as both the provider options map entry and a ClientOptions member', () => {
    const options: BamlClientOptions = {
      functions: createCompileFixture(),
      model: 'baml-configured-model',
    };

    const providerOptions: ProviderOptionsMap[Providers.BAML] = options;
    const clientOptions: ClientOptions = options;

    expect(options.functions.version).toBe(BAML_PORT_VERSION);
    expect(providerOptions.functions.declaredTools).toEqual(declaredTools);
    expect(clientOptions).toBe(options);
  });

  it('satisfies the constructor the mapped ChatModelConstructorMap demands', () => {
    const Ctor: ChatModelConstructorMap[Providers.BAML] = ChatBAML;

    const model = new Ctor({ functions: createCompileFixture() });

    expect(model).toBeInstanceOf(ChatBAML);
  });

  it('carries the port contract through a turn without casts', async () => {
    const functions = createCompileFixture();

    const result = await functions.takeTurn({
      version: BAML_PORT_VERSION,
      transcript: [{ role: 'user', content: 'hi' }],
      allowedTools: ['get_weather'],
    });

    expect(result).toEqual({ kind: 'answer', text: 'saw 1 entries' });
  });
});
