# The BAML provider (`Providers.BAML`)

`@librechat/agents` ships a `ChatBAML` chat model that runs turns and the tool
loop through a **host-supplied port** — `BamlFunctionSet`. This package imports
no BAML bridge and owns no `.baml` files. Your application owns the generated
BAML SDK, the bridge dependency, and the small adapter that satisfies the port.

```
your app  ─┬─►  generated baml_ts SDK  ──►  @boundaryml/baml-bridge  ──►  LLM API
           │         ▲
           │         │ (host-written)
           └─►  BamlFunctionSet adapter  ──►  ChatBAML  ──►  agent graph / ToolNode
```

The dashed relationship to the bridge is **entirely host-side**. That is what
keeps this package's CJS build clean and lets the whole test suite run with the
bridge absent.

---

## 1. Install the bridge (host-owned)

This package declares **no** dependency — not even an optional peer dependency —
on `@boundaryml/baml-bridge`. Declaring one would claim a relationship that does
not exist: `@librechat/agents` never imports it. The host owns it:

```bash
npm install @boundaryml/baml-bridge   # plus your generated baml_ts output
```

If you later add a peer-dependency expectation, add it in your application's
`package.json`, not here.

---

## 2. Register the provider — import order matters

`Providers.BAML` is registered by a **module side-effect**, not by the root
barrel. The root entry (`@librechat/agents`) deliberately does not name this
provider, so you must import the `./baml` entry once, for its side-effect,
**before** you construct or resolve a BAML model:

```ts
import '@librechat/agents/baml'; // 1) side-effect: registers BAML
import { initializeModel, Providers } from '@librechat/agents';

const model = initializeModel({
  provider: Providers.BAML, // 2) now resolvable
  clientOptions: { functions: myFunctionSet }, // see §3
});
```

Skip step 1 and `initializeModel` (via `getChatModelClass`) throws
`Unsupported LLM provider: baml`. The public `BamlNotRegisteredError` carries the
remediation so the failure is diagnosable rather than cryptic.

### Dual CJS + ESM

`./baml` ships **both** formats (`import`, `require`, and `types`):

```ts
// ESM
import '@librechat/agents/baml';
```

```js
// CommonJS
require('@librechat/agents/baml');
```

This is deliberate. An ESM-only subpath beside a CJS root would load the registry
module **twice** — once per module system — creating two registries: a
registration made through the ESM copy would be invisible to a CJS consumer of
the root. Shipping both formats keeps the registry singular per module system.
The generated `baml_ts` SDK is still ESM; that is your constraint on your
adapter, not on this package.

---

## 3. Wire a generated adapter to `BamlFunctionSet`

`clientOptions.functions` is the entire dependency. Implement the port over your
generated SDK:

```ts
import { BAML_PORT_VERSION } from '@librechat/agents/baml';
import type {
  BamlFunctionSet,
  BamlPromptInput,
  BamlTurnResult,
  BamlTurnChunk,
} from '@librechat/agents/baml';
import { b } from './baml_client'; // your generated SDK

export const myFunctionSet: BamlFunctionSet = {
  version: BAML_PORT_VERSION,

  // The tools present in your COMPILED union, with a stable schema fingerprint
  // per tool. This is the frozen superset (see §5).
  declaredTools: [
    { name: 'get_weather', schemaFingerprint: 'sha256:…' },
    { name: 'web_search', schemaFingerprint: 'sha256:…' },
  ],

  async takeTurn(input: BamlPromptInput): Promise<BamlTurnResult> {
    // Translate input.transcript + input.allowedTools into a call on your
    // generated function, threading input.signal for cancellation.
    const out = await b.RunTurn(toBamlArgs(input), { signal: input.signal });
    return toTurnResult(out); // answer | tool_calls | failure
  },

  async *streamTurn(input: BamlPromptInput): AsyncIterable<BamlTurnChunk> {
    const stream = b.stream.RunTurn(toBamlArgs(input), {
      signal: input.signal,
    });
    for await (const partial of stream) {
      yield toTurnChunk(partial); // text | tool_calls | failure
    }
  },
};
```

Key input fields:

- `input.transcript` — a versioned, replay-safe `BamlTranscriptEntry[]`
  projection of the conversation (roles, ordered, with `tool_call_id` pairing).
- `input.allowedTools` — the **current bound subset**, never the compiled
  superset. Selections outside it are rejected before they can dispatch (§5).
- `input.signal` — thread it into your SDK call; abort is the provider's
  responsibility (§6).

---

## 4. The two host contracts (both load-bearing)

Your adapter **must** honor both. They are not stylistic — the model's
correctness depends on them.

### 4a. Never reject for a per-tool failure

`takeTurn` / `streamTurn` must **not** reject when an individual tool fails.
Per-tool failures are **values**, carried in the `tool_calls` outcome's
`failures[]` (or, for a whole-turn failure, in a `failure` outcome). Rejection is
reserved for **transport errors and abort** only.

