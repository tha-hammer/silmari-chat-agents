import {
  describe,
  expect,
  it,
  jest,
  beforeEach,
  afterEach,
} from '@jest/globals';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import type { BindToolsInput } from '@langchain/core/language_models/chat_models';
import type { AIMessageChunk } from '@langchain/core/messages';
import type { Runnable } from '@langchain/core/runnables';
import type { BamlClientOptions } from '@/llm/baml/types';
import type * as t from '@/types';
import {
  __resetChatModelRegistry,
  getChatModelClass,
  registerChatModel,
  llmProviders,
} from '@/llm/providers';
import { createPortFixture } from '@/llm/baml/__tests__/portFixture';
import { ChatBAML } from '@/llm/baml/ChatBAML';
import { initializeModel } from '@/llm/init';
import { ChatOpenAI } from '@/llm/openai';
import { Providers } from '@/common';

/** Every enum member except BAML, derived from the enum so a new provider cannot skip the guard. */
const BUILT_IN_PROVIDERS: readonly Providers[] = Object.values(
  Providers
).filter((provider) => provider !== Providers.BAML);

function bamlOptions(): BamlClientOptions {
  return { functions: createPortFixture() };
}

/**
 * A real ChatBAML subclass, not a mock: `initializeModel` constructs it for
 * real and `bindTools` runs its real implementation under a spy.
 */
class RecordingChatBAML extends ChatBAML {
  readonly receivedOptions: BamlClientOptions;

  constructor(fields: BamlClientOptions) {
    super(fields);
    this.receivedOptions = fields;
  }

  bindTools(
    _tools: BindToolsInput[]
  ): Runnable<BaseLanguageModelInput, AIMessageChunk> {
    return this.withConfig({});
  }
}

/** A second, distinct constructor — used to prove the registry never clobbers. */
class OtherChatBAML extends ChatBAML {}

/**
 * A distinct constructor that is genuinely valid for a populated built-in. A
 * ChatBAML subclass cannot stand in here: `ChatModelConstructorMap` refuses it
 * for OPENAI at compile time, which is the type closure from B0 doing its job.
 */
class OtherChatOpenAI extends ChatOpenAI {}

