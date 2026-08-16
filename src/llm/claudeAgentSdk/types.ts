import type { BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import type {
  Options,
  Query,
  SessionStore,
} from '@anthropic-ai/claude-agent-sdk';
import type { SessionRegistry } from '@/llm/claudeAgentSdk/sessionRegistry';
import type { LocalWorkspaceConfig } from '@/types/tools';
import type { ToolApprovalDecision } from '@/types/hitl';
import type { HookCallback } from '@/hooks/types';

/**
 * Extension seam a same-process, in-memory human-response bridge would plug
 * into (Deferred — this phase ships the seam and its safe default, not a
 * live transport). Mirrors `canUseTool`'s own signature shape so the
 * adapter's wiring is a direct pass-through: async, single-call.
 *
 * A rejected/thrown Promise is treated identically to the
 * no-`hitlResolver`-configured path (degraded deny) by
 * `hookAdapter.ts#toSdkCanUseTool` — a resolver bug can never leave
 * `canUseTool`'s Promise pending.
 */
export type HitlResolver = (
  toolName: string,
  input: Record<string, unknown>,
  context: { toolUseId: string; matchedAskRule?: boolean; signal: AbortSignal }
) => Promise<ToolApprovalDecision>;

/**
 * Matches the real SDK's `query()` signature exactly, so `queryFn` defaults
 * to the real `query` with no adaptation. Test seam: fakes implement this
 * contract directly (`__tests__/fakeQuery.ts`), never a `jest.mock()` of the
 * SDK package.
 */
export type QueryFn = (params: { prompt: string; options?: Options }) => Query;

/**
 * Constructor options for {@link ChatClaudeAgentSDK}. Later phases (workspace,
 * hooks, HITL) add fields here as their own behaviors require them.
 */
export type ClaudeAgentSDKClientOptions = BaseChatModelParams & {
  /** Working directory for the spawned `claude` CLI subprocess. */
  cwd?: string;
  /**
   * Model name forwarded to the SDK's `query()` options. Optional, like every
   * sibling `*ClientOptions` type's `model` field — required so `LLMConfig`
   * (`SharedLLMConfig & ClientOptions & {...}`)'s `.model` access stays valid
   * across the full `ClientOptions` union.
   */
  model?: string;
  /** Test seam, defaults to the real SDK's `query` function. */
  queryFn?: QueryFn;
  /**
   * Session-continuity store keyed by `config.configurable.thread_id`. Test
   * seam — defaults to a process-local module singleton in production.
   */
  sessionRegistry?: SessionRegistry;
  /** Bound for the default module-singleton session registry (default 500). */
  sessionRegistryBound?: number;
  /**
   * Workspace boundary configuration, reusing the local coding engine's own
   * shape (`getLocalCwd`/`getWorkspaceRoots`,
   * `src/tools/local/LocalExecutionEngine.ts:227,240`) rather than
   * reimplementing workspace resolution. `workspace.root` takes precedence
   * over `cwd` when both are set (matching `getLocalCwd`'s own precedence).
   */
  workspace?: LocalWorkspaceConfig;
  /**
   * When true, applies per-tenant subprocess isolation: `settingSources:
   * ['user', 'project', 'local']` and an `env` derived from `process.env`
   * plus `CLAUDE_CONFIG_DIR` (per-tenant, derived from `cwd`, seeded from
   * {@link aaiTemplateDir} on first creation — see that field) and
   * `CLAUDE_CODE_DISABLE_AUTO_MEMORY`.
   */
  multiTenant?: boolean;
  /**
   * Absolute path to a directory whose contents are copied into a tenant's
   * `CLAUDE_CONFIG_DIR` the first time it's created (AF-5f2j) — e.g. a baked
   * `CLAUDE.md`/skills/hooks/agents/commands package a host wants every
   * tenant's subprocess to have, not just the default (empty) directory
   * `multiTenant: true` used to produce.
   *
   * Only consulted when `multiTenant` is `true`. Default resolution when
   * unset: `/home/node/.claude` if that path exists on disk, else
   * `perTenantConfigDir()` throws rather than silently seeding nothing — an
   * unseeded tenant directory is exactly the failure mode this field exists
   * to close, so a missing/misconfigured template source must fail loudly
   * at first-request time, not degrade to the old silent-empty behavior.
   */
  aaiTemplateDir?: string;
  /** Thin pass-through to the SDK's own `Options.sessionStore`. */
  sessionStore?: SessionStore;
  /**
   * Explicit session-id override, forwarded as `Options.resume`. Takes
   * precedence over the session registry's own lookup — explicit host
   * intent wins over this provider's convenience cache.
   */
  resume?: string;
  /** Thin pass-through to the SDK's own `Options.maxTurns`. */
  maxTurns?: number;
  /**
   * One already-resolved `PreToolUse` hook, mirroring `ChatBAML`'s own
   * host-supplied-port precedent (`functions: BamlFunctionSet`) rather than
   * this repo's multi-hook `HookRegistry`/`executeHooks` composition — no
   * provider class has ever received `HookRegistry` access, and giving one
   * this access would be a new architectural precedent, not a Phase-0
   * wiring detail (see the plan's Key Discoveries and "What We're NOT
   * Doing"). A host running multiple `PreToolUse` hooks (e.g.
   * `createToolPolicyHook` + `createWorkspacePolicyHook`) must compose them
   * into one callback itself before passing it here.
   */
  preToolUseHook?: HookCallback<'PreToolUse'>;
  /** One already-resolved `PostToolUse` hook — same posture as `preToolUseHook`. */
  postToolUseHook?: HookCallback<'PostToolUse'>;
  /**
   * Extension seam for the SDK's `canUseTool` fallback when this repo's own
   * policy resolves `'ask'`. No `hitlResolver` configured degrades to a safe
   * deny, never a hang (B21) — this phase ships the seam, not a live
   * human-response transport (Deferred).
   */
  hitlResolver?: HitlResolver;
};
