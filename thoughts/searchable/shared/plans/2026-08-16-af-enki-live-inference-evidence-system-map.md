# System Map: AF-enki Live Inference Verification

Companion to `thoughts/searchable/shared/plans/2026-08-16-af-enki-live-inference-evidence.md` (plan) and its `-REVIEW.md`. Maps the concrete files, seams, and contracts the plan's three phases touch or depend on. Research source: `thoughts/searchable/shared/research/2026-08-16-12-20-claude-agent-sdk-live-inference-test.md`.

## System Diagram

```mermaid
flowchart LR
    subgraph AgentMail["Coordination (Phase 1)"]
        FC["FuchsiaCat (AF-enki)"]
        CB["CyanBridge (AF-nr1p)"]
    end

    subgraph Harness["Test harness — CyanBridge-owned (not yet landed)"]
        PKG["package.json\ntest:live:claude-agent-sdk script\n(~line 210)"]
        LT["src/specs/claude-agent-sdk.live.test.ts\n(expected path)"]
    end

    subgraph Provider["ChatClaudeAgentSDK provider (existing, unmodified)"]
        CCS["ChatClaudeAgentSDK.ts\n_streamResponseChunks / _generate"]
        USG["usage.ts\nusageMetadataFromResult\nresponseMetadataFromResult"]
        MSG["messages.ts\nisResultMessage / isResultSuccess"]
        TYP["types.ts\nClaudeAgentSDKClientOptions"]
    end

    subgraph External["Outside the Node process"]
        CLI["real claude CLI subprocess\n(/home/maceo/.local/bin/claude)"]
        API["Anthropic API\n(real, billed)"]
    end

    subgraph Evidence["Phase 2/3 — this plan's own scope"]
        LOG["Jest command output\n(executed pass evidence)"]
        BD["bd close --reason\n(AF-enki)"]
    end

    FC -- "proposes assertion snippet\n(Agent Mail msg)" --> CB
    CB -- "harness-ready signal\n(Agent Mail msg)" --> FC
    CB -- "authors" --> PKG
    CB -- "authors" --> LT
    LT -- "npm run test:live:claude-agent-sdk" --> PKG
    PKG -- "jest --runInBand" --> LT
    LT -- "initializeModel(...).invoke(HumanMessage)" --> CCS
    CCS -- "resolveQueryFn() -> real query()" --> CLI
    CLI -- "real network call" --> API
    API -- "SDKMessage stream" --> CLI
    CLI -- "AsyncGenerator<SDKMessage>" --> CCS
    CCS -- "isResultMessage/isResultSuccess" --> MSG
    CCS -- "usageMetadataFromResult\nresponseMetadataFromResult" --> USG
    USG -- "AIMessageChunk\n(response_metadata/usage_metadata)" --> LT
    LT -- "jest stdout" --> LOG
    LOG -- "exit, pass count, duration" --> BD
    TYP -. "clientOptions shape\n(no apiKey field)" .-> CCS
```

## Sequence Diagram — one live run, end to end

```mermaid
sequenceDiagram
    participant FC as FuchsiaCat (AF-enki)
    participant CB as CyanBridge (AF-nr1p)
    participant NPM as npm run test:live:claude-agent-sdk
    participant LT as claude-agent-sdk.live.test.ts
    participant Init as initializeModel/invoke
    participant CCS as ChatClaudeAgentSDK
    participant CLI as claude CLI subprocess
    participant BD as bd (AF-enki)

    FC->>CB: propose assertion snippet (Phase 1 §1)
    CB-->>FC: harness commit ready (Phase 1 §2)
    FC->>NPM: <ENV_VAR>=1 npm run test:live:claude-agent-sdk --runInBand
    NPM->>LT: jest collects & runs file
    LT->>LT: describeIfLive gate check (dedicated env var)
    LT->>Init: initializeModel({ provider, clientOptions, tools: undefined })
    Init->>CCS: invoke(HumanMessage) [_streamResponseChunks]
    CCS->>CCS: ensureClaudeConfigDirExists()
    CCS->>CLI: query({ prompt, options }) [real, not queryFn override]
    CLI-->>CCS: SDKMessage stream (assistant*, result)
    CCS->>CCS: usageMetadataFromResult / responseMetadataFromResult
    CCS-->>Init: terminal AIMessageChunk (usage_metadata, response_metadata)
    Init-->>LT: direct invoke result
    LT->>LT: assert marker, no tools, session id, positive/consistent usage
    LT-->>NPM: jest pass/fail + stdout
    NPM-->>FC: command output with executed pass count and duration
    alt run passed
        FC->>BD: bd close AF-enki --reason "<evidence>" (Phase 3)
    else run failed
        FC->>BD: bd update AF-enki --append-notes "<failure>" (Phase 2 §4, retry once, then escalate)
    end
```

