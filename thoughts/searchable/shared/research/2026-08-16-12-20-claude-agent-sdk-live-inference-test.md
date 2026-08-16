---
date: 2026-08-16T12:20:22-04:00
researcher: FuchsiaCat (claude-code, claude-sonnet-5)
git_commit: 2b41826d40d36af36c43150af497f8c1ebfe57aa
branch: claude-agent-sdk-2026-08-16-12-13
repository: silmari-chat-agents
topic: 'AF-nr1p / AF-enki: live test harness + first real inference against Providers.CLAUDE_AGENT_SDK'
tags:
  [
    research,
    codebase,
    claude-agent-sdk,
    live-tests,
    ChatClaudeAgentSDK,
    AF-nr1p,
    AF-enki,
  ]
status: complete
last_updated: 2026-08-16
last_updated_by: FuchsiaCat
---

# Research: AF-nr1p / AF-enki — live test harness + first real inference against Providers.CLAUDE_AGENT_SDK

**Date**: 2026-08-16T12:20:22-04:00
**Researcher**: FuchsiaCat (claude-code, claude-sonnet-5)
**Git Commit**: 2b41826d40d36af36c43150af497f8c1ebfe57aa
**Branch**: claude-agent-sdk-2026-08-16-12-13
**Repository**: silmari-chat-agents

## Research Question

AF-enki asks for the first real, non-mocked inference test against `Providers.CLAUDE_AGENT_SDK` (a bare turn, no tools/hooks), and is blocked on AF-nr1p (add an `npm run test:live:claude-agent-sdk` harness). What exists today that either bead's implementation would build on: the repo's `*.live.test.ts` precedent pattern, how `ChatClaudeAgentSDK`/`Providers.CLAUDE_AGENT_SDK` is wired end-to-end, what credentials/CLI/config-dir setup a live run needs (informed by three recent `CLAUDE_CONFIG_DIR` fix commits), and current status of AF-nr1p/whether any harness file already exists.

## Summary

- **No harness exists yet.** `package.json` defines exactly one `test:live:*` script (`test:live:handoffs`); there is no `test:live:claude-agent-sdk` entry and no `src/specs/*claude-agent-sdk*.live.test.ts` (or equivalent) file anywhere in the repo (`package.json:210`, confirmed by a repo-wide `find` for `*.live.test.ts`).
- **The precedent pattern is uniform and simple** across all 10 existing `*.live.test.ts` files: `dotenv.config()` at the top, a `shouldRunLive` boolean gated on one purpose-specific env var (`RUN_<THING>_LIVE_TESTS=1`) plus a real API key check, `describeIfLive = shouldRunLive ? describe : describe.skip`, and the test body constructs a `t.AgentInputs` (via a small local `createXAgent` factory) with `provider: Providers.<X>` and calls `Run.create(...)` / `run.processStream(...)` exactly like production code does. No jest config changes are needed — `jest.config.mjs`'s `testMatch` (`**/src/**/*.test.ts`) already matches `*.live.test.ts` files; the `describe.skip` default is what keeps them out of the normal (non-live) `npm test` run in effect.
- **`Providers.CLAUDE_AGENT_SDK` is a fully first-class, already-registered provider** (`src/llm/providers.ts:37`, `src/common/enum.ts:101`) — a live test for it can use the exact same `Run.create({ agents: [{ provider: Providers.CLAUDE_AGENT_SDK, clientOptions, instructions, maxContextTokens }] })` shape the Anthropic/Bedrock/OpenRouter live tests already use, swapping only the provider and `clientOptions` type (`ClaudeAgentSDKClientOptions`, `src/llm/claudeAgentSdk/types.ts:41-122`).
- **This provider never emits `tool_calls`** — `bindTools()` throws unconditionally (`ChatClaudeAgentSDK.ts:427-432`) — so "a bare turn, no tools" is not one configuration among several; it's the _only_ mode this provider supports at the LangChain level. "No hooks" means simply omitting `preToolUseHook`/`postToolUseHook`/`hitlResolver` from `clientOptions`, all of which already default to `undefined`.
- **Credentials/auth are not a field on this provider at all.** Unlike `ChatAnthropic`-style providers, `ClaudeAgentSDKClientOptions` has no `apiKey` field. The provider spawns a real `claude` CLI subprocess via `@anthropic-ai/claude-agent-sdk`'s `query()`; in the (default, non-`multiTenant`) path it sets **no** `env` override at all, so the subprocess inherits `process.env` unmodified — meaning a live test's actual auth requirement is whatever the `claude` CLI itself would use outside this provider: either an already-`claude login`-ed `$HOME/.claude` (OAuth credentials) or `ANTHROPIC_API_KEY` in the parent process's env, which the subprocess would inherit.
- **The three recent `CLAUDE_CONFIG_DIR` fix commits (2251771, 0713b9a, 2ab31ee) all land _before_ AF-nr1p/AF-enki and already close the "config dir doesn't exist" failure mode** for a live run: `ensureClaudeConfigDirExists()` (`ChatClaudeAgentSDK.ts:275-278`) is called unconditionally on every `_streamResponseChunks` invocation, creates `process.env.CLAUDE_CONFIG_DIR ?? $HOME/.claude` if missing, and falls back to a `tmpdir()`-based path if `homedir()` itself throws. A live test does not need to create this directory itself.
- **This exact sandbox already has what a live run needs**: the `claude` CLI resolves on `PATH` (`/home/maceo/.local/bin/claude`, v2.1.233), `$HOME/.claude/.credentials.json` exists (already authenticated), and the installed `@anthropic-ai/claude-agent-sdk` package version is `0.3.233`. Running a live test here would make a real, billed API call and spawn a real `claude` subprocess — this is expected/intended per AF-enki's own description, but worth stating plainly before `implement_plan` actually executes one.
- **AF-nr1p is currently claimed by a teammate (CyanBridge) in the Agent Mail coordination ledger**, not by this researcher. AF-enki (this researcher's bead) is described in bd as depending on AF-nr1p's harness, and AF-enki's own bd record notes "the live test file itself belongs [to AF-nr1p's] scope" — i.e. AF-nr1p's deliverable is expected to include the actual bare-turn `*.live.test.ts` file, and AF-enki's distinct contribution is running it for real and evidencing the result.
- **A prior research document already exists** for this exact provider's registration/invocation chain, written before `ChatClaudeAgentSDK` existed (`thoughts/searchable/shared/research/2026-08-13-10-38-claude-code-sdk-agent-provider.md`) — see Related Research below; it maps the same production chain using BAML as the illustrative provider, since Claude Agent SDK hadn't been implemented yet at that time.

