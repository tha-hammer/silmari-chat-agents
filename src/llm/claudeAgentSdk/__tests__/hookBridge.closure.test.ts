import { describe, expect, it } from '@jest/globals';
import { HumanMessage } from '@langchain/core/messages';
import type { HitlResolver } from '@/llm/claudeAgentSdk/types';
import { createToolPolicyHook } from '@/hooks/createToolPolicyHook';
import { fakeQueryFromGenerator } from './fakeQuery';
import { attemptInvoke } from '@/llm/invoke';
import { initializeModel } from '@/llm/init';
import { resultSuccess } from './fixtures';
import { Providers } from '@/common';

/**
 * A host wanting `canUseTool`'s fallback informed by the same policy its
 * `PreToolUse` hook enforces composes it itself — this glue is real
 * host-composition code around the REAL, unmodified `createToolPolicyHook`,
 * not part of this provider. `'ask'` degrades to a distinguishable deny:
 * this phase ships no live human-response transport (Deferred), so a
 * resolver reaching a genuine `'ask'` has nothing to say.
 */
function hitlResolverFromPolicy(
  policyHook: ReturnType<typeof createToolPolicyHook>
): HitlResolver {
  return async (toolName, input, ctx) => {
    const repoOutput = await policyHook(
      {
        hook_event_name: 'PreToolUse',
        runId: 'r1',
        toolName,
        toolInput: input,
        toolUseId: ctx.toolUseId,
      },
      ctx.signal
    );
    if (repoOutput.decision === 'deny') {
      return {
        type: 'reject',
        reason: repoOutput.reason ?? `"${toolName}" was denied by policy.`,
      };
    }
    if (repoOutput.decision === 'ask') {
      return {
        type: 'reject',
        reason: `no human reviewer available for "${toolName}" right now (ask, no live transport)`,
      };
    }
    return { type: 'approve' };
  };
}

/**
 * Closure C: "a real tool-policy decision reaches the SDK in the SDK's own
 * shape, and an 'ask' never hangs" [BLOCKING].
 *
 * The fake `Query`'s own invocation of `options.canUseTool(...)` is the real
 * driver — never a direct call into the adapter function with a hand-built
 * input.
 */
describe('Closure C — a real tool-policy decision reaches the SDK, and an \'ask\' never hangs [BLOCKING]', () => {
  it('denies delete_file naming the policy reason, and degrades edit_file\'s ask to a distinguishable deny — both resolve, never pending', async () => {
    const policyHook = createToolPolicyHook({
      deny: ['delete_*'],
      ask: ['edit_file'],
      reason: 'blocked: {tool}',
    }); // REAL, unmodified — imported and called exactly as a host would

    const results: Record<
      string,
      { behavior: string; message?: string } | null
    > = {};
    const queryFn = fakeQueryFromGenerator((params) => {
      return async function* () {
        const signal =
          params.options?.abortController?.signal ??
          new AbortController().signal;
        const canUseTool = params.options?.canUseTool;
        if (canUseTool == null) {
          throw new Error('test setup: canUseTool was not wired');
        }
        results.delete_file = await canUseTool(
          'delete_file',
          {},
          {
            signal,
            toolUseID: 'tu1',
            requestId: 'r1',
          }
        );
        results.edit_file = await canUseTool(
          'edit_file',
          {},
          {
            signal,
            toolUseID: 'tu2',
            requestId: 'r2',
          }
        );
        yield resultSuccess({ result: 'done' });
      };
    });

    const model = initializeModel({
      provider: Providers.CLAUDE_AGENT_SDK,
      clientOptions: {
        cwd: '/tmp',
        queryFn,
        hitlResolver: hitlResolverFromPolicy(policyHook),
      },
    });

    await attemptInvoke({
      model,
      messages: [new HumanMessage('hi')],
      provider: Providers.CLAUDE_AGENT_SDK,
      onChunk: () => {},
    });

    expect(results.delete_file).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('delete_file'),
    });
    expect(results.edit_file).toMatchObject({ behavior: 'deny' });
    expect(results.edit_file?.message).not.toBe(results.delete_file?.message);
  });

  it('the no-hitlResolver default deny always resolves — never left pending', async () => {
    let observed: unknown;
    const queryFn = fakeQueryFromGenerator((params) => {
      return async function* () {
        const canUseTool = params.options?.canUseTool;
        if (canUseTool == null) {
          throw new Error('test setup: canUseTool was not wired');
        }
        observed = await canUseTool(
          'edit_file',
          {},
          {
            signal: new AbortController().signal,
            toolUseID: 'tu1',
            requestId: 'r1',
          }
        );
        yield resultSuccess({ result: 'done' });
      };
    });
    const model = initializeModel({
      provider: Providers.CLAUDE_AGENT_SDK,
      clientOptions: { cwd: '/tmp', queryFn }, // no hitlResolver configured
    });

    await attemptInvoke({
      model,
      messages: [new HumanMessage('hi')],
      provider: Providers.CLAUDE_AGENT_SDK,
      onChunk: () => {},
    });

    expect(observed).toMatchObject({ behavior: 'deny' });
  });
});

/**
 * Closure E: "a real PreToolUse hook decision reaches the SDK's
 * hooks.PreToolUse channel and is consulted before canUseTool" [BLOCKING].
 */
describe('Closure E — a real PreToolUse hook decision reaches hooks.PreToolUse and short-circuits canUseTool [BLOCKING]', () => {
  it('denies delete_file via the wired PreToolUse hook, and canUseTool is never subsequently invoked', async () => {
    const policyHook = createToolPolicyHook({ deny: ['delete_*'] }); // REAL, unmodified
    let hookResult:
      | { hookSpecificOutput?: { permissionDecision?: string } }
      | undefined;
    let canUseToolCalled = false;

    const queryFn = fakeQueryFromGenerator((params) => {
      return async function* () {
        const signal =
          params.options?.abortController?.signal ??
          new AbortController().signal;
        const matchers = params.options?.hooks?.PreToolUse;
        if (matchers == null || matchers.length === 0) {
          throw new Error('test setup: Options.hooks.PreToolUse was not wired');
        }
        hookResult = (await matchers[0].hooks[0](
          {
            hook_event_name: 'PreToolUse',
            tool_name: 'delete_file',
            tool_input: {},
            tool_use_id: 'tu1',
            session_id: 's',
            transcript_path: '/x',
            cwd: '/x',
          },
          'tu1',
          { signal }
        )) as { hookSpecificOutput?: { permissionDecision?: string } };

        const decision = hookResult.hookSpecificOutput?.permissionDecision;
        if (decision == null && params.options?.canUseTool != null) {
          canUseToolCalled = true;
          await params.options.canUseTool(
            'delete_file',
            {},
            {
              signal,
              toolUseID: 'tu1',
              requestId: 'r1',
            }
          );
        }

        yield resultSuccess({ result: 'done' });
      };
    });

    const model = initializeModel({
      provider: Providers.CLAUDE_AGENT_SDK,
      clientOptions: { cwd: '/tmp', queryFn, preToolUseHook: policyHook },
    });

    await attemptInvoke({
      model,
      messages: [new HumanMessage('hi')],
      provider: Providers.CLAUDE_AGENT_SDK,
      onChunk: () => {},
    });

    expect(hookResult?.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(canUseToolCalled).toBe(false);
  });
});
