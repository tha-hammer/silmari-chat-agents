# AF-enki: First Live Inference Verification Against Providers.CLAUDE_AGENT_SDK — Implementation Plan

> **Enhanced per review**: `thoughts/searchable/shared/plans/2026-08-16-af-enki-live-inference-evidence-REVIEW.md` (Needs Minor Revision, no critical issues). Folded in: failure-path handling for a failed live run (Phase 2 §4), confirmation that the proposed assertions' accessor path must match CyanBridge's actually-landed file (Phase 1 §1), demotion of `total_cost_usd`/`elapsedMs` from hard assertions to logged corroborating evidence (session_id + positive token counts are the load-bearing non-mocked proof instead), and a null-safe assertion fix.

> **Implemented**: AF-nr1p landed as commit `d00863c`. The direct `initializeModel(...).invoke(...)` harness was executed with `npm run test:live:claude-agent-sdk`; Jest reported one executed passing test, not a skip, in 13.364 seconds. AF-enki was closed with the assertion and command evidence. The landed harness intentionally does not log session, token, cost, or timing values; their stable invariants are asserted without exposing per-run metadata in normal test output.

## Overview

AF-nr1p (owned by teammate CyanBridge, in progress) adds the `npm run test:live:claude-agent-sdk` harness and a bare no-tools/no-hooks `*.live.test.ts` file for `Providers.CLAUDE_AGENT_SDK`. AF-enki (this plan) is the downstream bead: once that harness lands, actually execute it against real credentials in an environment that has them, strengthen it with a small set of coordinated assertions that prove the turn was genuinely non-mocked, capture concrete pass/fail evidence, and close AF-enki with that evidence in bd.

This plan does not design or own the harness file or `package.json` script — those paths are reserved by CyanBridge (AF-nr1p). This plan's only code contribution is a small, coordinated diff of _additional assertions_ inside whatever file CyanBridge lands, proposed to her before being applied, plus the live-run execution and evidence capture that no test file can do on its own (you have to actually run it once with real credentials).

## Current State Analysis

- No `test:live:claude-agent-sdk` script and no Claude-Agent-SDK live test file exist yet in the working tree (confirmed via `grep -n '"test:live' package.json` → one match, `test:live:handoffs`; `find . -name "*.live.test.ts"` → 10 files, none for `claude-agent-sdk`). AF-nr1p is in progress, not yet landed.
- `Providers.CLAUDE_AGENT_SDK` (`src/common/enum.ts:101`) is a fully registered provider (`src/llm/providers.ts:37`) usable through the exact same `Run.create({ agents: [{ provider, clientOptions, instructions, maxContextTokens }] })` shape every other live test already uses.
- `ChatClaudeAgentSDK` (`src/llm/claudeAgentSdk/ChatClaudeAgentSDK.ts`) has no `apiKey` field on its `ClaudeAgentSDKClientOptions` (`types.ts:41-122`) — it spawns a real `claude` CLI subprocess and, on the default (non-`multiTenant`) path, passes `process.env` through unmodified, so auth is whatever the `claude` CLI itself resolves (an already-`claude login`-ed `$HOME/.claude`, or `ANTHROPIC_API_KEY` in the parent env).
- `bindTools()` throws unconditionally (`ChatClaudeAgentSDK.ts:427-432`) — "no tools" is not a configuration choice, it's the only mode this provider supports.
- `ensureClaudeConfigDirExists()` (`ChatClaudeAgentSDK.ts:275-278`, hardened by commits `2251771`/`0713b9a`) already creates the config directory on every turn — a live test needs no extra config-dir setup.
- This exact sandbox already has a working, authenticated `claude` CLI (`/home/maceo/.local/bin/claude`, v2.1.233; `$HOME/.claude/.credentials.json` present) and the SDK package installed (`@anthropic-ai/claude-agent-sdk@0.3.233`) — a live run is executable here today, and will make a real, billed API call.
- bd's close-reason convention (verified via `bd show AF-hqp5`, the closed bead this one depends on) is a single detailed prose `close reason` field citing commits, file:line, and concrete evidence (log lines, commands run) — not a separate checked-in artifact file. This plan follows that convention rather than inventing a new one.
- Full research: `thoughts/searchable/shared/research/2026-08-16-12-20-claude-agent-sdk-live-inference-test.md`.

