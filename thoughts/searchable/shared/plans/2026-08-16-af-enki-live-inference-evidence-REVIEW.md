# Plan Review Report: thoughts/searchable/shared/plans/2026-08-16-af-enki-live-inference-evidence.md [AF-enki Live Inference Evidence REVIEW]

**Reviewer**: FuchsiaCat (self-review, no independent reviewer available synchronously — WildPrairie's independent pass invited in parallel via Agent Mail; findings here should be treated as provisional pending her read)
**Date**: 2026-08-16

### Review Summary

| Category          | Status | Issues Found                                             |
| ----------------- | ------ | -------------------------------------------------------- |
| Contracts         | ⚠️     | 1 issue                                                  |
| Interfaces        | ⚠️     | 1 issue                                                  |
| Promises          | ⚠️     | 2 issues                                                 |
| Data Models       | ✅     | 0 issues                                                 |
| APIs              | ✅ N/A | 0 issues (no new API surface)                            |
| Workflow Closure  | ✅ N/A | 0 issues (verifies pre-existing chain, adds no new node) |
| Test-Spec Quality | ⚠️     | 2 issues                                                 |

### Contract Review

#### Well-Defined:

- ✅ `Providers.CLAUDE_AGENT_SDK` / `ChatClaudeAgentSDK` boundary — the plan correctly treats this as pre-existing, verified-by-research contract (no `apiKey` field, `bindTools()` throws, `ensureClaudeConfigDirExists()` runs unconditionally) and does not attempt to re-specify it.
- ✅ File-ownership boundary between this plan and AF-nr1p/CyanBridge is explicit and consistently enforced throughout ("What We're NOT Doing", Phase 1 §1 marked "not edited by this plan directly").

#### Missing or Unclear:

- ⚠️ **No documented failure/error contract for Phase 2's live run.** The plan's Phase 2 success criteria assume the run passes (exit 0, jest summary shows pass). There is no stated behavior for a failed live run (auth expired mid-session, rate limit, transient network error, a genuine bug in the harness). Should the run be retried once? Is a single failure enough to report "AF-enki blocked, see error" in bd rather than closing? This is a real, likely-to-occur edge case for a live network-dependent test, and the plan is silent on it.

#### Recommendations:

- Add an explicit "if the run fails" branch to Phase 2/3: e.g. "on a non-zero exit, do not close AF-enki; instead update bd with `--status open` and a note citing the failure output, then retry once before escalating via Agent Mail."

---

### Interface Review

#### Well-Defined:

- ✅ The plan correctly defers the exact `RUN_<X>_LIVE_TESTS` env var name and npm script invocation to be read from CyanBridge's landed file rather than guessing it (Phase 2 §1) — appropriately avoids inventing an interface it doesn't own.

#### Missing or Unclear:

- ⚠️ **The proposed assertions' data-access path (`finalMessage.response_metadata?.session_id`, `finalMessage.usage_metadata?.input_tokens`) is not verified against how CyanBridge's file will actually extract the final message.** I checked this during review: every _existing_ live test that asserts on usage reads it via the `ModelEndHandler`/`GraphEvents.CHAT_MODEL_END` event-capture pattern (`context-usage.live.test.ts:78,137-140`), not by reading `response_metadata`/`usage_metadata` directly off a message returned from `run.getRunMessages()`. I confirmed these fields _are_ structurally carried through `Graph.ts` (`Graph.ts:2165-2168,3045,4011,4047` all read/propagate `response_metadata`/`usage_metadata` on graph state messages), and `turnTranslation.closure.test.ts:99,105` confirms they survive at the `attemptInvoke`/`result.messages` level — so the access pattern is _plausible and likely correct_, but no test in this repo proves it at the exact `run.getRunMessages()` surface the plan's snippet assumes. If CyanBridge's landed file follows the `agent-handoffs.live.test.ts` style (filter `getRunMessages()` for the last `'ai'` message) rather than `context-usage.live.test.ts`'s `ModelEndHandler` style, the snippet's variable names/shape will need adjusting to match whatever she actually wrote — the plan's proposed code is illustrative, not copy-paste-exact against an unlanded file, but this should be stated explicitly rather than implied.

#### Recommendations:

- Add a sentence to Phase 1 §1: "Exact accessor syntax (`response_metadata`/`usage_metadata` off `getRunMessages()`'s final AI message vs. a `ModelEndHandler`/`CHAT_MODEL_END` capture) must match whichever extraction pattern CyanBridge's landed file actually uses — confirm this against her file before applying, don't assume the snippet's shape is final."

---

### Promise Review

#### Well-Defined:

- ✅ Phase 1's coordination gate has both a primary signal (CyanBridge's message) and a fallback (`git log`/`git status` independent verification) — avoids an unbounded, single-point-of-failure block.
- ✅ `--runInBand` usage (Phase 2 §2) correctly avoids concurrent live-API races, matching every other live test's documented convention.

#### Missing or Unclear:

- ⚠️ **No timeout/escalation policy on the coordination gate.** "Wait for her message" has no stated maximum wait or escalation trigger. Low severity given this is a short-lived multi-agent session, but worth one sentence (e.g., "if no signal within a working session, re-check `git log` directly and proceed if the file has landed regardless of an explicit ping").
- ⚠️ **The `total_cost_usd > 0` assertion's reliability under this sandbox's actual auth mode is unverified.** The research doc confirms this sandbox authenticates via `$HOME/.claude/.credentials.json` (an OAuth/subscription-based Claude Code login), not `ANTHROPIC_API_KEY`. Whether `SDKResultMessage.total_cost_usd` reliably reports a non-zero value under subscription/OAuth auth (as opposed to metered API-key billing) is not verified anywhere in the plan or its research — this is exactly the kind of "would the shown assertion actually pass against real behavior" question Test-Spec-Quality review exists to catch. If it turns out to report `0` or `undefined` under OAuth auth, the proposed assertion would fail even on a fully genuine, non-mocked live call — a false negative, not a bug in the code under test.

