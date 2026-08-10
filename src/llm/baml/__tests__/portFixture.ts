import type {
  BamlFunctionSet,
  BamlDeclaredTool,
  BamlPromptInput,
  BamlTurnResult,
  BamlTurnChunk,
} from '@/llm/baml/types';
import { BAML_PORT_VERSION } from '@/llm/baml/types';

/**
 * The smallest real implementation of our port — enough to make a valid
 * `BamlClientOptions` for tests that never exercise a turn. Turn-driving tests
 * use the scripted `fakeFunctionSet` instead.
 *
 * It is a real implementation, not a mock: no cast appears anywhere in it, and
 * if one ever becomes necessary the public type is wrong.
 */
export function createPortFixture(
  declaredTools: readonly BamlDeclaredTool[] = []
): BamlFunctionSet {
  const describeTurn = (input: BamlPromptInput): string =>
    `saw ${input.transcript.length} entries`;

  return {
    version: BAML_PORT_VERSION,
    declaredTools,
    takeTurn(input: BamlPromptInput): Promise<BamlTurnResult> {
      return Promise.resolve({ kind: 'answer', text: describeTurn(input) });
    },
    async *streamTurn(
      input: BamlPromptInput
    ): AsyncGenerator<BamlTurnChunk, void, undefined> {
      yield { kind: 'text', text: describeTurn(input) };
    },
  };
}