describe('chat model registry', () => {
  let restoreRegistry: () => void;

  beforeEach(() => {
    restoreRegistry = __resetChatModelRegistry();
  });

  afterEach(() => {
    restoreRegistry();
    jest.restoreAllMocks();
  });

  describe('B1 — an unregistered provider stays inert', () => {
    it('throws for BAML when nothing has registered it', () => {
      expect(() => getChatModelClass(Providers.BAML)).toThrow(
        'Unsupported LLM provider: baml'
      );
    });
  });

  describe('B2 — registration makes a provider resolvable', () => {
    it('resolves to the constructor that was registered', () => {
      registerChatModel(Providers.BAML, RecordingChatBAML);

      expect(getChatModelClass(Providers.BAML)).toBe(RecordingChatBAML);
    });
  });

  describe('B2b — idempotent, never clobbering', () => {
    it('is silent when the same constructor is registered twice', () => {
      registerChatModel(Providers.BAML, RecordingChatBAML);

      expect(() =>
        registerChatModel(Providers.BAML, RecordingChatBAML)
      ).not.toThrow();
      expect(getChatModelClass(Providers.BAML)).toBe(RecordingChatBAML);
    });

    it('throws naming the provider when a different constructor is registered', () => {
      registerChatModel(Providers.BAML, RecordingChatBAML);

      expect(() => registerChatModel(Providers.BAML, OtherChatBAML)).toThrow(
        'Provider already registered: baml'
      );
    });

    it('leaves the original constructor in place after a rejected registration', () => {
      registerChatModel(Providers.BAML, RecordingChatBAML);

      expect(() => registerChatModel(Providers.BAML, OtherChatBAML)).toThrow();
      expect(getChatModelClass(Providers.BAML)).toBe(RecordingChatBAML);
    });

    it('refuses to overwrite a populated built-in', () => {
      expect(() =>
        registerChatModel(Providers.OPENAI, OtherChatOpenAI)
      ).toThrow('Provider already registered: openAI');
    });

    /**
     * Invariant, table-driven over every built-in (AF-d9m: this repo has no
     * property framework, so the domain is enumerated rather than generated).
     * The domain is restricted to providers that are NOT already registered —
     * each row clears its provider first, because registering over a populated
     * one is the separate, throwing case above.
     */
    it.each(BUILT_IN_PROVIDERS)(
      're-registers %s idempotently once it is unregistered',
      (provider) => {
        const original = llmProviders[provider];
        if (original == null) {
          throw new Error(`expected ${provider} to be a populated built-in`);
        }
        delete llmProviders[provider];
        expect(() => getChatModelClass(provider)).toThrow();

        registerChatModel(provider, original);
        registerChatModel(provider, original);

        expect(getChatModelClass(provider)).toBe(original);
      }
    );
  });

  describe('B3 — all thirteen built-ins undisturbed', () => {
    it('enumerates thirteen built-in providers from the enum', () => {
      expect(BUILT_IN_PROVIDERS).toHaveLength(13);
      expect(BUILT_IN_PROVIDERS).toContain(Providers.MISTRAL);
      expect(BUILT_IN_PROVIDERS).toContain(Providers.MISTRALAI);
    });

    it('resolves every built-in to the identical constructor after BAML registers', () => {
      const before = new Map(
        BUILT_IN_PROVIDERS.map((provider) => [
          provider,
          getChatModelClass(provider),
        ])
      );

      registerChatModel(Providers.BAML, RecordingChatBAML);

      for (const provider of BUILT_IN_PROVIDERS) {
        expect(getChatModelClass(provider)).toBe(before.get(provider));
      }
    });
  });

  describe('B4 — a registered class flows through initializeModel', () => {
    it('constructs an instance of the registered constructor with the client options', () => {
      registerChatModel(Providers.BAML, RecordingChatBAML);
      const clientOptions = bamlOptions();

      const model = initializeModel({
        provider: Providers.BAML,
        clientOptions,
      });

      if (!(model instanceof RecordingChatBAML)) {
        throw new Error('initializeModel did not return the registered class');
      }
      expect(model.receivedOptions).toBe(clientOptions);
    });

    it('does not bind tools when the tool list is empty', () => {
      registerChatModel(Providers.BAML, RecordingChatBAML);
      const bindTools = jest.spyOn(RecordingChatBAML.prototype, 'bindTools');

      initializeModel({
        provider: Providers.BAML,
        clientOptions: bamlOptions(),
        tools: [],
      });

      expect(bindTools).not.toHaveBeenCalled();
    });

    it('binds tools exactly once for a non-empty tool list', () => {
      registerChatModel(Providers.BAML, RecordingChatBAML);
      const bindTools = jest.spyOn(RecordingChatBAML.prototype, 'bindTools');
      const tools: t.GraphTools = [
        {
          name: 'get_weather',
          description: 'look up the weather',
          schema: { type: 'object', properties: {} },
        },
      ];

      initializeModel({
        provider: Providers.BAML,
        clientOptions: bamlOptions(),
        tools,
      });

      expect(bindTools).toHaveBeenCalledTimes(1);
      expect(bindTools).toHaveBeenCalledWith(tools);
    });

    it('short-circuits construction when an override model is supplied', () => {
      registerChatModel(Providers.BAML, RecordingChatBAML);
      const override = new OtherChatBAML(bamlOptions());

      const model = initializeModel({
        provider: Providers.BAML,
        clientOptions: bamlOptions(),
        override,
      });

      expect(model).toBe(override);
    });
  });

  describe('registry isolation seam', () => {
    it('removes a registration made inside the seam', () => {
      const restoreInner = __resetChatModelRegistry();
      registerChatModel(Providers.BAML, RecordingChatBAML);

      restoreInner();

      expect(() => getChatModelClass(Providers.BAML)).toThrow(
        'Unsupported LLM provider: baml'
      );
    });

    it('restores a provider deleted inside the seam', () => {
      const restoreInner = __resetChatModelRegistry();
      const original = getChatModelClass(Providers.OPENAI);
      delete llmProviders[Providers.OPENAI];

      restoreInner();

      expect(getChatModelClass(Providers.OPENAI)).toBe(original);
    });

    it('restores a provider clobbered inside the seam', () => {
      const restoreInner = __resetChatModelRegistry();
      const original = getChatModelClass(Providers.OPENAI);
      delete llmProviders[Providers.OPENAI];
      registerChatModel(Providers.OPENAI, OtherChatOpenAI);

      restoreInner();

      expect(getChatModelClass(Providers.OPENAI)).toBe(original);
    });
  });
});
