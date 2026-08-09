import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { BamlClientOptions, BamlFunctionSet } from '@/llm/baml/types';

/**
 * Chat model backed by a host-supplied BAML port. This package imports no
 * bridge and owns no `.baml` files — `functions` is the entire dependency.
 */
export class ChatBAML extends BaseChatModel {
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

  async _generate(
    _messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    throw new Error('ChatBAML turn execution is not implemented yet');
  }
}
