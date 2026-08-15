/**
 * Raised by {@link ChatClaudeAgentSDK.bindTools} (and, by extension,
 * `withStructuredOutput`, gated the same way). Claude Code owns its own tool
 * loop entirely (B10) — a LangChain-bound tool has no execution path to reach
 * at all, so binding one and having it silently do nothing would be silent
 * data loss. This is the loud alternative: a host must actively route around
 * it, e.g. via `toolAliases` or a future `createSdkMcpServer` exposure.
 */
export class ClaudeAgentSDKToolsUnsupportedError extends Error {
  constructor(
    message = 'ChatClaudeAgentSDK does not support bindTools: Claude Code ' +
      'drives its own internal tool loop and never dispatches through this ' +
      'repo\'s ToolNode, so a LangChain-bound tool has no execution path. Use ' +
      'the SDK\'s own toolAliases option to redirect a built-in tool, or wait ' +
      'for a future createSdkMcpServer exposure, instead of binding tools here.'
  ) {
    super(message);
    this.name = 'ClaudeAgentSDKToolsUnsupportedError';
  }
}

/**
 * Raised when a turn's terminal `SDKResultMessage` is an `SDKResultError`
 * (`subtype` one of `error_max_turns` / `error_during_execution` /
 * `error_max_budget_usd` / `error_max_structured_output_retries`). Carries
 * `subtype` and `errors` verbatim so a caller can branch on the kind of
 * failure — never surfaced as a normal `AIMessage`, never a generic `Error`
 * with a string-matched message (B8).
 */
export class ClaudeAgentSDKResultError extends Error {
  readonly subtype: string;
  readonly errors: readonly string[];

  constructor(subtype: string, errors: readonly string[]) {
    super(`Claude Agent SDK turn failed (${subtype}): ${errors.join('; ')}`);
    this.name = 'ClaudeAgentSDKResultError';
    this.subtype = subtype;
    this.errors = errors;
  }
}

/**
 * Raised (B15) when a thread's session registry entry was recorded under a
 * different `cwd` than the one this call resolves to, before `query()` is
 * ever called. The SDK's own on-disk session state is tied to its original
 * working directory — silently resuming against a different one is a real
 * correctness hazard, not a cosmetic one, so a stale or reconfigured
 * workspace root surfaces loudly rather than silently starting a new
 * session under the same `thread_id` (a surprising behavior change for a
 * host expecting continuity).
 */
export class ClaudeAgentSDKSessionResumeError extends Error {
  readonly recordedCwd: string | undefined;
  readonly resolvedCwd: string;

  constructor(recordedCwd: string | undefined, resolvedCwd: string) {
    super(
      'ChatClaudeAgentSDK: cannot resume this thread\'s session — it was ' +
        `recorded under cwd "${String(recordedCwd)}" but this call resolved ` +
        `cwd "${resolvedCwd}". Resuming a subprocess session against a ` +
        'different working directory than the one it was created in is not ' +
        'safe.'
    );
    this.name = 'ClaudeAgentSDKSessionResumeError';
    this.recordedCwd = recordedCwd;
    this.resolvedCwd = resolvedCwd;
  }
}
