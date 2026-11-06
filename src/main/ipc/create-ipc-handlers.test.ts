import { describe } from 'vitest';
import type { ExpectStatic } from 'vitest';

import type {
  AppInfo,
  IpcError,
  IpcResult,
  OpenedView,
  SessionSummary,
} from '#contract/ipc-contract.ts';
import { perHeadInvokeChannels } from '#contract/per-head-invoke-channels.ts';
import type { PerHeadInvokeChannel } from '#contract/per-head-invoke-channels.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Err, Ok } from '#x/result/result.ts';

import type { MainServices, SessionServices } from '../main-services.ts';

import { test } from '../testing/test.ts';
import { createIpcHandlers } from './create-ipc-handlers.ts';

function appInfo(): AppInfo {
  return {
    name: 'beuve',
    version: '0.1.0',
    platform: 'linux',
    electronVersion: '45.1.0',
    chromeVersion: '140',
    nodeVersion: '24',
  };
}

function sessionSummary(): SessionSummary {
  return {
    id: 's1',
    source: { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feature' },
    headSha: 'a'.repeat(40),
    createdAt: '2026-10-28T00:00:00.000Z',
    updatedAt: '2026-10-28T00:00:00.000Z',
  };
}

/** A valid request for each per-head channel, minus its `expectedHeadSha`. */
function perHeadRequestWithoutHead(channel: PerHeadInvokeChannel): object {
  const requests: Record<PerHeadInvokeChannel, object> = {
    'session:mark-reviewed': { sessionId: 's1' },
    'review:set-file-reviewed': { sessionId: 's1', path: 'a.ts', reviewed: true },
    'ura:set-verdict': { sessionId: 's1', verdict: 'approve' },
    'github:preview-review': { sessionId: 's1' },
    'github:post-review': { sessionId: 's1' },
    'lsp:call-hierarchy': { sessionId: 's1', path: 'a.ts', line: 1, direction: 'incoming' },
    'terminal:open': { sessionId: 's1', cols: 80, rows: 24 },
  };
  return requests[channel];
}

function sha(): string {
  return 'c'.repeat(40);
}

function notWiredError(): Err<IpcError> {
  return err({ code: 'not-wired', message: 'not wired in this test' });
}

async function notWired(): Promise<Err<IpcError>> {
  await Promise.resolve();
  return notWiredError();
}

async function sheetChecked(): Promise<Ok<OpenedView>> {
  await Promise.resolve();
  return ok({ opened: true });
}

async function notFound(): Promise<Err<IpcError>> {
  await Promise.resolve();
  return err({ code: 'not-found', message: 'no such file' });
}

async function opening(): Promise<Ok<SessionSummary>> {
  await Promise.resolve();
  return ok(sessionSummary());
}

describe('createIpcHandlers', () => {
  test('answers app:get-info and rejects unexpected arguments', ({ expect }) => {
    const handlers = createIpcHandlers(stubServices({}), appInfo());
    expect(handlers['app:get-info'](undefined)).toStrictEqual(ok(appInfo()));
    expect(handlers['app:get-info']({ sneaky: true })).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
  });

  test('passes service failures through unchanged', ({ expect }) => {
    const handlers = createIpcHandlers(stubServices({}), appInfo());
    expect(handlers['session:list'](undefined)).toMatchObject({
      ok: false,
      error: { code: 'not-wired' },
    });
  });

  test('validates session:create-local before delegating', async ({ expect }) => {
    const { calls, services } = recording('createLocal');
    const handlers = createIpcHandlers(services, appInfo());
    const good = { repoPath: '/repo', baseRef: 'main', headRef: 'HEAD' };
    for (const bad of [
      undefined,
      { ...good, repoPath: '' },
      { ...good, baseRef: ' '.repeat(3) },
      { ...good, headRef: 7 },
      { ...good, extra: true },
      { repoPath: '/repo', baseRef: 'main' },
    ]) {
      await expectInvalid(expect, handlers['session:create-local'](bad));
    }
    await expect(handlers['session:create-local'](good)).resolves.toStrictEqual(
      ok(sessionSummary()),
    );
    expect(calls).toStrictEqual([good]);
  });

  test('validates session:get-review before delegating', async ({ expect }) => {
    const { calls, services } = recording('getReview');
    const handlers = createIpcHandlers(services, appInfo());
    await expectInvalid(expect, handlers['session:get-review']({ sessionId: 3 }));
    await expectInvalid(
      expect,
      handlers['session:get-review']({ sessionId: 's1', ignoreWhitespace: 1 }),
    );
    await handlers['session:get-review']({ sessionId: 's1' });
    await handlers['session:get-review']({ sessionId: 's1', ignoreWhitespace: true });
    expect(calls).toStrictEqual([{ sessionId: 's1' }, { sessionId: 's1', ignoreWhitespace: true }]);
  });

  test('validates session:mark-reviewed, including the required expected head', async ({
    expect,
  }) => {
    const { calls, services } = recording('markReviewed');
    const handlers = createIpcHandlers(services, appInfo());
    await expectInvalid(
      expect,
      handlers['session:mark-reviewed']({ sessionId: 's1', expectedHeadSha: 'HEAD' }),
    );
    await expectInvalid(
      expect,
      handlers['session:mark-reviewed']({ sessionId: 's1', expectedHeadSha: 'A'.repeat(40) }),
    );
    await expectInvalid(expect, handlers['session:mark-reviewed']({ sessionId: 's1' }));
    await handlers['session:mark-reviewed']({ sessionId: 's1', expectedHeadSha: 'b'.repeat(40) });
    expect(calls).toStrictEqual([{ sessionId: 's1', expectedHeadSha: 'b'.repeat(40) }]);
  });
});

describe('createIpcHandlers for per-head channels (ADR 0078)', () => {
  test.for(perHeadInvokeChannels)(
    '%s refuses a request without the head the reviewer was shown',
    async (channel, { expect }) => {
      const handlers = createIpcHandlers(stubServices({}), appInfo());
      const headless = perHeadRequestWithoutHead(channel);
      await expectInvalid(expect, handlers[channel](headless));
      await expectInvalid(expect, handlers[channel]({ ...headless, expectedHeadSha: 'HEAD' }));
      const answered = await handlers[channel]({ ...headless, expectedHeadSha: sha() });
      expect(answered).not.toMatchObject({ error: { code: 'invalid-request' } });
    },
  );
});

describe('createIpcHandlers for reviewed marks', () => {
  test('validates review:set-file-reviewed before delegating', async ({ expect }) => {
    const { calls, services } = recording('setFileReviewed');
    const handlers = createIpcHandlers(services, appInfo());
    await expectInvalid(
      expect,
      handlers['review:set-file-reviewed']({ sessionId: 's1', path: 'a.ts' }),
    );
    await expectInvalid(
      expect,
      handlers['review:set-file-reviewed']({ sessionId: 's1', path: '', reviewed: true }),
    );
    await expectInvalid(
      expect,
      handlers['review:set-file-reviewed']({
        sessionId: 's1',
        path: 'a.ts',
        reviewed: true,
        expectedHeadSha: 'HEAD',
      }),
    );
    await expectInvalid(
      expect,
      handlers['review:set-file-reviewed']({ sessionId: 's1', path: 'a.ts', reviewed: false }),
    );
    const request = { sessionId: 's1', path: 'a.ts', reviewed: false, expectedHeadSha: sha() };
    await handlers['review:set-file-reviewed'](request);
    expect(calls).toStrictEqual([request]);
  });
});

describe('createIpcHandlers for review order', () => {
  test('validates session:get-order and the saved order in display:set', async ({ expect }) => {
    const calls: unknown[] = [];
    const handlers = createIpcHandlers(
      {
        ...stubServices({}),
        order: {
          getOrder: async (request) => {
            calls.push(request);
            return notWired();
          },
        },
      },
      appInfo(),
    );
    await expectInvalid(expect, handlers['session:get-order']({ sessionId: 's1', mode: 'random' }));
    await expectInvalid(expect, handlers['session:get-order']({ mode: 'path' }));
    await handlers['session:get-order']({ sessionId: 's1' });
    await handlers['session:get-order']({ sessionId: 's1', mode: 'calls' });
    expect(calls).toStrictEqual([{ sessionId: 's1' }, { sessionId: 's1', mode: 'calls' }]);
    await expectInvalid(expect, handlers['display:set']({ reviewOrder: 'tests-first' }));
  });
});

describe('createIpcHandlers for the tree, file pairs and call hierarchy', () => {
  test('validates session:get-tree and session:get-file-pair before delegating', async ({
    expect,
  }) => {
    const calls: unknown[] = [];
    const handlers = createIpcHandlers(
      {
        ...stubServices({}),
        files: {
          getTree: async (request) => {
            calls.push(['tree', request]);
            return notWired();
          },
          getFilePair: async (request) => {
            calls.push(['pair', request]);
            return notWired();
          },
          getFileAttributes: async (request) => {
            calls.push(['attributes', request]);
            return notWired();
          },
        },
      },
      appInfo(),
    );
    await expectInvalid(expect, handlers['session:get-tree']({ sessionId: 's1', path: 'a' }));
    await expectInvalid(expect, handlers['session:get-file-pair']({ sessionId: 's1' }));
    await expectInvalid(expect, handlers['session:get-file-pair']({ sessionId: 's1', path: '' }));
    await handlers['session:get-tree']({ sessionId: 's1' });
    await handlers['session:get-file-pair']({ sessionId: 's1', path: 'src/a.ts' });
    await expectInvalid(
      expect,
      handlers['session:get-file-attributes']({ sessionId: 's1', paths: [] }),
    );
    await handlers['session:get-file-attributes']({ sessionId: 's1' });
    expect(calls).toStrictEqual([
      ['tree', { sessionId: 's1' }],
      ['pair', { sessionId: 's1', path: 'src/a.ts' }],
      ['attributes', { sessionId: 's1' }],
    ]);
  });

  test('validates lsp:call-hierarchy and drops absent optional fields', async ({ expect }) => {
    const calls: unknown[] = [];
    const handlers = createIpcHandlers(
      {
        ...stubServices({}),
        lsp: {
          callHierarchy: async (request) => {
            calls.push(request);
            return notWired();
          },
          definition: notWired,
          diagnostics: notWired,
          hover: notWired,
          restart: notWired,
          status: notWiredError,
        },
      },
      appInfo(),
    );
    const good = {
      sessionId: 's1',
      expectedHeadSha: sha(),
      path: 'src/a.ts',
      line: 3,
      direction: 'incoming',
    };
    for (const bad of [
      { ...good, line: 0 },
      { ...good, line: 1.5 },
      { ...good, character: -1 },
      { ...good, direction: 'sideways' },
      { ...good, path: '' },
      { ...good, extra: true },
    ]) {
      await expectInvalid(expect, handlers['lsp:call-hierarchy'](bad));
    }
    await handlers['lsp:call-hierarchy'](good);
    await handlers['lsp:call-hierarchy']({ ...good, character: 4, nodeId: 'n1' });
    expect(calls).toStrictEqual([good, { ...good, character: 4, nodeId: 'n1' }]);
  });

  test('validates lsp:definition paths, commits and positions', async ({ expect }) => {
    const calls: unknown[] = [];
    const handlers = createIpcHandlers(
      {
        ...stubServices({}),
        lsp: {
          callHierarchy: notWired,
          definition: async (request) => {
            calls.push(request);
            return notWired();
          },
          diagnostics: notWired,
          hover: notWired,
          restart: notWired,
          status: notWiredError,
        },
      },
      appInfo(),
    );
    const good = { sessionId: 's1', path: 'src/a.ts', line: 3 };
    for (const bad of [
      { ...good, path: '../secret.ts' },
      { ...good, path: '/etc/passwd' },
      { ...good, path: 'src//a.ts' },
      { ...good, path: 'src/./a.ts' },
      { ...good, sha: 'HEAD~1' },
      { ...good, sha: 'abc1234' },
      { ...good, line: 0 },
      { ...good, kind: 'references' },
      { ...good, link: true },
      { ...good, character: 2, link: false },
    ]) {
      await expectInvalid(expect, handlers['lsp:definition'](bad));
    }
    const sha = 'a'.repeat(40);
    await handlers['lsp:definition'](good);
    await handlers['lsp:definition']({ ...good, sha, character: 2, kind: 'type-definition' });
    await handlers['lsp:definition']({ ...good, character: 2, link: true });
    expect(calls).toStrictEqual([
      good,
      { ...good, sha, character: 2, kind: 'type-definition' },
      { ...good, character: 2, link: true },
    ]);
  });

  test('validates lsp:hover paths, commits and positions', async ({ expect }) => {
    const calls: unknown[] = [];
    const handlers = createIpcHandlers(
      {
        ...stubServices({}),
        lsp: {
          callHierarchy: notWired,
          definition: notWired,
          diagnostics: notWired,
          hover: async (request) => {
            calls.push(request);
            return notWired();
          },
          restart: notWired,
          status: notWiredError,
        },
      },
      appInfo(),
    );
    const good = { sessionId: 's1', path: 'src/a.ts', line: 3, character: 4 };
    for (const bad of [
      { ...good, path: '../secret.ts' },
      { ...good, path: 'src//a.ts' },
      { ...good, sha: 'HEAD~1' },
      { ...good, line: 0 },
      { ...good, character: -1 },
      { sessionId: 's1', path: 'src/a.ts', line: 3 },
      { ...good, kind: 'definition' },
    ]) {
      await expectInvalid(expect, handlers['lsp:hover'](bad));
    }
    const sha = 'a'.repeat(40);
    await handlers['lsp:hover'](good);
    await handlers['lsp:hover']({ ...good, sha });
    expect(calls).toStrictEqual([good, { ...good, sha }]);
  });

  test('validates lsp:diagnostics paths and commits', async ({ expect }) => {
    const calls: unknown[] = [];
    const handlers = createIpcHandlers(
      {
        ...stubServices({}),
        lsp: {
          callHierarchy: notWired,
          definition: notWired,
          diagnostics: async (request) => {
            calls.push(request);
            return notWired();
          },
          hover: notWired,
          restart: notWired,
          status: notWiredError,
        },
      },
      appInfo(),
    );
    const good = { sessionId: 's1', path: 'src/a.ts' };
    for (const bad of [
      { ...good, path: '../secret.ts' },
      { ...good, path: 'src//a.ts' },
      { ...good, sha: 'HEAD~1' },
      { ...good, line: 3 },
      { path: 'src/a.ts' },
    ]) {
      await expectInvalid(expect, handlers['lsp:diagnostics'](bad));
    }
    const sha = 'a'.repeat(40);
    await handlers['lsp:diagnostics'](good);
    await handlers['lsp:diagnostics']({ ...good, sha });
    expect(calls).toStrictEqual([good, { ...good, sha }]);
  });

  test('opens a sheet only for a request main has checked', async ({ expect }) => {
    const opened: unknown[] = [];
    const sha = 'b'.repeat(40);
    const handlers = createIpcHandlers(
      {
        ...stubServices({}),
        sheets: {
          getFile: notWired,
          getHead: notWired,
          checkOpen: async (request): Promise<IpcResult<OpenedView>> => {
            if (request.path === 'src/a.ts') {
              return sheetChecked();
            }
            return notFound();
          },
        },
      },
      appInfo(),
      {
        openSheet: (request): void => {
          opened.push(request);
        },
      },
    );
    const range = { startLine: 4, startCharacter: 0, endLine: 4, endCharacter: 3 };
    await expectInvalid(expect, handlers['sheet:open']({ sessionId: 's1', sha, path: '..' }));
    await expectInvalid(
      expect,
      handlers['sheet:open']({ sessionId: 's1', sha, path: 'a', range: { ...range, endLine: 1 } }),
    );
    await expect(
      handlers['sheet:open']({ sessionId: 's1', sha, path: 'src/b.ts' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
    await expect(
      handlers['sheet:open']({ sessionId: 's1', sha, path: 'src/a.ts', range }),
    ).resolves.toStrictEqual({ ok: true, value: { opened: true } });
    expect(opened).toStrictEqual([{ sessionId: 's1', sha, path: 'src/a.ts', range }]);
    await expect(
      createIpcHandlers(stubServices({}), appInfo())['sheet:open']({
        sessionId: 's1',
        sha,
        path: 'src/a.ts',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not-wired' } });
  });

  test('validates flow:get-graph before delegating', async ({ expect }) => {
    const calls: unknown[] = [];
    const handlers = createIpcHandlers(
      {
        ...stubServices({}),
        flow: {
          getGraph: async (request) => {
            calls.push(request);
            return notWired();
          },
        },
      },
      appInfo(),
    );
    const good = { sessionId: 's1', path: 'src/a.ts', line: 3 };
    for (const bad of [
      { ...good, line: 0 },
      { ...good, line: 2.5 },
      { ...good, path: '' },
      { sessionId: 's1', path: 'a.ts' },
      { ...good, extra: true },
    ]) {
      await expectInvalid(expect, handlers['flow:get-graph'](bad));
    }
    await handlers['flow:get-graph'](good);
    expect(calls).toStrictEqual([good]);
  });
});

describe('createIpcHandlers for menus and the Settings window', () => {
  test('validates menu:set-state and passes it on with its sender', ({ expect }) => {
    const states: unknown[] = [];
    const handlers = createIpcHandlers(stubServices({}), appInfo(), {
      menus: {
        setState: (webContentsId, state): void => {
          states.push({ webContentsId, state });
        },
        popup: () => {
          return true;
        },
        runMainCommand: (_webContentsId, id) => {
          return id === 'settings';
        },
      },
    });
    const sender = { webContentsId: 3 };
    for (const bad of [
      undefined,
      { conditions: ['session'] },
      { conditions: ['sudo'], checked: [] },
      { conditions: [], checked: ['rm-rf'] },
      { conditions: [], checked: [], extra: 1 },
      { conditions: 'session '.repeat(40).trim().split(' '), checked: [] },
    ]) {
      expect(handlers['menu:set-state'](bad, sender)).toMatchObject({
        ok: false,
        error: { code: 'invalid-request' },
      });
    }
    const good = { conditions: ['session', 'text-focus'], checked: ['whitespace'] };
    expect(handlers['menu:set-state'](good, sender)).toStrictEqual(ok({ applied: true }));
    expect(states).toStrictEqual([{ webContentsId: 3, state: good }]);
    expect(handlers['menu:context']({ kind: 'line', x: 4.5, y: 9 }, sender)).toStrictEqual(
      ok({ shown: true }),
    );
    expect(handlers['menu:context']({ kind: 'window' }, sender)).toMatchObject({ ok: false });
    expect(handlers['menu:run-main']({ id: 'settings' }, sender)).toStrictEqual(ok({ ran: true }));
    expect(handlers['menu:run-main']({ id: 'stage' }, sender)).toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });
  });

  test('answers not-wired for menus outside Electron', ({ expect }) => {
    const handlers = createIpcHandlers(stubServices({}), appInfo());
    expect(
      handlers['menu:set-state']({ conditions: [], checked: [] }, { webContentsId: 1 }),
    ).toMatchObject({ ok: false, error: { code: 'not-wired' } });
  });

  test('validates the read-only settings channels', async ({ expect }) => {
    const handlers = createIpcHandlers(stubServices({}), appInfo());
    await expect(handlers['claude:status']({ probe: true })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
  });
});

describe('createIpcHandlers for the model registry', () => {
  test('validates every models channel in main and never echoes a key', async ({ expect }) => {
    const calls: unknown[] = [];
    const record = async (...args: unknown[]): Promise<Ok<never>> => {
      calls.push(args);
      await Promise.resolve();
      return ok(undefined as never);
    };
    const handlers = createIpcHandlers(
      {
        ...stubServices({}),
        models: {
          list: record,
          save: record,
          remove: record,
          setRole: record,
          setKey: record,
          removeKey: record,
          listRemote: record,
          test: record,
        },
      },
      appInfo(),
    );
    const leaked = await handlers['models:set-key']({ id: 'a', apiKey: 'sk-LEAK\0', extra: 1 });
    expect(leaked).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
    expect(JSON.stringify(leaked)).not.toContain('LEAK');
    await expectInvalid(expect, handlers['models:list']({}));
    await expectInvalid(
      expect,
      handlers['models:save']({
        entry: {
          kind: 'openai-compatible',
          label: 'x',
          model: 'm',
          baseUrl: 'file:///etc',
          tools: false,
        },
      }),
    );
    await expectInvalid(
      expect,
      handlers['models:save']({
        entry: {
          kind: 'openai-compatible',
          label: 'x',
          model: 'm',
          baseUrl: 'https://u:p@h/v1',
          tools: false,
        },
      }),
    );
    await expectInvalid(
      expect,
      handlers['models:save']({
        entry: {
          kind: 'claude-agent-sdk',
          label: 'x',
          executable: { source: 'installed', path: 'claude' },
        },
      }),
    );
    await expectInvalid(
      expect,
      handlers['models:save']({
        entry: { kind: 'claude-code-cli', label: 'x', command: '/bin/sh' },
      }),
    );
    await expectInvalid(expect, handlers['models:set-role']({ role: 'admin', id: 'a' }));
    await expectInvalid(expect, handlers['models:list-remote']({ baseUrl: 'ftp://x' }));
    await expectInvalid(expect, handlers['models:test']({}));
    expect(calls).toStrictEqual([]);
    await handlers['models:save']({
      entry: {
        kind: 'claude-agent-sdk',
        label: '  Key  ',
        executable: { source: 'installed' },
        effort: 'high',
      },
    });
    await handlers['models:set-key']({ id: 'a', apiKey: ' sk-ok ' });
    await handlers['models:set-role']({ role: 'verify', id: 'a' });
    expect(calls).toStrictEqual([
      [
        {
          kind: 'claude-agent-sdk',
          label: 'Key',
          executable: { source: 'installed' },
          effort: 'high',
        },
      ],
      [{ id: 'a', apiKey: 'sk-ok' }],
      ['verify', 'a'],
    ]);
  });
});

describe('createIpcHandlers for the chat', () => {
  const mention = {
    path: 'src/discounts.ts',
    side: 'head',
    startLine: 27,
    endLine: 33,
    sha: 'c'.repeat(40),
  } as const;

  test('validates chat:ask and drops absent options', async ({ expect }) => {
    const calls: unknown[] = [];
    const base = stubServices({});
    const handlers = createIpcHandlers(
      {
        ...base,
        chat: {
          ...base.chat,
          ask: async (request) => {
            calls.push(request);
            return notWired();
          },
        },
      },
      appInfo(),
    );
    for (const bad of [
      { sessionId: 's1' },
      { sessionId: 's1', question: ' '.repeat(3) },
      { sessionId: 's1', question: 'x'.repeat(8001) },
      { sessionId: 's1', question: 'why?', focus: { path: '' } },
      { sessionId: 's1', question: 'why?', focus: { path: 'a.ts', line: 0 } },
      { sessionId: 's1', question: 'why?', extra: true },
      { sessionId: 's1', question: 'why?', mentions: [{ ...mention, path: '/etc/passwd' }] },
      { sessionId: 's1', question: 'why?', mentions: [{ ...mention, path: '../x.ts' }] },
      { sessionId: 's1', question: 'why?', mentions: [{ ...mention, side: 'left' }] },
      { sessionId: 's1', question: 'why?', mentions: [{ ...mention, sha: 'abc' }] },
      { sessionId: 's1', question: 'why?', mentions: [{ ...mention, startLine: 9, endLine: 3 }] },
      { sessionId: 's1', question: 'why?', mentions: [{ ...mention, endLine: 5100 }] },
      { sessionId: 's1', question: 'why?', mentions: [{ ...mention, endLine: undefined }] },
      {
        sessionId: 's1',
        question: 'why?',
        mentions: Array.from({ length: 9 }, (_, index) => {
          return { ...mention, startLine: index + 1 };
        }),
      },
      { sessionId: 's1', question: '/review', command: { kind: 'review', pathPrefixes: ['/etc'] } },
      { sessionId: 's1', question: '/review', command: { kind: 'review', pathPrefixes: ['../x'] } },
      { sessionId: 's1', question: '/review', command: { kind: 'review', effort: 'max' } },
      { sessionId: 's1', question: '/review', command: { kind: 'review', fresh: 'yes' } },
      { sessionId: 's1', question: '/review', command: { kind: 'review', extra: true } },
      { sessionId: 's1', question: '/x', command: { kind: 'essay' } },
      { sessionId: 's1', question: '/summarize', command: { kind: 'summarize', paths: [] } },
    ]) {
      await expectInvalid(expect, handlers['chat:ask'](bad));
    }
    await handlers['chat:ask']({ sessionId: 's1', question: '  why?  ' });
    await handlers['chat:ask']({
      sessionId: 's1',
      question: 'why?',
      focus: { path: 'src/a.ts', line: undefined },
    });
    await handlers['chat:ask']({
      sessionId: 's1',
      question: 'why?',
      focus: { path: 'a', line: 3 },
    });
    await handlers['chat:ask']({
      sessionId: 's1',
      question: 'why [[@1]] and [[@2]]?',
      mentions: [mention, { path: './docs/a.md', side: 'base', sha: mention.sha }],
    });
    await handlers['chat:ask']({ sessionId: 's1', question: 'why?', mentions: [] });
    await handlers['chat:ask']({
      sessionId: 's1',
      question: '/review ./src/ui/ docs',
      command: {
        kind: 'review',
        pathPrefixes: ['./src/ui/', 'src/ui', 'docs'],
        fresh: true,
        effort: 'low',
        verify: false,
      },
    });
    await handlers['chat:ask']({
      sessionId: 's1',
      question: '/review',
      command: { kind: 'review', pathPrefixes: [], fresh: false },
    });
    await handlers['chat:ask']({
      sessionId: 's1',
      question: '/summarize',
      command: { kind: 'summarize' },
    });
    expect(calls).toStrictEqual([
      { sessionId: 's1', question: 'why?' },
      { sessionId: 's1', question: 'why?', focus: { path: 'src/a.ts' } },
      { sessionId: 's1', question: 'why?', focus: { path: 'a', line: 3 } },
      {
        sessionId: 's1',
        question: 'why [[@1]] and [[@2]]?',
        mentions: [mention, { path: 'docs/a.md', side: 'base', sha: mention.sha }],
      },
      { sessionId: 's1', question: 'why?' },
      {
        sessionId: 's1',
        question: '/review ./src/ui/ docs',
        command: {
          kind: 'review',
          pathPrefixes: ['src/ui', 'docs'],
          fresh: true,
          effort: 'low',
          verify: false,
        },
      },
      { sessionId: 's1', question: '/review', command: { kind: 'review' } },
      { sessionId: 's1', question: '/summarize', command: { kind: 'summarize' } },
    ]);
  });

  test('validates chat:list, chat:cancel and chat:clear', async ({ expect }) => {
    const handlers = createIpcHandlers(stubServices({}), appInfo());
    await expectInvalid(expect, handlers['chat:list']({}));
    await expectInvalid(expect, handlers['chat:clear']({ sessionId: '' }));
    await expectInvalid(expect, handlers['chat:clear']({ sessionId: 's1', queuedOnly: 'yes' }));
    await expectInvalid(expect, handlers['chat:cancel']({ messageId: 'not-a-uuid' }));
    await expectInvalid(expect, handlers['chat:cancel']({ sessionId: '' }));
    await expectInvalid(expect, handlers['chat:compact']({ sessionId: 's1', extra: 1 }));
    await expect(handlers['chat:compact']({ sessionId: 's1' })).resolves.toMatchObject({
      error: { code: 'not-wired' },
    });
    expect(handlers['chat:cancel']({ sessionId: 's1' })).toMatchObject({
      error: { code: 'not-wired' },
    });
    expect(handlers['chat:list']({ sessionId: 's1' })).toMatchObject({
      error: { code: 'not-wired' },
    });
    expect(
      handlers['chat:cancel']({ messageId: '00000000-0000-4000-8000-000000000001' }),
    ).toMatchObject({ error: { code: 'not-wired' } });
  });
});

describe('createIpcHandlers for the review dock and clipboard', () => {
  const id = '00000000-0000-4000-8000-000000000001';

  test('validates ura channels before delegating, dropping absent options', async ({ expect }) => {
    const calls: unknown[] = [];
    const record = async (request: unknown): Promise<Err<IpcError>> => {
      calls.push(request);
      return notWired();
    };
    const base = stubServices({});
    const handlers = createIpcHandlers(
      {
        ...base,
        ura: {
          ...base.ura,
          create: record,
          update: record,
          transition: record,
          stageReviewFinding: record,
          export: record,
          setVerdict: (request) => {
            calls.push(request);
            return notWiredError();
          },
          reorder: (request) => {
            calls.push(request);
            return notWiredError();
          },
        },
      },
      appInfo(),
    );
    const note = {
      sessionId: 's1',
      anchor: { kind: 'lines', path: 'src/a.ts', startLine: 3, endLine: 4 },
      severity: 'issue',
      title: 'Check this',
      body: '',
    };
    for (const bad of [
      { ...note, severity: 'major' },
      { ...note, anchor: { kind: 'lines', path: 'a', startLine: 4, endLine: 3 } },
      { ...note, anchor: { kind: 'lines', path: 'a', startLine: 0, endLine: 3 } },
      { ...note, anchor: { kind: 'change', path: 'a' } },
      { ...note, headSha: 'abc' },
      { ...note, extra: 1 },
      { ...note, origin: { kind: 'human' } },
      { ...note, origin: { kind: 'chat-answer', messageId: 'm1' } },
    ]) {
      await expectInvalid(expect, handlers['ura:create'](bad));
    }
    await expectInvalid(expect, handlers['ura:update']({ itemId: 'x' }));
    await expectInvalid(expect, handlers['ura:transition']({ itemId: id, to: 'deleted' }));
    await expectInvalid(expect, handlers['ura:reorder']({ sessionId: 's1', itemIds: ['x'] }));
    await expectInvalid(
      expect,
      handlers['ura:stage-review-finding']({ messageId: id, finding: -1 }),
    );
    await expectInvalid(
      expect,
      handlers['ura:stage-review-finding']({ messageId: 'm', finding: 0 }),
    );
    await expectInvalid(
      expect,
      handlers['ura:stage-review-finding']({ messageId: id, finding: 0, severity: 'meh' }),
    );
    await expectInvalid(expect, handlers['ura:export']({ sessionId: 's1', target: 'pdf' }));
    await expectInvalid(expect, handlers['ura:set-verdict']({ sessionId: 's1', verdict: 'ship' }));
    await expectInvalid(expect, handlers['ura:list']({}));

    await handlers['ura:create'](note);
    await handlers['ura:create']({ ...note, origin: { kind: 'chat-answer', messageId: id } });
    await handlers['ura:update']({ itemId: id, title: 'New' });
    await handlers['ura:transition']({ itemId: id, to: 'withdrawn' });
    await handlers['ura:reorder']({ sessionId: 's1', itemIds: [id] });
    await handlers['ura:stage-review-finding']({ messageId: id, finding: 2 });
    await handlers['ura:export']({ sessionId: 's1', target: 'agent-xml' });
    await expectInvalid(
      expect,
      handlers['ura:set-verdict']({ sessionId: 's1', verdict: 'comment' }),
    );
    await handlers['ura:set-verdict']({
      sessionId: 's1',
      verdict: 'comment',
      expectedHeadSha: sha(),
    });
    await handlers['ura:set-verdict']({ sessionId: 's1', expectedHeadSha: sha() });
    expect(calls).toStrictEqual([
      note,
      { ...note, origin: { kind: 'chat-answer', messageId: id } },
      { itemId: id, title: 'New' },
      { itemId: id, to: 'withdrawn' },
      { sessionId: 's1', itemIds: [id] },
      { messageId: id, finding: 2 },
      { sessionId: 's1', target: 'agent-xml' },
      { sessionId: 's1', expectedHeadSha: sha(), verdict: 'comment' },
      { sessionId: 's1', expectedHeadSha: sha() },
    ]);
  });

  test('writes the clipboard through the platform, and only text', async ({ expect }) => {
    const written: string[] = [];
    const handlers = createIpcHandlers(stubServices({}), appInfo(), {
      writeClipboard: async (text) => {
        written.push(text);
        await Promise.resolve();
      },
    });
    await expectInvalid(expect, handlers['clipboard:write-text']({ text: 7 }));
    await expect(
      handlers['clipboard:write-text']({ text: '<beuve-review/>' }),
    ).resolves.toStrictEqual(ok({ length: 15 }));
    expect(written).toStrictEqual(['<beuve-review/>']);
    await expect(
      createIpcHandlers(stubServices({}), appInfo())['clipboard:write-text']({ text: 'x' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not-wired' } });
  });
});

describe('createIpcHandlers for the open flow', () => {
  test('inspects only absolute paths', async ({ expect }) => {
    const calls: unknown[] = [];
    const handlers = createIpcHandlers(
      stubServices({
        inspectRepository: async (request) => {
          calls.push(request);
          await Promise.resolve();
          return notWired();
        },
      }),
      appInfo(),
    );
    await expectInvalid(expect, handlers['repository:inspect']({ path: 'relative/dir' }));
    await expectInvalid(expect, handlers['repository:inspect']({ path: '/x', extra: 1 }));
    await handlers['repository:inspect']({ path: '/code/beuve' });
    expect(calls).toStrictEqual([{ path: '/code/beuve' }]);
  });

  test('shows the folder picker through the platform', async ({ expect }) => {
    const asked: unknown[] = [];
    const handlers = createIpcHandlers(stubServices({}), appInfo(), {
      chooseFolder: async (options): Promise<string | undefined> => {
        asked.push(options);
        await Promise.resolve();
        if (asked.length === 1) {
          return '/code/beuve';
        }
        return undefined;
      },
    });
    await expectInvalid(expect, handlers['dialog:choose-folder']({ title: 7 }));
    await expect(handlers['dialog:choose-folder']({ defaultPath: '/code' })).resolves.toStrictEqual(
      ok({ kind: 'chosen', path: '/code/beuve' }),
    );
    await expect(handlers['dialog:choose-folder']({})).resolves.toStrictEqual(
      ok({ kind: 'cancelled' }),
    );
    expect(asked).toStrictEqual([{ defaultPath: '/code' }, {}]);
    await expect(
      createIpcHandlers(stubServices({}), appInfo())['dialog:choose-folder']({}),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not-wired' } });
  });
});

describe('createIpcHandlers for the editor', () => {
  const opened = ok({
    kind: 'opened' as const,
    editorId: 'zed' as const,
    editorName: 'Zed',
    location: 'working-tree' as const,
    path: 'src/a.ts',
    line: 3,
    headSha: 'a'.repeat(40),
  });

  test('validates editor:open and normalizes the path before delegating', async ({ expect }) => {
    const calls: unknown[] = [];
    const services: MainServices = {
      ...stubServices({}),
      editor: {
        ...stubServices({}).editor,
        open: async (request) => {
          calls.push(request);
          await Promise.resolve();
          return opened;
        },
      },
    };
    const handlers = createIpcHandlers(services, appInfo());
    const base = { sessionId: 's1', path: 'src/a.ts', line: 3 };
    for (const bad of [
      undefined,
      { ...base, path: '../etc/passwd' },
      { ...base, path: 'src/../../x' },
      { ...base, path: '/etc/passwd' },
      { ...base, path: 'C:/x' },
      { ...base, path: 'a\0b' },
      { ...base, path: '' },
      { ...base, line: 0 },
      { ...base, line: 1.5 },
      { ...base, column: 0 },
      { ...base, extra: true },
    ]) {
      await expectInvalid(expect, handlers['editor:open'](bad));
    }
    await expect(
      handlers['editor:open']({ ...base, path: './src//a.ts', column: 4 }),
    ).resolves.toStrictEqual(opened);
    expect(calls).toStrictEqual([{ sessionId: 's1', path: 'src/a.ts', line: 3, column: 4 }]);
  });

  test('accepts only known editors for editor:set-preferred', async ({ expect }) => {
    const handlers = createIpcHandlers(stubServices({}), appInfo());
    const responses = await Promise.all([
      handlers['editor:set-preferred']({ editorId: 'emacs' }),
      handlers['editor:set-preferred']({}),
      handlers['editor:get-settings']({ x: 1 }),
    ]);
    expect(responses).toMatchObject([
      { ok: false, error: { code: 'invalid-request' } },
      { ok: false, error: { code: 'invalid-request' } },
      { ok: false, error: { code: 'invalid-request' } },
    ]);
  });

  test('validates the diff display preferences', async ({ expect }) => {
    const calls: unknown[] = [];
    const services = stubServices({});
    const handlers = createIpcHandlers(
      {
        ...services,
        display: {
          get: notWired,
          set: async (request) => {
            calls.push(request);
            return notWired();
          },
        },
      },
      appInfo(),
    );
    await expectInvalid(expect, handlers['display:set']({ layout: 'diagonal' }));
    await expectInvalid(expect, handlers['display:set']({ ignoreWhitespace: 'yes' }));
    await expectInvalid(expect, handlers['display:set']({ showGenerated: 1 }));
    await expectInvalid(expect, handlers['display:set']({ showInsights: 'no' }));
    await expectInvalid(expect, handlers['display:get']({ x: 1 }));
    await handlers['display:set']({ layout: 'unified' });
    await handlers['display:set']({ ignoreWhitespace: false });
    await handlers['display:set']({ showGenerated: true });
    await handlers['display:set']({ showInsights: false });
    expect(calls).toStrictEqual([
      { layout: 'unified' },
      { ignoreWhitespace: false },
      { showGenerated: true },
      { showInsights: false },
    ]);
  });
});

describe('github channels', () => {
  test('validates refs, paths, verdicts and links before reaching the services', async ({
    expect,
  }) => {
    const calls: unknown[] = [];
    const record = async (request: unknown): Promise<Err<IpcError>> => {
      calls.push(request);
      await Promise.resolve();
      return notWiredError();
    };
    const handlers = createIpcHandlers(
      stubServices(
        {},
        {
          authStatus: record,
          openPullRequest: record,
          postReview: record,
          openLink: record,
          getPullRequest: record,
        },
      ),
      appInfo(),
    );
    await expectInvalid(expect, handlers['github:open-pr']({ ref: '' }));
    await expectInvalid(expect, handlers['github:open-pr']({ ref: 'o/r#1', token: 'x' }));
    await expectInvalid(
      expect,
      handlers['github:post-review']({ sessionId: 's1', verdict: 'lgtm' }),
    );
    await expectInvalid(expect, handlers['github:open-link']({ url: '' }));
    await expectInvalid(expect, handlers['shell:open-url']({ url: '' }));
    await expectInvalid(expect, handlers['shell:open-url']({ url: 'https://a.example', extra: 1 }));
    await expectInvalid(expect, handlers['github:auth-status']({ host: '' }));
    await handlers['github:auth-status'](undefined);
    await handlers['github:open-pr']({ ref: ' o/r#1 ', repoPath: '/clone' });
    await handlers['github:open-pr']({ ref: 'o/r#2' });
    await expectInvalid(
      expect,
      handlers['github:post-review']({ sessionId: 's1', verdict: 'comment' }),
    );
    await handlers['github:post-review']({
      sessionId: 's1',
      verdict: 'comment',
      expectedHeadSha: sha(),
    });
    await handlers['github:get-pr']({ sessionId: 's1' });
    expect(calls).toStrictEqual([
      {},
      { ref: 'o/r#1', repoPath: '/clone' },
      { ref: 'o/r#2' },
      { sessionId: 's1', expectedHeadSha: sha(), verdict: 'comment' },
      's1',
    ]);
  });
});

describe('session:get-commit', () => {
  test('takes a full commit sha of a session, and nothing else', async ({ expect }) => {
    const handlers = createIpcHandlers(stubServices({}), appInfo());
    const invalid = { ok: false, error: { code: 'invalid-request' } };
    await expect(
      handlers['session:get-commit']({ sessionId: 's1', sha: 'abc1234' }),
    ).resolves.toMatchObject(invalid);
    await expect(handlers['session:get-commit']({ sessionId: 's1' })).resolves.toMatchObject(
      invalid,
    );
    await expect(
      handlers['session:get-commit']({ sessionId: 's1', sha: sha(), extra: true }),
    ).resolves.toMatchObject(invalid);
  });
});

async function expectInvalid(expect: ExpectStatic, response: unknown): Promise<void> {
  expect(await response).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
}

function stubServices(
  overrides: Partial<SessionServices>,
  github: Partial<MainServices['github']> = {},
): MainServices {
  return {
    sessions: {
      list: notWiredError,
      createLocal: notWired,
      getReview: notWired,
      markReviewed: notWired,
      setFileReviewed: notWired,
      inspectRepository: notWired,
      ...overrides,
    },
    files: {
      getTree: notWired,
      getFilePair: notWired,
      getFileAttributes: notWired,
    },
    order: { getOrder: notWired },
    lsp: {
      callHierarchy: notWired,
      definition: notWired,
      diagnostics: notWired,
      hover: notWired,
      restart: notWired,
      status: notWiredError,
    },
    sheets: { getFile: notWired, getHead: notWired, checkOpen: notWired },
    remote: { permalink: notWired, openPermalink: notWired, openCommit: notWired },
    commits: { getCommit: notWired },
    shell: { openUrl: notWired },
    flow: { getGraph: notWired },
    editor: {
      open: notWired,
      getSettings: notWired,
      setPreferred: notWired,
      setReviewEditsPrefix: notWired,
    },
    reviewEdits: {
      get: notWired,
      open: notWired,
      previewSuggestions: notWired,
      stageSuggestions: notWired,
      previewDiscard: notWired,
      discard: notWired,
    },
    display: { get: notWired, set: notWired },
    chat: {
      ask: notWired,
      list: notWiredError,
      cancel: notWiredError,
      compact: notWired,
      clear: notWiredError,
      onStream: (): (() => void) => {
        return doNothingSync;
      },
      dispose: doNothing,
    },
    ura: {
      list: notWired,
      create: notWired,
      update: notWired,
      transition: notWired,
      reorder: notWiredError,
      stageReviewFinding: notWired,
      setVerdict: notWiredError,
      export: notWired,
      onChanged: (): (() => void) => {
        return doNothingSync;
      },
    },
    terminal: {
      open: notWired,
      list: notWiredError,
      write: notWiredError,
      resize: notWiredError,
      close: notWiredError,
      onData: (): (() => void) => {
        return doNothingSync;
      },
      onExit: (): (() => void) => {
        return doNothingSync;
      },
      dispose: doNothingSync,
    },
    github: {
      authStatus: notWired,
      openPullRequest: notWired,
      getPullRequest: notWired,
      openBranch: notWired,
      getBranch: notWired,
      getTimeline: notWired,
      previewReview: notWired,
      postReview: notWired,
      openLink: notWired,
      pollNow: doNothing,
      setForeground: doNothingSync,
      onPullRequestUpdated: (): (() => void) => {
        return doNothingSync;
      },
      onCiStatus: (): (() => void) => {
        return doNothingSync;
      },
      onBranchUpdated: (): (() => void) => {
        return doNothingSync;
      },
      dispose: doNothingSync,
      ...github,
    },
    queue: {
      get: notWired,
      refresh: notWired,
      setForeground: doNothingSync,
      onUpdated: (): (() => void) => {
        return doNothingSync;
      },
      dispose: doNothingSync,
    },
    claude: { status: notWired },
    models: {
      list: notWired,
      save: notWired,
      remove: notWired,
      setRole: notWired,
      setKey: notWired,
      removeKey: notWired,
      listRemote: notWired,
      test: notWired,
    },
    languageServerConfig: { open: notWired },
    pruneWorktrees: doNothing,
    dispose: doNothing,
  };
}

/** Main services whose one session operation records every request it is given. */
interface RecordingServices {
  readonly calls: unknown[];
  readonly services: MainServices;
}

function recording(
  name: Exclude<keyof SessionServices, 'list' | 'inspectRepository'>,
): RecordingServices {
  const calls: unknown[] = [];
  const overrides: Record<typeof name, Partial<SessionServices>> = {
    createLocal: {
      createLocal: async (request) => {
        calls.push(request);
        return opening();
      },
    },
    getReview: {
      getReview: async (request) => {
        calls.push(request);
        return notWired();
      },
    },
    setFileReviewed: {
      setFileReviewed: async (request) => {
        calls.push(request);
        return notWired();
      },
    },
    markReviewed: {
      markReviewed: async (request) => {
        calls.push(request);
        return opening();
      },
    },
  };
  return { calls, services: stubServices(overrides[name]) };
}

function doNothingSync(): void {
  // Stub subscriptions hold nothing.
}

async function doNothing(): Promise<void> {
  // Stub services own no resources.
}
