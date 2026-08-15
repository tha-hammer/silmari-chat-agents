---
date: 2026-08-15T15:51:25-04:00
researcher: tha-hammer
git_commit: 3f5dc561fc07fe710e9183de7f8a5015bda0751c
branch: main
repository: silmari-chat-agents
topic: 'Providers.CLAUDE_AGENT_SDK Implementation — Complete, next: silmari-chat integration'
tags:
  [
    implementation,
    complete,
    providers,
    claude-agent-sdk,
    hooks,
    session-continuity,
    silmari-chat,
    live-inference,
  ]
status: complete
last_updated: 2026-08-15
last_updated_by: tha-hammer
type: implementation_strategy
---

# Handoff: Claude Agent SDK provider — implementation complete; next: wire into silmari-chat + live inference

## Task(s)

1. **Implement the TDD plan** (`thoughts/searchable/shared/plans/2026-08-15-12-14-tdd-providers-claude-agent-sdk-phase0.md`) for `Providers.CLAUDE_AGENT_SDK` in this repo (`silmari-chat-agents`, published as `@librechat/agents`). **COMPLETE.** All 6 phases, 27 behaviors (B0–B26), 5 closures (A–E) — see "Recent changes" below. Started from `thoughts/searchable/shared/handoffs/general/2026-08-15_13-09-34_implement-claude-agent-sdk-provider-plan.md`.
2. **Re-implement/wire this module into the `silmari-chat` app and test with actual (live, credentialed) inference.** **NOT STARTED.** This is the task for the next session — see "Action Items & Next Steps". `silmari-chat` is a **sibling repo on disk at `../silmari-chat`** (relative to this repo) — a fork/instance of LibreChat. It consumes this package as a **git dependency pinned to an exact commit hash**: `../silmari-chat/api/package.json:50` and `../silmari-chat/packages/api/package.json:117` both declare `"@librechat/agents": "git+https://github.com/tha-hammer/silmari-chat-agents.git#3f5dc561fc07fe710e9183de7f8a5015bda0751c"` — that hash is this repo's `HEAD` from _before_ this session's work started. See "Action Items & Next Steps" for how to get the new provider code there.

## Critical References

- `thoughts/searchable/shared/plans/2026-08-15-12-14-tdd-providers-claude-agent-sdk-phase0.md` — the canonical plan, now fully implemented; every behavior heading is marked `✅ DONE`. Read this first to understand the full design.
- `docs/providers/claude-agent-sdk.md` — **the host-integration doc, written for exactly the next task.** Covers registration, the never-`tool_calls` invariant, `bindTools` throwing, session continuity + its process-local limitation, multi-tenancy, hook composition (one hook each, not `HookRegistry`), and — most importantly — the "mid-session HITL is not supported" limitation. Read this before wiring anything into silmari-chat.
- `thoughts/searchable/shared/research/2026-08-13-10-38-claude-code-sdk-agent-provider.md` — architecture research, both follow-up sections, including how a host app is expected to consume this package's providers.

## Recent changes

All new code lives under `src/llm/claudeAgentSdk/` (this repo):

- `ChatClaudeAgentSDK.ts` — the provider class. `_generate`/`_streamResponseChunks` drive `query()` from `@anthropic-ai/claude-agent-sdk`; never emits `tool_calls`; session continuity via an overridden `_separateRunnableConfigFromCallOptionsCompat` that stashes `config.configurable.thread_id`/`run_id` before the base class strips them; workspace/multi-tenancy/cancellation/hook wiring.
- `messages.ts`, `usage.ts`, `errors.ts`, `sessionRegistry.ts`, `hookAdapter.ts`, `types.ts` — supporting modules (classification, usage derivation, 3 public error classes, bounded LRU session registry, hook/HITL bridging, client-options types).
- 13 test files under `src/llm/claudeAgentSdk/__tests__/` (unit + closure tests for A/B/C/E; D lives in `bindTools.closure.test.ts`).
- `docs/providers/claude-agent-sdk.md` — new host documentation.
- Registration wiring: `src/common/enum.ts` (`Providers.CLAUDE_AGENT_SDK`), `src/llm/providers.ts` (static `llmProviders` entry), `src/types/llm.ts` (3 type-map entries).
- `package.json` — added `@anthropic-ai/claude-agent-sdk@0.3.233` (exact pin), `zod@^4.0.0`, `@modelcontextprotocol/sdk@^1.29.0`.
- Incidental fixes required to make the zod v4 bump actually work: `src/types/run.ts:21` (`ZodObject<any,any>`, was 4-arg v3 form), `src/utils/schema.ts:30` (double-cast through `unknown` for a `zod-to-json-schema` version-skew mismatch), `src/utils/__tests__/errors.test.ts` (added `Providers.CLAUDE_AGENT_SDK` to the `noClientOfItsOwn` set — it spawns a subprocess, not an HTTP client this util recognizes).

