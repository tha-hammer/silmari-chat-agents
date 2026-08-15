---
date: 2026-08-15T13:09:34-04:00
researcher: tha-hammer
git_commit: 3f5dc561fc07fe710e9183de7f8a5015bda0751c
branch: main
repository: silmari-chat-agents
topic: 'Providers.CLAUDE_AGENT_SDK Implementation Strategy'
tags:
  [
    implementation,
    strategy,
    providers,
    claude-agent-sdk,
    hooks,
    session-continuity,
  ]
status: complete
last_updated: 2026-08-15
last_updated_by: tha-hammer
type: implementation_strategy
---

# Handoff: Implement the Claude Agent SDK provider TDD plan

## Task(s)

1. **Research** — resolve the remaining open questions on incorporating the Claude Agent SDK as a provider. **COMPLETE.** `thoughts/searchable/shared/research/2026-08-13-10-38-claude-code-sdk-agent-provider.md` (see its "Follow-up Research 2026-08-15" section).
2. **TDD plan** — write the implementation plan. **COMPLETE**, but with a wrinkle: two _other_ sessions independently wrote full competing plans for this exact feature within the same ~15-minute window. All three were read in full and synthesized into one canonical plan. `thoughts/searchable/shared/plans/2026-08-15-12-14-tdd-providers-claude-agent-sdk-phase0.md`.
3. **Beads tracking** — consolidated. 21 duplicate issues (3 epics + 18 phase issues from the collision) closed; one clean epic + 6 phase issues created.
4. **Implementation** — **NOT STARTED.** This handoff is for that next phase, beginning with Phase 0 (`AF-ftsa`).

## Critical References

- `thoughts/searchable/shared/plans/2026-08-15-12-14-tdd-providers-claude-agent-sdk-phase0.md` — the canonical plan. Read it fully before writing any code.
- `thoughts/searchable/shared/research/2026-08-13-10-38-claude-code-sdk-agent-provider.md` — all architecture decisions plus ground-truth SDK facts (both follow-up sections).
- `thoughts/searchable/shared/plans/2026-08-09-15-57-tdd-providers-baml-phase0.md` — the BAML precedent plan. `ChatBAML` is the structural template (the only other provider in this codebase extending `BaseChatModel` directly).

## Recent changes

No implementation code changed this session — pure research and planning. Only `thoughts/` docs and beads state changed:

- Appended a "Follow-up Research 2026-08-15" section to the research doc, resolving subprocess lifecycle/multi-tenancy, hook bridging, and `createSdkMcpServer` tool-exposure questions.
- Wrote, then fully rewrote as a synthesis, `thoughts/searchable/shared/plans/2026-08-15-12-14-tdd-providers-claude-agent-sdk-phase0.md`.
- Closed 21 beads issues (3 duplicate epics + 18 duplicate phase issues) with a reason pointing to the synthesis.
- Created epic `AF-xcnf` and 6 phase issues: `AF-ftsa` (Phase 0), `AF-hztz` (Phase 1, BLOCKING Closure A), `AF-6nfw` (Phase 2, BLOCKING Closure B), `AF-hmmm` (Phase 3), `AF-v6f9` (Phase 4, BLOCKING Closure C), `AF-bsv5` (Phase 5).

## Learnings

