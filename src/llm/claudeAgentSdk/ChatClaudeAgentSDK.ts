import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import { AIMessageChunk } from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseChatModelCallOptions } from '@langchain/core/language_models/chat_models';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { BaseMessage, MessageContent } from '@langchain/core/messages';
import type { SessionStore } from '@anthropic-ai/claude-agent-sdk';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { ChatResult } from '@langchain/core/outputs';
import type {
  ClaudeAgentSDKClientOptions,
  QueryFn,
  HitlResolver,
} from '@/llm/claudeAgentSdk/types';
import type { SessionRegistry } from '@/llm/claudeAgentSdk/sessionRegistry';
import type { LocalWorkspaceConfig } from '@/types/tools';
import type { HookCallback } from '@/hooks/types';
import type * as t from '@/types';
import {
  isMainLoopAssistantMessage,
  isSubagentAssistantMessage,
  isResultMessage,
  isResultSuccess,
  mainLoopChunkFromAssistantMessage,
} from '@/llm/claudeAgentSdk/messages';
import {
  ClaudeAgentSDKToolsUnsupportedError,
  ClaudeAgentSDKResultError,
  ClaudeAgentSDKSessionResumeError,
} from '@/llm/claudeAgentSdk/errors';
import {
  toSdkPreToolUseHook,
  toSdkPostToolUseHook,
  toSdkCanUseTool,
} from '@/llm/claudeAgentSdk/hookAdapter';
import {
  usageMetadataFromResult,
  responseMetadataFromResult,
} from '@/llm/claudeAgentSdk/usage';
import {
  getLocalCwd,
  getWorkspaceRoots,
} from '@/tools/local/LocalExecutionEngine';
import { getModuleSessionRegistry } from '@/llm/claudeAgentSdk/sessionRegistry';

export interface ChatClaudeAgentSDKCallOptions
  extends BaseChatModelCallOptions {
  /**
   * Stashed by {@link ChatClaudeAgentSDK._separateRunnableConfigFromCallOptionsCompat}
   * from `config.configurable.thread_id` before the base class strips
   * `configurable` off the options object it hands to `_streamResponseChunks`
   * — this repo's own established stable per-conversation key
   * (`Graph.ts:1803,3501,4132,4341`). Internal; not meant to be set by a
   * caller directly.
   */
  threadId?: string;
  /** Stashed alongside `threadId`, from `config.configurable.run_id`/`config.runId`. */
  hookRunId?: string;
}

/**
 * `@anthropic-ai/claude-agent-sdk` ships `"type": "module"` with no CommonJS
 * build (`sdk.mjs` only) — a static top-level `import { query } from '...'`
 * would force every consumer of this file (including Jest's CJS runtime,
 * which cannot parse it) to load the real package eagerly, even in tests
 * that always supply a `queryFn` override. Lazily loaded and memoized here,
 * mirroring `loadSandboxRuntime()`'s established pattern
 * (`src/tools/local/LocalExecutionEngine.ts:331-336`) for the same class of
 * problem.
 */
let realQueryPromise: Promise<QueryFn> | undefined;
function loadRealQuery(): Promise<QueryFn> {
  realQueryPromise ??= import('@anthropic-ai/claude-agent-sdk').then(
    (mod) => mod.query
  );
  return realQueryPromise;
}

/** Flattens a message's content to plain text for the SDK's string prompt. */
function contentToString(content: MessageContent): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .map((block) =>
      'text' in block && typeof block.text === 'string' ? block.text : ''
    )
    .join('');
}

/** Fresh-start prompt: the latest human-turn content — the full message list's last entry. */
function promptFromMessages(messages: BaseMessage[]): string {
  if (messages.length === 0) {
    return '';
  }
  return contentToString(messages[messages.length - 1].content);
}

