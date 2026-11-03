import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { LspError } from './lsp-error.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';
import { ServerSession } from './server-session.ts';
import type { DocumentContent, ServerSessionOptions } from './server-session.ts';
import type { LanguageServer, ServerExit } from './start-language-server.ts';

interface FakeServer {
  readonly server: LanguageServer;
  readonly notifications: { method: string; params: unknown }[];
}

function createFakeServer(): FakeServer {
  const notifications: { method: string; params: unknown }[] = [];
  const server: LanguageServer = {
    serverId: 'fake',
    root: '/workspace' as WorkspaceRoot,
    pid: undefined,
    capabilities: {
      positionEncoding: 'utf-16',
      callHierarchy: false,
      definition: false,
      typeDefinition: false,
      references: false,
      hover: false,
      documentSymbol: false,
      raw: {},
    },
    request: async (): Promise<Result<unknown, LspError>> => {
      await Promise.resolve();
      return ok(undefined);
    },
    notify: (method, params): void => {
      notifications.push({ method, params });
    },
    setNotificationListener: (): void => {
      // The session does not listen for notifications.
    },
    exited: new Promise<ServerExit>(() => {
      // The fake server never exits.
    }),
    shutdown: async (): Promise<void> => {
      await Promise.resolve();
    },
  };
  return { server, notifications };
}

/** At least 30 ms: the test waits 40. */
function hasIdledAWhile(duration: Temporal.Duration): boolean {
  return Temporal.Duration.compare(duration, Temporal.Duration.from({ milliseconds: 30 })) >= 0;
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
    session.close('file:///workspace/a.ts');
    expect(fake.notifications.map((n) => n.method)).toStrictEqual([
      'textDocument/didOpen',
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

  test('tracks busy and idle time around requests', async ({ expect, signal }) => {
    const fake = createFakeServer();
    const session = new ServerSession(fake.server);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(hasIdledAWhile(session.idle)).toBe(true);
    const pending = session.request('x', {}, { signal });
    expect(session.isBusy).toBe(true);
    expect(session.idle.sign).toBe(0);
    await pending;
    expect(session.isBusy).toBe(false);
    expect(hasIdledAWhile(session.idle)).toBe(false);
  });
});
