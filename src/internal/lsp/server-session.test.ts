import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

import type { LspError } from './lsp-error.ts';
import type { LspServerCapabilities } from './lsp-protocol.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';
import { ServerSession } from './server-session.ts';
import type { DiagnosticsWait, DocumentContent, ServerSessionOptions } from './server-session.ts';
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
      typeDefinition: false,
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

function wait(): DiagnosticsWait {
  return {
    timeout: Temporal.Duration.from({ milliseconds: 400 }),
    grace: Temporal.Duration.from({ milliseconds: 80 }),
    quiet: Temporal.Duration.from({ milliseconds: 30 }),
  };
}

function isAtLeast(duration: Temporal.Duration, milliseconds: number): boolean {
  return Temporal.Duration.compare(duration, Temporal.Duration.from({ milliseconds })) >= 0;
}

/** A document at `/workspace/<name>`. */
interface TestDocument {
  readonly name: string;
  readonly text: string;
}

function content({ name, text }: TestDocument): DocumentContent {
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
    diagnostics: messages.map((message) => {
      return {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        message,
      };
    }),
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
  test('opens, changes and closes documents with increasing versions', ({ expect }) => {
    const fake = createFakeServer();
    const session = new ServerSession(fake.server);
    expect(session.sync(content({ name: 'a.ts', text: 'one' }))).toMatchObject({
      version: 1,
      changed: true,
    });
    expect(session.sync(content({ name: 'a.ts', text: 'one' }))).toMatchObject({
      version: 1,
      changed: false,
    });
    expect(session.sync(content({ name: 'a.ts', text: 'two' }))).toMatchObject({
      version: 2,
      changed: true,
    });
    expect(session.sync(content({ name: 'a.ts', text: 'two' }), { recheck: true })).toMatchObject({
      version: 3,
      changed: true,
    });
    session.close('file:///workspace/a.ts');
    expect(fake.notifications.map((n) => n.method)).toStrictEqual([
      'textDocument/didOpen',
      'textDocument/didChange',
      'textDocument/didChange',
      'textDocument/didClose',
    ]);
    expect(fake.notifications[1]?.params).toStrictEqual({
      textDocument: { uri: 'file:///workspace/a.ts', version: 2 },
      contentChanges: [{ text: 'two' }],
    });
  });

  test('closes the least recently used document beyond the limit', ({ expect }) => {
    const fake = createFakeServer();
    const options: ServerSessionOptions = { maxOpenDocuments: 2 };
    const session = new ServerSession(fake.server, options);
    session.sync(content({ name: 'a.ts', text: 'a' }));
    session.sync(content({ name: 'b.ts', text: 'b' }));
    session.sync(content({ name: 'a.ts', text: 'a' }));
    session.sync(content({ name: 'c.ts', text: 'c' }));
    expect(session.openDocuments.map((document) => document.absolutePath)).toStrictEqual([
      '/workspace/a.ts',
      '/workspace/c.ts',
    ]);
    expect(fake.notifications.at(-1)).toStrictEqual({
      method: 'textDocument/didClose',
      params: { textDocument: { uri: 'file:///workspace/b.ts' } },
    });
  });

  test('settles on the first report after a change once the server is quiet', async ({
    expect,
  }) => {
    const fake = createFakeServer();
    const session = new ServerSession(fake.server);
    const document = session.sync(content({ name: 'a.ts', text: 'x' }));
    later(() => {
      publish(fake, ['syntax pass']);
    }, 5);
    later(() => {
      publish(fake, ['semantic pass']);
    }, 20);
    const result = unwrap(await session.diagnostics(document, wait()));
    expect(result.freshness).toBe('fresh');
    expect(result.diagnostics.map((d) => d.message)).toStrictEqual(['semantic pass']);
  });

  test('ignores reports for older versions and waits while work-done progress runs', async ({
    expect,
  }) => {
    const fake = createFakeServer();
    const session = new ServerSession(fake.server);
    session.sync(content({ name: 'a.ts', text: 'v1' }));
    const document = session.sync(content({ name: 'a.ts', text: 'v2' }));
    fake.push('$/progress', { token: 't', value: { kind: 'begin', title: 'Loading' } });
    publish(fake, ['old'], 1);
    later(() => {
      publish(fake, ['new'], 2);
    }, 10);
    later(() => {
      fake.push('$/progress', { token: 't', value: { kind: 'end' } });
    }, 120);
    const waited = new Stopwatch();
    const result = unwrap(await session.diagnostics(document, wait()));
    expect(isAtLeast(waited.elapsed(), 110)).toBe(true);
    expect(result).toMatchObject({ freshness: 'fresh', diagnostics: [{ message: 'new' }] });
  });

  test('assumes an unchanged report when the server stays silent after a re-check', async ({
    expect,
  }) => {
    const fake = createFakeServer();
    const session = new ServerSession(fake.server);
    session.sync(content({ name: 'a.ts', text: 'x' }));
    publish(fake, []);
    const document = session.sync(content({ name: 'a.ts', text: 'x' }), { recheck: true });
    await expect(session.diagnostics(document, wait())).resolves.toStrictEqual(
      ok({ diagnostics: [], freshness: 'assumed-unchanged' }),
    );
  });

  test('times out when a newly opened document never gets a report', async ({ expect }) => {
    const fake = createFakeServer();
    const session = new ServerSession(fake.server);
    const document = session.sync(content({ name: 'a.ts', text: 'x' }));
    await expect(
      session.diagnostics(document, {
        ...wait(),
        timeout: Temporal.Duration.from({ milliseconds: 60 }),
      }),
    ).resolves.toStrictEqual(ok({ diagnostics: [], freshness: 'timed-out' }));
  });

  test('pulls diagnostics when the server supports it', async ({ expect }) => {
    const fake = createFakeServer({ pullDiagnostics: true }, (method) => {
      if (method === 'textDocument/diagnostic') {
        return {
          kind: 'full',
          items: [
            {
              range: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } },
              message: 'pulled',
            },
          ],
        };
      }
      return;
    });
    const session = new ServerSession(fake.server);
    const document = session.sync(content({ name: 'a.ts', text: 'x' }));
    await expect(session.diagnostics(document, wait())).resolves.toMatchObject({
      ok: true,
      value: { freshness: 'fresh', diagnostics: [{ message: 'pulled' }] },
    });
  });

  test('fails a diagnostics wait as soon as the server exits', async ({ expect }) => {
    const fake = createFakeServer();
    const session = new ServerSession(fake.server);
    const document = session.sync(content({ name: 'a.ts', text: 'x' }));
    later(() => {
      fake.exit({ exitCode: 1, signal: undefined, expected: false });
    }, 10);
    const waited = new Stopwatch();
    await expect(session.diagnostics(document, wait())).resolves.toMatchObject({
      ok: false,
      error: { kind: 'server-exited', exitCode: 1 },
    });
    expect(isAtLeast(waited.elapsed(), 300)).toBe(false);
  });

  test('tracks busy and idle time around requests', async ({ expect, signal }) => {
    const fake = createFakeServer();
    const session = new ServerSession(fake.server);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(isAtLeast(session.idle, 30)).toBe(true);
    const pending = session.request('x', {}, { signal });
    expect(session.isBusy).toBe(true);
    expect(session.idle.sign).toBe(0);
    await pending;
    expect(session.isBusy).toBe(false);
    expect(isAtLeast(session.idle, 30)).toBe(false);
  });
});