## Detailed Findings

### The `*.live.test.ts` precedent pattern

All 10 existing files share the same four-part shape:

1. **Load real env vars**: `import { config as dotenvConfig } from 'dotenv'; dotenvConfig();` at the top of the file (e.g. `src/specs/agent-handoffs.live.test.ts:8-9`, `src/specs/context-usage.live.test.ts:9-10`).
2. **Gate on a purpose-specific env var + a real key check**:
   - `src/specs/agent-handoffs.live.test.ts:19-22` — `RUN_HANDOFF_LIVE_TESTS === '1' && ANTHROPIC_API_KEY != null && ANTHROPIC_API_KEY !== ''`
   - `src/specs/context-usage.live.test.ts:22-25` — `RUN_CONTEXT_USAGE_LIVE_TESTS === '1' && ANTHROPIC_API_KEY != null && ...`
   - `src/agents/__tests__/AgentContext.anthropic.live.test.ts:33-36` — `RUN_ANTHROPIC_PROMPT_CACHE_LIVE_TESTS === '1' && ANTHROPIC_API_KEY != null && ...`
   - Each file's own env var name is unique to that file/feature — there is no single shared `RUN_LIVE_TESTS` flag.
3. **`describeIfLive = shouldRunLive ? describe : describe.skip;`** — the file is always collected by Jest (it matches `testMatch`), but its `describe` block is a no-op unless the gate passes. `jest.setTimeout(...)` is set high (120_000–180_000 ms) inside the live `describe` block for real network latency.
4. **A small local agent-factory function** (`createAnthropicAgent`, `createAnthropicAgent` again in the context-usage file, etc.) builds a `t.AgentInputs` — `{ agentId, provider: Providers.X, clientOptions: {...}, instructions, maxContextTokens }` — then the test calls `Run.create({ runId, graphConfig: { type: 'standard' | 'multi-agent', agents, edges? }, returnContent: true, skipCleanup: true, ... })` followed by `run.processStream({ messages: [new HumanMessage(...)] }, { configurable: { thread_id }, streamMode: 'values', version: 'v2' })`, then asserts on `run.getRunMessages()` and/or captured event handlers.