/**
 * A resumed call's prompt is only the content appended since the last call
 * — replaying the full history as a fresh prompt would both lose the
 * subprocess's own turn/cache continuity and make the model re-answer from
 * scratch (see the plan's "Session Continuity" section). "Since the last
 * call" is approximated as "since the most recent `AIMessage` in the
 * array" — this provider never emits `tool_calls` (B10), so there is no
 * `ToolMessage` concept in its own transcript; the trailing run after the
 * last assistant turn is exactly what's new.
 */
function extractNewTurnContent(
  messages: BaseMessage[],
  sessionFound: boolean
): string {
  if (!sessionFound) {
    return promptFromMessages(messages);
  }
  let lastAiIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].getType() === 'ai') {
      lastAiIndex = i;
      break;
    }
  }
  return messages
    .slice(lastAiIndex + 1)
    .map((message) => contentToString(message.content))
    .join('\n');
}

/** `.text` for a `ChatGenerationChunk`: only text-typed blocks, never thinking. */
function textOfContent(content: MessageContent): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .map((block) =>
      'type' in block &&
      block.type === 'text' &&
      'text' in block &&
      typeof block.text === 'string'
        ? block.text
        : ''
    )
    .join('');
}

/**
 * Per-tenant `CLAUDE_CONFIG_DIR`, deterministically derived from the
 * resolved `cwd` — in a multi-tenant host, distinct tenants run under
 * distinct workspace roots, so this keeps one tenant's on-disk Claude
 * settings/session-cache isolated from another's without requiring a
 * separate host-supplied tenant-id field.
 *
 * Created (not just computed) before being handed to the subprocess: the
 * `claude` CLI does not create `CLAUDE_CONFIG_DIR` itself, so a first-ever
 * turn for a given tenant hash pointed the subprocess at a directory that
 * never existed — its session transcript had nowhere to persist, so a
 * second turn's `--resume <session-id>` always reported no conversation
 * found, since nothing was ever durably saved for it to find.
 */
function perTenantConfigDir(resolvedCwd: string): string {
  const digest = createHash('sha256').update(resolvedCwd).digest('hex');
  const dir = join(tmpdir(), 'claude-agent-sdk-tenants', digest.slice(0, 16));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The `claude` CLI persists session transcripts under `CLAUDE_CONFIG_DIR`
 * when set (the multi-tenant path above always sets it), and under
 * `$HOME/.claude/` otherwise (`sdk.d.ts`'s own JSDoc: "Sessions will not be
 * saved to ~/.claude/projects/..." names this as the default). Unlike
 * `perTenantConfigDir`, this directory is never created by this provider's
 * own env-override logic in the non-multi-tenant path, because that path
 * deliberately sets no `env` at all — the subprocess inherits `process.env`
 * unmodified, so a developer's own already-`claude login`-ed `~/.claude`
 * keeps working exactly as it does outside this provider.
 *
 * That default is exactly the gap: a fresh container/host whose `$HOME` was
 * never seeded by an interactive `claude login` has no `~/.claude` either,
 * and the CLI does not create it — so this ensures whichever directory the
 * subprocess is ABOUT to use (env override or CLI default) actually exists,
 * regardless of `multiTenant`, before every `query()` call.
 *
 * `homedir()` itself is not trustworthy in every deployment: on POSIX it
 * falls through to a native passwd-file lookup keyed by uid whenever `$HOME`
 * is unset, and a container running as an arbitrary host uid (common when a
 * deployment overrides the image's built-in user, e.g. Docker Compose's
 * `user: "${UID}:${GID}"`) has no `/etc/passwd` entry for that uid — the
 * lookup throws. Falls back to a `tmpdir()`-based directory (never uid/passwd
 * -dependent — same reasoning as `perTenantConfigDir`'s own choice of
 * `tmpdir()`) rather than letting that exception surface mid-turn.
 */
function ensureClaudeConfigDirExists(): void {
  const dir = process.env.CLAUDE_CONFIG_DIR ?? resolveDefaultConfigDir();
  mkdirSync(dir, { recursive: true });
}

function resolveDefaultConfigDir(): string {
  try {
    return join(homedir(), '.claude');
  } catch {
    return join(tmpdir(), 'claude-agent-sdk-home-fallback');
  }
}

/**
 * `Options.env` REPLACES the subprocess environment entirely — it does not
 * merge with `process.env` (`sdk.d.ts:1461-1479`, explicit in the SDK's own
 * JSDoc). Omitting the spread here would silently drop `PATH`/`HOME`/
 * credentials from the subprocess (B16).
 */
function multiTenantEnv(resolvedCwd: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value != null) {
      env[key] = value;
    }
  }
  env.CLAUDE_CONFIG_DIR = perTenantConfigDir(resolvedCwd);
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  return env;
}