- **Two other sessions independently wrote full competing TDD plans** for this exact feature in the same ~15-minute window (`thoughts/searchable/shared/plans/2026-08-15-12-01-...` and `.../2026-08-15-12-02-...`), each with its own beads epic. Both are retained as historical record but are **superseded** — do not resume implementation from them, resume from the `12-14` synthesis.
- `WebFetch` on the SDK's docs pages is **unreliable for exact field names** — two independent fetches of the same page returned contradictory type shapes (different `SDKMessage` variants, a fabricated `stop_reason` enum). Ground truth came from `npm pack @anthropic-ai/claude-agent-sdk@latest`, extracting the real tarball, and reading `sdk.d.ts`/`sdk-tools.d.ts` directly (verified at v0.3.233). Re-verify against `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` once the dependency is actually installed, since the version may have moved.
- **The central architectural finding**: `Graph.ts`'s `createCallModel` constructs a brand-new model instance on **every** graph turn — confirmed by direct read (`src/graphs/Graph.ts:2264,2400-2406`, the returned node function calls `initializeModel(...)` on every invocation). Every other provider is stateless per call, so this never mattered before. The Claude Agent SDK's subprocess **is** stateful (on-disk session, resumed by id). Session continuity is threaded through a process-local `sessionRegistry` keyed by `config.configurable.thread_id` — an established stable-per-conversation key already used at four other sites (`src/graphs/Graph.ts:1803,3501,4132,4341`).
- `canUseTool`'s return type (`PermissionResult`, real `sdk.d.ts:2193-2205`) has **exactly two branches**, `allow`/`deny` — no `ask` branch anywhere in the SDK's type system. This repo's own `ask`/`respond` HITL flow (`ToolNode`'s `interrupt()`) is **confirmed structurally incompatible** with `canUseTool`'s live-Promise model: `interrupt()` unwinds and checkpoints for possibly-later, possibly-different-process resumption; `canUseTool`'s Promise must resolve within the same live process/subprocess connection. **Do not wire `ToolNode`'s `interrupt()` directly into the `canUseTool` bridge — it does not compose.** The plan ships a `hitlResolver` extension seam with a safe default (deny-with-explanation, proven to never hang) but does **not** implement a live human-response bridge — that's explicitly Deferred.
- **zod v4 is safe, not a BAML-style blocker** — verified against the real `package-lock.json` dependency graph. Every existing zod consumer (`@langchain/core`, `@langchain/anthropic`, `@langchain/openai`, `@langchain/langgraph`, `@anthropic-ai/sdk`, `openai`, `@mistralai/mistralai`, `zod-to-json-schema`) already accepts `zod ^3.25.x || ^4.x`. Only `@anthropic-ai/sandbox-runtime` pins `zod ^3.24.1`, and it's already optional/lazy-loaded — npm nests its own v3 copy, a normal resolution, not a conflict.
- Registered as a **normal static `llmProviders` entry** (like `CustomAnthropic`), **not** a BAML-style `registerChatModel()` side-effect — the direct-dependency decision means none of BAML's packaging-boundary machinery applies (no npm subpath, no `config/package-entries.mjs` entry, no `config/circular-deps.test.mjs` count bump).
- Only `ChatBAML` in this codebase extends `BaseChatModel` directly (every other provider subclasses an upstream LangChain integration) — it's the structural template for `ChatClaudeAgentSDK`'s class shape, not `CustomAnthropic`.
- `SDKAssistantMessage.message` is a real Anthropic `BetaMessage` — **reuse** `src/llm/anthropic/utils/message_outputs.ts`'s existing content-block converters for streaming translation rather than writing a new parser.
- `Options.env` **replaces** the subprocess environment wholesale, it does **not** merge with `process.env` (confirmed in the real `.d.ts` JSDoc) — any multi-tenant isolation code that sets `env` must spread `process.env` first or the subprocess silently loses `PATH`/`HOME`/credentials.
- `resolveWorkspacePathSafe` (`src/tools/local/LocalExecutionEngine.ts:1319`) is a **per-file-path** check, not a session `cwd` resolver — use `getLocalCwd(config)` (`:227`) for the session's working directory instead.
- **No property-testing framework, by ratified decision** (`bd show AF-d9m`, closed 2026-08-09): use table-driven property tests enumerating stated domains, not `fast-check`.
- `AF-2gh` (in_progress, unrelated) is a **different, Python-based** "ClaudeCodeProvider" in a different repo (`activegraph`, capability-limited design, mostly complete per its own notes) — do not confuse with this TypeScript work; no overlap, no action needed.
- Beads issue IDs (`AF-*`) are **shared/global across many of this user's projects**, not scoped to this repo alone — `bd list` shows issues from reel-af, BAML, Vultr deployment, Cosmic-DS, etc. Filter carefully by title/description, not just prefix.
- AgentMail has zero registered agents for this project (`resource://agents/home-maceo-dev-silmari-chat-agents` returned an empty agent list) — the colliding sessions coordinated via beads, not AgentMail. No messages to pick up.

## Artifacts

