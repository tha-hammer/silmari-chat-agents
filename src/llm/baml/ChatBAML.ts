import { ChatGenerationChunk } from '@langchain/core/outputs';
import { AIMessage, AIMessageChunk } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseChatModelCallOptions } from '@langchain/core/language_models/chat_models';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { BaseMessage } from '@langchain/core/messages';
import type { Runnable } from '@langchain/core/runnables';
import type { ChatResult } from '@langchain/core/outputs';
import type {
  BamlClientOptions,
  BamlFunctionSet,
  BamlPromptInput,
  BamlToolCallsOutcome,
  BamlCallMeta,
  BamlToolFailure,
} from '@/llm/baml/types';
import type { BamlToolBinding } from '@/llm/baml/toolBinding';
import type { BamlMessageMeta } from '@/llm/baml/callMeta';
import type * as t from '@/types';
import {
  createToolBinding,
  allowedToolNames,
  NO_TOOL_BINDING,
  emitToolCalls,
} from '@/llm/baml/toolBinding';
import { BamlUnsupportedError, BamlTurnError } from '@/llm/baml/errors';
import { projectTranscript } from '@/llm/baml/transcript';
import { messageMetaFields } from '@/llm/baml/callMeta';
import { BAML_PORT_VERSION } from '@/llm/baml/types';

/** Where a turn's rejected selections are recorded, so a gated call is auditable. */
export const BAML_TOOL_FAILURES_KEY = 'baml_tool_failures';

export interface ChatBAMLCallOptions extends BaseChatModelCallOptions {
  /** The tools bound for THIS invocation, frozen by {@link ChatBAML.bindTools}. */
  toolBinding?: BamlToolBinding;
}

/**
 * Chat model backed by a host-supplied BAML port. This package imports no
 * bridge and owns no `.baml` files — `functions` is the entire dependency.
 */
export class ChatBAML extends BaseChatModel<ChatBAMLCallOptions> {
  readonly functions: BamlFunctionSet;
  readonly model?: string;

  static lc_name(): 'ChatBAML' {
    return 'ChatBAML';
  }

  constructor(fields: BamlClientOptions) {
    super(fields);
    this.functions = fields.functions;
    this.model = fields.model;
  }

  _llmType(): string {
    return 'baml';
  }

