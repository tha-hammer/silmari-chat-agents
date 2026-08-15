export interface SessionEntry {
  sessionId: string;
  /** The cwd the SDK's on-disk session was created under (read back by B15). */
  cwd?: string;
}

export const DEFAULT_SESSION_REGISTRY_BOUND = 500;

/**
 * `Map<threadId, SessionEntry>` — the store `ChatClaudeAgentSDK` (a fresh
 * instance every graph turn, see `Graph.ts:2400-2406`) uses to recover
 * session continuity keyed by `config.configurable.thread_id`.
 *
 * Bounded LRU: `set()` moves an entry to most-recently-used and evicts the
 * oldest entry once `bound` is exceeded. Eviction degrades to B11's
 * fresh-start path (never throws) but is not silent — `onEvict` fires so a
 * host can distinguish "this thread never had a session" from "this
 * thread's session was evicted mid-conversation", matching B25's "never
 * silently dropped without a trace" standard.
 */
export class SessionRegistry {
  private readonly bound: number;
  private readonly entries = new Map<string, SessionEntry>();
  private readonly onEvict: (threadId: string) => void;

  constructor(
    bound: number = DEFAULT_SESSION_REGISTRY_BOUND,
    onEvict: (threadId: string) => void = defaultOnEvict
  ) {
    this.bound = bound;
    this.onEvict = onEvict;
  }

  get(threadId: string): SessionEntry | undefined {
    return this.entries.get(threadId);
  }

  set(threadId: string, entry: SessionEntry): void {
    this.entries.delete(threadId);
    this.entries.set(threadId, entry);
    while (this.entries.size > this.bound) {
      const oldestKey: string | undefined = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.entries.delete(oldestKey);
      this.onEvict(oldestKey);
    }
  }
}

function defaultOnEvict(threadId: string): void {
  // eslint-disable-next-line no-console
  console.debug(
    `ChatClaudeAgentSDK: session registry evicted thread_id=${threadId} past ` +
      'its bound; its next call starts a fresh session.'
  );
}

let moduleSingleton: SessionRegistry | undefined;

/** Production default: one process-local registry shared across instances. */
export function getModuleSessionRegistry(bound?: number): SessionRegistry {
  moduleSingleton ??= new SessionRegistry(bound);
  return moduleSingleton;
}

/** Test-only — clears the module singleton so tests don't leak state. */
export function __resetModuleSessionRegistry(): void {
  moduleSingleton = undefined;
}
