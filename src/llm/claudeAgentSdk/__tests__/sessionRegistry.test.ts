import { describe, expect, it, jest } from '@jest/globals';
import { SessionRegistry } from '@/llm/claudeAgentSdk/sessionRegistry';

describe('B13 — a different thread never resumes another thread\'s session', () => {
  it('same thread twice: the second get returns the first-recorded entry', () => {
    const registry = new SessionRegistry();
    registry.set('t1', { sessionId: 's1' });

    expect(registry.get('t1')).toEqual({ sessionId: 's1' });
    expect(registry.get('t1')).toEqual({ sessionId: 's1' });
  });

  it('two different threads: each resolves only its own entry', () => {
    const registry = new SessionRegistry();
    registry.set('t1', { sessionId: 's1' });
    registry.set('t2', { sessionId: 's2' });

    expect(registry.get('t1')).toEqual({ sessionId: 's1' });
    expect(registry.get('t2')).toEqual({ sessionId: 's2' });
    expect(registry.get('t1')).not.toEqual({ sessionId: 's2' });
  });

  it('missing thread_id: get() returns undefined, never throws', () => {
    const registry = new SessionRegistry();

    expect(() => registry.get('never-set')).not.toThrow();
    expect(registry.get('never-set')).toBeUndefined();
  });
});

describe('B14 — the session registry is bounded, by design', () => {
  it.each([
    { entryCount: 2, bound: 3, expectedSize: 2 },
    { entryCount: 3, bound: 3, expectedSize: 3 },
    { entryCount: 4, bound: 3, expectedSize: 3 },
    { entryCount: 53, bound: 3, expectedSize: 3 },
  ])(
    'entryCount=$entryCount against bound=$bound: membership is exactly the most-recently-used entries, eviction never throws',
    ({ entryCount, bound, expectedSize }) => {
      const registry = new SessionRegistry(bound);

      expect(() => {
        for (let i = 0; i < entryCount; i++) {
          registry.set(`t${i}`, { sessionId: `s${i}` });
        }
      }).not.toThrow();

      const mostRecentIds = Array.from(
        { length: expectedSize },
        (_, i) => `t${entryCount - expectedSize + i}`
      );
      for (const id of mostRecentIds) {
        expect(registry.get(id)).toEqual({ sessionId: id.replace('t', 's') });
      }
      if (entryCount > bound) {
        expect(registry.get('t0')).toBeUndefined();
      }
    }
  );

  it('degrades to the fresh-start path rather than throwing, and fires onEvict for the evicted thread', () => {
    const onEvict = jest.fn();
    const registry = new SessionRegistry(2, onEvict);
    registry.set('t0', { sessionId: 's0' });
    registry.set('t1', { sessionId: 's1' });

    registry.set('t2', { sessionId: 's2' });

    expect(registry.get('t0')).toBeUndefined();
    expect(onEvict).toHaveBeenCalledWith('t0');
  });
});
