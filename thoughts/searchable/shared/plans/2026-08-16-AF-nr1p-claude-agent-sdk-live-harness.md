---
date: 2026-08-16T12:28:00-04:00
researcher: CyanBridge (codex-cli)
git_commit: 2b41826d40d36af36c43150af497f8c1ebfe57aa
branch: claude-agent-sdk-2026-08-16-12-13
repository: silmari-chat-agents
topic: 'AF-nr1p: add the Claude Agent SDK live-test harness'
tags: [plan, tdd, claude-agent-sdk, live-tests, AF-nr1p]
status: implemented
last_updated: 2026-08-16
last_updated_by: CyanBridge
last_updated_note: 'Implemented with TDD Red/Green evidence. Structural, default-skip, type, lint, provider regression, build, and diff checks pass; AF-enki owns the authenticated live execution.'
---

# AF-nr1p — Claude Agent SDK Live Harness Implementation Plan

## Overview

Add the missing `npm run test:live:claude-agent-sdk` command and one credentialed Jest suite that exercises a bare `Providers.CLAUDE_AGENT_SDK` turn through the real `@anthropic-ai/claude-agent-sdk` `query()` path. The test omits LangChain tools, provider hooks, HITL, `queryFn`, and multi-tenant configuration. It is skipped during ordinary test runs and runs only when its dedicated opt-in flag is set.

AF-nr1p owns the harness and executable bare-turn specification. AF-enki owns executing the finished harness against the available real Claude CLI credentials and recording that result. The live test file is therefore implemented here but its first billed inference evidence is not required to close this bead.

## Current State Analysis

