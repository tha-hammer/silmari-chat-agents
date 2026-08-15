# The Claude Agent SDK provider (`Providers.CLAUDE_AGENT_SDK`)

`@librechat/agents` ships a `ChatClaudeAgentSDK` chat model that spawns a
`claude` CLI subprocess (`@anthropic-ai/claude-agent-sdk`, the successor to
`@anthropic-ai/claude-code`) for each turn. Unlike every other provider in
this registry, **the subprocess drives its own internal tool loop** — bash,
file read/write/edit, grep, glob, web search/fetch, and any tool
`toolAliases`/MCP servers add. Nothing this repo's own `ToolNode` executes.

```
your app  ──►  ChatClaudeAgentSDK  ──►  query()  ──►  claude CLI subprocess
                    │                                       │
                    │  hooks / canUseTool                   │  its own tool loop
                    ▼                                       ▼
           createToolPolicyHook,                    Bash, Read, Write, Edit,
           createWorkspacePolicyHook                Grep, Glob, WebSearch, ...
```

Unlike BAML, this is a **direct dependency** — `@anthropic-ai/claude-agent-sdk`,
`zod`, and `@modelcontextprotocol/sdk` are all in this package's own
`package.json`. No separate install step, no side-effect import, no npm
subpath. Register and use it exactly like `Providers.ANTHROPIC`:

```ts
import { initializeModel, Providers } from '@librechat/agents';

const model = initializeModel({
  provider: Providers.CLAUDE_AGENT_SDK,
  clientOptions: { cwd: '/path/to/workspace' },
});
```

---

## 1. `zod` moved to v4 — why it's safe

The SDK peer-depends on `zod ^4.0.0`. Every other zod consumer in this
package's dependency graph (`@langchain/core`, `@langchain/anthropic`,
`@langchain/openai`, `@langchain/langgraph`, `@anthropic-ai/sdk`, `openai`,
`@mistralai/mistralai`, `zod-to-json-schema`) already accepts `zod ^3.25.x ||
^4.x`. `@anthropic-ai/sandbox-runtime` is the one holdout (`zod ^3.24.1`) —
already optional/lazily-loaded, and npm nests its own isolated v3 copy for
it (confirm with `npm ls zod`: a single top-level `zod@4.x` plus that one
nested exception is the expected, correct resolution, not a bug to
investigate away).

If you vendor code that imports `zod` directly against v3-specific behavior
(error formatting, `.parse()` semantics, schema introspection), re-verify it
against v4 — this package's own first-party zod call sites were re-verified
as part of shipping this provider.

---

## 2. This provider never emits `tool_calls` — ever

Claude Code owns its tool loop entirely. No `AIMessageChunk` this provider
yields — streaming or final, before or after `.concat()` — ever carries a
non-empty `tool_calls` or `tool_call_chunks` field. Concretely:

- `toolsCondition` always routes to `END` for this provider. Tools you pass
  via LangChain's own `tools:` mechanism have **no execution path** to
  reach — see §3.
- Intermediate `tool_use`/`tool_result` activity the subprocess performs
  internally is stripped before it ever reaches a message chunk. It is not
  forwarded as host-visible progress in this phase.