#### Recommendations:

- Downgrade `total_cost_usd > 0` from a hard `expect(...)` in the shared test file to a values-recorded-but-not-asserted evidence field in Phase 2/3 (still log it in the captured output and cite it in the bd close reason), OR explicitly verify empirically in Phase 2 (run once, observe whether it's non-zero, _then_ decide whether to keep it as a hard assertion) before proposing it to CyanBridge as a blocking `expect`.
- Treat `session_id` non-empty + `input_tokens > 0` + `output_tokens > 0` as the load-bearing non-mocked proof (these are essentially certain to be present on any real result, regardless of billing mode); treat `total_cost_usd > 0` and `elapsedMs > 150` as corroborating-but-not-load-bearing evidence in the close reason.

---

### Data Model Review

#### Well-Defined:

- ✅ The plan does not introduce any new data model — it consumes `SDKResultMessage`'s already-documented shape (`usage.ts:19-50`) faithfully, using only fields confirmed to exist today (correctly avoids depending on AF-t37e's in-flight `context_window`/`canonical_model`/`max_output_tokens` additions, explicitly called out in "What We're NOT Doing").

---

### API Review

Not applicable — this plan adds no new API surface (no new endpoint, no new public function signature). N/A, not a gap.

---

### Workflow Closure Review

#### Well-Defined:

- ✅ The plan explicitly does not add a new production node — the research doc's `ClosureMap` marks every node in the `Run.create → ChatClaudeAgentSDK → claude subprocess → SDKResultMessage → observable AIMessageChunk` chain as `adds_or_changes: false`, and the plan is consistent with that: it verifies an already-production-called, already-registered chain rather than wiring anything new. No handler/worker/listener is introduced that would need a production caller or registration.
- ✅ No source-to-sink shortcut risk: Phase 2 explicitly runs the real harness against the real subprocess — it does not seed a downstream read model, cache, or fixture in place of a real call.

This dimension is correctly treated as largely N/A by the plan's own reasoning (a verification task, not a new workflow), and review confirms that reasoning holds — there is no missing production wiring to flag.

---

### Test-Spec-Quality Review

#### Well-Defined:

- ✅ The proposed assertions are concrete and falsifiable (specific thresholds: `> 0`, `> 150`), not vague shape-only checks.
- ✅ Phase 2/3's manual verification step ("spot-check response text looks like a real, coherent reply... not an empty string, not a fixture string from `fixtures.ts`") is a real, specific check tied to this provider's actual fixture file, not a generic placeholder.

#### Missing or Unclear:

- ⚠️ **The `elapsedMs > 150` check, while reasonable as a supplementary signal, is framed in the plan's own comment as proof of "a real network round trip, not a near-instant fake/mocked resolution" — this overstates what the check proves.** It rules out a naively-synchronous fake; it does not rule out a fake that deliberately sleeps, nor does it strictly guarantee a real call always exceeds 150ms if a future SDK optimization streams faster. It's a fine corroborating signal but the plan should not present it as definitive proof by itself (see also the Promise Review recommendation above to make `session_id`/token counts the load-bearing evidence).
- ⚠️ **The Phase 1 code snippet's `(finalMessage.response_metadata?.session_id as string).length` will throw a raw TypeError (not a clean Jest assertion failure) if `session_id` is ever `undefined`**, e.g. if the harness's error path is exercised instead of success. Minor robustness nit: prefer `expect(finalMessage.response_metadata?.session_id).toEqual(expect.any(String))` (or two separate `.toBeDefined()`/length checks) so a failure diagnoses cleanly instead of crashing the test file.

#### Recommendations:

- Reframe the `elapsedMs` assertion's comment to "a supplementary corroborating signal, not primary proof" in whatever gets proposed/applied to the live test file.
- Replace the unsafe `as string` cast + `.length` chain with a null-safe Jest matcher.

---

### Critical Issues (Must Address Before Implementation)

None. All findings above are ⚠️ Warning-level — the plan is structurally sound (correct scope boundaries, correct file-ownership discipline, correct reliance on already-verified research, no missing production wiring) but has a few assumptions worth tightening before Phase 2 actually runs a real, billed API call.

### Suggested Plan Amendments

```diff
# In Phase 1: Coordination Gate — Harness Landed + Assertions Agreed

+ Add: explicit failure-path guidance — if `total_cost_usd` proves unreliable
+ under this sandbox's OAuth/subscription auth (verify empirically on first
+ run), drop it from hard `expect(...)`s and keep it as a logged/reported
+ value only; treat session_id + positive token counts as the load-bearing
+ non-mocked proof.
+ Add: one sentence confirming the exact accessor path (getRunMessages() vs.
+ ModelEndHandler capture) will be matched to CyanBridge's landed file, not
+ assumed from this plan's illustrative snippet.
~ Modify: the unsafe `(x as string).length` cast in the proposed snippet to
  a null-safe Jest matcher.

# In Phase 2: Execute the Live Run + Capture Evidence

+ Add: an explicit "if the run fails" branch — do not close AF-enki; record
  the failure in bd notes (not close reason), retry once, then escalate via
  Agent Mail if it still fails.
```

### Approval Status

- [x] **Needs Minor Revision** — Address warnings (failure-path handling, accessor-path confirmation against CyanBridge's actual file, and softening the `total_cost_usd`/`elapsedMs` assertions from load-bearing to corroborating) before Phase 2 executes a real, billed run. No critical/structural issues found — proceed to `enhance_plan_with_review` to fold these in, then `system_map` and `implement_plan`.
