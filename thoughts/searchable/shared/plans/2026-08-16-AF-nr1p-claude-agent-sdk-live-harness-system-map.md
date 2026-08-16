# System Map: AF-nr1p Claude Agent SDK Live Harness

## Scope and ownership

AF-nr1p owns the npm entrypoint and executable Jest specification. It does not change the provider implementation. AF-enki owns the first authenticated, billed execution and its evidence. AF-t37e independently changes result metadata and is not a dependency of this harness.

## Component map

```mermaid
flowchart LR
  Operator[Developer or AF-enki operator]
  Npm[package.json live script]
  Jest[Jest VM-module runner]
  Gate[RUN_CLAUDE_AGENT_SDK_LIVE_TESTS gate]
  Suite[claude-agent-sdk.live.test.ts]
  Init[initializeModel]
  Registry[Providers registry]
  Adapter[ChatClaudeAgentSDK]
  SDK[Anthropic Agent SDK query]
  CLI[Built-in Claude CLI subprocess]
  API[Claude service]
  Result[AIMessageChunk result]
  Evidence[AF-enki command evidence]

  Operator --> Npm
  Npm --> Jest
  Jest --> Gate
  Gate -->|enabled| Suite
  Gate -->|disabled| Skipped[Jest skipped test]
  Suite --> Init
  Init --> Registry
  Registry --> Adapter
  Adapter -->|no queryFn override| SDK
  SDK --> CLI
  CLI --> API
  API --> CLI
  CLI --> SDK
  SDK --> Adapter
  Adapter --> Result
  Result --> Suite
  Jest --> Evidence
```

## Disabled/default sequence

```mermaid
sequenceDiagram
  participant Jest
  participant Suite as Live suite module
  participant SDK as Claude Agent SDK

  Jest->>Suite: collect with run flag absent
  Suite->>Suite: liveEnabled = false
  Suite-->>Jest: describe.skip with one skipped test
  Note over Suite,SDK: initializeModel and query are never executed
  Jest-->>Jest: exit 0; 0 executed, 1 skipped
```

## Enabled/live sequence

```mermaid
sequenceDiagram
  actor Operator
  participant Npm
  participant Jest
  participant Suite
  participant Init as initializeModel
  participant Adapter as ChatClaudeAgentSDK
  participant SDK as SDK query()
  participant CLI as Claude CLI subprocess
  participant API as Claude service

  Operator->>Npm: npm run test:live:claude-agent-sdk
  Npm->>Jest: flag=1, VM modules, exact file, runInBand
  Jest->>Suite: execute bare-turn test
  Suite->>Init: provider=claudeAgentSdk, tools=undefined
  Init-->>Suite: unbound ChatClaudeAgentSDK
  Suite->>Adapter: invoke(HumanMessage(marker))
  Adapter->>SDK: query(prompt, options) without queryFn seam
  SDK->>CLI: spawn built-in executable with inherited environment
  CLI->>API: authenticated inference request
  API-->>CLI: assistant and terminal result
  CLI-->>SDK: async SDK message stream
  SDK-->>Adapter: assistant/result messages
  Adapter-->>Suite: AIMessageChunk with content, usage, session metadata
  Suite-->>Jest: marker/type/no-tools/usage/session assertions
  Jest-->>Operator: one executed passing test, or a propagated auth/SDK failure
```

## Data flow

```mermaid
flowchart TD
  Env[Inherited process.env and Claude CLI login state]
  ModelEnv[Optional trimmed model env]
  Marker[Unique marker prompt]
  Options[Client options: cwd, maxTurns=1, optional model]
  QueryInput[SDK query input]
  SDKFrames[Assistant and terminal SDK frames]
  Message[AIMessageChunk]
  Assertions[Stable assertions]

  Env --> QueryInput
  ModelEnv --> Options
  Marker --> QueryInput
  Options --> QueryInput
  QueryInput --> SDKFrames
  SDKFrames --> Message
  Marker --> Assertions
  Message --> Assertions
```

## Interface grammar

```ebnf
LiveScript = RunGate, VmModules, Jest, ExactSuite, SerialExecution ;
RunGate = "RUN_CLAUDE_AGENT_SDK_LIVE_TESTS=1" ;
VmModules = "NODE_OPTIONS='--experimental-vm-modules'" ;
ExactSuite = "src/specs/claude-agent-sdk.live.test.ts" ;
SerialExecution = "--runInBand" ;

DisabledCollection = RunGate absent, "=>", ExecutedTests(0), SkippedTests(1) ;
ModelOverride = trim(env("CLAUDE_AGENT_SDK_LIVE_MODEL")) ;
ModelOption = ModelOverride nonblank, "=>", { model: ModelOverride }
            | ModelOverride blank, "=>", {} ;

BareClientOptions = {
  cwd: process.cwd(),
  maxTurns: 1,
  [model: ModelOverride]
} ;
BareModel = initializeModel({
  provider: Providers.CLAUDE_AGENT_SDK,
  clientOptions: BareClientOptions,
  tools: undefined
}) ;
RealQuerySelection = BareClientOptions excludes queryFn ;
LiveTurn = BareModel.invoke([HumanMessage(MarkerPrompt)]) ;

Success = AIMessageChunkTypeGuard
        & ContentContains(Marker)
        & ToolCalls(0)
        & ToolCallChunks(0)
        & PositiveInputTokens
        & PositiveOutputTokens
        & TotalTokensConsistent
        & NonEmptySessionId
        & NumTurnsAtLeast(1) ;

MissingAuthentication = RunGate present, "=>", PropagatedJestFailure ;
EvidenceHandoff = AF-nr1p committed harness, "=>", AF-enki authenticated execution ;
```

## Boundary invariants

- The default test path stops at Jest collection; it cannot cross the provider or subprocess boundary.
- The enabled path omits `queryFn`, so the adapter resolves the real installed SDK.
- No host tools, hooks, HITL resolver, multi-tenant environment, or graph orchestration are added.
- Authentication remains owned by the SDK/CLI inherited environment; the test neither discovers nor rewrites credentials.
- Timing and cost are observations, not correctness gates.
- Any authenticated SDK error propagates and fails Jest; the explicit live command never converts an error into a skip.
