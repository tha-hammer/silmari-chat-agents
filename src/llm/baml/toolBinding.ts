import { v4 as uuidv4 } from 'uuid';
import type { ToolCall, ToolCallChunk } from '@langchain/core/messages/tool';
import type {
  BamlDeclaredTool,
  BamlSelectedTool,
  BamlToolFailure,
} from '@/llm/baml/types';
import type * as t from '@/types';

/**
 * A tool bound to a ChatBAML runnable, carrying the schema fingerprint the
 * port declared for that name **at bind time**. The fingerprint is opaque to
 * this package — it is the host's fingerprint of its compiled BAML schema, so
 * it can only be compared against itself, never recomputed from a LangChain
 * tool. Snapshotting it is what makes the comparison in
 * {@link emitToolCalls} meaningful: it detects a port whose declaration
 * drifted after the model was bound and prompted.
 */
export interface BamlBoundTool {
  readonly name: string;
  /** Absent when the port declared no tool of this name at bind time. */
  readonly schemaFingerprint?: string;
}

/** The frozen bound subset. Never the port's compiled superset. */
export type BamlToolBinding = ReadonlyMap<string, BamlBoundTool>;

/**
 * The binding of an invocation that bound no tools — the `generateTitle` shape
 * (`src/run.ts:1708`). Every selection fails against it, which is the correct
 * reading: a turn that bound nothing authorized nothing.
 */
export const NO_TOOL_BINDING: BamlToolBinding = new Map<
  string,
  BamlBoundTool
>();

export interface BamlToolEmission {
  readonly toolCalls: ToolCall[];
  readonly toolCallChunks: ToolCallChunk[];
  readonly failures: BamlToolFailure[];
}

function readName(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { name } = value as { name?: unknown };
  if (typeof name !== 'string' || name.length === 0) {
    return null;
  }
  return name;
}

/**
 * The names one `GraphTools` entry contributes. The union is not a uniform
 * record (`src/types/graph.ts:330`): a LangChain tool carries `name`, an
 * OpenAI tool definition nests it under `function`, and a Google tool object
 * carries several under `functionDeclarations`.
 */
function toolNames(entry: unknown): string[] {
  if (typeof entry !== 'object' || entry === null) {
    return [];
  }

  const { functionDeclarations } = entry as { functionDeclarations?: unknown };
  if (Array.isArray(functionDeclarations)) {
    const names: string[] = [];
    for (const declaration of functionDeclarations) {
      const name = readName(declaration);
      if (name !== null) {
        names.push(name);
      }
    }
    return names;
  }

  const nested = readName((entry as { function?: unknown }).function);
  if (nested !== null) {
    return [nested];
  }

  const own = readName(entry);
  return own === null ? [] : [own];
}

function indexDeclaredTools(
  declaredTools: readonly BamlDeclaredTool[]
): ReadonlyMap<string, BamlDeclaredTool> {
  const index = new Map<string, BamlDeclaredTool>();
  for (const declared of declaredTools) {
    index.set(declared.name, declared);
  }
  return index;
}

/**
 * Freezes the tools bound to one runnable into the subset a turn is allowed to
 * select from. A repeated name keeps its first position and its last
 * definition, matching `ToolNode`'s own tool map (`src/tools/ToolNode.ts:826`).
 */
export function createToolBinding(
  tools: t.GraphTools | undefined,
  declaredTools: readonly BamlDeclaredTool[]
): BamlToolBinding {
  const binding = new Map<string, BamlBoundTool>();
  if (tools == null) {
    return binding;
  }

  const declared = indexDeclaredTools(declaredTools);
  for (const entry of tools) {
    for (const name of toolNames(entry)) {
      binding.set(name, {
        name,
        schemaFingerprint: declared.get(name)?.schemaFingerprint,
      });
    }
  }
  return binding;
}

/** The `allowedTools` a prompt input carries: the bound subset, in bind order. */
export function allowedToolNames(binding: BamlToolBinding): string[] {
  return [...binding.keys()];
}

function describeBinding(binding: BamlToolBinding): string {
  return binding.size === 0 ? '(none)' : [...binding.keys()].join(', ');
}

/** The reason a selection may not be emitted, or `null` when it may. */
function validateSelection(
  name: string,
  binding: BamlToolBinding,
  declared: ReadonlyMap<string, BamlDeclaredTool>
): BamlToolFailure | null {
  const bound = binding.get(name);
  if (bound == null) {
    return {
      code: 'unbound',
      message: `BAML selected "${name}", which is not bound to this model. Bound tools: ${describeBinding(binding)}.`,
      toolName: name,
    };
  }

  const current = declared.get(name);
  if (current == null) {
    return {
      code: 'unbound',
      message: `BAML selected "${name}", which is bound but is not declared by the port.`,
      toolName: name,
    };
  }

  if (bound.schemaFingerprint !== current.schemaFingerprint) {
    return {
      code: 'schema_mismatch',
      message: `BAML selected "${name}", bound against schema "${bound.schemaFingerprint ?? '(undeclared)'}" but now declared as "${current.schemaFingerprint}".`,
      toolName: name,
    };
  }

  return null;
}

/**
 * Turns a turn's selections into `tool_calls` in one order-preserving pass,
 * rejecting anything the current binding does not authorize.
 *
 * This is a safety gate, not a formatting step: an unbound name that reached
 * `toolsCondition` would route to `ToolNode` and be dispatched by the host
 * (`src/tools/ToolNode.ts:4541-4568`). Rejections become failures and are
 * never emitted as calls, and never as `invalid_tool_calls` — those carry
 * their own id-bearing routing requirements (`:5144-5160`).
 *
 * Failures returned here are the *validation* failures only; a caller merges
 * them with the failures the port itself reported.
 */
export function emitToolCalls(
  selections: readonly BamlSelectedTool[],
  binding: BamlToolBinding,
  declaredTools: readonly BamlDeclaredTool[]
): BamlToolEmission {
  const declared = indexDeclaredTools(declaredTools);
  const toolCalls: ToolCall[] = [];
  const toolCallChunks: ToolCallChunk[] = [];
  const failures: BamlToolFailure[] = [];

  for (const selection of selections) {
    const failure = validateSelection(selection.name, binding, declared);
    if (failure != null) {
      failures.push(failure);
      continue;
    }

    const id = uuidv4();
    toolCalls.push({
      id,
      name: selection.name,
      args: selection.args,
      type: 'tool_call',
    });
    /** `index` must be numeric or `handleToolCallChunks` is never reached
     * (`src/stream.ts:1756-1761`) and the call goes nowhere, silently. */
    toolCallChunks.push({
      id,
      name: selection.name,
      args: JSON.stringify(selection.args),
      index: toolCallChunks.length,
      type: 'tool_call_chunk',
    });
  }

  return { toolCalls, toolCallChunks, failures };
}
