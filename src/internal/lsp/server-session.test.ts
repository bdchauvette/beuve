import { describe, expect, it } from 'vitest';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { LspError } from './lsp-error.ts';
import type { LspServerCapabilities } from './lsp-protocol.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';
import { ServerSession } from './server-session.ts';
import type { DocumentContent, ServerSessionOptions } from './server-session.ts';
import type { LanguageServer, ServerExit } from './start-language-server.ts';

interface FakeServer {
  readonly server: LanguageServer;
  readonly notifications: { method: string; params: unknown }[];
  readonly push: (method: string, params: unknown) => void;
  readonly exit: (exit: ServerExit) => void;
}

function createFakeServer(
  overrides: Partial<LspServerCapabilities> = {},
  answer?: (method: string) => unknown,
): FakeServer {
  const notifications: { method: string; params: unknown }[] = [];
  let listener: ((method: string, params: unknown) => void) | undefined;
  const exits: ((exit: ServerExit) => void)[] = [];
  const server: LanguageServer = {
    serverId: 'fake',
    root: '/workspace' as WorkspaceRoot,
    pid: undefined,
    capabilities: {
      positionEncoding: 'utf-16',
      callHierarchy: false,
      pullDiagnostics: false,
      definition: false,
      references: false,
      hover: false,
      documentSymbol: false,
      raw: {},
      ...overrides,
    },
    request: async (method): Promise<Result<unknown, LspError>> => {
      await Promise.resolve();
      return ok(answer?.(method));
    },
    notify: (method, params): void => {
      notifications.push({ method, params });
    },
    setNotificationListener: (next): void => {
      listener = next;
    },
    exited: new Promise<ServerExit>((resolve) => {
      exits.push(resolve);
    }),
    shutdown: async (): Promise<void> => {
      await Promise.resolve();
    },
  };
  return {
    server,
    notifications,
    push: (method, params): void => {
      listener?.(method, params);
    },
    exit: (exit): void => {
      for (const resolve of exits) {
        resolve(exit);
      }
    },
  };
}

const wait = {
  timeout: Temporal.Duration.from({ milliseconds: 400 }),
  grace: Temporal.Duration.from({ milliseconds: 80 }),
  quiet: Temporal.Duration.from({ milliseconds: 30 }),
};

function content(name: string, text: string): DocumentContent {
  return {
    uri: `file:///workspace/${name}`,
    absolutePath: `/workspace/${name}`,
    languageId: 'typescript',
    text,
    stamp: { mtime: Temporal.Instant.fromEpochMilliseconds(1), size: text.length },
  };
}

function publish(fake: FakeServer, messages: readonly string[], version?: number): void {
  fake.push('textDocument/publishDiagnostics', {
    uri: 'file:///workspace/a.ts',
    ...(version !== undefined && { version }),
    diagnostics: messages.map((message) => ({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message,
    })),
  });
}

function unwrap<T>(result: Result<T, LspError>): T {
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value;
}

function later(run: () => void, ms: number): void {
  setTimeout(run, ms);
}