### Key Discoveries:

- `context-usage.live.test.ts:106-150` is the closest existing precedent for a single-`HumanMessage`, single-agent live turn with real usage assertions (`usage.input_tokens > 0`, etc.) — the assertion style this plan's proposed additions mirror.
- CyanBridge's own independent pattern audit (Agent Mail message 4053) identified `src/specs/bedrock-toolless.live.test.ts:98-122` as the closest no-tools precedent (though not a literal bare turn — its fixed history includes prior tool blocks) and confirmed the same `package.json:210` single-script precedent this plan relies on. Two independent research passes converged on the same facts.
- `usageMetadataFromResult`/`responseMetadataFromResult` (`src/llm/claudeAgentSdk/usage.ts:19-50`) is the exact code AF-t37e (GoldStream, in parallel) is extending with `context_window`/`canonical_model`/`max_output_tokens`. This plan's assertions deliberately check only the fields that exist **today** (`session_id`, `num_turns`, `total_cost_usd`, `input_tokens`, `output_tokens`) so it does not depend on or race AF-t37e's landing.

## Desired End State

1. CyanBridge's AF-nr1p harness (`package.json` script + live test file) has landed on this branch.
2. That live test file contains CyanBridge-approved assertions proving the turn was genuinely non-mocked: a unique marker response, real session id, positive internally consistent usage, and no host-visible tool calls/chunks.
3. The live test has actually been executed once in this sandbox against real credentials, and its output has been captured verbatim.
4. AF-enki is closed in bd with a close reason citing the exact command, executed assertions, Jest result and duration, and AF-nr1p's landed commit.

### Verification

Run the documented command (Phase 2) and observe exit code 0 with one test passed and none skipped. A pass means the load-bearing marker, message type, tool absence, usage, session-id, and turn-count assertions all executed successfully. Cost and elapsed-time thresholds are not correctness gates.

## What We're NOT Doing

- Not designing, authoring, or unilaterally editing `package.json`'s new script or the live test file's core structure — that's AF-nr1p/CyanBridge's reserved scope. This plan only proposes specific additional `expect(...)` lines for her to accept/adapt.
- Not testing hook/HITL bridging (`preToolUseHook`, `hitlResolver`) live — AF-enki's own bd description explicitly defers this ("decide separately whether hook/HITL bridging needs its own live test").
- Not testing `multiTenant: true` / per-tenant `CLAUDE_CONFIG_DIR` seeding live — that's AF-t37e/AF-5f2j territory, not a bare turn.
- Not fixing or depending on AF-t37e's `context_window`/`canonical_model`/`max_output_tokens` additions — this plan's assertions only use fields that already exist on `SDKResultMessage`'s current `usage.ts` output.
- Not committing a new checked-in evidence artifact file — evidence lives in the bd close reason, matching this repo's existing convention (`bd show AF-hqp5`).
- Not pushing anything to `origin/main` — per session git policy, commits stay local to this worktree/branch pending human review.

## Implementation Approach

Three sequential phases, each gated on the previous: (1) a coordination gate that blocks on CyanBridge's harness landing and on her accepting the proposed additional assertions, (2) the actual live execution + evidence capture, (3) closing AF-enki in bd. There is no "Red" phase in the classic new-code sense — the live test file's existence/correctness is AF-nr1p's TDD cycle, not this plan's. This plan's own red/green is binary and external: _has the harness been run for real yet, with real credentials, and did it pass_ — false until Phase 2 succeeds, true after.

---

## Phase 1: Coordination Gate — Harness Landed + Assertions Agreed

### Overview

Block on two things this plan does not control: CyanBridge's harness commit landing, and her agreement on the specific additive assertions below (proposed via Agent Mail, not a unilateral edit to her reserved file).

### Changes Required

#### 1. Propose additive assertions to CyanBridge (Agent Mail message, no file edit)

