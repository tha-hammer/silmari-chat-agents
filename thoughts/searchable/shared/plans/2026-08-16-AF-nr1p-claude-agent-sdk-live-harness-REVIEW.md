---
date: 2026-08-16T12:32:00-04:00
reviewer: CyanBridge (codex-cli)
plan: thoughts/searchable/shared/plans/2026-08-16-AF-nr1p-claude-agent-sdk-live-harness.md
bead: AF-nr1p
status: needs-minor-revision
---

# AF-nr1p Plan Review

## Verdict

Needs minor revision before implementation. The plan selects the correct public seam and preserves the live-test opt-in boundary, but two type/configuration details and three verification details should be made executable rather than left implicit.

## Findings

### R1 — High: narrow the returned message before chunk-only assertions

The plan requires assertions on `tool_call_chunks`, but `initializeModel(...).invoke(...)` is exposed through the common LangChain model surface. The implementation must not depend on an implicit `any` or an unchecked structural access. Require an `AIMessageChunk.isInstance(response)` guard (or an equally explicit existing LangChain type guard) before reading `tool_calls`, `tool_call_chunks`, and `usage_metadata`. The guard itself is also the AI-message-shape assertion.

Resolution required in Phase 2 and the contract grammar.

### R2 — Medium: define the model override's blank-value behavior

The plan says the model override is optional and non-empty but does not define whether whitespace-only input is forwarded. Normalize `CLAUDE_AGENT_SDK_LIVE_MODEL` with `trim()` and omit the `model` property when the normalized value is empty. This prevents the dedicated command from accidentally forwarding an invalid blank model name.

Resolution required in Locked Decisions and Phase 2.

### R3 — Medium: distinguish collection proof from no-inference proof

`--listTests` proves exact Jest target resolution but does not prove the disabled suite cannot call the SDK. The default-skip command is the behavioral proof: it must report one skipped test and no executed test. Record both commands and their distinct guarantees in the plan and close evidence.

Resolution required in B1/B2 and automated verification.

### R4 — Medium: make the real-query proof explicit and non-flaky

The strongest static proof is the absence of `clientOptions.queryFn`; the strongest runtime proof is AF-enki's executed, non-skipped command with real terminal metadata. Do not use elapsed wall-clock thresholds as a proxy for a subprocess, and do not require `total_cost_usd > 0`, because billing/accounting modes are not the behavior under test and may legitimately report zero. Keep positive usage, session id, marker, and the no-`queryFn` construction as the stable proof set.

Resolution required in Assertions, Phase 2, and Workflow Closure.

### R5 — Low: name structural test literals and keep control expressions pure

The environment keys, opt-in value, maximum turn count, and Jest timeout should be module constants. Compute the normalized model override before the client-options object and keep the conditional spread a pure question over that value. No filesystem, credential, or SDK probe belongs in a condition. The resulting test remains flat and requires no helper abstraction used only once.

Resolution required in Phase 2 and Phase 3.

## Contract and Boundary Audit

- Provider registry boundary: verified at `src/llm/providers.ts:23-38`.
- Unbound/no-tools boundary: verified at `src/llm/init.ts:18-31,58-62`.
- Real-query selection: verified at `src/llm/claudeAgentSdk/ChatClaudeAgentSDK.ts:82-88,387-390`; it is selected only when no `queryFn` override is supplied.
- SDK subprocess/stream boundary: verified at `src/llm/claudeAgentSdk/ChatClaudeAgentSDK.ts:457-582`.
- Jest discovery and script precedent: verified at `jest.config.mjs:7-10` and `package.json:209-212`.
- Authentication boundary: correctly left to inherited SDK/CLI state; the provider has no API-key client option.

No adapter is required because AF-nr1p adds a caller-side live specification and npm entrypoint without changing the production provider chain.

## Cleanup Audit

- No side effects in conditionals: safe after R5; all environment reads are assignments and conditions only inspect values.
- No mutation in control expressions: safe; no assignment or increment is planned inside a condition.
- Never nesting: safe; one suite and one test stay at a single logical scope.
- Named constants: revise per R5.
- External configuration: no new committed secret or operator configuration is introduced. Credentials remain inherited environment/CLI state. Test-only bounds stay named in the test module.
- Control-expression discipline: the run gate and optional-model predicate remain simple, pure questions.
- Maintainability: no shared helper or new abstraction is justified for one live suite.

## Approval Conditions

The plan is approved for implementation once R1-R5 are incorporated in place and a system map records the command, gate, public model boundary, SDK subprocess, terminal message, and AF-enki evidence handoff.
