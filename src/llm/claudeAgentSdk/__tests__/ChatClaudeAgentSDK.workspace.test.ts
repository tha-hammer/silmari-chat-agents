import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { HumanMessage } from '@langchain/core/messages';
import { describe, expect, it, jest } from '@jest/globals';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
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
  it('multiTenant: true sets settingSources: [\'user\',\'project\',\'local\'] and env spreading process.env', async () => {
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery([[resultSuccess({ result: 'hi' })]], calls);
    const template = mkdtempSync(join(tmpdir(), 'claude-aai-template-'));
    const model = new ChatClaudeAgentSDK({
      cwd: '/tmp',
      multiTenant: true,
      aaiTemplateDir: template,
      queryFn,
    });

    await model.invoke([new HumanMessage('hi')]);

    // AF-5f2j: [] (the SDK's "isolation mode") silently drops CLAUDE.md and
    // project-scoped settings even from a fully-seeded config dir — must
    // include 'project' at minimum, pinned to the full explicit set so
    // intent is visible in code rather than relying on the SDK's own CLI
    // default.
    expect(calls[0].options?.settingSources).toEqual([
      'user',
      'project',
      'local',
    ]);
    const env = calls[0].options?.env;
    expect(env).toBeDefined();
    expect(env?.PATH).toBe(process.env.PATH);
    expect(env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
    expect(env?.CLAUDE_CONFIG_DIR).toEqual(expect.any(String));
    // Regression: perTenantConfigDir() used to only compute this path, never
    // create it — the claude CLI does not create CLAUDE_CONFIG_DIR itself, so
    // a subprocess pointed at a never-created directory has nowhere to
    // persist its session transcript, and a later --resume always reports no
    // conversation found.
    expect(existsSync(env?.CLAUDE_CONFIG_DIR as string)).toBe(true);
  });

  it('multiTenant unset: none of the forced options are set', async () => {
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery([[resultSuccess({ result: 'hi' })]], calls);
    const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });

    await model.invoke([new HumanMessage('hi')]);

    expect(calls[0].options?.settingSources).toBeUndefined();
    expect(calls[0].options?.env).toBeUndefined();
  });

  it('multiTenant unset: the CLAUDE_CONFIG_DIR the subprocess will actually inherit from process.env is created before query()', async () => {
    // multiTenant: false sets no env override at all — the subprocess
    // inherits process.env unmodified. If the deployment's own
    // CLAUDE_CONFIG_DIR (or, absent that, $HOME/.claude — not exercised
    // here to avoid touching the test runner's real home directory) was
    // never created, session persistence silently fails the same way
    // perTenantConfigDir's bug did, just via a different, un-overridden
    // code path.
    const tmpBase = mkdtempSync(join(tmpdir(), 'claude-config-dir-test-'));
    const configDir = join(tmpBase, 'never-created-yet');
    const originalEnv = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    try {
      expect(existsSync(configDir)).toBe(false);
      const calls: FakeQueryCall[] = [];
      const queryFn = fakeQuery([[resultSuccess({ result: 'hi' })]], calls);
      const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });

      await model.invoke([new HumanMessage('hi')]);

      expect(calls[0].options?.env).toBeUndefined();
      expect(existsSync(configDir)).toBe(true);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = originalEnv;
      }
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('falls back to a tmpdir-based directory when homedir() throws (arbitrary-uid container, no /etc/passwd entry)', async () => {
    // No CLAUDE_CONFIG_DIR set: forces the homedir()-based default path.
    // homedir() throws on POSIX when $HOME is unset and the running uid has
    // no /etc/passwd entry — a real condition in containers that run as an
    // arbitrary host uid (e.g. Docker Compose's user: "${UID}:${GID}").
    const originalEnv = process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_CONFIG_DIR;
    const homedirSpy = jest
      .spyOn(require('node:os'), 'homedir')
      .mockImplementation(() => {
        throw new Error('ENOENT: no matching passwd entry for uid');
      });
    try {
      const calls: FakeQueryCall[] = [];
      const queryFn = fakeQuery([[resultSuccess({ result: 'hi' })]], calls);
      const model = new ChatClaudeAgentSDK({ cwd: '/tmp', queryFn });

      await expect(
        model.invoke([new HumanMessage('hi')])
      ).resolves.toBeDefined();

      const fallbackDir = join(tmpdir(), 'claude-agent-sdk-home-fallback');
      expect(existsSync(fallbackDir)).toBe(true);
    } finally {
      homedirSpy.mockRestore();
      if (originalEnv === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = originalEnv;
      }
    }
  });
});