## Data Flow — what crosses each seam

```mermaid
flowchart TD
    A["HumanMessage\n(unique marker-only prompt)"] --> B["initializeModel/invoke\nclientOptions: cwd, maxTurns, optional model"]
    B --> C["ChatClaudeAgentSDK._streamResponseChunks\nprompt: string (extractNewTurnContent)"]
    C --> D["query({ prompt, options: Options })\nreal claude CLI subprocess"]
    D --> E["SDKMessage stream\n(assistant | result | system | ...)"]
    E --> F["SDKResultMessage (subtype: success)\nmodelUsage, session_id, num_turns, total_cost_usd"]
    F --> G["usageMetadataFromResult()\n-> UsageMetadata { input_tokens, output_tokens, total_tokens }"]
    F --> H["responseMetadataFromResult()\n-> { session_id, num_turns, total_cost_usd }"]
    G --> I["AIMessageChunk.usage_metadata"]
    H --> I2["AIMessageChunk.response_metadata"]
    I --> J["direct invoke AIMessageChunk"]
    I2 --> J
    J --> K["Jest assertions (load-bearing: session_id, input/output_tokens)"]
    K --> M["jest pass/fail + stdout"]
    M --> O["bd close --reason (Phase 3)\ncommand, pass count, duration, asserted invariants"]
```

## Interface/Contract Grammar at Each Seam

### Seam 1 — FuchsiaCat ↔ CyanBridge (Agent Mail proposal)

- **Direction**: FuchsiaCat → CyanBridge (proposal), CyanBridge → FuchsiaCat (harness-ready signal).
- **Contract**: a Markdown message body containing the exact TypeScript snippet from the plan's Phase 1 §1. No enforced schema — human/agent-readable prose + code fence. Acceptance is asynchronous and explicit (a reply message), not implied by silence.
- **Precondition**: FuchsiaCat has not edited any path CyanBridge reserved (`package.json`, `src/specs/*claude-agent-sdk*`).
- **Postcondition**: CyanBridge's landed file either contains the proposed assertions verbatim, an adapted equivalent, or FuchsiaCat applies them herself once the base file exists — resolved via reply-thread before Phase 2 starts (plan's Phase 1 Manual Verification).

### Seam 2 — Live test file ↔ `package.json` script

- **Direction**: `package.json`'s `test:live:claude-agent-sdk` script → invokes jest against the live test file path.
- **Contract** (by precedent, `package.json:210`): `<RUN_ENV_VAR>=1 NODE_OPTIONS='--experimental-vm-modules' jest <file-path> --runInBand`. Exit code 0 = all contained `it(...)` blocks passed (or were `describe.skip`ped, which still exits 0 — a real pass is distinguished by grep'ing the jest summary for a `✓`, not by exit code alone, per Phase 2's Automated Verification).
- **Precondition**: the named env var is `'1'`. The suite has no credential-presence skip; invalid or missing SDK/CLI authentication propagates as a failed live command.

### Seam 3 — Live test file ↔ `initializeModel`/`ChatClaudeAgentSDK` (production contract, unmodified by this plan)

- **Direction**: test → `initializeModel({ provider: Providers.CLAUDE_AGENT_SDK, clientOptions, tools: undefined })` → `model.invoke([HumanMessage])`.
- **Contract**: `ClaudeAgentSDKClientOptions` (`types.ts:41-122`) — no `apiKey` field; `cwd`/`workspace`/`model` all optional; omitting `preToolUseHook`/`postToolUseHook`/`hitlResolver` yields the "no hooks" bare-turn mode; never call `.bindTools(...)` (throws unconditionally, `ChatClaudeAgentSDK.ts:427-432`).
- **Postcondition**: on success, direct invocation returns an `AIMessageChunk` carrying `response_metadata: { session_id, num_turns, total_cost_usd }` and (when `modelUsage` was non-empty) `usage_metadata: { input_tokens, output_tokens, total_tokens }`. On failure, `ChatClaudeAgentSDK` throws `ClaudeAgentSDKResultError` or a generic stream-ended-without-result `Error` (`ChatClaudeAgentSDK.ts:564-568,608-610`) — this plan's Phase 2 §4 failure path catches that at the Jest-exit-code level.

