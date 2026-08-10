import type {
  BamlDeclaredTool,
  BamlFunctionSet,
  BamlPromptInput,
  BamlTurnResult,
  BamlTurnChunk,
} from '@/llm/baml/types';
import { BAML_PORT_VERSION } from '@/llm/baml/types';

export interface FakeFunctionSetOptions {
  declaredTools?: readonly BamlDeclaredTool[];
  /** Consumed in order, one per `takeTurn`. */
  results?: readonly BamlTurnResult[];
  /** Consumed in order, one script per `streamTurn`. */
  chunks?: readonly (readonly BamlTurnChunk[])[];
  /** Runs after the call is recorded, before the outcome is produced. */
  onTurn?: (input: BamlPromptInput) => Promise<void>;
}

/**
 * A real implementation of our port — not a mock of BAML. It replays scripted
 * outcomes and records every input it was handed, so tests can assert on what
 * crossed S5 (allowed tools, transcript, signal) and on how many times it
 * crossed.
 */
export interface FakeFunctionSet extends BamlFunctionSet {
  /** Every `BamlPromptInput` the port received, in call order. */
  readonly calls: BamlPromptInput[];
  /** Streams whose iterator ran its `finally` — closed or exhausted. */
  readonly closedStreams: () => number;
}

function exhausted(kind: string, scripted: number): Error {
  return new Error(
    `fakeFunctionSet: ${kind} was called more times than the ${scripted} outcome(s) scripted for it`
  );
}

export function createFakeFunctionSet(
  options: FakeFunctionSetOptions = {}
): FakeFunctionSet {
  const declaredTools = options.declaredTools ?? [];
  const pendingResults = [...(options.results ?? [])];
  const pendingChunks = [...(options.chunks ?? [])];
  const scriptedResults = pendingResults.length;
  const scriptedChunks = pendingChunks.length;
  const calls: BamlPromptInput[] = [];
  let closed = 0;

  return {
    version: BAML_PORT_VERSION,
    declaredTools,
    calls,
    closedStreams: (): number => closed,
    async takeTurn(input: BamlPromptInput): Promise<BamlTurnResult> {
      calls.push(input);
      await options.onTurn?.(input);
      const next = pendingResults.shift();
      if (next == null) {
        throw exhausted('takeTurn', scriptedResults);
      }
      return next;
    },
    streamTurn(input: BamlPromptInput): AsyncIterable<BamlTurnChunk> {
      calls.push(input);
      const script = pendingChunks.shift();
      if (script == null) {
        throw exhausted('streamTurn', scriptedChunks);
      }
      const hook = options.onTurn;
      return (async function* (): AsyncGenerator<BamlTurnChunk, void, undefined> {
        try {
          await hook?.(input);
          yield* script;
        } finally {
          closed += 1;
        }
      })();
    },
  };
}