/**
 * Forwards `signal`'s abort onto a fresh `AbortController` — the SDK's
 * `Options.abortController` wants a controller it can read `.signal` off,
 * not the caller's raw `AbortSignal` (`sdk.d.ts:1353`).
 */
function forwardAbort(signal: AbortSignal | undefined): AbortController {
  const controller = new AbortController();
  if (signal == null) {
    return controller;
  }
  if (signal.aborted) {
    controller.abort(signal.reason);
  } else {
    signal.addEventListener('abort', () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller;
}

/**
 * Chat model backed by a spawned `claude` CLI subprocess
 * (`@anthropic-ai/claude-agent-sdk`). Unlike every other provider, tool calls
 * are never emitted to the host graph — Claude Code drives its own internal
 * tool loop (B10) — and the subprocess is stateful across calls while this
 * class is reconstructed fresh on every graph turn (see the plan's "Session
 * Continuity" section).
 */
export class ChatClaudeAgentSDK extends BaseChatModel<ChatClaudeAgentSDKCallOptions> {
  readonly cwd?: string;
  readonly model?: string;
  readonly workspace?: LocalWorkspaceConfig;
  readonly multiTenant?: boolean;
  readonly sessionStore?: SessionStore;
  readonly resumeOverride?: string;
  readonly maxTurns?: number;
  readonly preToolUseHook?: HookCallback<'PreToolUse'>;
  readonly postToolUseHook?: HookCallback<'PostToolUse'>;
  readonly hitlResolver?: HitlResolver;
  private readonly queryFnOverride?: QueryFn;
  private readonly sessionRegistry: SessionRegistry;

  static lc_name(): 'ChatClaudeAgentSDK' {
    return 'ChatClaudeAgentSDK';
  }

  constructor(fields: ClaudeAgentSDKClientOptions) {
    super(fields);
    this.cwd = fields.cwd;
    this.model = fields.model;
    this.workspace = fields.workspace;
    this.multiTenant = fields.multiTenant;
    this.sessionStore = fields.sessionStore;
    this.resumeOverride = fields.resume;
    this.maxTurns = fields.maxTurns;
    this.preToolUseHook = fields.preToolUseHook;
    this.postToolUseHook = fields.postToolUseHook;
    this.hitlResolver = fields.hitlResolver;
    this.queryFnOverride = fields.queryFn;
    this.sessionRegistry =
      fields.sessionRegistry ??
      getModuleSessionRegistry(fields.sessionRegistryBound);
  }

  /** The resolved workspace boundary, reusing the local coding engine's own resolution (B15). */
  private resolvedCwd(): string {
    return getLocalCwd({ cwd: this.cwd, workspace: this.workspace });
  }

  private additionalDirectories(): string[] {
    return getWorkspaceRoots({
      cwd: this.cwd,
      workspace: this.workspace,
    }).slice(1);
  }

  private resolveQueryFn(): Promise<QueryFn> {
    return this.queryFnOverride == null
      ? loadRealQuery()
      : Promise.resolve(this.queryFnOverride);
  }

  /**
   * The base class deletes `configurable` from the options object it hands
   * to `_streamResponseChunks`/`_generate` (see
   * `_separateRunnableConfigFromCallOptions`,
   * `@langchain/core/runnables/base.js`) — this is the one point in the
   * call chain where `config.configurable.thread_id` is still visible,
   * stashed onto `callOptions.threadId` before the base class strips it.
   */
  protected override _separateRunnableConfigFromCallOptionsCompat(
    options?: Partial<ChatClaudeAgentSDKCallOptions>
  ): [RunnableConfig, this['ParsedCallOptions']] {
    const [runnableConfig, callOptions] =
      super._separateRunnableConfigFromCallOptionsCompat(options);
    const threadId = runnableConfig.configurable?.thread_id as
      | string
      | undefined;
    const hookRunId =
      runnableConfig.runId ??
      (runnableConfig.configurable?.run_id as string | undefined);
    return [
      runnableConfig,
      { ...callOptions, threadId, hookRunId } as this['ParsedCallOptions'],
    ];
  }

  _llmType(): string {
    return 'claudeAgentSdk';
  }

  /**
   * Claude Code owns its tool loop entirely (B10) — a bound tool has no
   * execution path to reach. Throwing here (Closure D) is the safety gate
   * proving no SDK call is ever made on a tool-binding attempt.
   */
  override bindTools(
    _tools: t.GraphTools,
    _kwargs?: Partial<ChatClaudeAgentSDKCallOptions>
  ): never {
    throw new ClaudeAgentSDKToolsUnsupportedError();
  }

  /**
   * Drives one bounded `query()` subprocess turn. Main-loop assistant text/
   * thinking content streams as it arrives (B6); Claude-internal tool
   * activity and subagent-originated text are stripped, never surfaced
   * (B9/B10 — B10 is the single most important behavior in this plan: no
   * emitted chunk, before or after `concat()`, ever carries `tool_calls`).
   *
   * Session continuity (B11-B14): `options.threadId` looked up in the
   * session registry decides fresh-vs-resumed and the prompt content
   * (`extractNewTurnContent`); the terminal message's `session_id` is
   * recorded back on BOTH success and error (an errored turn's session may
   * still be resumable) — but only when a `threadId` was actually supplied,
   * so a caller with no thread concept never accidentally participates in
   * continuity.
   *
   * The terminal `SDKResultSuccess` always yields a final chunk carrying
   * `usage_metadata`/`response_metadata`; when nothing else was streamed
   * (e.g. a session with no intermediate main-loop commentary), that chunk's
   * content falls back to the result's own `result` text — the single
   * source of truth for "the final answer," mirroring the guarantee
   * `ChatBAML.ts:266-271` gives its own empty-stream case, but with a real
   * fallback text available instead of an empty string.
   */
  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    options.signal?.throwIfAborted();

    const resolvedCwd = this.resolvedCwd();
    const threadId = options.threadId;
    const sessionEntry =
      threadId == null ? undefined : this.sessionRegistry.get(threadId);
    if (
      sessionEntry != null &&
      sessionEntry.cwd != null &&
      sessionEntry.cwd !== resolvedCwd
    ) {
      throw new ClaudeAgentSDKSessionResumeError(sessionEntry.cwd, resolvedCwd);
    }

    const prompt = extractNewTurnContent(messages, sessionEntry != null);
    const resumeId = this.resumeOverride ?? sessionEntry?.sessionId;
    const additionalDirectories = this.additionalDirectories();
    const hookContext = {
      runId: options.hookRunId ?? threadId ?? 'claude-agent-sdk',
      ...(threadId == null ? {} : { threadId }),
    };
    const preToolUse =
      this.preToolUseHook == null
        ? undefined
        : toSdkPreToolUseHook(this.preToolUseHook, hookContext);
    const postToolUse =
      this.postToolUseHook == null
        ? undefined
        : toSdkPostToolUseHook(this.postToolUseHook, hookContext);
    ensureClaudeConfigDirExists();
    const queryFn = await this.resolveQueryFn();
    const query = queryFn({
      prompt,
      options: {
        cwd: resolvedCwd,
        ...(this.model == null ? {} : { model: this.model }),
        ...(resumeId == null ? {} : { resume: resumeId }),
        ...(additionalDirectories.length === 0
          ? {}
          : { additionalDirectories }),
        ...(this.multiTenant !== true
          ? {}
          : { settingSources: [], env: multiTenantEnv(resolvedCwd) }),
        ...(this.sessionStore == null
          ? {}
          : { sessionStore: this.sessionStore }),
        ...(this.maxTurns == null ? {} : { maxTurns: this.maxTurns }),
        abortController: forwardAbort(options.signal),
        canUseTool: toSdkCanUseTool(this.hitlResolver),
        ...(preToolUse == null && postToolUse == null
          ? {}
          : {
            hooks: {
              ...(preToolUse == null
                ? {}
                : { PreToolUse: [{ hooks: [preToolUse] }] }),
              ...(postToolUse == null
                ? {}
                : { PostToolUse: [{ hooks: [postToolUse] }] }),
            },
          }),
      },
    });

    let yieldedContent = false;
    const recordSession = (sessionId: string): void => {
      if (threadId != null) {
        this.sessionRegistry.set(threadId, { sessionId, cwd: resolvedCwd });
      }
    };

    for await (const message of query) {
      if (isMainLoopAssistantMessage(message)) {
        const chunk = mainLoopChunkFromAssistantMessage(message);
        if (chunk != null) {
          yieldedContent = true;
          const text = textOfContent(chunk.content);
          await runManager?.handleLLMNewToken(text);
          yield new ChatGenerationChunk({ text, message: chunk });
        }
        continue;
      }

      if (isSubagentAssistantMessage(message)) {
        continue;
      }

      if (message.type === 'user') {
        continue;
      }

      if (isResultMessage(message)) {
        recordSession(message.session_id);

        if (!isResultSuccess(message)) {
          throw new ClaudeAgentSDKResultError(message.subtype, message.errors);
        }

        const usageMetadata = usageMetadataFromResult(message);
        const responseMetadata = responseMetadataFromResult(message);
        const content = yieldedContent ? '' : message.result;
        yield new ChatGenerationChunk({
          text: yieldedContent ? '' : message.result,
          message: new AIMessageChunk({
            content,
            response_metadata: responseMetadata,
            ...(usageMetadata == null ? {} : { usage_metadata: usageMetadata }),
          }),
        });
        return;
      }

      if (message.type === 'system' && message.subtype === 'mirror_error') {
        // A session-store mirror failure (B17): non-fatal by the SDK's own
        // documented semantics — the turn continues to completion, but a
        // warning-level side-channel notice is worth surfacing (distinct
        // from B25's plain debug-level unknown-message log).
        // eslint-disable-next-line no-console
        console.warn(
          `ChatClaudeAgentSDK: session-store mirror failed: ${message.error}`
        );
        continue;
      }

      // ~35 other SDKMessage variants (system, control/status/progress
      // events, etc.) — a safe, logged passthrough (B25): never forwarded
      // as content, never thrown, the stream simply continues. Counted at
      // debug level rather than silently dropped without a trace.
      // eslint-disable-next-line no-console
      console.debug(
        `ChatClaudeAgentSDK: unhandled SDKMessage type "${message.type}" ` +
          '(safe, logged passthrough — not forwarded as content).'
      );
    }

    throw new Error(
      'ChatClaudeAgentSDK: the query() stream ended without a terminal result message.'
    );
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    let finalChunk: ChatGenerationChunk | undefined;
    for await (const genChunk of this._streamResponseChunks(
      messages,
      options,
      runManager
    )) {
      finalChunk = finalChunk == null ? genChunk : finalChunk.concat(genChunk);
    }

    const generation =
      finalChunk ??
      new ChatGenerationChunk({
        text: '',
        message: new AIMessageChunk({ content: '' }),
      });
    return { generations: [generation] };
  }
}
