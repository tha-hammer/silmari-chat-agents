import { HumanMessage } from '@langchain/core/messages';
import { describe, expect, it, jest } from '@jest/globals';
import type { FakeQueryCall } from './fakeQuery';
import { ClaudeAgentSDKSessionResumeError } from '@/llm/claudeAgentSdk/errors';
import { ChatClaudeAgentSDK } from '@/llm/claudeAgentSdk/ChatClaudeAgentSDK';
import { SessionRegistry } from '@/llm/claudeAgentSdk/sessionRegistry';
import { resultSuccess } from './fixtures';
import { fakeQuery } from './fakeQuery';

describe('B15 — cwd and additionalDirectories reuse the local coding engine\'s workspace resolution', () => {
  it('Options.cwd equals getLocalCwd(config) for an explicit workspace.root', async () => {
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery([[resultSuccess({ result: 'hi' })]], calls);
    const model = new ChatClaudeAgentSDK({
      workspace: { root: '/workspace/root' },
      queryFn,
    });

    await model.invoke([new HumanMessage('hi')]);

    expect(calls[0].options?.cwd).toBe('/workspace/root');
  });

  it('Options.additionalDirectories maps from getWorkspaceRoots non-root entries', async () => {
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery([[resultSuccess({ result: 'hi' })]], calls);
    const model = new ChatClaudeAgentSDK({
      workspace: {
        root: '/workspace/root',
        additionalRoots: ['/workspace/shared'],
      },
      queryFn,
    });

    await model.invoke([new HumanMessage('hi')]);

    expect(calls[0].options?.additionalDirectories).toEqual([
      '/workspace/shared',
    ]);
  });

  it('throws ClaudeAgentSDKSessionResumeError before query() when resuming under a different resolved cwd', async () => {
    const registry = new SessionRegistry();
    registry.set('t1', { sessionId: 's1', cwd: '/workspace/original' });
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery([[resultSuccess({ result: 'hi' })]], calls);
    const model = new ChatClaudeAgentSDK({
      workspace: { root: '/workspace/moved' },
      queryFn,
      sessionRegistry: registry,
    });

    await expect(
      model.invoke([new HumanMessage('hi')], {
        configurable: { thread_id: 't1' },
      })
    ).rejects.toBeInstanceOf(ClaudeAgentSDKSessionResumeError);
    expect(calls).toHaveLength(0);
  });
});

describe('B16 — multi-tenant isolation options apply when configured, and env is spread correctly', () => {
  it('multiTenant: true sets settingSources: [] and env spreading process.env', async () => {
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery([[resultSuccess({ result: 'hi' })]], calls);
    const model = new ChatClaudeAgentSDK({
      cwd: '/tmp',
      multiTenant: true,
      queryFn,
    });

    await model.invoke([new HumanMessage('hi')]);

    expect(calls[0].options?.settingSources).toEqual([]);
    const env = calls[0].options?.env;
    expect(env).toBeDefined();
    expect(env?.PATH).toBe(process.env.PATH);
    expect(env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
    expect(env?.CLAUDE_CONFIG_DIR).toEqual(expect.any(String));
  });

  it('multiTenant unset: none of the forced options are set', async () => {
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery([[resultSuccess({ result: 'hi' })]], calls);
    const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });

    await model.invoke([new HumanMessage('hi')]);

    expect(calls[0].options?.settingSources).toBeUndefined();
    expect(calls[0].options?.env).toBeUndefined();
  });
});

describe('B17 — sessionStore, an explicit resume override, and maxTurns are thin pass-throughs', () => {
  it('forwards sessionStore and maxTurns verbatim', async () => {
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery([[resultSuccess({ result: 'hi' })]], calls);
    const sessionStore = {
      append: jest.fn(),
      load: jest.fn(),
    } as unknown as NonNullable<
      ConstructorParameters<typeof ChatClaudeAgentSDK>[0]['sessionStore']
    >;
    const model = new ChatClaudeAgentSDK({
      cwd: '/tmp',
      queryFn,
      sessionStore,
      maxTurns: 7,
    });

    await model.invoke([new HumanMessage('hi')]);

    expect(calls[0].options?.sessionStore).toBe(sessionStore);
    expect(calls[0].options?.maxTurns).toBe(7);
  });

  it('an explicit resume override takes precedence over the session registry lookup', async () => {
    const registry = new SessionRegistry();
    registry.set('t1', { sessionId: 'from-registry', cwd: '/tmp' });
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery([[resultSuccess({ result: 'hi' })]], calls);
    const model = new ChatClaudeAgentSDK({
      cwd: '/tmp',
      queryFn,
      sessionRegistry: registry,
      resume: 'from-client-options',
    });

    await model.invoke([new HumanMessage('hi')], {
      configurable: { thread_id: 't1' },
    });

    expect(calls[0].options?.resume).toBe('from-client-options');
  });

  it('a non-fatal SDKMirrorErrorMessage does not fail the turn', async () => {
    const mirrorError = {
      type: 'system' as const,
      subtype: 'mirror_error' as const,
      error: 'store unavailable',
      key: { projectKey: 'p', sessionId: 's1' },
      uuid: '00000000-0000-0000-0000-000000000000' as const,
      session_id: 's1',
    };
    const queryFn = fakeQuery([
      [mirrorError, resultSuccess({ result: 'still answers' })],
    ]);
    const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await model.invoke([new HumanMessage('hi')]);

    expect(result.content).toBe('still answers');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('B18 — abort propagates; no follow-on call starts after abort', () => {
  it('pre-abort: zero query() calls', async () => {
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery([[resultSuccess({ result: 'hi' })]], calls);
    const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });
    const controller = new AbortController();
    controller.abort();

    await expect(
      model.invoke([new HumanMessage('hi')], { signal: controller.signal })
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('forwards config.signal onto Options.abortController', async () => {
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery([[resultSuccess({ result: 'hi' })]], calls);
    const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });
    const controller = new AbortController();

    await model.invoke([new HumanMessage('hi')], {
      signal: controller.signal,
    });

    const forwarded = calls[0].options?.abortController;
    expect(forwarded).toBeInstanceOf(AbortController);
    expect(forwarded?.signal.aborted).toBe(false);
    controller.abort('caller aborted');
    expect(forwarded?.signal.aborted).toBe(true);
  });
});

describe('B19 — nothing from the local-coding-engine bundle is exposed via createSdkMcpServer', () => {
  it('Options.mcpServers is absent', async () => {
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery([[resultSuccess({ result: 'hi' })]], calls);
    const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });

    await model.invoke([new HumanMessage('hi')]);

    expect(calls[0].options?.mcpServers).toBeUndefined();
  });
});