Only one file (`agent-handoffs.live.test.ts`) has a dedicated `npm run` script (`package.json:210`); the rest are presumably invoked directly via `jest <path> --runInBand` with the relevant env vars set inline, matching the `RUN_HANDOFF_LIVE_TESTS=1 npm test -- agent-handoffs.live.test.ts --runInBand` comment convention documented at the top of each file (e.g. `AgentContext.anthropic.live.test.ts:5-6`).

### `package.json` test scripts

- `package.json:209` — `"test": "NODE_OPTIONS='--experimental-vm-modules' jest"` (the default, non-live suite; live files self-skip under this).
- `package.json:210` — `"test:live:handoffs": "RUN_HANDOFF_LIVE_TESTS=1 NODE_OPTIONS='--experimental-vm-modules' jest src/specs/agent-handoffs.live.test.ts --runInBand"` — the only existing `test:live:*` script; the pattern AF-nr1p is asked to replicate.
- No `test:live:claude-agent-sdk` (or any other `test:live:*` beyond `handoffs`) exists (`grep -n '"test:live' package.json` returns exactly one match).

### `jest.config.mjs`

- `testMatch: ['**/src/**/*.test.ts', '**/src/**/*.spec.ts']` (`jest.config.mjs:9`) — already matches `*.live.test.ts` files (they end in `.test.ts`); no jest config change is needed to add a new live test file.
- `testTimeout: 60000` global default (`jest.config.mjs:44`), routinely overridden per-suite via `jest.setTimeout(...)` inside a live `describe` block (up to 180_000 ms in the existing files).
- `maxConcurrency: 1`, `maxWorkers: '50%'` — existing live tests are also run with `--runInBand` in their npm scripts/doc comments for the same reason (avoid concurrent real API calls).

### `Providers.CLAUDE_AGENT_SDK` registration and invocation surface