describe('AF-5f2j — multiTenant seeds AAI (aaiTemplateDir) into each per-tenant CLAUDE_CONFIG_DIR', () => {
  function tenantConfigDirFor(resolvedCwd: string): string {
    const digest = createHash('sha256').update(resolvedCwd).digest('hex');
    return join(tmpdir(), 'claude-agent-sdk-tenants', digest.slice(0, 16));
  }

  function freshCwd(): string {
    // Each test gets a distinct resolvedCwd so it hashes to a distinct,
    // never-before-seeded tenant directory — perTenantConfigDir's tenant
    // hash is a pure function of resolvedCwd, not a fresh id per test run.
    return mkdtempSync(join(tmpdir(), 'claude-aai-cwd-'));
  }

  function makeAaiTemplate(): string {
    const dir = mkdtempSync(join(tmpdir(), 'claude-aai-template-'));
    writeFileSync(join(dir, 'CLAUDE.md'), '# AAI template content\n');
    mkdirSync(join(dir, 'skills'), { recursive: true });
    writeFileSync(join(dir, 'skills', 'foo.md'), '# foo skill\n');
    return dir;
  }

  it('seeds CLAUDE.md and skills/ from aaiTemplateDir into a freshly-created tenant dir', async () => {
    const cwd = freshCwd();
    const template = makeAaiTemplate();
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery([[resultSuccess({ result: 'hi' })]], calls);
    const model = new ChatClaudeAgentSDK({
      cwd,
      multiTenant: true,
      aaiTemplateDir: template,
      queryFn,
    });

    await model.invoke([new HumanMessage('hi')]);

    const tenantDir = tenantConfigDirFor(cwd);
    expect(calls[0].options?.env?.CLAUDE_CONFIG_DIR).toBe(tenantDir);
    expect(readFileSync(join(tenantDir, 'CLAUDE.md'), 'utf8')).toBe(
      '# AAI template content\n'
    );
    expect(readFileSync(join(tenantDir, 'skills', 'foo.md'), 'utf8')).toBe(
      '# foo skill\n'
    );
  });

  it('is idempotent: a second call does not re-seed or touch a file the tenant itself wrote', async () => {
    const cwd = freshCwd();
    const template = makeAaiTemplate();
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery(
      [
        [resultSuccess({ result: 'first' })],
        [resultSuccess({ result: 'second' })],
      ],
      calls
    );
    const model = new ChatClaudeAgentSDK({
      cwd,
      multiTenant: true,
      aaiTemplateDir: template,
      queryFn,
    });

    await model.invoke([new HumanMessage('hi')]);
    const tenantDir = tenantConfigDirFor(cwd);
    const tenantWrittenFile = join(tenantDir, 'projects', 'session-state.json');
    mkdirSync(join(tenantDir, 'projects'), { recursive: true });
    writeFileSync(tenantWrittenFile, '{"sessionId":"abc"}');

    await model.invoke([new HumanMessage('again')]);

    // Not clobbered by a second seed pass.
    expect(readFileSync(tenantWrittenFile, 'utf8')).toBe('{"sessionId":"abc"}');
    // Template content is still there too (never needed re-seeding).
    expect(readFileSync(join(tenantDir, 'CLAUDE.md'), 'utf8')).toBe(
      '# AAI template content\n'
    );
  });

  it('throws rather than silently seeding nothing when no aaiTemplateDir is set and the default (/home/node/.claude) does not exist', async () => {
    const cwd = freshCwd();
    const calls: FakeQueryCall[] = [];
    const queryFn = fakeQuery([[resultSuccess({ result: 'hi' })]], calls);
    const model = new ChatClaudeAgentSDK({
      cwd,
      multiTenant: true,
      // no aaiTemplateDir — and this dev/test machine has no
      // /home/node/.claude, so the default-resolution path must fail loud.
      queryFn,
    });

    await expect(model.invoke([new HumanMessage('hi')])).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('two concurrent first-requests for the same new tenant both succeed with a fully-seeded, non-corrupted directory', async () => {
    const cwd = freshCwd();
    const template = makeAaiTemplate();
    const calls1: FakeQueryCall[] = [];
    const calls2: FakeQueryCall[] = [];
    const model1 = new ChatClaudeAgentSDK({
      cwd,
      multiTenant: true,
      aaiTemplateDir: template,
      queryFn: fakeQuery([[resultSuccess({ result: 'a' })]], calls1),
    });
    const model2 = new ChatClaudeAgentSDK({
      cwd,
      multiTenant: true,
      aaiTemplateDir: template,
      queryFn: fakeQuery([[resultSuccess({ result: 'b' })]], calls2),
    });

    await Promise.all([
      model1.invoke([new HumanMessage('hi')]),
      model2.invoke([new HumanMessage('hi')]),
    ]);

    const tenantDir = tenantConfigDirFor(cwd);
    expect(calls1).toHaveLength(1);
    expect(calls2).toHaveLength(1);
    // The end state is never partially copied — either absent or fully
    // seeded (renameSync only ever exposes a complete temp dir at the
    // final path), regardless of which of the two requests' rename won.
    expect(readFileSync(join(tenantDir, 'CLAUDE.md'), 'utf8')).toBe(
      '# AAI template content\n'
    );
    expect(readFileSync(join(tenantDir, 'skills', 'foo.md'), 'utf8')).toBe(
      '# foo skill\n'
    );
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