Send the following concrete proposal (exact `expect(...)` shape) for her to fold into the bare-turn test, or to apply herself, or to explicitly hand back to me to add once her file lands. **Load-bearing vs. corroborating, per review**: `session_id` non-empty + positive `input_tokens`/`output_tokens` are the load-bearing non-mocked proof (essentially certain to be present on any real result regardless of billing/auth mode). `total_cost_usd`/`elapsedMs` are corroborating signals only — logged and cited in the bd close reason, not hard `expect()` gates — because this sandbox authenticates via OAuth (`$HOME/.claude/.credentials.json`), and whether `total_cost_usd` reliably reports non-zero under subscription auth (vs. metered API-key billing) is unverified; treating it as a hard assertion risks a false-negative failure on a fully genuine call. Similarly, an elapsed-time floor only rules out a naively-synchronous fake — it doesn't itself prove a real network call, so it's evidence, not a gate.

**Also**: the exact accessor for `response_metadata`/`usage_metadata` below (`finalMessage.response_metadata`/`usage_metadata`, via `getRunMessages()`'s final AI message) must be matched against whichever extraction pattern CyanBridge's landed file actually uses before applying — some existing live tests instead read usage via a `ModelEndHandler`/`GraphEvents.CHAT_MODEL_END` capture (`context-usage.live.test.ts:78,137-140`). Confirm against her file at Phase 1 §2's verification step; the snippet below is illustrative, not copy-paste-final.

```typescript
// Proof-of-non-mocked additions to the bare-turn test case:
const startedAt = Date.now();
// ... existing Run.create / processStream call ...
const elapsedMs = Date.now() - startedAt;

const finalMessage = /* the terminal AIMessageChunk-derived message, however
  the landed test already extracts it (e.g. run.getRunMessages() last 'ai' message) —
  confirm this matches CyanBridge's actual extraction pattern first, see note above */;

// Load-bearing: real session id (never present on a faked/synchronous path)
expect(finalMessage.response_metadata?.session_id).toEqual(expect.any(String));
expect((finalMessage.response_metadata?.session_id as string).length).toBeGreaterThan(0);

// Load-bearing: real usage (SDKResultMessage.modelUsage was actually populated by a real turn)
expect(finalMessage.usage_metadata?.input_tokens ?? 0).toBeGreaterThan(0);
expect(finalMessage.usage_metadata?.output_tokens ?? 0).toBeGreaterThan(0);

// Corroborating only (not asserted as a hard gate — see note above): record
// total_cost_usd and elapsedMs in the console/log output for the evidence
// capture in Phase 2/3, rather than asserting on them. If Phase 2's first
// real run shows total_cost_usd is reliably non-zero in this sandbox, a
// follow-up may promote it to a hard expect(...) — not assumed here.
process.stdout.write(
  `[AF-enki evidence] total_cost_usd=${finalMessage.response_metadata?.total_cost_usd} elapsedMs=${elapsedMs}\n`
);
```

**File**: whichever path CyanBridge lands (expected `src/specs/claude-agent-sdk.live.test.ts` per her message) — **not edited by this plan directly**; proposed via Agent Mail, applied by whoever she designates once the base file exists.

**Update — superseded by CyanBridge's own decision (Agent Mail msg 4099)**: she independently reached the same load-bearing-vs-corroborating conclusion this plan's review reached, for the same reasons ("timing is not a semantic real-query proof and is environment-flaky"; "CLI/OAuth/accounting modes can legitimately report zero/omit billing despite real inference"), and is building a stronger set than proposed above: non-empty `session_id`, positive input/output tokens, **internally consistent total tokens**, **no tool calls/chunks present** (a direct assertion of B10, not just an absence-of-error), and the **marker response** (a nonce echoed back, proving the model actually processed this specific prompt rather than returning a cached/fixture string — stronger non-mocked proof than an elapsed-time floor). She explicitly omits `elapsedMs`/`total_cost_usd` as hard assertions, deferring the live evidence to this plan's executed, non-skipped run (Phase 2). Treat her landed file as authoritative over this section's illustrative snippet once it lands; this plan's own contribution narrows to Phase 2/3 (execute + evidence + close), with no further assertion negotiation needed.

#### 2. Wait for her "harness commit is ready to run" signal

Per her message: _"I'll message you when the harness commit is ready to run."_ This plan's Phase 2 does not start until that signal arrives (or until this researcher independently verifies, via `git log`/`git status`, that the file and script exist and the proposed assertions are present).

### Success Criteria

#### Automated Verification:

- [x] `test:live:claude-agent-sdk` exists in `package.json`.
- [x] `src/specs/claude-agent-sdk.live.test.ts` exists in commit `d00863c`.
- [x] The file contains the agreed marker, no-tools, positive/consistent usage, session-id, and turn-count assertions.
- [x] `npx tsc --noEmit` passes on the landed file.

#### Manual Verification:

- [x] Agent Mail message from CyanBridge confirmed commit `d00863c` was ready.
- [x] Assertion scope was resolved via Agent Mail before Phase 2.

---

## Phase 2: Execute the Live Run + Capture Evidence

### Overview

Actually run the harness once, for real, in this sandbox (which already has a working authenticated `claude` CLI), and capture the full output verbatim for the bd close reason.

### Changes Required

#### 1. Confirm the exact gating env var name

The precise `shouldRunLive` env var (e.g. `RUN_CLAUDE_AGENT_SDK_LIVE_TESTS`) is CyanBridge's choice, made inside her landed file — read it directly rather than assuming:

```bash
grep -n "process.env.RUN_" src/specs/claude-agent-sdk.live.test.ts   # or wherever it landed
```

#### 2. Run it live

```bash
# Exact form depends on the confirmed env var name from step 1 and the
# npm script CyanBridge added; both are read from the landed files, not
# guessed. Generic shape (matching every other *.live.test.ts convention
# and package.json:210's existing test:live:handoffs script):
<CONFIRMED_ENV_VAR>=1 NODE_OPTIONS='--experimental-vm-modules' \
  npm run test:live:claude-agent-sdk -- --runInBand 2>&1 \
  | tee /tmp/claude-1000/-home-maceo-ntm-Dev-claude-agent-sdk-2026-08-16-12-13/*/scratchpad/af-enki-live-run.log
```

(Redirect to this session's scratchpad directory, not the repo — this is evidence captured for the bd close reason, not a checked-in artifact, per "What We're NOT Doing".)

#### 3. Extract evidence values from the captured output

From the `tee`d log, record: exit code, `session_id` value observed, `input_tokens`/`output_tokens` values, `total_cost_usd` value (from the `[AF-enki evidence]` log line), measured `elapsedMs`, and the jest summary line (`Tests: N passed`).

#### 4. Failure path (per review — do not silently ignore a failed run)

If the command exits non-zero, or the jest summary shows a failure rather than a pass:

1. Do **not** proceed to Phase 3 / close AF-enki.
2. Update bd instead of closing: `bd update AF-enki --append-notes "Live run attempt N failed: <exit code, key error line from the captured log>. Log: <scratchpad path>."` — leave the bead open/in-progress.
3. Retry once (a single transient network/auth blip is plausible and cheap to rule out).
4. If it fails a second time, escalate via Agent Mail to CyanBridge (harness-side bug?) and/or report to the human orchestrator with the captured log — do not keep retrying silently, and do not close AF-enki on a failing run.

### Success Criteria

#### Automated Verification:

- [x] `npm run test:live:claude-agent-sdk` exited 0.
- [x] Jest reported one passed suite and one passed test, not a skip, in 13.364 seconds.
- [x] The load-bearing assertions for marker, message type, no tool calls/chunks, positive consistent usage, session id, and turn count all passed.
- [x] The failure branch was not entered; no retry was needed.

#### Manual Verification:

- [x] The unique per-run marker assertion proves the response was generated for this prompt rather than copied from a fixture.
- [x] Cost was not surfaced or treated as a gate under OAuth/CLI authentication.

---

## Phase 3: Close AF-enki With Evidence

### Overview

Record the outcome in bd, following this repo's established close-reason convention (prose citing commands, file:line, and concrete observed values — see `bd show AF-hqp5` as precedent), and note the downstream-repo follow-up.

### Changes Required

#### 1. Close AF-enki

```bash
bd close AF-enki --reason "$(cat <<'EOF'
Ran the AF-nr1p live harness for real against Providers.CLAUDE_AGENT_SDK: `<exact command from Phase 2>`.
Observed (load-bearing non-mocked proof): session_id=<value>, input_tokens=<n>, output_tokens=<n>.
Observed (corroborating, logged not asserted): total_cost_usd=<n or "unavailable under OAuth auth">, elapsed=<n>ms.
Test file: <path CyanBridge landed>, commit <sha>. Full captured output: <scratchpad log path>
(not checked into the repo — ephemeral evidence, per bd's own close-reason-as-evidence convention,
see AF-hqp5). Bare turn only (no tools/hooks) per AF-enki's own scope; hook/HITL live testing
explicitly deferred to a separate future bead, as noted in AF-enki's original description.
EOF
)"
```

#### 2. Note the cross-repo follow-up (do not implement it — out of this session's scope)

Record, in the same close reason or a linked bd note, that `silmari-chat`'s consumption of the new usage fields (AF-t37e's `context_window`/`canonical_model`/`max_output_tokens`) is separate downstream work already flagged by AF-t37e's own close notes — AF-enki's live run does not exercise those fields since they don't exist in `usage.ts` yet at plan-writing time.

### Success Criteria

#### Automated Verification:

- [x] `bd show AF-enki` reports `CLOSED` with the command, commit, duration, and assertion evidence.
- [x] AF-enki no longer blocks AF-1f56 as an open dependency.

#### Manual Verification:

- [ ] Agent Mail message sent to CyanBridge/GoldStream/WildPrairie announcing closure with a summary of the evidence, inviting WildPrairie's independent verification pass if desired

---

## Testing Strategy

### Unit Tests:

None added by this plan — no new production code. AF-nr1p's own unit/live test additions are out of this plan's scope.

### Integration Tests:

The live test run itself (Phase 2) _is_ the integration test — a real, single-turn, non-mocked exercise of `initializeModel` → `ChatClaudeAgentSDK` → real `claude` CLI subprocess → real `SDKResultMessage` → real `AIMessageChunk`.

### Manual Testing Steps:

1. Confirm CyanBridge's harness commit landed (`git log`).
2. Run the exact command from Phase 2, step 2, with the real env var name confirmed from the landed file.
3. Read the captured log and manually eyeball the response text for coherence (not just assert-passing).
4. Close AF-enki per Phase 3.

## Performance Considerations

A live run makes one real, billed Anthropic API call via a spawned `claude` CLI subprocess — expected latency in the low single-digit seconds, small but non-zero cost. `--runInBand` (matching every other live test's documented invocation) avoids concurrent live calls; this plan runs the suite exactly once.

## Migration Notes

Not applicable — no data model or schema changes.

## References

- Research: `thoughts/searchable/shared/research/2026-08-16-12-20-claude-agent-sdk-live-inference-test.md`
- Related research (pre-implementation, BAML-illustrated pattern): `thoughts/searchable/shared/research/2026-08-13-10-38-claude-code-sdk-agent-provider.md`
- Precedent live tests: `src/specs/agent-handoffs.live.test.ts`, `src/specs/context-usage.live.test.ts:106-150`, `src/specs/bedrock-toolless.live.test.ts:98-122`
- `package.json:210` — existing `test:live:*` script convention
- `src/llm/claudeAgentSdk/usage.ts:19-50`, `ChatClaudeAgentSDK.ts:275-286,427-432,457-611` — provider internals this plan's assertions and evidence depend on
- bd close-reason precedent: `bd show AF-hqp5`
- bd issues: AF-enki (this plan), AF-nr1p (blocking dependency, owned by CyanBridge), AF-t37e (parallel, owned by GoldStream, not a dependency of this plan), AF-1f56 (epic both AF-nr1p and AF-enki block)