- Subagent-originated text (Claude's own `Task`/subagent tool, not this
  repo's `SubagentExecutor`) is also dropped — only the main loop's own
  text/thinking commentary and the terminal result surface.

If you need visibility into what Claude did — which files it touched, which
commands it ran — that is not exposed by this provider today. A
`SubagentExecutor`-style `ON_*_UPDATE` progress channel is a plausible
follow-up, not implemented.

---

## 3. `bindTools` throws — do not bind LangChain tools to this provider

```ts
model.bindTools([myTool]); // throws ClaudeAgentSDKToolsUnsupportedError
```

This is deliberate and loud, not an oversight. A LangChain-bound tool would
have no execution path (per §2), so binding one and having it silently do
nothing would be silent data loss — a worse failure mode than an error you
must actively route around. If you want Claude Code's own built-in tools
redirected to your own sandboxed implementations, see the SDK's own
`toolAliases` option (not wired by this provider; pass it through
`clientOptions` if you construct `Options` yourself upstream — a documented
gap, not solved here).

---

## 4. Session continuity is `thread_id`-keyed and **process-local**

Every other provider in this registry is stateless per call. This one is
not: `query()` spawns a stateful subprocess with its own on-disk session,
and `Graph.ts` reconstructs a fresh `ChatClaudeAgentSDK` instance on **every**
graph turn (and every inner tool-loop iteration within a turn). There is no
persistent JS object to hold a `session_id`.

The resolution: `config.configurable.thread_id` is the key into a
process-local session registry. A second `attemptInvoke` call sharing the
same `thread_id` — even against a brand-new model instance — resumes the
first call's session (`resume: <session_id>`) and sends only the content
appended since the last call, not the full replayed history.

**This registry is process-local.** A host running multiple stateless
server processes behind a load balancer will not get continuity for a
thread whose turns land on different processes unless you also:

1. Supply `clientOptions.sessionStore` (a thin pass-through to the SDK's own
   `SessionStore` — implement `append`/`load`, optionally
   `listSessions`/`listSessionSummaries`/`delete`/`listSubkeys`).
2. Persist and re-supply `session_id` externally yourself (e.g.
   `clientOptions.resume`, which takes precedence over the registry's own
   lookup).

The registry is bounded (`sessionRegistryBound`, default 500 threads, LRU) —
eviction degrades to a fresh-start session for that thread, not an error,
and is logged at debug level so you can distinguish "this thread never had
a session" from "this thread's session was evicted mid-conversation."

**Resuming under a different `cwd` throws.** The SDK's on-disk session state
is tied to the working directory it was created under. If a thread's
recorded session was created under one `cwd` and a later call in the same
thread resolves to a different one (e.g. a reconfigured workspace root),
`ChatClaudeAgentSDKSessionResumeError` is thrown before any subprocess is
spawned, rather than silently resuming against the wrong directory.

---

## 5. Workspace, multi-tenancy, and the `env` gotcha

`clientOptions.cwd`/`clientOptions.workspace` reuse this repo's own local
coding engine workspace resolution (`getLocalCwd`/`getWorkspaceRoots`) —
`workspace.root` takes precedence over `cwd` when both are set;
`workspace.additionalRoots` maps onto the SDK's own
`additionalDirectories`.

`clientOptions.multiTenant: true` sets `Options.settingSources: []` and an
`Options.env` derived from `process.env` plus a per-tenant
`CLAUDE_CONFIG_DIR` (deterministically derived from the resolved `cwd`) and
`CLAUDE_CODE_DISABLE_AUTO_MEMORY`. **`Options.env` replaces the subprocess
environment wholesale — it does not merge with `process.env`.** This
provider always spreads `process.env` first when it sets `env` at all, so
you do not lose `PATH`/`HOME`/credentials; if you construct `Options`
yourself elsewhere, remember this is not this provider's default behavior —
it is the SDK's.

Concurrent-session scaling, resource sizing, and subprocess-pool management
are host concerns per the SDK's own hosting guidance — this library does
not build a scheduler.

---

## 6. Hook bridging — one hook each, not this repo's `HookRegistry`

`clientOptions.preToolUseHook`/`postToolUseHook` each accept exactly **one**
already-resolved `HookCallback`, mirroring `ChatBAML`'s own host-supplied-port
precedent (`functions: BamlFunctionSet`) — **not** this repo's full
`HookRegistry`/`executeHooks` multi-hook `deny > ask > allow` composition
that every other provider's `ToolNode`-routed tool calls get automatically.

If you run more than one `PreToolUse` hook today — e.g. the documented
`createToolPolicyHook` + `createWorkspacePolicyHook` composition — **you
must compose them into one callback yourself** before passing the result
here:

```ts
const composed: HookCallback<'PreToolUse'> = async (input, signal) => {
  const policy = await createToolPolicyHook({ deny: ['delete_*'] })(
    input,
    signal
  );
  if (policy.decision === 'deny') return policy;
  return createWorkspacePolicyHook({
    /* ... */
  })(input, signal);
};

const model = initializeModel({
  provider: Providers.CLAUDE_AGENT_SDK,
  clientOptions: { cwd: '/workspace', preToolUseHook: composed },
});
```

Without composing, only the last hook you pass takes effect for
Claude-internal tool calls — a silent capability gap relative to every
other provider's tool calls, which get the full composition automatically.

`decision: 'allow'`/`'deny'` write into the SDK's granular
`hookSpecificOutput.permissionDecision` and short-circuit — the SDK never
calls `canUseTool` for that tool call. `decision: 'ask'` (or no decision at
all) abstains, letting the SDK's own documented evaluation order (hooks →
deny rules → ask rules → permission mode → allow rules → `canUseTool`) fall
through to `canUseTool`, described next.

