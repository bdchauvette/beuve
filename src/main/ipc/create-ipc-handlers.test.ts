import { describe, expect, it } from 'vitest';

import type { AppInfo, IpcError, SessionSummary } from '#contract/ipc-contract.ts';
import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Err } from '#pkg/result/result.ts';

import type { MainServices, SessionServices } from '../main-services.ts';
import { unimplementedMcpTools } from '../mcp/unimplemented-mcp-tools.ts';

import { createIpcHandlers } from './create-ipc-handlers.ts';

const appInfo: AppInfo = {
  name: 'beuve',
  version: '0.1.0',
  platform: 'linux',
  electronVersion: '45.1.0',
  chromeVersion: '140',
  nodeVersion: '24',
};

const session: SessionSummary = {
  id: 's1',
  source: { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feature' },
  headSha: 'a'.repeat(40),
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z',
};

const notWiredError: Err<IpcError> = err({ code: 'not-wired', message: 'not wired in this test' });
const notWired = Promise.resolve(notWiredError);
const opening = Promise.resolve(ok(session));

describe('createIpcHandlers', () => {
  it('answers app:get-info and rejects unexpected arguments', async () => {
    const handlers = createIpcHandlers(stubServices({}), appInfo);
    expect(await handlers['app:get-info'](undefined)).toEqual(ok(appInfo));
    expect(await handlers['app:get-info']({ sneaky: true })).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
  });

  it('passes service failures through unchanged', async () => {
    const handlers = createIpcHandlers(stubServices({}), appInfo);
    expect(await handlers['session:list'](undefined)).toMatchObject({
      ok: false,
      error: { code: 'not-wired' },
    });
  });

  it('validates session:create-local before delegating', async () => {
    const { calls, services } = recording('createLocal');
    const handlers = createIpcHandlers(services, appInfo);
    const good = { repoPath: '/repo', baseRef: 'main', headRef: 'HEAD' };
    for (const bad of [
      undefined,
      { ...good, repoPath: '' },
      { ...good, baseRef: ' '.repeat(3) },
      { ...good, headRef: 7 },
      { ...good, extra: true },
      { repoPath: '/repo', baseRef: 'main' },
    ]) {
      await expectInvalid(handlers['session:create-local'](bad));
    }
    expect(await handlers['session:create-local'](good)).toEqual(ok(session));
    expect(calls).toEqual([good]);
  });

  it('validates session:get-review before delegating', async () => {
    const { calls, services } = recording('getReview');
    const handlers = createIpcHandlers(services, appInfo);
    await expectInvalid(handlers['session:get-review']({ sessionId: 3 }));
    await expectInvalid(handlers['session:get-review']({ sessionId: 's1', ignoreWhitespace: 1 }));
    await handlers['session:get-review']({ sessionId: 's1' });
    await handlers['session:get-review']({ sessionId: 's1', ignoreWhitespace: true });
    expect(calls).toEqual([{ sessionId: 's1' }, { sessionId: 's1', ignoreWhitespace: true }]);
  });

  it('validates session:mark-reviewed, including the optional expected head', async () => {
    const { calls, services } = recording('markReviewed');
    const handlers = createIpcHandlers(services, appInfo);
    await expectInvalid(
      handlers['session:mark-reviewed']({ sessionId: 's1', expectedHeadSha: 'HEAD' }),
    );
    await expectInvalid(
      handlers['session:mark-reviewed']({ sessionId: 's1', expectedHeadSha: 'A'.repeat(40) }),
    );
    await handlers['session:mark-reviewed']({ sessionId: 's1' });
    await handlers['session:mark-reviewed']({ sessionId: 's1', expectedHeadSha: 'b'.repeat(40) });
    expect(calls).toEqual([
      { sessionId: 's1' },
      { sessionId: 's1', expectedHeadSha: 'b'.repeat(40) },
    ]);
  });
});

describe('createIpcHandlers for impact and call hierarchy', () => {
  it('validates session:get-impact before delegating', async () => {
    const calls: unknown[] = [];
    const handlers = createIpcHandlers(
      {
        ...stubServices({}),
        impact: {
          ...stubServices({}).impact,
          getImpactForRenderer: async (request) => {
            calls.push(request);
            return notWired;
          },
        },
      },
      appInfo,
    );
    await expectInvalid(handlers['session:get-impact']({ sessionId: 's1', paths: [] }));
    await handlers['session:get-impact']({ sessionId: 's1' });
    expect(calls).toEqual([{ sessionId: 's1' }]);
  });

  it('validates session:get-tree and session:get-file-pair before delegating', async () => {
    const calls: unknown[] = [];
    const handlers = createIpcHandlers(
      {
        ...stubServices({}),
        files: {
          getTree: async (request) => {
            calls.push(['tree', request]);
            return notWired;
          },
          getFilePair: async (request) => {
            calls.push(['pair', request]);
            return notWired;
          },
          getFileAttributes: async (request) => {
            calls.push(['attributes', request]);
            return notWired;
          },
        },
      },
      appInfo,
    );
    await expectInvalid(handlers['session:get-tree']({ sessionId: 's1', path: 'a' }));
    await expectInvalid(handlers['session:get-file-pair']({ sessionId: 's1' }));
    await expectInvalid(handlers['session:get-file-pair']({ sessionId: 's1', path: '' }));
    await handlers['session:get-tree']({ sessionId: 's1' });
    await handlers['session:get-file-pair']({ sessionId: 's1', path: 'src/a.ts' });
    await expectInvalid(handlers['session:get-file-attributes']({ sessionId: 's1', paths: [] }));
    await handlers['session:get-file-attributes']({ sessionId: 's1' });
    expect(calls).toEqual([
      ['tree', { sessionId: 's1' }],
      ['pair', { sessionId: 's1', path: 'src/a.ts' }],
      ['attributes', { sessionId: 's1' }],
    ]);
  });

  it('validates lsp:call-hierarchy and drops absent optional fields', async () => {
    const calls: unknown[] = [];
    const handlers = createIpcHandlers(
      {
        ...stubServices({}),
        lsp: {
          callHierarchy: async (request) => {
            calls.push(request);
            return notWired;
          },
        },
      },
      appInfo,
    );
    const good = { sessionId: 's1', path: 'src/a.ts', line: 3, direction: 'incoming' };
    for (const bad of [
      { ...good, line: 0 },
      { ...good, line: 1.5 },
      { ...good, character: -1 },
      { ...good, direction: 'sideways' },
      { ...good, path: '' },
      { ...good, extra: true },
    ]) {
      await expectInvalid(handlers['lsp:call-hierarchy'](bad));
    }
    await handlers['lsp:call-hierarchy'](good);
    await handlers['lsp:call-hierarchy']({ ...good, character: 4, nodeId: 'n1' });
    expect(calls).toEqual([good, { ...good, character: 4, nodeId: 'n1' }]);
  });

  it('validates flow:get-graph before delegating', async () => {
    const calls: unknown[] = [];
    const handlers = createIpcHandlers(
      {
        ...stubServices({}),
        flow: {
          getGraph: async (request) => {
            calls.push(request);
            return notWired;
          },
        },
      },
      appInfo,
    );
    const good = { sessionId: 's1', path: 'src/a.ts', line: 3 };
    for (const bad of [
      { ...good, line: 0 },
      { ...good, line: 2.5 },
      { ...good, path: '' },
      { sessionId: 's1', path: 'a.ts' },
      { ...good, extra: true },
    ]) {
      await expectInvalid(handlers['flow:get-graph'](bad));
    }
    await handlers['flow:get-graph'](good);
    expect(calls).toEqual([good]);
  });
});

describe('createIpcHandlers for trace probes', () => {
  it('validates trace:run and trace:set-trust before delegating', async () => {
    const calls: unknown[] = [];
    const handlers = createIpcHandlers(
      {
        ...stubServices({}),
        trace: {
          ...stubServices({}).trace,
          run: async (request) => {
            calls.push(request);
            return notWired;
          },
          setTrust: async (request) => {
            calls.push(request);
            return notWired;
          },
        },
      },
      appInfo,
    );
    const good = { sessionId: 's1', path: 'src/a.ts', line: 3 };
    for (const bad of [
      { ...good, line: 0 },
      { ...good, path: '' },
      { ...good, testNamePattern: '' },
      { ...good, extra: true },
      { sessionId: 's1', line: 3 },
    ]) {
      await expectInvalid(handlers['trace:run'](bad));
    }
    await handlers['trace:run'](good);
    await handlers['trace:run']({ ...good, testNamePattern: 'clamp' });
    await expectInvalid(handlers['trace:set-trust']({ sessionId: 's1' }));
    await expectInvalid(handlers['trace:set-trust']({ sessionId: 's1', trusted: 'yes' }));
    await handlers['trace:set-trust']({ sessionId: 's1', trusted: true });
    expect(calls).toEqual([
      good,
      { ...good, testNamePattern: 'clamp' },
      { sessionId: 's1', trusted: true },
    ]);
  });
});

describe('createIpcHandlers for the preliminary review', () => {
  it('validates review:run and normalizes path prefixes', async () => {
    const calls: unknown[] = [];
    const handlers = createIpcHandlers(
      {
        ...stubServices({}),
        review: {
          ...stubServices({}).review,
          run: async (request) => {
            calls.push(request);
            return notWired;
          },
        },
      },
      appInfo,
    );
    for (const bad of [
      { sessionId: '' },
      { sessionId: 's1', pathPrefixes: ['/etc'] },
      { sessionId: 's1', pathPrefixes: ['../x'] },
      { sessionId: 's1', pathPrefixes: 'src' },
      { sessionId: 's1', effort: 'max' },
      { sessionId: 's1', fresh: 'yes' },
      { sessionId: 's1', extra: true },
    ]) {
      await expectInvalid(handlers['review:run'](bad));
    }
    await handlers['review:run']({ sessionId: 's1' });
    await handlers['review:run']({
      sessionId: 's1',
      pathPrefixes: ['./src/ui/', 'src/ui', 'docs'],
      fresh: true,
      effort: 'low',
    });
    await handlers['review:run']({ sessionId: 's1', pathPrefixes: [], fresh: false });
    expect(calls).toEqual([
      { sessionId: 's1' },
      { sessionId: 's1', pathPrefixes: ['src/ui', 'docs'], fresh: true, effort: 'low' },
      { sessionId: 's1' },
    ]);
  });

  it('validates review:list-insights and review:set-insight-status', async () => {
    const calls: unknown[] = [];
    const handlers = createIpcHandlers(
      {
        ...stubServices({}),
        review: {
          ...stubServices({}).review,
          listInsights: async (request) => {
            calls.push(request);
            return notWired;
          },
          setInsightStatus: (request) => {
            calls.push(request);
            return notWiredError;
          },
        },
      },
      appInfo,
    );
    const id = '00000000-0000-4000-8000-000000000001';
    await expectInvalid(handlers['review:list-insights']({}));
    await expectInvalid(
      handlers['review:set-insight-status']({ insightId: 'x', status: 'pending' }),
    );
    await expectInvalid(handlers['review:set-insight-status']({ insightId: id, status: 'done' }));
    await handlers['review:list-insights']({ sessionId: 's1' });
    await handlers['review:set-insight-status']({ insightId: id, status: 'promoted' });
    expect(calls).toEqual([{ sessionId: 's1' }, { insightId: id, status: 'promoted' }]);
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

  it('validates chat:ask and drops absent options', async () => {
    const calls: unknown[] = [];
    const base = stubServices({});
    const handlers = createIpcHandlers(
      {
        ...base,
        chat: {
          ...base.chat,
          ask: async (request) => {
            calls.push(request);
            return notWired;
          },
        },
      },
      appInfo,
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
        mentions: Array.from({ length: 9 }, (_, index) => ({ ...mention, startLine: index + 1 })),
      },
    ]) {
      await expectInvalid(handlers['chat:ask'](bad));
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
    expect(calls).toEqual([
      { sessionId: 's1', question: 'why?' },
      { sessionId: 's1', question: 'why?', focus: { path: 'src/a.ts' } },
      { sessionId: 's1', question: 'why?', focus: { path: 'a', line: 3 } },
      {
        sessionId: 's1',
        question: 'why [[@1]] and [[@2]]?',
        mentions: [mention, { path: 'docs/a.md', side: 'base', sha: mention.sha }],
      },
      { sessionId: 's1', question: 'why?' },
    ]);
  });

  it('validates chat:list, chat:cancel and chat:clear', async () => {
    const handlers = createIpcHandlers(stubServices({}), appInfo);
    await expectInvalid(handlers['chat:list']({}));
    await expectInvalid(handlers['chat:clear']({ sessionId: '' }));
    await expectInvalid(handlers['chat:cancel']({ messageId: 'not-a-uuid' }));
    await expectInvalid(handlers['chat:cancel']({ sessionId: '' }));
    await expectInvalid(handlers['chat:compact']({ sessionId: 's1', extra: 1 }));
    expect(await handlers['chat:compact']({ sessionId: 's1' })).toMatchObject({
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

  it('validates ura channels before delegating, dropping absent options', async () => {
    const calls: unknown[] = [];
    const record = async (request: unknown): Promise<Err<IpcError>> => {
      calls.push(request);
      return notWired;
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
          promoteInsight: record,
          stageImpactFinding: record,
          export: record,
          setVerdict: (request) => {
            calls.push(request);
            return notWiredError;
          },
          reorder: (request) => {
            calls.push(request);
            return notWiredError;
          },
        },
      },
      appInfo,
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
      await expectInvalid(handlers['ura:create'](bad));
    }
    await expectInvalid(handlers['ura:update']({ itemId: 'x' }));
    await expectInvalid(handlers['ura:transition']({ itemId: id, to: 'deleted' }));
    await expectInvalid(handlers['ura:reorder']({ sessionId: 's1', itemIds: ['x'] }));
    await expectInvalid(handlers['ura:promote-insight']({ insightId: id, severity: 'meh' }));
    await expectInvalid(handlers['ura:stage-impact-finding']({ sessionId: 's1', path: 'a' }));
    await expectInvalid(handlers['ura:export']({ sessionId: 's1', target: 'pdf' }));
    await expectInvalid(handlers['ura:set-verdict']({ sessionId: 's1', verdict: 'ship' }));
    await expectInvalid(handlers['ura:list']({}));

    await handlers['ura:create'](note);
    await handlers['ura:create']({ ...note, origin: { kind: 'chat-answer', messageId: id } });
    await handlers['ura:update']({ itemId: id, title: 'New' });
    await handlers['ura:transition']({ itemId: id, to: 'withdrawn' });
    await handlers['ura:reorder']({ sessionId: 's1', itemIds: [id] });
    await handlers['ura:promote-insight']({ insightId: id });
    await handlers['ura:stage-impact-finding']({ sessionId: 's1', path: 'a', functionName: 'f' });
    await handlers['ura:export']({ sessionId: 's1', target: 'agent-xml' });
    await handlers['ura:set-verdict']({ sessionId: 's1', verdict: 'comment' });
    await handlers['ura:set-verdict']({ sessionId: 's1' });
    expect(calls).toEqual([
      note,
      { ...note, origin: { kind: 'chat-answer', messageId: id } },
      { itemId: id, title: 'New' },
      { itemId: id, to: 'withdrawn' },
      { sessionId: 's1', itemIds: [id] },
      { insightId: id },
      { sessionId: 's1', path: 'a', functionName: 'f' },
      { sessionId: 's1', target: 'agent-xml' },
      { sessionId: 's1', verdict: 'comment' },
      { sessionId: 's1' },
    ]);
  });

  it('writes the clipboard through the platform, and only text', async () => {
    const written: string[] = [];
    const handlers = createIpcHandlers(stubServices({}), appInfo, {
      writeClipboard: async (text) => {
        written.push(text);
        await Promise.resolve();
      },
    });
    await expectInvalid(handlers['clipboard:write-text']({ text: 7 }));
    expect(await handlers['clipboard:write-text']({ text: '<beuve-review/>' })).toEqual(
      ok({ length: 15 }),
    );
    expect(written).toEqual(['<beuve-review/>']);
    expect(
      await createIpcHandlers(stubServices({}), appInfo)['clipboard:write-text']({ text: 'x' }),
    ).toMatchObject({ ok: false, error: { code: 'not-wired' } });
  });
});

describe('createIpcHandlers for the open flow', () => {
  it('inspects only absolute paths', async () => {
    const calls: unknown[] = [];
    const handlers = createIpcHandlers(
      stubServices({
        inspectRepository: async (request) => {
          calls.push(request);
          await Promise.resolve();
          return notWired;
        },
      }),
      appInfo,
    );
    await expectInvalid(handlers['repository:inspect']({ path: 'relative/dir' }));
    await expectInvalid(handlers['repository:inspect']({ path: '/x', extra: 1 }));
    await handlers['repository:inspect']({ path: '/code/beuve' });
    expect(calls).toEqual([{ path: '/code/beuve' }]);
  });

  it('shows the folder picker through the platform', async () => {
    const asked: unknown[] = [];
    const handlers = createIpcHandlers(stubServices({}), appInfo, {
      chooseFolder: async (options) => {
        asked.push(options);
        await Promise.resolve();
        return asked.length === 1 ? '/code/beuve' : undefined;
      },
    });
    await expectInvalid(handlers['dialog:choose-folder']({ title: 7 }));
    expect(await handlers['dialog:choose-folder']({ defaultPath: '/code' })).toEqual(
      ok({ kind: 'chosen', path: '/code/beuve' }),
    );
    expect(await handlers['dialog:choose-folder']({})).toEqual(ok({ kind: 'cancelled' }));
    expect(asked).toEqual([{ defaultPath: '/code' }, {}]);
    expect(
      await createIpcHandlers(stubServices({}), appInfo)['dialog:choose-folder']({}),
    ).toMatchObject({ ok: false, error: { code: 'not-wired' } });
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
  });

  it('validates editor:open and normalizes the path before delegating', async () => {
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
    const handlers = createIpcHandlers(services, appInfo);
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
      await expectInvalid(handlers['editor:open'](bad));
    }
    expect(await handlers['editor:open']({ ...base, path: './src//a.ts', column: 4 })).toEqual(
      opened,
    );
    expect(calls).toEqual([{ sessionId: 's1', path: 'src/a.ts', line: 3, column: 4 }]);
  });

  it('accepts only known editors for editor:set-preferred', async () => {
    const handlers = createIpcHandlers(stubServices({}), appInfo);
    await expectInvalid(handlers['editor:set-preferred']({ editorId: 'emacs' }));
    await expectInvalid(handlers['editor:set-preferred']({}));
    await expectInvalid(handlers['editor:get-settings']({ x: 1 }));
  });

  it('validates the diff display preferences', async () => {
    const calls: unknown[] = [];
    const services = stubServices({});
    const handlers = createIpcHandlers(
      {
        ...services,
        display: {
          get: async () => notWired,
          set: async (request) => {
            calls.push(request);
            return notWired;
          },
        },
      },
      appInfo,
    );
    await expectInvalid(handlers['display:set']({ layout: 'diagonal' }));
    await expectInvalid(handlers['display:set']({ ignoreWhitespace: 'yes' }));
    await expectInvalid(handlers['display:set']({ showGenerated: 1 }));
    await expectInvalid(handlers['display:get']({ x: 1 }));
    await handlers['display:set']({ layout: 'unified' });
    await handlers['display:set']({ ignoreWhitespace: false });
    await handlers['display:set']({ showGenerated: true });
    expect(calls).toEqual([
      { layout: 'unified' },
      { ignoreWhitespace: false },
      { showGenerated: true },
    ]);
  });
});

describe('github channels', () => {
  it('validates refs, paths, verdicts and links before reaching the services', async () => {
    const calls: unknown[] = [];
    const record = async (request: unknown): Promise<typeof notWiredError> => {
      calls.push(request);
      await Promise.resolve();
      return notWiredError;
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
      appInfo,
    );
    await expectInvalid(handlers['github:open-pr']({ ref: '' }));
    await expectInvalid(handlers['github:open-pr']({ ref: 'o/r#1', token: 'x' }));
    await expectInvalid(handlers['github:post-review']({ sessionId: 's1', verdict: 'lgtm' }));
    await expectInvalid(handlers['github:open-link']({ url: '' }));
    await expectInvalid(handlers['github:auth-status']({ host: '' }));
    await handlers['github:auth-status'](undefined);
    await handlers['github:open-pr']({ ref: ' o/r#1 ', repoPath: '/clone' });
    await handlers['github:open-pr']({ ref: 'o/r#2' });
    await handlers['github:post-review']({ sessionId: 's1', verdict: 'comment' });
    await handlers['github:get-pr']({ sessionId: 's1' });
    expect(calls).toEqual([
      {},
      { ref: 'o/r#1', repoPath: '/clone' },
      { ref: 'o/r#2' },
      { sessionId: 's1', verdict: 'comment' },
      's1',
    ]);
  });
});

async function expectInvalid(response: unknown): Promise<void> {
  expect(await response).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
}

function stubServices(
  overrides: Partial<SessionServices>,
  github: Partial<MainServices['github']> = {},
): MainServices {
  return {
    sessions: {
      list: () => notWiredError,
      createLocal: async () => notWired,
      getReview: async () => notWired,
      markReviewed: async () => notWired,
      inspectRepository: async () => notWired,
      ...overrides,
    },
    impact: {
      getImpact: async () => notWired,
      getImpactForRenderer: async () => notWired,
      observeHead: noop,
    },
    files: {
      getTree: async () => notWired,
      getFilePair: async () => notWired,
      getFileAttributes: async () => notWired,
    },
    lsp: { callHierarchy: async () => notWired },
    flow: { getGraph: async () => notWired },
    editor: {
      open: async () => notWired,
      getSettings: async () => notWired,
      setPreferred: async () => notWired,
    },
    display: { get: async () => notWired, set: async () => notWired },
    review: {
      run: async () => notWired,
      listInsights: async () => notWired,
      setInsightStatus: () => notWiredError,
      onProgress: () => doNothingSync,
    },
    chat: {
      ask: async () => notWired,
      list: () => notWiredError,
      cancel: () => notWiredError,
      compact: async () => notWired,
      clear: () => notWiredError,
      onDelta: () => doNothingSync,
      onMessageUpdated: () => doNothingSync,
      dispose: doNothing,
    },
    ura: {
      list: async () => notWired,
      create: async () => notWired,
      update: async () => notWired,
      transition: async () => notWired,
      reorder: () => notWiredError,
      promoteInsight: async () => notWired,
      stageImpactFinding: async () => notWired,
      setVerdict: () => notWiredError,
      export: async () => notWired,
      onChanged: () => doNothingSync,
    },
    trace: {
      run: async () => notWired,
      cancel: () => notWiredError,
      getTrust: async () => notWired,
      setTrust: async () => notWired,
      onStatus: () => doNothingSync,
      dispose: doNothing,
    },
    github: {
      authStatus: async () => notWired,
      openPullRequest: async () => notWired,
      getPullRequest: async () => notWired,
      previewReview: async () => notWired,
      postReview: async () => notWired,
      openLink: async () => notWired,
      pollNow: doNothing,
      setForeground: doNothingSync,
      onPullRequestUpdated: () => doNothingSync,
      onCiStatus: () => doNothingSync,
      dispose: doNothingSync,
      ...github,
    },
    mcpTools: unimplementedMcpTools,
    pruneWorktrees: doNothing,
    dispose: doNothing,
  };
}

function recording(name: Exclude<keyof SessionServices, 'list' | 'inspectRepository'>): {
  calls: unknown[];
  services: MainServices;
} {
  const calls: unknown[] = [];
  const overrides: Record<typeof name, Partial<SessionServices>> = {
    createLocal: {
      createLocal: async (request) => {
        calls.push(request);
        return opening;
      },
    },
    getReview: {
      getReview: async (request) => {
        calls.push(request);
        return notWired;
      },
    },
    markReviewed: {
      markReviewed: async (request) => {
        calls.push(request);
        return opening;
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

function noop(): void {
  // stands in for a callback the test never reaches
}