```ts
// GOOD — a failed tool is a value
return { kind: 'tool_calls', calls: [...], failures: [
  { code: 'model_error', message: 'geocoder timed out', toolName: 'get_weather' },
] };

// BAD — throwing loses sibling results
throw new Error('geocoder timed out');
```

This result-union shape routes around a concurrency bug where a `catch` at an
`await` site drops errors from every spawned task but the first. Returning
failures as values makes every outcome observable and deterministic.

### 4b. Never fabricate `meta`

`meta` (`BamlCallMeta`: `model`, `finishReason`, `inputTokens`, `outputTokens`)
is optional and every field may be omitted. When you don't have real usage
numbers, **omit `meta` entirely** — do not send zeros. Absent metadata means the
emitted chunk carries **no** `usage_metadata`; fabricated zeros would corrupt
cost accounting downstream. When present, `usage_metadata` is attached to the
**first** chunk only, matching every other provider.

---

## 5. Frozen tools — the compiled union is the superset

The BAML tool union is **compiled and frozen at build time**. `ChatBAML` does not
vary it at runtime. Two consequences:

- `declaredTools` is your fixed superset. `bindTools(tools)` selects a **subset**
  for a given invocation; `input.allowedTools` reflects that subset.
- A selection for a tool that is **not in the current binding**, or whose
  `schemaFingerprint` does not match, is **rejected** — recorded as a failure,
  never emitted as a `tool_call`, never routed to `ToolNode`. `bindTools`
  returns a new, independent runnable; the base model is never mutated, so two
  differently-bound runnables can run concurrently without cross-contamination.

Runtime-varying tool unions are out of scope this phase (blocked upstream).

---

## 6. Cancellation

Abort is the provider's responsibility. `ChatBAML` threads `config.signal`
into the port as `input.signal`; your adapter must pass it to the generated SDK
call. A pre-aborted invocation makes **no** port call; a mid-request abort fires
the signal and the turn rejects (abort is one of the two allowed rejection
reasons). No follow-on request starts after an abort.

---

## 7. `functions` is not serializable across session restore

The port is **executable code**, not data. It cannot be serialized into a
session snapshot and restored later. When you reconstruct an agent/run from a
persisted session, you must **re-inject** a fresh `functions` adapter into
`clientOptions` — the restored session will not carry one. Treat the adapter the
way you treat a live database handle: rebuilt on process start, never persisted.

---

## 8. Title generation — completion mode only

`ChatBAML` does not support `withStructuredOutput`. BaseChatModel's inherited
implementation binds a **synthetic** tool, which cannot exist in a frozen
compiled union — it would fail at request time with a confusing error. Instead,
`withStructuredOutput(schema)` throws `BamlUnsupportedError` at the call site,
which is honest.

Consequence for titles: `Run.generateTitle` supports BAML only in
**`TitleMethod.COMPLETION`** mode. The `STRUCTURED` and `FUNCTIONS` title paths
route through `withStructuredOutput` (`src/utils/title.ts`) and will throw for a
BAML model. Configure completion-mode titling when using this provider.

---

## 9. Public error surface

All ship from `@librechat/agents/baml` as stable, typed classes — branch on the
class and read structured fields rather than matching on message text.

| Class                    | Raised when                                                     | Carries                                |
| ------------------------ | --------------------------------------------------------------- | -------------------------------------- |
| `BamlNotRegisteredError` | `Providers.BAML` resolved without importing `./baml`            | remediation in the message             |
| `BamlPortVersionError`   | host adapter's `version` ≠ this build's `BAML_PORT_VERSION`     | `expected`, `received`                 |
| `BamlToolNotBoundError`  | a tool outside the current binding is dispatched                | `toolName`, `boundTools`               |
| `BamlTurnError`          | a turn resolves to a `failure` outcome                          | `code` (`BamlFailureCode`), `toolName` |
| `BamlUnsupportedError`   | an unsupported capability is used (e.g. `withStructuredOutput`) | message naming the limitation          |

---

## Reference — the port contract

```ts
export const BAML_PORT_VERSION = 1 as const;

export interface BamlFunctionSet {
  readonly version: BamlPortVersion;
  readonly declaredTools: readonly BamlDeclaredTool[];
  takeTurn(input: BamlPromptInput): Promise<BamlTurnResult>;
  streamTurn(input: BamlPromptInput): AsyncIterable<BamlTurnChunk>;
}

export type BamlClientOptions = BaseChatModelParams &
  StreamSmoothingOptions & {
    functions: BamlFunctionSet; // required
    model?: string; // optional label
  };
```

See `src/llm/baml/types.ts` for the full set of exported types
(`BamlPromptInput`, `BamlTurnResult`, `BamlTurnChunk`, `BamlDeclaredTool`,
`BamlSelectedTool`, `BamlToolFailure`, `BamlCallMeta`, `BamlTranscriptEntry`).
