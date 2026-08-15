import { describe, expect, it } from '@jest/globals';
import type {
  HookJSONOutput,
  SyncHookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';
import type { ToolApprovalDecision } from '@/types/hitl';
import {
  toSdkPreToolUseHook,
  toSdkCanUseTool,
} from '@/llm/claudeAgentSdk/hookAdapter';
import { createToolPolicyHook } from '@/hooks/createToolPolicyHook';

const CTX = { runId: 'r1' };

function sdkInput(fields: {
  toolName: string;
  toolInput?: Record<string, unknown>;
}) {
  return {
    hook_event_name: 'PreToolUse' as const,
    tool_name: fields.toolName,
    tool_input: fields.toolInput ?? {},
    tool_use_id: 'x',
    session_id: 's',
    transcript_path: '/x',
    cwd: '/x',
  };
}

/** The adapter's own output is always sync-shaped; never the async variant. */
function syncOutput(out: HookJSONOutput): SyncHookJSONOutput {
  expect(out).not.toHaveProperty('async');
  return out as SyncHookJSONOutput;
}

describe('B20 — PreToolUse allow/deny decisions translate to the SDK\'s granular decision channel', () => {
  it.each([
    {
      label: 'allow',
      policy: { allow: ['read_*'] },
      toolName: 'read_file',
      expected: { permissionDecision: 'allow' },
    },
    {
      label: 'allow+updatedInput',
      policy: { allow: ['read_*'] },
      toolName: 'read_file',
      expected: { permissionDecision: 'allow' },
    },
    {
      label: 'deny',
      policy: { deny: ['delete_*'], reason: 'blocked: {tool}' },
      toolName: 'delete_file',
      expected: {
        permissionDecision: 'deny',
        permissionDecisionReason: 'blocked: delete_file',
      },
    },
  ])('$label', async ({ policy, toolName, expected }) => {
    const policyHook = createToolPolicyHook(policy); // REAL, unmodified
    const sdkHook = toSdkPreToolUseHook(policyHook, CTX);

    const out = await sdkHook(sdkInput({ toolName }), 'x', {
      signal: new AbortController().signal,
    });

    expect(syncOutput(out).hookSpecificOutput).toMatchObject(expected);
  });

  it('deny+updatedInput drops updatedInput: sending both is a nonsensical combination', async () => {
    const policyHook = createToolPolicyHook({ deny: ['delete_*'] });
    const sdkHook = toSdkPreToolUseHook(policyHook, CTX);

    const out = await sdkHook(sdkInput({ toolName: 'delete_file' }), 'x', {
      signal: new AbortController().signal,
    });

    expect(syncOutput(out).hookSpecificOutput).not.toHaveProperty(
      'updatedInput'
    );
  });

  it('ask abstains: permissionDecision is omitted, falling through to canUseTool', async () => {
    const policyHook = createToolPolicyHook({ ask: ['edit_file'] });
    const sdkHook = toSdkPreToolUseHook(policyHook, CTX);

    const out = await sdkHook(sdkInput({ toolName: 'edit_file' }), 'x', {
      signal: new AbortController().signal,
    });

    expect(syncOutput(out).hookSpecificOutput).not.toHaveProperty(
      'permissionDecision'
    );
  });
});

describe('B22 — respond degrades honestly to a denial, never a fabricated success', () => {
  it.each([
    {
      label: 'approve',
      decision: { type: 'approve' } as ToolApprovalDecision,
      expected: { behavior: 'allow' },
    },
    {
      label: 'reject',
      decision: { type: 'reject', reason: 'no' } as ToolApprovalDecision,
      expected: { behavior: 'deny', message: 'no' },
    },
    {
      label: 'edit',
      decision: {
        type: 'edit',
        updatedInput: { city: 'Denver' },
      } as ToolApprovalDecision,
      expected: { behavior: 'allow', updatedInput: { city: 'Denver' } },
    },
    {
      label: 'respond',
      decision: {
        type: 'respond',
        responseText: 'no relevant results',
      } as ToolApprovalDecision,
      expected: { behavior: 'deny', message: 'no relevant results' },
    },
  ])('$label', async ({ decision, expected }) => {
    const resolver = async (): Promise<ToolApprovalDecision> => decision;
    const canUseTool = toSdkCanUseTool(resolver);

    const result = await canUseTool(
      'web_search',
      {},
      {
        signal: new AbortController().signal,
        toolUseID: 'x',
        requestId: 'r',
      }
    );

    expect(result).toEqual(expected);
  });

  it('respond never emits allow', async () => {
    const resolver = async (): Promise<ToolApprovalDecision> => ({
      type: 'respond',
      responseText: 'no relevant results',
    });
    const canUseTool = toSdkCanUseTool(resolver);

    const result = await canUseTool(
      'web_search',
      {},
      {
        signal: new AbortController().signal,
        toolUseID: 'x',
        requestId: 'r',
      }
    );

    expect(result?.behavior).not.toBe('allow');
  });
});
