import type {
  PreToolUseHookInput as SdkPreToolUseHookInput,
  PostToolUseHookInput as SdkPostToolUseHookInput,
  HookCallback as SdkHookCallback,
  PermissionResult,
  CanUseTool,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  HookCallback,
  PreToolUseHookInput,
  PostToolUseHookInput,
} from '@/hooks/types';
import type { HitlResolver } from '@/llm/claudeAgentSdk/types';

/** Field-name translation shared by both hook directions (camelCase <-> snake_case). */
function baseRepoHookInput(fields: { runId: string; threadId?: string }): {
  runId: string;
  threadId?: string;
} {
  return {
    runId: fields.runId,
    ...(fields.threadId == null ? {} : { threadId: fields.threadId }),
  };
}

function toRepoPreToolUseInput(
  sdkInput: SdkPreToolUseHookInput,
  context: { runId: string; threadId?: string }
): PreToolUseHookInput {
  return {
    ...baseRepoHookInput(context),
    hook_event_name: 'PreToolUse',
    toolName: sdkInput.tool_name,
    toolInput: sdkInput.tool_input as Record<string, unknown>,
    toolUseId: sdkInput.tool_use_id,
  };
}

function toRepoPostToolUseInput(
  sdkInput: SdkPostToolUseHookInput,
  context: { runId: string; threadId?: string }
): PostToolUseHookInput {
  return {
    ...baseRepoHookInput(context),
    hook_event_name: 'PostToolUse',
    toolName: sdkInput.tool_name,
    toolInput: sdkInput.tool_input as Record<string, unknown>,
    toolOutput: sdkInput.tool_response,
    toolUseId: sdkInput.tool_use_id,
  };
}

/**
 * Wraps this repo's `PreToolUse` `HookCallback` into the SDK's own hook
 * shape (B20). `allow`/`deny` write into the granular
 * `hookSpecificOutput.permissionDecision` field and short-circuit — the SDK
 * never calls `canUseTool` for this tool call (Seam 6/Closure E). `ask` (or
 * no decision at all) abstains by omitting `permissionDecision` entirely,
 * letting the SDK's own documented evaluation order (hooks -> deny rules ->
 * ask rules -> permission mode -> allow rules -> `canUseTool`) fall through
 * to `canUseTool` (Seam 7/Closure C) — the one extension point confirmed to
 * actually pause.
 *
 * `deny` + `updatedInput` drops `updatedInput`: sending both is a
 * nonsensical combination the real hook shape has no room for.
 */
export function toSdkPreToolUseHook(
  repoHook: HookCallback<'PreToolUse'>,
  context: { runId: string; threadId?: string }
): SdkHookCallback {
  return async (sdkInput, _toolUseId, options) => {
    const repoOutput = await repoHook(
      toRepoPreToolUseInput(sdkInput as SdkPreToolUseHookInput, context),
      options.signal
    );

    if (repoOutput.decision === 'allow') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          ...(repoOutput.reason == null
            ? {}
            : { permissionDecisionReason: repoOutput.reason }),
          ...(repoOutput.updatedInput == null
            ? {}
            : { updatedInput: repoOutput.updatedInput }),
        },
      };
    }
    if (repoOutput.decision === 'deny') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          ...(repoOutput.reason == null
            ? {}
            : { permissionDecisionReason: repoOutput.reason }),
        },
      };
    }
    // 'ask' or no decision at all: abstain — omit permissionDecision
    // entirely so the SDK's own evaluation order falls through to
    // canUseTool, rather than emitting a value the real type has no
    // 'ask' branch for.
    return { hookSpecificOutput: { hookEventName: 'PreToolUse' } };
  };
}

/**
 * Wraps this repo's `PostToolUse` `HookCallback` into the SDK's own hook
 * shape. `updatedOutput` maps to the SDK's `updatedToolOutput` — the real
 * field name (`updatedMCPToolOutput` is MCP-tool-only and superseded by it).
 */
export function toSdkPostToolUseHook(
  repoHook: HookCallback<'PostToolUse'>,
  context: { runId: string; threadId?: string }
): SdkHookCallback {
  return async (sdkInput, _toolUseId, options) => {
    const repoOutput = await repoHook(
      toRepoPostToolUseInput(sdkInput as SdkPostToolUseHookInput, context),
      options.signal
    );

    return {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        ...(repoOutput.updatedOutput === undefined
          ? {}
          : { updatedToolOutput: repoOutput.updatedOutput }),
      },
    };
  };
}

const NO_HITL_RESOLVER_MESSAGE = (toolName: string): string =>
  `No human reviewer is configured for "${toolName}"; denying by default ` +
  '(degraded-ask outcome — this repo\'s own policy resolved \'ask\', but no ' +
  'hitlResolver is wired for this Claude Agent SDK provider).';

/**
 * Bridges the SDK's `canUseTool` fallback (Seam 7/Closure C) — reached only
 * when nothing earlier in the evaluation chain resolved the call — to this
 * repo's `hitlResolver` extension seam. The returned Promise ALWAYS
 * resolves, never left pending, which is what prevents the real production
 * deadlock risk `canUseTool`'s own "no park deadline" JSDoc warns about:
 * no `hitlResolver` configured, and a resolver that throws or rejects, both
 * degrade to the same safe deny rather than hanging (B21).
 *
 * `respond` (B22) never synthesizes an `allow`: the real `PermissionResult`
 * union has no "skip execution, inject a substitute result" branch, so it
 * degrades honestly to `deny` with the human's response text as the
 * message — a deliberate capability loss, not a bug.
 */
export function toSdkCanUseTool(hitlResolver?: HitlResolver): CanUseTool {
  return async (toolName, input, context) => {
    if (hitlResolver == null) {
      return { behavior: 'deny', message: NO_HITL_RESOLVER_MESSAGE(toolName) };
    }

    let decision;
    try {
      decision = await hitlResolver(toolName, input, {
        toolUseId: context.toolUseID,
        matchedAskRule: context.matchedAskRule != null,
        signal: context.signal,
      });
    } catch {
      return { behavior: 'deny', message: NO_HITL_RESOLVER_MESSAGE(toolName) };
    }

    return toolApprovalToPermissionResult(decision, toolName);
  };
}

function toolApprovalToPermissionResult(
  decision: Awaited<ReturnType<HitlResolver>>,
  toolName: string
): PermissionResult {
  switch (decision.type) {
  case 'approve':
    return { behavior: 'allow' };
  case 'reject':
    return {
      behavior: 'deny',
      message: decision.reason ?? `"${toolName}" was rejected.`,
    };
  case 'edit':
    return { behavior: 'allow', updatedInput: decision.updatedInput };
  case 'respond':
    return { behavior: 'deny', message: decision.responseText };
  }
}