**Nothing has been committed or pushed.** `git status` shows ~9 modified files and ~20 new files, all uncommitted, per this repo's conservative git profile.

## Learnings

- **`@anthropic-ai/claude-agent-sdk` is ESM-only (`"type": "module"`, `sdk.mjs` only, no CJS build).** A static top-level `import { query } from '...'` broke Jest immediately (`SyntaxError: Unexpected token 'export'`) even in tests that never call the real function. Fixed with a lazy, memoized `import()` inside `ChatClaudeAgentSDK.ts`, mirroring this repo's own `loadSandboxRuntime()` pattern (`src/tools/local/LocalExecutionEngine.ts:331-336`). **This will matter again in silmari-chat** if it's also a Jest/CJS-based test setup, or if its own bundler doesn't handle dynamic `import()` of an ESM-only package cleanly.
- **`config.configurable.thread_id` is NOT visible inside `_streamResponseChunks`'s `options` param by default.** `BaseChatModel._separateRunnableConfigFromCallOptions` (`@langchain/core/dist/runnables/base.js`) explicitly deletes `configurable` (and `runId`) before handing `callOptions` down. The fix: override the protected `_separateRunnableConfigFromCallOptionsCompat` method to stash both onto the returned `callOptions` object before the base class's own deletion — see `ChatClaudeAgentSDK.ts`'s override (~line 244). This is the one point in the whole call chain where `RunnableConfig` is still intact.
- **`Options.abortController` wants a real `AbortController`, not the caller's `AbortSignal`** (`sdk.d.ts:1353,7608-7645`) — solved by constructing a fresh controller and forwarding the incoming signal's abort event onto it (`forwardAbort()` in `ChatClaudeAgentSDK.ts`).
- **`Options.hooks` requires the `HookCallbackMatcher[]` wrapper shape** (`{hooks: [fn]}` inside the array), not a bare array of hook functions — the plan's own prose abbreviated this; the real `.d.ts` (`sdk.d.ts` line ~1348-2133 for `Options`) is authoritative.
- **The SDK's own `HookCallback` type is one big union across all hook events** (not narrowed per-event) — `toSdkPreToolUseHook`/`toSdkPostToolUseHook` had to return the SDK's own `HookCallback` type (cast the input internally) rather than a narrower function type, or TS rejects assigning them into `HookCallbackMatcher.hooks`.
- **`canUseTool` genuinely can return `null`** (out-of-band control_response case) — not used by this provider, but worth knowing if extending `hookAdapter.ts` later.
- **Live/credentialed testing was never done this session.** Every test in this repo uses `fakeQuery`/`fakeQueryFromGenerator` (real implementations of the `query()` contract, never `jest.mock()`) — nothing here has ever spawned a real `claude` CLI subprocess. `npm run test:live:claude-agent-sdk` is referenced in the plan's verification gates as a script to add but **was not created this session** — check if it exists before assuming it does.
- **This repo's own beads issue IDs are shared/global** across many of this user's projects (confirmed again this session) — `bd list`/`bd show` surface issues from unrelated repos too; filter by title, not just prefix.

## Artifacts

- `thoughts/searchable/shared/plans/2026-08-15-12-14-tdd-providers-claude-agent-sdk-phase0.md` — canonical plan, all behaviors marked done.
- `thoughts/searchable/shared/plans/2026-08-15-12-14-tdd-providers-claude-agent-sdk-phase0-REVIEW.md` — the plan review whose 5 critical findings are all incorporated into the plan (and thus the implementation).
- `docs/providers/claude-agent-sdk.md` — host integration guide (read before starting the next task).
- `src/llm/claudeAgentSdk/` — full implementation + tests (see "Recent changes").
- `thoughts/searchable/shared/research/2026-08-13-10-38-claude-code-sdk-agent-provider.md` — architecture research.