- `src/common/enum.ts:101` — `CLAUDE_AGENT_SDK = 'claudeAgentSdk'` in the `Providers` enum.
- `src/llm/providers.ts:14,37` — `import { ChatClaudeAgentSDK } from '@/llm/claudeAgentSdk/ChatClaudeAgentSDK';` and `[Providers.CLAUDE_AGENT_SDK]: ChatClaudeAgentSDK` in the `llmProviders` registry map, alongside every other provider (Anthropic, Bedrock, OpenRouter, etc.) — no special-casing.
- `src/llm/providers.ts:42-45` — `manualToolStreamProviders` explicitly excludes `Providers.CLAUDE_AGENT_SDK` with the comment "ChatClaudeAgentSDK never emits `tool_calls` (B10) — its streamed content has no tool-use chunks to reconcile, so it needs no entry here."
- Production (non-test) references to `CLAUDE_AGENT_SDK`/`ChatClaudeAgentSDK` exist only in `src/common/enum.ts`, `src/llm/providers.ts`, `src/types/llm.ts`, and the `src/llm/claudeAgentSdk/` implementation files themselves (`ChatClaudeAgentSDK.ts`, `errors.ts`, `sessionRegistry.ts`, `types.ts`) — confirmed via `grep -rln "CLAUDE_AGENT_SDK\|ChatClaudeAgentSDK" --include="*.ts" src | grep -v "__tests__\|\.test\.ts\|\.spec\.ts"`. There is no in-repo application code that constructs a `Run` with this provider — this repo is a library; the actual "production caller" that would do so lives in the downstream `silmari-chat` repo (out of this session's scope), so within this repo the only real trigger is `Run.create` itself, exactly as the existing live tests already use it for other providers.

### `ClaudeAgentSDKClientOptions` — what a "bare turn, no tools, no hooks" config needs

`src/llm/claudeAgentSdk/types.ts:41-122` defines the full option set. For a bare turn:

- **Required for identity**: none — every field is optional. `model` (`types.ts:44-50`) is optional and falls back to the SDK/CLI's own default when omitted.
- **`cwd`/`workspace`** (`types.ts:42-43,60-67`): optional; `ChatClaudeAgentSDK.resolvedCwd()` (`ChatClaudeAgentSDK.ts:376-378`) delegates to `getLocalCwd()` (`src/tools/local/LocalExecutionEngine.ts:227-228`), which falls back to `process.cwd()` when neither is set — a live test does not need to configure a workspace to get a working `cwd`.
- **No tools**: `bindTools()` (`ChatClaudeAgentSDK.ts:427-432`) throws `ClaudeAgentSDKToolsUnsupportedError` unconditionally — a caller must simply never call `.bindTools(...)` (the existing live tests for other providers only bind tools when the scenario needs one; a bare-turn Claude Agent SDK test just never does).
- **No hooks**: `preToolUseHook`/`postToolUseHook`/`hitlResolver` (`types.ts:112-121`) are all optional and default to `undefined`; when unset, `_streamResponseChunks` builds no `hooks` object at all (`ChatClaudeAgentSDK.ts:522-533`) and `toSdkCanUseTool(this.hitlResolver)` degrades to a safe-deny path per its own documented contract (`types.ts:116-121`) — irrelevant for a turn that never triggers tool use in the first place.
- **`multiTenant`** (`types.ts:68-90`): optional, defaults to falsy — the simplest bare-turn config should leave this unset so the subprocess inherits `process.env` unmodified (no `aaiTemplateDir` requirement, no per-tenant `CLAUDE_CONFIG_DIR` derivation).
- **No `apiKey` field exists anywhere in this type** — confirmed by reading the full `ClaudeAgentSDKClientOptions` definition; this is the one structural difference from every sibling `*ClientOptions` type (e.g. `AnthropicClientOptions` used in `AgentContext.anthropic.live.test.ts:44-58`, which does carry `apiKey`).

### How the turn actually runs (`ChatClaudeAgentSDK._streamResponseChunks`)

`src/llm/claudeAgentSdk/ChatClaudeAgentSDK.ts:457-611`:

1. Resolves `cwd`, looks up any existing session for `options.threadId` in the module-singleton `SessionRegistry` (fresh session for a bare, single-turn test — no prior entry).
2. Builds the prompt from the trailing message content (`extractNewTurnContent`, `ChatClaudeAgentSDK.ts:120-138`) — for a single `HumanMessage`, this is just that message's text.
3. Calls `ensureClaudeConfigDirExists()` (`ChatClaudeAgentSDK.ts:275-278,491`) unconditionally, then resolves the real `query` function lazily (`loadRealQuery()`, `ChatClaudeAgentSDK.ts:82-88` — dynamic `import('@anthropic-ai/claude-agent-sdk')`, since the package is ESM-only and would break Jest's CJS collection if imported statically; tests normally override this via `clientOptions.queryFn`, but a _live_ test must NOT set `queryFn` so the real import path executes).
4. Invokes `queryFn({ prompt, options: { cwd, model?, resume?, additionalDirectories?, ...multiTenant fields only if multiTenant, abortController, canUseTool, hooks? } })` and iterates the resulting `AsyncGenerator<SDKMessage>`.
5. Filters the stream via `isMainLoopAssistantMessage`/`isSubagentAssistantMessage`/`isResultMessage` (`src/llm/claudeAgentSdk/messages.ts:37-60`) — main-loop text/thinking streams as `ChatGenerationChunk`s; subagent and internal-tool activity is dropped; the terminal `SDKResultMessage` (on success) yields one final chunk carrying `usage_metadata` (from `usageMetadataFromResult`, `usage.ts:19-39`) and `response_metadata` (from `responseMetadataFromResult`, `usage.ts:42-50` — the function AF-t37e is fixing in parallel) plus `message.result` as fallback content if nothing streamed.
6. A non-success result subtype throws `ClaudeAgentSDKResultError` (`errors.ts`); a stream that ends without any `result` message throws a generic `Error` (`ChatClaudeAgentSDK.ts:608-610`).

### Credentials / `CLAUDE_CONFIG_DIR` setup — the three recent fix commits

- **`f00cae4`** (not directly cited by the session brief but the ancestor of the two below) — `mkdirSync` fix scoped to `perTenantConfigDir()` only (the `multiTenant: true` path).
- **`2251771` "ensure CLAUDE_CONFIG_DIR exists on the default path too"** — extends directory creation to the _non-multiTenant_ default path: neither this repo's own host wiring nor most deployments set `multiTenant`, so the real default sets no `env` override and falls through to the `claude` CLI's own default persistence location, `$HOME/.claude/projects/`; this commit adds `ensureClaudeConfigDirExists()` so that directory exists before every `query()` call regardless of `multiTenant`.
- **`0713b9a` "fall back to tmpdir when homedir() fails"** — hardens `resolveDefaultConfigDir()` (`ChatClaudeAgentSDK.ts:280-286`) against containers running as an arbitrary host uid with no `/etc/passwd` entry (confirmed against a real deployment per the commit message), where `node:os`'s `homedir()` throws instead of returning a usable path; falls back to a `tmpdir()`-based directory.
- **`2ab31ee` "multiTenant seeds AAI into per-tenant CLAUDE_CONFIG_DIR"** — orthogonal to the default (non-multiTenant) path a bare live-turn test would use; only relevant if a future live test explicitly sets `multiTenant: true`.

Net effect for AF-enki: **a live test using the default (non-`multiTenant`) config path gets `CLAUDE_CONFIG_DIR`/`$HOME/.claude` creation for free** — no test-side setup code is needed to avoid a missing-directory failure. The only remaining precondition is that the directory (wherever it resolves to) actually contains valid Claude Code credentials, which `ensureClaudeConfigDirExists()` does not — and cannot — provide; that is an environment/operator concern, not something the harness can create.

### This sandbox's current live-run readiness (evidence, not a recommendation)

- `which claude` → `/home/maceo/.local/bin/claude`; `claude --version` → `2.1.233 (Claude Code)`.
- `$HOME/.claude/.credentials.json` exists (mode `600`) — an authenticated OAuth credential is already present in this exact session's `$HOME`.
- `node_modules/@anthropic-ai/claude-agent-sdk/package.json` → `"version": "0.3.233"` (already installed as a dependency of this repo).
- No `ANTHROPIC_API_KEY`/`CLAUDE_*` env vars beyond Claude Code's own session-plumbing vars (`CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_PID`, `CLAUDE_EFFORT`) were observed in this shell's environment — meaning a live run in this exact shell would authenticate via the `$HOME/.claude/.credentials.json` OAuth path, not an `ANTHROPIC_API_KEY` env var, since `ChatClaudeAgentSDK` never sets or reads that variable itself and the default path passes `process.env` through unmodified to the subprocess.
- `.env.example` (repo root) lists `ANTHROPIC_API_KEY` as a documented variable name other live tests gate on, but `ChatClaudeAgentSDK`'s own auth path does not depend on it being set — only on whatever `claude` CLI auth (env var or `$HOME/.claude` credentials) is present in the process environment the test runs under.

### AF-nr1p / AF-enki current bd status

- `bd show AF-nr1p`: open (task, P3), depends on nothing, blocks AF-enki and the epic AF-1f56. No harness file or script exists yet in the working tree (confirmed above).
- `bd show AF-enki`: open (task, P3), depends on AF-hqp5 (closed — the `perTenantConfigDir()`/`CLAUDE_CONFIG_DIR` bug fix) and AF-nr1p (open), blocks AF-1f56. Its own description: "Requires the real claude CLI binary available wherever silmari-chat runs, plus real credentials. Start with a bare turn (no tools, no hooks) as the simplest smoke test per this repo's own `*.live.test.ts` convention of testing one thing at a time — decide separately whether hook/HITL bridging (`preToolUseHook`/`hitlResolver`) needs its own live test." This description is the source of the "the live test file itself belongs [to AF-nr1p's] scope" reading — AF-nr1p's own bd record does not literally say this in its own text; it is inferred from AF-enki's phrasing plus AF-nr1p's title ("Add … harness") and the shared bare-turn description.
- Per this session's Agent Mail coordination (not bd), a teammate (CyanBridge) currently holds the `claim_task` ledger entry for AF-nr1p; this researcher holds AF-enki.

## Code References

- `package.json:209-212` — `test`, `test:live:handoffs`, `test:memory`, `test:all` scripts (no `test:live:claude-agent-sdk`).
- `jest.config.mjs:9,44` — `testMatch` (already covers `*.live.test.ts`), default `testTimeout`.
- `src/specs/agent-handoffs.live.test.ts:1-141` — full reference implementation of the env-gate + `describeIfLive` + `Run.create` pattern, simplest of the 10 existing live tests.
- `src/specs/context-usage.live.test.ts:1-297` — same pattern, includes single-agent ("solo") case closest in shape to a bare Claude Agent SDK turn (`context-usage.live.test.ts:106-150`).
- `src/agents/__tests__/AgentContext.anthropic.live.test.ts:1-448` — same pattern, most complex example (prompt-cache benchmarking); shows the `AnthropicClientOptions.apiKey` field this provider's `ClaudeAgentSDKClientOptions` lacks.
- `src/common/enum.ts:101` — `Providers.CLAUDE_AGENT_SDK = 'claudeAgentSdk'`.
- `src/llm/providers.ts:14,23-38,42-45` — provider registry entry and `manualToolStreamProviders` exclusion.
- `src/llm/claudeAgentSdk/types.ts:41-122` — `ClaudeAgentSDKClientOptions` (no `apiKey` field; all fields optional).
- `src/llm/claudeAgentSdk/ChatClaudeAgentSDK.ts:82-88` — lazy/memoized real `query` import (why a live test must not set `queryFn`).
- `src/llm/claudeAgentSdk/ChatClaudeAgentSDK.ts:275-286` — `ensureClaudeConfigDirExists()`/`resolveDefaultConfigDir()` (the three recent fix commits' target).
- `src/llm/claudeAgentSdk/ChatClaudeAgentSDK.ts:376-378` — `resolvedCwd()` fallback to `process.cwd()`.
- `src/llm/claudeAgentSdk/ChatClaudeAgentSDK.ts:427-432` — `bindTools()` unconditional throw (B10).
- `src/llm/claudeAgentSdk/ChatClaudeAgentSDK.ts:457-611` — `_streamResponseChunks` (the full bare-turn execution path).
- `src/llm/claudeAgentSdk/messages.ts:37-60` — main-loop/subagent/result message-type discriminators.
- `src/llm/claudeAgentSdk/usage.ts:19-50` — `usageMetadataFromResult`/`responseMetadataFromResult` (AF-t37e's target — a live test's result assertions will exercise this code, though fixing it is out of this bead's scope).
- `src/tools/local/LocalExecutionEngine.ts:227-229` — `getLocalCwd()` default-to-`process.cwd()` behavior.
- Recent commits: `2251771` (default-path `CLAUDE_CONFIG_DIR` creation), `0713b9a` (`homedir()` fallback), `2ab31ee` (multiTenant AAI seeding — not applicable to a bare non-multiTenant test).

## Architecture Documentation

- Every `*.live.test.ts` file is a self-contained, independently-gated integration test — there is no shared live-test helper module beyond `dotenv` loading and (in the `AgentContext.*` family) a shared `promptCacheLiveHelpers` module (`src/agents/__tests__/promptCacheLiveHelpers`) specific to prompt-cache benchmarking, not a general-purpose live-test utility.
- The provider-agnostic entrypoint for every live test, regardless of provider, is `Run.create(...)` + `run.processStream(...)` from `src/run` (`import { Run } from '@/run';`) — the same surface production code uses, with only `clientOptions`/`provider` varying per test.
- `ChatClaudeAgentSDK` is architecturally distinct from every other registered provider in one respect relevant to a live test's design: it has no notion of an API key at the LangChain-config level at all, delegating all authentication to the spawned `claude` CLI subprocess's own environment/config-file resolution.

## Workflow Closure Map

AF-nr1p/AF-enki do not add a new node to the production chain a `Providers.CLAUDE_AGENT_SDK` turn already flows through — `Run.create` → `ChatClaudeAgentSDK._streamResponseChunks` → real `claude` subprocess (`query()`) → `SDKResultMessage` → `usageMetadataFromResult`/`responseMetadataFromResult` → observable `AIMessageChunk`/`run.getRunMessages()` is all pre-existing, already-tested-against-`fakeQuery` production code (`src/llm/claudeAgentSdk/__tests__/*.test.ts`, `fakeQuery.ts`). What AF-nr1p/AF-enki add is a **live, credentialed exercise of that existing chain** — swapping the test-seam `queryFn` override for the real dynamically-imported SDK `query`, per `resolveQueryFn()` (`ChatClaudeAgentSDK.ts:387-391`).

```text
Run.create({ provider: Providers.CLAUDE_AGENT_SDK, clientOptions }) [existing]
  -> ChatClaudeAgentSDK._streamResponseChunks [existing]
    -> resolveQueryFn() -> loadRealQuery() (real, not overridden, in a live test) [existing]
      -> real `claude` CLI subprocess via query() [existing, external]
        -> SDKMessage stream (assistant/result) [existing]
          -> usageMetadataFromResult / responseMetadataFromResult [existing]
            -> terminal AIMessageChunk -> run.getRunMessages() / capture.collectedUsage [existing, observable]
```

| Edge                    | Producer                                                                     | Consumer                                                                                                                                                                                                         | Registration point                                                        | Evidence                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| registry → construction | `src/llm/providers.ts:37` (`llmProviders[Providers.CLAUDE_AGENT_SDK]`)       | `Run.create`'s internal `initializeModel` (same mechanism BAML/Anthropic use — not independently re-Read for this pass; see prior research doc below)                                                            | Import of `src/llm/providers.ts` — module-load-time side effect           | Direct Read of `providers.ts:14,37`                                                                                                                                                  |
| construction → stream   | Constructed `ChatClaudeAgentSDK` instance                                    | `_streamResponseChunks` invoked via LangChain's `BaseChatModel.stream()` contract                                                                                                                                | Standard LangChain streaming contract — no manual registration            | Direct Read of `ChatClaudeAgentSDK.ts:457-611`                                                                                                                                       |
| stream → subprocess     | `resolveQueryFn()`/`loadRealQuery()` (`ChatClaudeAgentSDK.ts:387-391,82-88`) | Real `@anthropic-ai/claude-agent-sdk` `query()` — spawns the `claude` CLI                                                                                                                                        | Dynamic `import('@anthropic-ai/claude-agent-sdk')`, memoized module-level | Direct Read; `queryFn` test seam is what existing `__tests__/*.test.ts` override instead                                                                                             |
| subprocess → result     | `query()`'s `AsyncGenerator<SDKMessage>`                                     | `isResultMessage`/`isResultSuccess` branch (`ChatClaudeAgentSDK.ts:564-583`)                                                                                                                                     | In-process `for await` loop, no external registration                     | Direct Read of `messages.ts:50-60` and `ChatClaudeAgentSDK.ts:564-583`                                                                                                               |
| result → observable     | `usageMetadataFromResult`/`responseMetadataFromResult` (`usage.ts:19-50`)    | Terminal `ChatGenerationChunk`/`AIMessageChunk` → `_generate`'s concatenated `ChatResult` → `run.getRunMessages()`/event-handler capture (same observable surface every other live test already asserts against) | Standard `BaseChatModel._generate` contract                               | Direct Read of `ChatClaudeAgentSDK.ts:571-582,613-634`; observable surface confirmed via `context-usage.live.test.ts:131-149`'s existing assertions on the equivalent Anthropic path |

Labels: every node above is **production-called** in the sense that it is the same code path a real host application invokes (no test-only bypass) — the only thing a live test changes versus the existing `__tests__/*.test.ts` suite is _not overriding_ `queryFn`, letting the real subprocess run. `adds_or_changes: false` on every node — this research (and the beads it supports) adds a new **test**, not a new production node.

### ClosureMap (structured — derive() input)

```json
{
  "behavior": "A Providers.CLAUDE_AGENT_SDK agent turn spawns a real `claude` CLI subprocess and produces an observable AIMessageChunk carrying usage_metadata/response_metadata derived from the subprocess's terminal SDKResultMessage.",
  "git_commit": "2b41826d40d36af36c43150af497f8c1ebfe57aa",
  "repo": "/home/maceo/ntm_Dev/claude-agent-sdk-2026-08-16-12-13",
  "nodes": [
    {
      "id": "register",
      "module": "src/llm/providers.ts",
      "is_entrypoint": false,
      "adds_or_changes": false,
      "read_path": null,
      "seedable_store": "llmProviders (src/llm/providers.ts:23-38)"
    },
    {
      "id": "invoke_turn",
      "module": "src/llm/claudeAgentSdk/ChatClaudeAgentSDK.ts",
      "is_entrypoint": true,
      "adds_or_changes": false,
      "read_path": null,
      "seedable_store": null
    },
    {
      "id": "spawn_subprocess",
      "module": "src/llm/claudeAgentSdk/ChatClaudeAgentSDK.ts:387-391,82-88",
      "is_entrypoint": false,
      "adds_or_changes": false,
      "read_path": null,
      "seedable_store": null
    },
    {
      "id": "result_message",
      "module": "src/llm/claudeAgentSdk/messages.ts",
      "is_entrypoint": false,
      "adds_or_changes": false,
      "read_path": null,
      "seedable_store": null
    },
    {
      "id": "observable_chunk",
      "module": "src/llm/claudeAgentSdk/usage.ts + ChatClaudeAgentSDK.ts:571-582",
      "is_entrypoint": false,
      "adds_or_changes": false,
      "read_path": "run.getRunMessages() (used identically by context-usage.live.test.ts:126-140)",
      "seedable_store": null
    }
  ],
  "edges": [
    { "is_async": false, "cross_boundary": true, "driver": null },
    { "is_async": false, "cross_boundary": true, "driver": null },
    { "is_async": false, "cross_boundary": false, "driver": null },
    { "is_async": false, "cross_boundary": false, "driver": null }
  ]
}
```

Notes on rule application: `register -> invoke_turn` crosses the provider-registry construction boundary (same kind of boundary as the prior BAML-era research doc's `register -> resolve_construct` edge). `invoke_turn -> spawn_subprocess` crosses a real OS-process boundary (the `claude` CLI subprocess) — still modeled `is_async: false` because the whole chain is a single in-process `await`/`for await` from the calling test's point of view (no queue/scheduler/outbox/event-replay edge exists here); `cross_boundary: true` because it leaves the Node process. No `highest_new_connector` — no node in this chain is `adds_or_changes: true`; AF-nr1p/AF-enki add a **test file**, not a production node.

**No closure adapter staged for this pass.** The closure-adapter framework stages a promotable trigger/observe HTTP scaffold for a _new or changed_ production node; every node in this chain is pre-existing and already covered by real (non-fake) integration exercise once AF-nr1p's live test lands — the "adapter" AF-nr1p/AF-enki effectively build _is_ the live test file itself (it triggers via `Run.create`/`processStream` and observes via `run.getRunMessages()`/captured usage, using real functions directly rather than a promotable HTTP shim). Fabricating a separate staged adapter for an unchanged chain that a prior research pass (`2026-08-13-10-38-claude-code-sdk-agent-provider.md`) already mapped for this same provider's registration path would duplicate, not add, information.

## Historical Context (from thoughts/)

- `thoughts/searchable/shared/research/2026-08-13-10-38-claude-code-sdk-agent-provider.md` — written _before_ `ChatClaudeAgentSDK` existed, using BAML's already-implemented provider as the concrete illustration of "the pattern a Claude Code SDK provider would need to join" (provider registry, three type maps, `registerChatModel`). Its own Workflow Closure Map (lines 198-296) documents the general registry→construction→invocation→(tool loop, for tool-using providers)→observable chain that `ChatClaudeAgentSDK` was later built to join — `ChatClaudeAgentSDK` skips the tool-loop leg entirely (B10), which this current research's map reflects by omitting a `tool_execute`-equivalent node.
- That same document's `Follow-up Research 2026-08-15T00:00:00-04:00` section (lines 409-439, not fully read in this pass) covers subprocess lifecycle/multi-tenancy, hook/permission bridging, and `createSdkMcpServer` — adjacent to but not overlapping AF-nr1p/AF-enki's live-test-harness concern; worth a follow-up read if AF-enki's scope ever expands into hook/HITL live testing (which its own bd description explicitly defers: "decide separately whether hook/HITL bridging... needs its own live test").

## Related Research

- `thoughts/searchable/shared/research/2026-08-13-10-38-claude-code-sdk-agent-provider.md` — see above.

## Open Questions

- **Gating env var name**: no existing convention dictates the exact name AF-nr1p's env var should take (`RUN_CLAUDE_AGENT_SDK_LIVE_TESTS`, `RUN_LIVE_CLAUDE_AGENT_SDK_TESTS`, etc. are all consistent with the `RUN_<THING>_LIVE_TESTS` shape seen elsewhere) — a naming decision for the plan, not something the codebase already answers.
- **Auth gate condition**: because `ChatClaudeAgentSDK` doesn't read `ANTHROPIC_API_KEY` itself, gating `shouldRunLive` on that env var (matching every other live test's convention) would not actually reflect this provider's real auth requirement (a working `claude` CLI + either an env var or an authenticated `$HOME/.claude`) — the plan needs to decide whether to gate on `ANTHROPIC_API_KEY` for consistency with repo convention, on CLI/credential presence instead, or on both.
- **File ownership between AF-nr1p and AF-enki**: bd's own text does not explicitly assign the live test _file_ to AF-nr1p; that reading is inferred from AF-enki's description plus the two beads' titles. This is being resolved via Agent Mail coordination with the teammate who claimed AF-nr1p (CyanBridge) rather than by anything in the codebase itself.
- **`npm run` script name**: AF-nr1p's own title (`npm run test:live:claude-agent-sdk`) already answers this one directly — no ambiguity there, unlike the env var name above.