describe('ServerSession', () => {
  it('opens, changes and closes documents with increasing versions', () => {
    const fake = createFakeServer();
    const session = new ServerSession(fake.server);
    expect(session.sync(content('a.ts', 'one'))).toMatchObject({ version: 1, changed: true });
    expect(session.sync(content('a.ts', 'one'))).toMatchObject({ version: 1, changed: false });
    expect(session.sync(content('a.ts', 'two'))).toMatchObject({ version: 2, changed: true });
    expect(session.sync(content('a.ts', 'two'), { recheck: true })).toMatchObject({
      version: 3,
      changed: true,
    });
    session.close('file:///workspace/a.ts');
    expect(fake.notifications.map((n) => n.method)).toEqual([
      'textDocument/didOpen',
      'textDocument/didChange',
      'textDocument/didChange',
      'textDocument/didClose',
    ]);
    expect(fake.notifications[1]?.params).toEqual({
      textDocument: { uri: 'file:///workspace/a.ts', version: 2 },
      contentChanges: [{ text: 'two' }],
    });
  });

  it('closes the least recently used document beyond the limit', () => {
    const fake = createFakeServer();
    const options: ServerSessionOptions = { maxOpenDocuments: 2 };
    const session = new ServerSession(fake.server, options);
    session.sync(content('a.ts', 'a'));
    session.sync(content('b.ts', 'b'));
    session.sync(content('a.ts', 'a'));
    session.sync(content('c.ts', 'c'));
    expect(session.openDocuments.map((document) => document.absolutePath)).toEqual([
      '/workspace/a.ts',
      '/workspace/c.ts',
    ]);
    expect(fake.notifications.at(-1)).toEqual({
      method: 'textDocument/didClose',
      params: { textDocument: { uri: 'file:///workspace/b.ts' } },
    });
  });

  it('settles on the first report after a change once the server is quiet', async () => {
    const fake = createFakeServer();
    const session = new ServerSession(fake.server);
    const document = session.sync(content('a.ts', 'x'));
    later(() => {
      publish(fake, ['syntax pass']);
    }, 5);
    later(() => {
      publish(fake, ['semantic pass']);
    }, 20);
    const result = unwrap(await session.diagnostics(document, wait));
    expect(result.freshness).toBe('fresh');
    expect(result.diagnostics.map((d) => d.message)).toEqual(['semantic pass']);
  });

  it('ignores reports for older versions and waits while work-done progress runs', async () => {
    const fake = createFakeServer();
    const session = new ServerSession(fake.server);
    session.sync(content('a.ts', 'v1'));
    const document = session.sync(content('a.ts', 'v2'));
    fake.push('$/progress', { token: 't', value: { kind: 'begin', title: 'Loading' } });
    publish(fake, ['old'], 1);
    later(() => {
      publish(fake, ['new'], 2);
    }, 10);
    later(() => {
      fake.push('$/progress', { token: 't', value: { kind: 'end' } });
    }, 120);
    const started = performance.now();
    const result = unwrap(await session.diagnostics(document, wait));
    expect(performance.now() - started).toBeGreaterThanOrEqual(110);
    expect(result).toMatchObject({ freshness: 'fresh', diagnostics: [{ message: 'new' }] });
  });

  it('assumes an unchanged report when the server stays silent after a re-check', async () => {
    const fake = createFakeServer();
    const session = new ServerSession(fake.server);
    session.sync(content('a.ts', 'x'));
    publish(fake, []);
    const document = session.sync(content('a.ts', 'x'), { recheck: true });
    await expect(session.diagnostics(document, wait)).resolves.toEqual(
      ok({ diagnostics: [], freshness: 'assumed-unchanged' }),
    );
  });

  it('times out when a newly opened document never gets a report', async () => {
    const fake = createFakeServer();
    const session = new ServerSession(fake.server);
    const document = session.sync(content('a.ts', 'x'));
    await expect(
      session.diagnostics(document, {
        ...wait,
        timeout: Temporal.Duration.from({ milliseconds: 60 }),
      }),
    ).resolves.toEqual(ok({ diagnostics: [], freshness: 'timed-out' }));
  });

  it('pulls diagnostics when the server supports it', async () => {
    const fake = createFakeServer({ pullDiagnostics: true }, (method) =>
      method === 'textDocument/diagnostic'
        ? {
            kind: 'full',
            items: [
              {
                range: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } },
                message: 'pulled',
              },
            ],
          }
        : undefined,
    );
    const session = new ServerSession(fake.server);
    const document = session.sync(content('a.ts', 'x'));
    await expect(session.diagnostics(document, wait)).resolves.toMatchObject({
      ok: true,
      value: { freshness: 'fresh', diagnostics: [{ message: 'pulled' }] },
    });
  });

  it('fails a diagnostics wait as soon as the server exits', async () => {
    const fake = createFakeServer();
    const session = new ServerSession(fake.server);
    const document = session.sync(content('a.ts', 'x'));
    later(() => {
      fake.exit({ exitCode: 1, signal: undefined, expected: false });
    }, 10);
    const started = performance.now();
    await expect(session.diagnostics(document, wait)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'server-exited', exitCode: 1 },
    });
    expect(performance.now() - started).toBeLessThan(300);
  });

  it('tracks busy and idle time around requests', async () => {
    const fake = createFakeServer();
    const session = new ServerSession(fake.server);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(session.idle.total('milliseconds')).toBeGreaterThanOrEqual(30);
    const pending = session.request('x', {});
    expect(session.isBusy).toBe(true);
    expect(session.idle.total('milliseconds')).toBe(0);
    await pending;
    expect(session.isBusy).toBe(false);
    expect(session.idle.total('milliseconds')).toBeLessThan(30);
  });
});