## Action Items & Next Steps

1. **Get the new provider code to `../silmari-chat`.** It currently pins `@librechat/agents` to this repo's pre-session `HEAD` (`3f5dc561f...`) via a git-dependency URL in `../silmari-chat/api/package.json:50` and `../silmari-chat/packages/api/package.json:117`. Two options:
   - **Fast local iteration**: `npm link` or a `file:../silmari-chat-agents` override in silmari-chat's `package.json` (temporary, for testing before committing/pushing this repo's work).
   - **Real integration**: commit + push this session's work in `silmari-chat-agents` (needs explicit user go-ahead per the conservative git profile — nothing was pushed this session), then bump the pinned commit hash in both `package.json` files above and reinstall. This repo's own `prepare` script (added in the immediately-prior commit, `3f5dc56`) builds `dist/` automatically on install specifically to support this git-dependency flow — confirm that still works against the new commit.
2. **Read `docs/providers/claude-agent-sdk.md` in full** before wiring anything — it documents every host-facing gotcha (env replace-not-merge, hook composition requirement, the HITL limitation) that a real integration will hit immediately.
3. **Check `../silmari-chat`'s own docs/config for its provider-registration pattern.** `AGENTS.md:5` in this repo calls `silmari-chat` "the same team's" major backend consumer (though its own relative link to `../LibreChat` is stale — `../silmari-chat` is the repo actually on disk). Six older `thoughts/` docs from the 2026-08-09 BAML integration effort already reference `../silmari-chat` extensively, including a prior spike directory `../silmari-chat/scripts/baml-toolloop/` — that's the closest existing precedent for "wiring a new @librechat/agents provider into silmari-chat" and worth reading before inventing a new pattern.
4. **Wire `Providers.CLAUDE_AGENT_SDK` into silmari-chat's own provider selection** (however it currently exposes ANTHROPIC/OPENAI/etc. to users/config).
5. **Test with actual inference**: requires the real `claude` CLI binary available wherever silmari-chat runs, plus real credentials. No live test harness (`*.live.test.ts` for this provider) exists yet in `silmari-chat-agents` — the plan's verification gates reference `npm run test:live:claude-agent-sdk` as a script that should be added but wasn't created this session. Consider whether that harness belongs in `silmari-chat-agents` (alongside the other 9 `*.live.test.ts` precedents, re-testable independent of the host app) or as an integration test directly in `silmari-chat` — probably the former.
6. Decide whether the first live test needs to exercise hook/HITL bridging (`preToolUseHook`/`hitlResolver`) or just a bare turn — a bare turn (no tools, no hooks) is the simplest first smoke test and matches this repo's own `*.live.test.ts` convention of testing one thing at a time.

## Other Notes

- **Conservative git profile remains in effect.** Nothing was committed or pushed this session; `git status` shows the full diff ready for review. Get explicit user authorization before committing/pushing, and before running `bd dolt push`/`bd dolt pull`.
- **Beads**: epic `AF-xcnf` and all 6 phase issues (`AF-ftsa`, `AF-hztz`, `AF-6nfw`, `AF-hmmm`, `AF-v6f9`, `AF-bsv5`) are closed. `bd list --status=in_progress` shows 11 unrelated in-progress issues from other projects sharing this beads database — none relate to this task. `bd dolt push`/`pull` were **not** run this session (same conservative-profile reasoning as commits).
- Not an NTM session, not multi-agent orchestrated — a plain single-session handoff, same as the one this session resumed from. AgentMail was not re-checked this session (the prior handoff already confirmed zero registered agents for this project); worth a fresh `fetch_inbox`/`whois` check only if the next session expects to coordinate with other agents.
- Verification gates that were all green at the end of this session: `npx tsc --noEmit`, `npx eslint src/` (0 errors, 102 pre-existing warnings unrelated to this work), `npx jest` (full suite, only 3 pre-existing environment-credential failures in `anthropic|google|vertexai llm.spec.ts` unrelated to this work), `npm run build`. Re-run all four after any changes in the next session, plus re-run `npx jest src/llm/claudeAgentSdk` specifically (71 tests) to catch any regressions from the silmari-chat integration work.
