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

  it('validates session:open before delegating', async () => {
    const { calls, services } = recording('open');
    const handlers = createIpcHandlers(services, appInfo);
    for (const bad of [undefined, 'id', { sessionId: '' }, { sessionId: 's1', extra: 1 }]) {
      await expectInvalid(handlers['session:open'](bad));
    }
    expect(await handlers['session:open']({ sessionId: 's1' })).toEqual(ok(session));
    expect(calls).toEqual([{ sessionId: 's1' }]);
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
    await handlers['session:get-review']({ sessionId: 's1' });
    expect(calls).toEqual([{ sessionId: 's1' }]);
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
          getImpact: async (request) => {
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
        },
      },
      appInfo,
    );
    await expectInvalid(handlers['session:get-tree']({ sessionId: 's1', path: 'a' }));
    await expectInvalid(handlers['session:get-file-pair']({ sessionId: 's1' }));
    await expectInvalid(handlers['session:get-file-pair']({ sessionId: 's1', path: '' }));
    await handlers['session:get-tree']({ sessionId: 's1' });
    await handlers['session:get-file-pair']({ sessionId: 's1', path: 'src/a.ts' });
    expect(calls).toEqual([
      ['tree', { sessionId: 's1' }],
      ['pair', { sessionId: 's1', path: 'src/a.ts' }],
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
    ]) {
      await expectInvalid(handlers['ura:create'](bad));
    }
    await expectInvalid(handlers['ura:update']({ itemId: 'x' }));
    await expectInvalid(handlers['ura:transition']({ itemId: id, to: 'deleted' }));
    await expectInvalid(handlers['ura:reorder']({ sessionId: 's1', itemIds: ['x'] }));
    await expectInvalid(handlers['ura:promote-insight']({ insightId: id, severity: 'meh' }));
    await expectInvalid(handlers['ura:stage-impact-finding']({ sessionId: 's1', path: 'a' }));
    await expectInvalid(handlers['ura:export']({ sessionId: 's1', target: 'pdf' }));
    await expectInvalid(handlers['ura:list']({}));

    await handlers['ura:create'](note);
    await handlers['ura:update']({ itemId: id, title: 'New' });
    await handlers['ura:transition']({ itemId: id, to: 'withdrawn' });
    await handlers['ura:reorder']({ sessionId: 's1', itemIds: [id] });
    await handlers['ura:promote-insight']({ insightId: id });
    await handlers['ura:stage-impact-finding']({ sessionId: 's1', path: 'a', functionName: 'f' });
    await handlers['ura:export']({ sessionId: 's1', target: 'agent-xml' });
    expect(calls).toEqual([
      note,
      { itemId: id, title: 'New' },
      { itemId: id, to: 'withdrawn' },
      { sessionId: 's1', itemIds: [id] },
      { insightId: id },
      { sessionId: 's1', path: 'a', functionName: 'f' },
      { sessionId: 's1', target: 'agent-xml' },
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

async function expectInvalid(response: unknown): Promise<void> {
  expect(await response).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
}

function stubServices(overrides: Partial<SessionServices>): MainServices {
  return {
    sessions: {
      list: () => notWiredError,
      open: () => notWiredError,
      createLocal: async () => notWired,
      getReview: async () => notWired,
      markReviewed: async () => notWired,
      ...overrides,
    },
    impact: { getImpact: async () => notWired },
    files: { getTree: async () => notWired, getFilePair: async () => notWired },
    lsp: { callHierarchy: async () => notWired },
    review: {
      run: async () => notWired,
      listInsights: async () => notWired,
      setInsightStatus: () => notWiredError,
      onProgress: () => doNothingSync,
    },
    ura: {
      list: async () => notWired,
      create: async () => notWired,
      update: async () => notWired,
      transition: async () => notWired,
      reorder: () => notWiredError,
      promoteInsight: async () => notWired,
      stageImpactFinding: async () => notWired,
      export: async () => notWired,
      onChanged: () => doNothingSync,
    },
    mcpTools: unimplementedMcpTools,
    pruneWorktrees: doNothing,
    dispose: doNothing,
  };
}

function recording(name: Exclude<keyof SessionServices, 'list'>): {
  calls: unknown[];
  services: MainServices;
} {
  const calls: unknown[] = [];
  const overrides: Record<typeof name, Partial<SessionServices>> = {
    open: {
      open: (request) => {
        calls.push(request);
        return ok(session);
      },
    },
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