- `thoughts/searchable/shared/plans/2026-08-15-12-14-tdd-providers-claude-agent-sdk-phase0.md` — **the canonical plan** (27 behaviors B0–B26, 4 BLOCKING closures, 6 phases). Read fully before starting implementation.
- `thoughts/searchable/shared/research/2026-08-13-10-38-claude-code-sdk-agent-provider.md` — full research doc, both follow-up sections.
- `thoughts/searchable/shared/plans/2026-08-15-12-01-tdd-providers-claude-agent-sdk-phase0.md` — superseded parallel draft, historical record only.
- `thoughts/searchable/shared/plans/2026-08-15-12-02-tdd-providers-claude-agent-sdk-phase0.md` — superseded parallel draft, historical record only (source of the session-continuity finding, folded into the synthesis).

## Action Items & Next Steps

1. Read the canonical plan (`12-14`) fully.
2. `bd update AF-ftsa --claim` and start Phase 0 (B0–B4): enum member (`Providers.CLAUDE_AGENT_SDK = 'claudeAgentSdk'`), `ClaudeAgentSDKClientOptions` type, `ProviderOptionsMap`/`ChatModelMap` entries, `package.json` deps (`@anthropic-ai/claude-agent-sdk`, `zod@^4.0.0`, `@modelcontextprotocol/sdk@^1.29.0`), static `llmProviders` entry, `bindTools` throw (Closure D — a safety closure proving no SDK call happens on a tool-binding attempt).
3. Run `npm install && npm ls zod` early to confirm the dependency-compatibility verification (B0) before writing more code — it's asserted, not assumed, in the plan.
4. Follow TDD Red-Green-Refactor per behavior. Proceed through phases in order: Phase 1 (B5–B10, Closure A: message-stream classification, "never emit `tool_calls`") → Phase 2 (B11–B14, Closure B: session continuity) → Phase 3 (B15–B19: workspace/multi-tenancy/cancellation) → Phase 4 (B20–B22, Closure C: hook/permission bridging) → Phase 5 (B23–B26: Langfuse, errors, docs).
5. New directory: `src/llm/claudeAgentSdk/` — `ChatClaudeAgentSDK.ts`, `types.ts`, `messages.ts`, `usage.ts`, `sessionRegistry.ts`, `hookAdapter.ts`, `errors.ts`, `__tests__/` (including `fakeQuery.ts`, mirroring BAML's `fakeFunctionSet.ts`).
6. Claim/close beads issues as you progress (`bd update <id> --claim`, `bd close <id>`) per phase.
7. The plan's "Decisions needed" #1 (naming: `ChatClaudeAgentSDK` / `claudeAgentSdk` / `src/llm/claudeAgentSdk/`) should be confirmed or changed before B0's Green step — it's not load-bearing, easy to rename now, hard later.

## Other Notes

- **Conservative git profile is in effect for this repo** (see `CLAUDE.md`) — do not commit, push, or run `bd dolt push`/`bd dolt pull` without explicit user authorization. Those sync commands were deliberately **not** run this session; run them only with the user's go-ahead.
- The plan's own "Deferred" table lists 7 explicitly out-of-scope items (a live `hitlResolver` bridge, hook-level `'ask'` procedural semantics, `toolAliases` redirection, `createSdkMcpServer` exposure of local tools, cross-server session continuity, forwarding intermediate Claude-internal tool activity, `spawnClaudeCodeProcess` sandbox routing) — do not silently expand scope into these without a new planning pass.
- Verification gates (from the plan): `npm install && npm audit` · `npm ls zod` · `npx tsc --noEmit` · `npx eslint src/` · `npx jest` · `npx jest claudeAgentSdk` · `npx jest langfuse deterministic-trace-id` (`AGENTS.md:155`) · `npm run build` · `npm run test:live:claude-agent-sdk` (new opt-in script, not part of default CI).
- Beads epic: `AF-xcnf`. Phase issues: `AF-ftsa` (Phase 0), `AF-hztz` (Phase 1, Closure A), `AF-6nfw` (Phase 2, Closure B), `AF-hmmm` (Phase 3), `AF-v6f9` (Phase 4, Closure C), `AF-bsv5` (Phase 5).
- Not an NTM session; not orchestrating multi-agent work — this is a plain single-session handoff.
