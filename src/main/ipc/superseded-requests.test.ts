import { describe } from 'vitest';

import { startHoldServer } from '#internal/git/testing/start-hold-server.ts';
import type { HoldServer } from '#internal/git/testing/start-hold-server.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { writeHoldScript } from '#internal/git/testing/write-hold-script.ts';
import type { HoldScript } from '#internal/git/testing/write-hold-script.ts';
import type { AppInfo } from '#contract/ipc-contract.ts';
import type { Closing } from '#testing/test.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import type { MainServices } from '../main-services.ts';
import type { CreateServices } from '../testing/test.ts';
import { test } from '../testing/test.ts';
import { createIpcHandlers } from './create-ipc-handlers.ts';
import type { IpcHandlers } from './create-ipc-handlers.ts';
import { RequestScopes } from './request-scopes.ts';

describe('superseded and cancelled requests (ADR 0079)', () => {
  test('a newer diff load from the window stops the older one’s git and ends it quietly', async ({
    expect,
    repo,
    createServices,
    closing,
    signal,
  }) => {
    const { server, git, handlers, sessionId } = await heldDiffs(
      repo,
      createServices,
      closing,
      signal,
    );
    const older = handlers['session:get-review']({ sessionId }, { webContentsId: 1 });
    const olderDiff = await server.next();
    const newer = handlers['session:get-review']({ sessionId }, { webContentsId: 1 });
    await expect(older).resolves.toStrictEqual({
      ok: false,
      error: { code: 'cancelled', message: 'cancelled' },
    });
    await expect(olderDiff.ended).resolves.toBe('terminated');
    expect(git.terminations()).toHaveLength(1);
    const newerDiff = await server.next();
    newerDiff.release();
    await expect(newer).resolves.toMatchObject({ ok: true, value: { files: [{ path: 'f.txt' }] } });
  });

  test('another window’s load is not superseded, and both share one diff (ADR 0081)', async ({
    expect,
    repo,
    createServices,
    closing,
    signal,
  }) => {
    const { server, git, handlers, sessionId } = await heldDiffs(
      repo,
      createServices,
      closing,
      signal,
    );
    const first = handlers['session:get-review']({ sessionId }, { webContentsId: 1 });
    const diff = await server.next();
    const second = handlers['session:get-review']({ sessionId }, { webContentsId: 2 });
    diff.release();
    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(second).resolves.toMatchObject({ ok: true });
    expect(git.terminations()).toStrictEqual([]);
  });

  test('closing one window leaves the diff another window waits for running', async ({
    expect,
    repo,
    createServices,
    closing,
    signal,
  }) => {
    const { server, git, scopes, handlers, sessionId } = await heldDiffs(
      repo,
      createServices,
      closing,
      signal,
    );
    const waiting = handlers['session:get-review']({ sessionId }, { webContentsId: 1 });
    const diff = await server.next();
    const closed = handlers['session:get-review']({ sessionId }, { webContentsId: 2 });
    scopes.closeWindow(2);
    await expect(closed).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(git.terminations()).toStrictEqual([]);
    diff.release();
    await expect(waiting).resolves.toMatchObject({
      ok: true,
      value: { files: [{ path: 'f.txt' }] },
    });
    await expect(diff.ended).resolves.toBe('closed');
  });

  test('closing the window stops its loads', async ({
    expect,
    repo,
    createServices,
    closing,
    signal,
  }) => {
    const { server, scopes, handlers, sessionId } = await heldDiffs(
      repo,
      createServices,
      closing,
      signal,
    );
    const loading = handlers['session:get-review']({ sessionId }, { webContentsId: 1 });
    const diff = await server.next();
    scopes.closeWindow(1);
    await expect(loading).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } });
    await expect(diff.ended).resolves.toBe('terminated');
  });
});

interface HeldDiffs {
  readonly server: HoldServer;
  readonly git: HoldScript;
  readonly scopes: RequestScopes;
  readonly handlers: IpcHandlers;
  readonly services: MainServices;
  readonly sessionId: string;
}

/** A local session whose `git diff` waits for the test, behind IPC handlers with their own scopes. */
async function heldDiffs(
  repo: TestRepository,
  createServices: CreateServices,
  closing: Closing,
  signal: AbortSignal,
): Promise<HeldDiffs> {
  repo.write('f.txt', '1\n');
  await repo.commit('base');
  await repo.git('switch', '--quiet', '-c', 'feature');
  repo.write('f.txt', '2\n');
  await repo.commit('change');
  const server = closing(await startHoldServer(signal));
  const git = writeHoldScript({ directory: repo.scratch(), name: 'git' }, server.port, {
    kind: 'git',
    holds: [['diff', '--no-color']],
  });
  const services = createServices({ git: { gitBinary: git.command } });
  const scopes = new RequestScopes();
  const handlers = createIpcHandlers(services, appInfo(), {}, scopes);
  const created = okValueFrom(
    await services.sessions.createLocal({
      repoPath: repo.directory,
      baseRef: 'main',
      headRef: 'feature',
    }),
  );
  return { server, git, scopes, handlers, services, sessionId: created.id };
}

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