---

## 7. Mid-session human-in-the-loop tool approval is **not supported**

**This is the most important limitation in this document.** This repo's
`ask`/`respond` HITL flow — `ToolNode`'s `interrupt()`, resumable across
process restarts via checkpointing — is structurally incompatible with the
SDK's `canUseTool` model, which awaits a live Promise inside one in-memory
`query()` call. `interrupt()` unwinds and checkpoints for possibly-later,
possibly-different-process resumption; `canUseTool`'s Promise must resolve
inside the same live subprocess connection. These two pause mechanisms do
not compose, and this provider does not attempt to bridge them.

What this provider ships instead is `clientOptions.hitlResolver` — a
same-process, in-memory extension seam:

```ts
type HitlResolver = (
  toolName: string,
  input: Record<string, unknown>,
  context: { toolUseId: string; matchedAskRule?: boolean; signal: AbortSignal }
) => Promise<ToolApprovalDecision>; // approve | reject | edit | respond
```

With **no** `hitlResolver` configured (the default), any tool call that
reaches `canUseTool` — i.e. one your `preToolUseHook` didn't already resolve
— is **denied**, with a message distinguishing it as a degraded-ask
outcome. The Promise always resolves; it is never left pending, which is
what `canUseTool`'s own "no park deadline" contract requires.

`respond` (this repo's HITL outcome that substitutes a canned tool result
without executing) has **no SDK analog**: `PermissionResult` is binary
allow/deny with optional input mutation, nothing else. A `hitlResolver`
that resolves `respond` degrades honestly to `deny` with the human's
response text as the message — never a fabricated `allow`.

If you need a live human-approval transport for Claude-internal tool calls,
you must build it yourself against the `hitlResolver` seam — this phase
ships the seam, not the transport.

---

## 8. Cancellation

`config.signal` is forwarded onto a fresh `AbortController` passed as
`Options.abortController` (the SDK wants a controller it can read `.signal`
off, not your raw signal). A pre-aborted invocation makes **no** `query()`
call. This provider uses single-shot prompt mode only — no streaming-input
mode, no mid-session `setPermissionMode`/`setModel`, and no `Query` control
method beyond `interrupt()`/`close()`.

---

## 9. Public error surface

All ship from `@librechat/agents`'s internal `src/llm/claudeAgentSdk/errors.ts`
module path (no separate npm subpath — same posture as `CustomAnthropic`) as
stable, typed classes. Branch on the class and read structured fields
rather than matching on message text.

| Class                                 | Raised when                                                                                                                                              | Carries                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `ClaudeAgentSDKToolsUnsupportedError` | `bindTools`/`withStructuredOutput` called                                                                                                                | message naming the workaround |
| `ClaudeAgentSDKResultError`           | the terminal `SDKResultMessage` is an error (`error_max_turns`, `error_during_execution`, `error_max_budget_usd`, `error_max_structured_output_retries`) | `subtype`, `errors`           |
| `ClaudeAgentSDKSessionResumeError`    | resuming a thread's session under a different resolved `cwd` than it was recorded under                                                                  | `recordedCwd`, `resolvedCwd`  |

---

## 10. Not implemented this phase (deferred, not dropped)

- A live human-response transport plugged into `hitlResolver` (§7).
- Whether a hook-level `'ask'` behaves procedurally like an ask-rule
  (unconfirmed in the SDK's own shipped types — this provider's design
  never depends on the answer).
- `toolAliases`-based redirection of Claude's built-in tools to this repo's
  own sandboxed tools.
- Exposing this repo's local-coding-engine tools, programmatic tool
  calling, or subagent delegation via `createSdkMcpServer`.
- Cross-server session continuity (host-owned, via `sessionStore` — §4).
- Routing Claude-internal tool calls through this repo's full
  `HookRegistry` instead of one composed callback (§6).
- Forwarding intermediate `tool_use`/`tool_result` activity as host-visible
  progress events.