  /**
   * Freezes `tools` into a binding carried by the returned runnable's call
   * options. The receiver is untouched: two runnables bound from one model are
   * independent, including when invoked concurrently.
   */
  bindTools(
    tools: t.GraphTools,
    kwargs?: Partial<ChatBAMLCallOptions>
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, ChatBAMLCallOptions> {
    return this.withConfig({
      ...kwargs,
      toolBinding: createToolBinding(tools, this.functions.declaredTools),
    });
  }

  /**
   * Unsupported this phase, and deliberately loud. The inherited implementation
   * binds a *synthetic* tool, which cannot exist in a build-time-frozen
   * compiled union: it would reach the binding gate at request time and be
   * rejected as unbound, surfacing as a per-tool failure far from the call that
   * caused it. Failing here is the honest place.
   */
  withStructuredOutput(_outputSchema: unknown, _config?: unknown): never {
    throw new BamlUnsupportedError(
      'ChatBAML does not support withStructuredOutput: it binds a synthetic tool, which cannot exist in a build-time-frozen BAML union. Declare the shape as a BAML function and read it from the answer text instead. Run.generateTitle supports BAML only in TitleMethod.COMPLETION mode.'
    );
  }

  /**
   * General cancellation is the provider's own job: `attemptInvoke` inspects
   * `config.signal` only for `StreamLimitExceededError`
   * (`src/llm/invoke.ts:868-876`).
   *
   * Called before the port is reached on both paths — `BaseChatModel` enters
   * the generator body before it checks the signal, so without this an
   * already-aborted call would still issue a request. A *mid-flight* abort
   * needs nothing here: delivery is stopped by `BaseChatModel`'s own iterator,
   * and the port learns of it through the `AbortSignal` threaded into
   * {@link promptInput}, the way `src/llm/mistral/index.ts:26-30` threads it.
   */
  private throwIfAborted(options: this['ParsedCallOptions']): void {
    options.signal?.throwIfAborted();
  }

  private toolBinding(options: this['ParsedCallOptions']): BamlToolBinding {
    return options.toolBinding ?? NO_TOOL_BINDING;
  }

  /**
   * The tool names bound for THIS invocation. Bindings ride call options rather
   * than instance state, so concurrently-invoked runnables derived from one
   * model cannot see each other's tools.
   */
  private allowedTools(options: this['ParsedCallOptions']): string[] {
    return allowedToolNames(this.toolBinding(options));
  }

  private promptInput(
    messages: BaseMessage[],
    options: this['ParsedCallOptions']
  ): BamlPromptInput {
    return {
      version: BAML_PORT_VERSION,
      transcript: projectTranscript(messages),
      allowedTools: this.allowedTools(options),
      ...(options.signal == null ? {} : { signal: options.signal }),
    };
  }

  /**
   * Selections are validated against the current binding before any of them
   * becomes a `tool_call` — a declared-but-unbound name that reached `ToolNode`
   * would be dispatched by the host (`src/tools/ToolNode.ts:4541-4568`).
   *
   * A rejected selection is recorded alongside the port's own failures rather
   * than dropped: without the record, a host whose port keeps choosing an
   * unbound tool sees an empty assistant turn and no way to find out why.
   */
  private toolCallsMessage(
    outcome: BamlToolCallsOutcome,
    options: this['ParsedCallOptions'],
    metaFields: BamlMessageMeta = messageMetaFields(outcome.meta)
  ): AIMessageChunk {
    const emission = emitToolCalls(
      outcome.calls,
      this.toolBinding(options),
      this.functions.declaredTools
    );
    const failures: BamlToolFailure[] = [
      ...outcome.failures,
      ...emission.failures,
    ];
    const { response_metadata: responseMetadata, ...usage } = metaFields;

    return new AIMessageChunk({
      content: '',
      tool_calls: emission.toolCalls,
      tool_call_chunks: emission.toolCallChunks,
      response_metadata: {
        ...responseMetadata,
        ...(failures.length === 0 ? {} : { [BAML_TOOL_FAILURES_KEY]: failures }),
      },
      ...usage,
    });
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    this.throwIfAborted(options);
    const result = await this.functions.takeTurn(
      this.promptInput(messages, options)
    );

    if (result.kind === 'failure') {
      throw new BamlTurnError(result.failure);
    }

    if (result.kind === 'tool_calls') {
      const message = this.toolCallsMessage(result, options);
      return { generations: [{ text: '', message }] };
    }

    await runManager?.handleLLMNewToken(result.text);
    return {
      generations: [
        {
          text: result.text,
          message: new AIMessage({
            content: result.text,
            ...messageMetaFields(result.meta),
          }),
        },
      ],
    };
  }

  /**
   * An empty stream still yields one chunk. `attemptInvoke` accumulates into a
   * `finalChunk` that starts `undefined` and is cast on return
   * (`src/llm/invoke.ts:859,1039`), so a provider that yields nothing hands the
   * graph an `undefined` masquerading as a message.
   *
   * Usage is attached to the first chunk that reports countable tokens and
   * suppressed thereafter: the aggregator sums `usage_metadata` across merged
   * chunks, so repeating it would multiply the counts.
   *
   * `for await` closes the port's iterator on every exit path — early consumer
   * return, an abort, and exhaustion all run its `finally`, because the loop
   * desugars to a `try/finally` that calls `iterator.return()`. That is the
   * cleanup B14 requires; an explicit iterator dance would guard only the
   * window between acquiring the iterable and entering the loop, and no code
   * occupies it.
   */
  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    this.throwIfAborted(options);
    const turn = this.functions.streamTurn(this.promptInput(messages, options));
    let yielded = false;
    let usageEmitted = false;

    const meteredFields = (meta: BamlCallMeta | undefined): BamlMessageMeta => {
      const fields = messageMetaFields(meta);
      if (fields.usage_metadata == null) {
        return fields;
      }
      if (usageEmitted) {
        return { response_metadata: fields.response_metadata };
      }
      usageEmitted = true;
      return fields;
    };

    for await (const chunk of turn) {
      if (chunk.kind === 'failure') {
        throw new BamlTurnError(chunk.failure);
      }
      yielded = true;
      if (chunk.kind === 'tool_calls') {
        yield new ChatGenerationChunk({
          text: '',
          message: this.toolCallsMessage(
            chunk,
            options,
            meteredFields(chunk.meta)
          ),
        });
        continue;
      }
      await runManager?.handleLLMNewToken(chunk.text);
      yield new ChatGenerationChunk({
        text: chunk.text,
        message: new AIMessageChunk({
          content: chunk.text,
          ...meteredFields(chunk.meta),
        }),
      });
    }

    if (!yielded) {
      yield new ChatGenerationChunk({
        text: '',
        message: new AIMessageChunk({ content: '' }),
      });
    }
  }
}