- `package.json` has the base Jest script and one dedicated live script, `test:live:handoffs`; it has no Claude Agent SDK live script (`package.json:209-212`).
- Jest already discovers any `src/**/*.test.ts`, so a `src/specs/*.live.test.ts` file needs no Jest configuration change (`jest.config.mjs:7-10`).
- `Providers.CLAUDE_AGENT_SDK` is statically mapped to `ChatClaudeAgentSDK` (`src/llm/providers.ts:23-38`).
- `initializeModel` constructs the registered provider and returns it unbound when `tools` is absent or empty (`src/llm/init.ts:18-31,58-62`).
- Omitting `clientOptions.queryFn` selects the lazy real SDK import (`src/llm/claudeAgentSdk/ChatClaudeAgentSDK.ts:82-88,387-390`).
- The provider passes the prompt to real `query()`, consumes the SDK stream, and yields the terminal LangChain message (`src/llm/claudeAgentSdk/ChatClaudeAgentSDK.ts:457-582,613-634`).
- Existing unit and closure tests use `fakeQuery`; the exact unbound invocation shape is already tested without a real subprocess (`src/llm/claudeAgentSdk/__tests__/ChatClaudeAgentSDK.stream.test.ts:32-41`, `src/llm/claudeAgentSdk/__tests__/turnTranslation.closure.test.ts:35-119`).
- The closest credentialed direct-model precedent is the Bedrock tool-less suite: dotenv load, opt-in gate, `initializeModel`, `tools: undefined`, `model.invoke`, and bounded timeout (`src/specs/bedrock-toolless.live.test.ts:15-43,79-123`).
- The provider has no API-key option. When `Options.env` is omitted, the SDK subprocess inherits `process.env`, including CLI/API credentials (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1461-1479`).

## Desired End State

The repository contains:

1. `src/specs/claude-agent-sdk.live.test.ts`, collected but skipped by default.
2. `package.json` script `test:live:claude-agent-sdk` that sets `RUN_CLAUDE_AGENT_SDK_LIVE_TESTS=1`, uses the repository's VM-module Jest setup, targets only that file, and runs serially.
3. A bounded bare turn that omits `queryFn`, tools, hooks, HITL, and multi-tenant options; invokes the real provider; and checks a nonce marker, AI message shape, absence of host tool calls, usage totals, and terminal response metadata.
4. Structural verification proving the script resolves the exact suite without making a billed request, plus default-skip, type-check, lint, and provider-regression checks.

## Locked Decisions

### Invocation surface

Use `initializeModel({ provider: Providers.CLAUDE_AGENT_SDK, clientOptions, tools: undefined })` followed by `model.invoke([new HumanMessage(prompt)])`. This is the smallest public provider boundary that proves registry selection and real adapter invocation without introducing graph handlers, token counters, checkpointers, or cleanup behavior unrelated to AF-nr1p.

### Live gate and authentication

Use `RUN_CLAUDE_AGENT_SDK_LIVE_TESTS=1` as the sole collection gate. Default Jest runs select `describe.skip`. The npm harness sets the flag deliberately.

Do not skip again based only on `ANTHROPIC_API_KEY`: this provider can authenticate through an existing Claude CLI login as well as inherited API-key credentials. Once the operator invokes the dedicated live command, missing/invalid authentication must fail the test rather than turn it into a green skip.

### Model and cost bound

Allow a trimmed, nonblank `CLAUDE_AGENT_SDK_LIVE_MODEL` to override the SDK/CLI default; omit the `model` property for unset, empty, or whitespace-only input. Set `maxTurns: 1` and a 120-second timeout. Use a short marker-only prompt that explicitly asks for no tool use. Define the environment keys, opt-in value, maximum turns, and timeout as module constants.

### Assertions

Use a per-run marker and containment rather than exact full prose. Narrow the public invocation result with LangChain's `AIMessageChunk.isInstance` type guard before reading chunk-only fields. Assert:

- the returned message is an AI message;
- flattened response content contains the marker and is non-empty;
- `tool_calls` and `tool_call_chunks` are empty;
- `usage_metadata` exists with positive input/output/total tokens and an internally consistent total;
- `response_metadata.session_id` is a non-empty string;
- `response_metadata.num_turns` is at least one.

Do not assert elapsed wall-clock thresholds, exact token counts, positive cost, model name, context window, or output limit. Timing is not semantic proof of a subprocess, and SDK/CLI accounting modes can legitimately report zero cost. The stable real-query proof is the absence of `queryFn` in construction plus AF-enki's executed, non-skipped run with real terminal usage/session metadata. AF-t37e owns the context-window/canonical-model metadata change in parallel.

## What We're Not Doing

- No changes under `src/llm/claudeAgentSdk/`.
- No mocked/fake `queryFn` in the live test.
- No tools, hooks, HITL resolver, session resume, workspace-policy, multi-tenant, or Langfuse scenario.
- No downstream `silmari-chat` edits or dependency-pin updates.
- No default-CI credential requirement.
- No first live execution evidence under this bead; AF-enki owns that dependent run.

## Smallest Testable Behaviors

### B1 — the named npm harness resolves one exact live suite

Given the repository before AF-nr1p, when `npm run test:live:claude-agent-sdk -- --listTests` is invoked, then npm reports that the script is missing.

Given the completed harness, when the same command is invoked, then Jest lists `src/specs/claude-agent-sdk.live.test.ts` and no other test file. This proves exact command-to-suite resolution; it does not by itself prove the suite's disabled behavior.

Classification: LEAF. The observable is the npm/Jest command resolution itself; no production workflow or background edge is involved.

### B2 — ordinary Jest execution remains credential-free

Given `RUN_CLAUDE_AGENT_SDK_LIVE_TESTS` is absent, when Jest targets the new file, then exactly one test is collected as skipped, zero tests execute, and no real inference occurs. This command, rather than `--listTests`, is the no-inference proof.

Classification: LEAF. The gate and observable live in the test module; no production call occurs.

### B3 — opting in exercises the real bare provider boundary

Given the opt-in flag and valid inherited Claude CLI authentication, when the live test invokes one marker prompt, then a real Claude Agent SDK turn returns an AI message containing the marker, no host-visible tool calls, positive usage, and terminal session metadata.

Classification: BLOCKING for AF-enki's inference promise because it crosses the provider-registration and OS-subprocess boundaries. For AF-nr1p, the executable spec is the deliverable; AF-enki supplies the required executed-not-skipped evidence.

### B4 — an explicitly requested but unauthenticated live run fails closed

Given the opt-in flag and no usable Claude CLI authentication, when the test reaches `model.invoke`, then the SDK error fails the Jest command; the suite does not self-skip because `ANTHROPIC_API_KEY` is absent.

Classification: BLOCKING for live-environment evidence, owned by AF-enki. AF-nr1p structurally guarantees it by using only the explicit run flag as the suite gate and allowing invocation failures to propagate.

## TDD Implementation Phases

## Phase 1 — Red: record the missing harness

### Verification

- Run `npm run test:live:claude-agent-sdk -- --listTests` before editing.
- Record the expected non-zero exit and `Missing script` failure as B1's Red evidence.
- Run `npx jest src/specs/claude-agent-sdk.live.test.ts --runInBand` before creating the file and record Jest's no-test failure as B2's Red evidence.

No files change in this phase.

## Phase 2 — Green: add the opt-in bare-turn suite

### File: `src/specs/claude-agent-sdk.live.test.ts`

Add:

- dotenv loading before provider imports;
- named constants for both environment keys, the opt-in value, maximum turns, and timeout;
- `liveEnabled` from `RUN_CLAUDE_AGENT_SDK_LIVE_TESTS === '1'`;
- `describeIfLive = liveEnabled ? describe : describe.skip`;
- optional model input normalized with `trim()`, with whitespace-only input omitted;
- a 120-second suite/test timeout;
- one `initializeModel` call with `Providers.CLAUDE_AGENT_SDK`, `cwd: process.cwd()`, `maxTurns: 1`, and `tools: undefined`;
- no `queryFn`, hook, HITL, or multi-tenant fields;
- one nonce-marker prompt;
- an `AIMessageChunk.isInstance` guard before accessing AI/chunk-only fields;
- the structural assertions in B3.

The file-level run comment documents both invocation modes:

```text
npm run test:live:claude-agent-sdk
CLAUDE_AGENT_SDK_LIVE_MODEL=<model> npm run test:live:claude-agent-sdk
```

### File: `package.json`

Add beside `test:live:handoffs`:

```json
"test:live:claude-agent-sdk": "RUN_CLAUDE_AGENT_SDK_LIVE_TESTS=1 NODE_OPTIONS='--experimental-vm-modules' jest src/specs/claude-agent-sdk.live.test.ts --runInBand"
```

### Automated verification

- `npm run test:live:claude-agent-sdk -- --listTests` lists only the new suite without executing it; this is the command-resolution proof.
- `env -u RUN_CLAUDE_AGENT_SDK_LIVE_TESTS npx jest src/specs/claude-agent-sdk.live.test.ts --runInBand` reports one skipped test, zero executed tests, and exits successfully; this is the disabled/no-inference proof.
- `npx tsc --noEmit` passes.
- `npx eslint src/specs/claude-agent-sdk.live.test.ts` passes with no warnings or errors.
- `npx jest src/llm/claudeAgentSdk --runInBand` passes.

### Manual/dependent verification

- AF-enki runs `npm run test:live:claude-agent-sdk` against real inherited Claude CLI credentials.
- The output shows one executed passing test, not a skip.
- AF-enki records the command output and closes its bead independently.

## Phase 3 — Refactor: keep the live contract minimal

- Remove helper abstractions unless used more than once in the file.
- Keep the prompt, environment-variable names, opt-in value, turn bound, and timeout as module constants.
- Compute the normalized model override before building `clientOptions`.
- Keep conditionals pure and early; do not perform filesystem, credential, SDK, or invocation probes in a condition.
- Do not inspect `$HOME/.claude` or duplicate the SDK's authentication rules.
- Re-run all Phase 2 automated checks.

## Workflow Closure

AF-nr1p changes test infrastructure, not the existing provider production chain. The production lineage under live execution remains:

```text
HumanMessage
  -> initializeModel(Providers.CLAUDE_AGENT_SDK)
  -> ChatClaudeAgentSDK.resolveQueryFn()
  -> real SDK query()
  -> claude CLI subprocess
  -> SDK assistant/result messages
  -> ChatClaudeAgentSDK message conversion
  -> returned AI message
```

### Closure Test: a real bare Claude Agent SDK turn returns an observable AI message [BLOCKING]

SOURCE (seed only): one `HumanMessage` containing a unique marker.

TRIGGER (start): `initializeModel(...).invoke(...)` from `src/specs/claude-agent-sdk.live.test.ts`; boundary is the highest new connector, the live-test entrypoint.

DRIVERS (async edges): none. The subprocess stream is awaited directly; there is no queue, scheduler, outbox, timer, or background registration edge.

OBSERVE (assert via): the `BaseMessage` returned by the public `Runnable.invoke` path.

FORBIDDEN SPAN: no `queryFn` override, fake SDK message generator, elapsed-time proxy, direct `messages.ts` converter call, or direct `usage.ts` call.

RED-AT-SEAM proof: before AF-nr1p, the named npm harness and target suite do not exist. For the existing provider connector itself, the established default closure tests already prove fake-query red/green behavior; AF-enki supplies the real-subprocess execution evidence.

DRIVABILITY: the public model API accepts the message input directly; the SDK subprocess is the true external boundary. No injected store or clock exists because this behavior has no mutable store or detached async edge.

EXECUTION (must run): AF-enki invokes the dedicated command in the authenticated environment and records one executed, non-skipped passing test. Missing credentials fail closed.

## Contract Grammar

```ebnf
LiveCommand = "npm run test:live:claude-agent-sdk" ;
RunGate = "RUN_CLAUDE_AGENT_SDK_LIVE_TESTS=1" ;
ModelOverride = [ "CLAUDE_AGENT_SDK_LIVE_MODEL=", NonEmptyString ] ;

BareTurn = initializeModel(
  provider = "claudeAgentSdk",
  clientOptions = { cwd, maxTurns = 1, [model] },
  tools = undefined
) ".invoke" "(" HumanMessage ")" ;

Success = AIMessage
  & AIMessageChunkTypeGuard
  & MarkerContained
  & NoToolCalls
  & PositiveUsage
  & NonEmptySessionId
  & PositiveTurnCount ;

Disabled = RunGate absent -> JestSkipped ;
EnabledFailure = RunGate present & AuthenticationInvalid -> JestFailed ;
```

## Review Resolution Log

- R1 resolved: Phase 2 and the grammar now require `AIMessageChunk.isInstance` before chunk-only field access.
- R2 resolved: the optional model is trimmed and omitted when blank.
- R3 resolved: `--listTests` is only command-resolution proof; the disabled Jest run proves one skip and zero executions.
- R4 resolved: stable no-`queryFn` plus terminal metadata replaces timing/cost proxies.
- R5 resolved: environment keys and structural bounds are named constants; all planned conditions are pure questions.

## Success Criteria

### Automated verification

- [x] Red evidence records the missing script and missing test file.
- [x] The npm command resolves exactly one suite under `--listTests`.
- [x] The suite is skipped by default without requiring credentials.
- [x] TypeScript, focused ESLint, and the existing Claude Agent SDK suite pass.
- [x] `git diff --check` passes.

### Manual/dependent verification

- [ ] AF-enki records a real, non-skipped passing inference run.
- [x] No files in `/home/maceo/Dev/silmari-chat` are modified.

## Implementation Evidence

- Red, missing script: `npm run test:live:claude-agent-sdk -- --listTests` exited 1 with `Missing script`.
- Red, missing suite: `npx jest src/specs/claude-agent-sdk.live.test.ts --runInBand` exited 1 with `No tests found`.
- Green, exact resolution: the npm command with `--listTests` exited 0 and listed only `src/specs/claude-agent-sdk.live.test.ts`.
- Green, default path: the targeted Jest command with the run flag removed exited 0 with `1 skipped, 0 of 1` suites executed.
- `npx tsc --noEmit`: passed.
- `npx eslint src/specs/claude-agent-sdk.live.test.ts --max-warnings=0`: passed.
- `npx prettier --check package.json src/specs/claude-agent-sdk.live.test.ts`: passed.
- `npx jest src/llm/claudeAgentSdk --runInBand`: 11 suites and 77 tests passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## References

- Bead: `AF-nr1p`
- Dependent live-run bead: `AF-enki`
- Research: `thoughts/searchable/shared/research/2026-08-16-12-20-claude-agent-sdk-live-inference-test.md`
- Review: `thoughts/searchable/shared/plans/2026-08-16-AF-nr1p-claude-agent-sdk-live-harness-REVIEW.md`
- System map: `thoughts/searchable/shared/plans/2026-08-16-AF-nr1p-claude-agent-sdk-live-harness-system-map.md`
- Prior provider plan: `thoughts/searchable/shared/plans/2026-08-15-12-14-tdd-providers-claude-agent-sdk-phase0.md:267-272,1741-1753`
- Prior implementation handoff: `thoughts/searchable/shared/handoffs/general/2026-08-15_15-51-25_implement-claude-agent-sdk-provider-complete.md:54-60,79-80`
