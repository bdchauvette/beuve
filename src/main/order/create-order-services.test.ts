import { describe } from 'vitest';

import type { CallHierarchyCallView, IpcResult } from '#contract/ipc-contract.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { createSyntaxParser } from '#internal/syntax/create-syntax-parser.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import type { MainServices } from '../main-services.ts';
import { lines } from '../testing/lines.ts';
import { createGitCaches } from '../sessions/create-git-caches.ts';
import { test } from '../testing/test.ts';

import { createOrderServices } from './create-order-services.ts';
import type { OrderServices, OrderServicesOptions } from './create-order-services.ts';

describe('session:get-order (integration: git + tree-sitter)', { timeout: 30_000 }, () => {
  test('orders by path, with config and mechanical files in a group at the end', async ({
    expect,
    services,
    repo,
    signal,
  }) => {
    const sessionId = await startReview(repo, services);
    const order = okValueFrom(
      await services.order.getOrder({ sessionId, mode: 'path' }, { signal }),
    );
    expect(order).toMatchObject({ requestedMode: 'path', mode: 'path' });
    expect(order.fallback).toBeUndefined();
    expect(order.groups).toStrictEqual([
      {
        id: 'changes',
        label: 'Changes',
        paths: [
          'docs/readme.md',
          'src/app.ts',
          'src/lib/util.ts',
          'src/shared.ts',
          'src/x/helper.ts',
        ],
      },
      {
        id: 'config-and-mechanical',
        label: 'Config and mechanical',
        paths: ['package.json', 'src/fmt.ts', 'package-lock.json'],
        reasons: ['config', 'formatting-only', 'lockfile'],
      },
    ]);
    expect(order.paths).toStrictEqual(order.groups.flatMap((group) => group.paths));
  });

  test('puts changed dependencies before their dependents, resolving relative and #alias imports', async ({
    expect,
    services,
    repo,
    signal,
  }) => {
    const sessionId = await startReview(repo, services);
    const order = okValueFrom(
      await services.order.getOrder({ sessionId, mode: 'imports' }, { signal }),
    );
    expect(order.mode).toBe('imports');
    expect(order.groups[0]).toStrictEqual({
      id: 'changes',
      label: 'Changes, dependencies first',
      paths: [
        'docs/readme.md',
        'src/shared.ts',
        'src/lib/util.ts',
        'src/x/helper.ts',
        'src/app.ts',
      ],
    });
    expect(order.groups[1]?.paths).toStrictEqual([
      'package.json',
      'src/fmt.ts',
      'package-lock.json',
    ]);
  });

  test('uses the saved mode when the request has none', async ({
    expect,
    services,
    repo,
    signal,
  }) => {
    const sessionId = await startReview(repo, services);
    await services.display.set({ reviewOrder: 'imports' });
    expect(okValueFrom(await services.order.getOrder({ sessionId }, { signal }))).toMatchObject({
      requestedMode: 'imports',
      mode: 'imports',
    });
  });

  test('uses the language server for calls, and says when it falls back to imports', async ({
    expect,
    services,
    repo,
    db,
    deps,
    logger,
    signal,
  }) => {
    const sessionId = await startReview(repo, services);
    const queried: string[] = [];
    const orderWith = (callHierarchy: OrderServicesOptions['callHierarchy']): OrderServices =>
      createOrderServices({
        context: {
          db,
          deps,
          logger: logger.logger,
          git: { logger: logger.logger },
          caches: createGitCaches(),
        },
        parse: createSyntaxParser().parse,
        callHierarchy,
        getFileAttributes: services.files.getFileAttributes,
        defaultMode: async () => later('path'),
      });

    const answering = orderWith(async (request) => {
      queried.push(`${request.path}:${String(request.line)}`);
      return later(
        okCalls(request.path === 'src/shared.ts' ? [workspaceCall('src/x/helper.ts')] : []),
      );
    });
    const calls = okValueFrom(await answering.getOrder({ sessionId, mode: 'calls' }, { signal }));
    expect(calls).toMatchObject({ requestedMode: 'calls', mode: 'calls' });
    expect(calls.fallback).toBeUndefined();
    expect(calls.groups[0]?.paths).toStrictEqual([
      'docs/readme.md',
      'src/app.ts',
      'src/lib/util.ts',
      'src/x/helper.ts',
      'src/shared.ts',
    ]);
    expect(queried).toContain('src/shared.ts:1');

    const noServer = orderWith(async () =>
      later({
        ok: false,
        error: { code: 'unsupported', message: 'no language server for this file' },
      }),
    );
    const fallen = okValueFrom(await noServer.getOrder({ sessionId, mode: 'calls' }, { signal }));
    expect(fallen).toMatchObject({
      requestedMode: 'calls',
      mode: 'imports',
      fallback: { kind: 'no-language-server' },
    });
    expect(fallen.paths.indexOf('src/shared.ts')).toBeLessThan(fallen.paths.indexOf('src/app.ts'));

    const quiet = orderWith(async () => later(okCalls([])));
    expect(
      okValueFrom(await quiet.getOrder({ sessionId, mode: 'calls' }, { signal })),
    ).toMatchObject({
      mode: 'imports',
      fallback: { kind: 'no-call-edges' },
    });
  });

  test('falls back to path order when no changed file has imports to read', async ({
    expect,
    services,
    repo,
    signal,
  }) => {
    repo.write('base.md', lines(['base']));
    await repo.commit('base');
    await repo.git('switch', '--quiet', '--create', 'feature');
    repo.write('b.md', lines(['b']));
    repo.write('a.md', lines(['a']));
    await repo.commit('docs');
    await repo.git('switch', '--quiet', 'main');
    const created = okValueFrom(
      await services.sessions.createLocal({
        repoPath: repo.directory,
        baseRef: 'main',
        headRef: 'feature',
      }),
    );
    const order = okValueFrom(
      await services.order.getOrder({ sessionId: created.id, mode: 'imports' }, { signal }),
    );
    expect(order).toMatchObject({ mode: 'path', fallback: { kind: 'no-source-files' } });
    expect(order.paths).toStrictEqual(['a.md', 'b.md']);
  });

  test('refuses an unknown session', async ({ expect, services, signal }) => {
    await expect(
      services.order.getOrder({ sessionId: '00000000-0000-4000-8000-0000000000ff' }, { signal }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
  });
});

async function later<T>(value: T): Promise<T> {
  await Promise.resolve();
  return value;
}

function okCalls(calls: readonly CallHierarchyCallView[]): IpcResult<{
  readonly direction: 'outgoing';
  readonly calls: readonly CallHierarchyCallView[];
}> {
  return { ok: true, value: { direction: 'outgoing', calls } };
}

function workspaceCall(path: string): CallHierarchyCallView {
  return {
    node: {
      id: path,
      name: 'f',
      kind: 'function',
      file: { kind: 'workspace', path },
      startLine: 1,
      endLine: 2,
      selectionLine: 1,
      badge: 'modified',
    },
    callSiteLines: [1],
  };
}

/**
 * main: package.json, src/fmt.ts. feature: app imports util (relative) and helper (#x alias);
 * util imports shared; config, lockfile and a re-indented file ride along. Returns the session id.
 */
async function startReview(repo: TestRepository, services: MainServices): Promise<string> {
  repo.write('package.json', lines(['{}']));
  repo.write('src/fmt.ts', lines(['export function f() {', '  return 1;', '}']));
  await repo.commit('base');
  await repo.git('switch', '--quiet', '--create', 'feature');
  repo.write('package.json', lines(['{ "imports": { "#x/*": "./src/x/*" } }']));
  repo.write('package-lock.json', lines(['{}']));
  repo.write('src/fmt.ts', lines(['export function f() {', '    return 1;', '}']));
  repo.write('docs/readme.md', lines(['# notes']));
  repo.write(
    'src/app.ts',
    lines([
      "import { util } from './lib/util.ts';",
      "import { helper } from '#x/helper.ts';",
      'util(helper());',
    ]),
  );
  repo.write(
    'src/lib/util.ts',
    lines([
      "import { shared } from '../shared.ts';",
      'export function util(x: number) { return shared(x); }',
    ]),
  );
  repo.write('src/shared.ts', lines(['export function shared(x: number) { return x; }']));
  repo.write('src/x/helper.ts', lines(['export function helper() { return 1; }']));
  await repo.commit('feature');
  await repo.git('switch', '--quiet', 'main');
  const created = okValueFrom(
    await services.sessions.createLocal({
      repoPath: repo.directory,
      baseRef: 'main',
      headRef: 'feature',
    }),
  );
  return created.id;
}