### Seam 4 — `ChatClaudeAgentSDK` ↔ real `claude` CLI subprocess (external process boundary)

- **Direction**: `query({ prompt: string, options: Options })` → real, dynamically-imported `@anthropic-ai/claude-agent-sdk` `query` (not the `queryFn` test seam — a live test must not set `clientOptions.queryFn`).
- **Contract**: subprocess inherits `process.env` unmodified (non-`multiTenant` path) — auth is whatever the `claude` CLI itself resolves (this sandbox: OAuth via `$HOME/.claude/.credentials.json`). `ensureClaudeConfigDirExists()` guarantees the config directory exists before every call regardless of auth mode.
- **Postcondition**: an `AsyncGenerator<SDKMessage>` yielding zero-or-more `assistant` messages followed by exactly one terminal `result` message (success or error subtype) — `ChatClaudeAgentSDK.ts:608-610` throws if the generator ends without one.

### Seam 5 — `SDKResultMessage` ↔ `usage.ts` (existing, unmodified production code)

- **Direction**: `usageMetadataFromResult(result)` / `responseMetadataFromResult(result)` (`usage.ts:19-50`), both pure functions of the terminal `SDKResultMessage`.
- **Contract**: `responseMetadataFromResult` always returns `{ session_id, num_turns, total_cost_usd }` (no undefined branch). `usageMetadataFromResult` returns `undefined` (not a zero-filled object) when `modelUsage` is empty — this plan's load-bearing assertions (`input_tokens ?? 0`, `output_tokens ?? 0`) tolerate that via nullish-coalescing rather than assuming the field is always present, matching the provider's own documented omit-don't-fabricate convention.
- **Out of scope for this plan**: AF-t37e (parallel, GoldStream) extends this contract with `context_window`/`canonical_model`/`max_output_tokens` — this plan's assertions deliberately don't depend on those fields existing.

### Seam 6 — captured evidence ↔ bd (AF-enki close reason)

- **Direction**: captured command output → `bd close AF-enki --reason "<prose>"` / `bd update AF-enki --append-notes "<prose>"` on failure.
- **Contract**: prose cites the exact command, exit code, executed-versus-skipped Jest counts, duration, asserted invariants, test file, and commit. Per-run session/token values remain inside the test process and are not exposed in normal output.

## Files Touched / Read (by phase)

| Phase | File                                                                                  | Mode                                     | Notes                                                                                              |
| ----- | ------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1     | `src/specs/claude-agent-sdk.live.test.ts` (expected path, not yet landed)             | proposed-not-applied                     | CyanBridge's reserved file; this plan only sends a code proposal via Agent Mail                    |
| 1     | `package.json` (~line 210)                                                            | read-only                                | verify the new script exists once landed; never edited by this plan                                |
| 2     | same live test file                                                                   | read-only                                | `grep` to confirm the actual gating env var name before running                                    |
| 2     | `src/llm/claudeAgentSdk/ChatClaudeAgentSDK.ts`, `usage.ts`, `messages.ts`, `types.ts` | read-only (already read during research) | not modified — production code this plan verifies, does not change                                 |
| 2     | command output                                                                        | read-only evidence                       | records exit code, executed pass count, and duration; per-run metadata is asserted but not printed |
| 3     | bd (AF-enki record)                                                                   | write                                    | `bd close`/`bd update --append-notes`                                                              |

## Open Seams Not Yet Resolved (tracked, not blocking this map)

- Seam 1's exact acceptance mechanism (verbatim adoption vs. adapted vs. handed back) is unresolved until CyanBridge replies — tracked in the plan's Phase 1 Manual Verification, not assumed here.
- Seam 2's exact env var name is unresolved until the file lands — Phase 2 §1 reads it directly rather than guessing.
