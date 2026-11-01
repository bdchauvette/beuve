import { existsSync, readFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import type { DependencyStatusView } from '#contract/ipc-contract.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';
import { err } from '#x/result/err.ts';

import { waitUntil } from '../testing/wait-until.ts';
import { fakeToolchains } from './testing/fake-toolchains.ts';
import { test } from './testing/test.ts';

describe('createDependencyServices (integration: git + fake package managers)', () => {
  test('an untrusted repository installs nothing until it is trusted', async ({
    expect,
    signal,
    services,
    openSession,
    fakeNpm,
    settledStatus,
    repo,
  }) => {
    const sessionId = await openSession('feature');
    const before = okValueFrom(await services.deps.status({ sessionId }));
    expect(before).toMatchObject({ state: 'untrusted', repositoryPath: repo.directory });
    okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));
    expect(fakeNpm.calls()).toStrictEqual([]);

    okValueFrom(await services.trust.set({ sessionId, trusted: true }));
    const done = await settledStatus(sessionId, 'done');
    expect(done).toMatchObject({ tools: [{ tool: 'npm', version: '9.9.9' }], hasLog: true });
    const [call] = fakeNpm.calls();
    const checkout = await realpath(call?.cwd ?? '');
    expect(call?.argv.slice(0, 1)).toStrictEqual(['ci']);
    expect(call?.argv).toContain('--cache');
    expect(checkout.startsWith(repo.directory)).toBe(false);
    expect(existsSync(path.join(checkout, 'node_modules/.installed'))).toBe(true);
    expect(call?.env).toMatchObject({
      BEUVE_HEAD_SHA: done.headSha,
      BEUVE_SESSION_ID: sessionId,
      CI: 'true',
      MISE_FAKE: '1',
    });
    expect(call?.env['COREPACK_HOME']).toMatch(/deps[/\\]corepack$/u);
    await expect(repo.git('status', '--porcelain')).resolves.toBe('');
    const log = okValueFrom(await services.deps.readLog({ sessionId }));
    expect(log.text).toContain('added 1 package');
    expect(log.text).toContain('Installed in');
  });

  test('a session opening on a trusted repository installs once per checkout, shared', async ({
    expect,
    signal,
    services,
    openSession,
    fakeNpm,
    settledStatus,
  }) => {
    const first = await openSession('feature');
    okValueFrom(await services.trust.set({ sessionId: first, trusted: true }));
    await settledStatus(first, 'done');
    const second = await openSession('feature');
    okValueFrom(await services.sessions.getReview({ sessionId: second }, { signal }));
    await expect(services.deps.status({ sessionId: second })).resolves.toMatchObject({
      ok: true,
      value: { state: 'done' },
    });
    expect(fakeNpm.calls().filter((call) => call.argv[0] === 'ci')).toHaveLength(1);
  });

  test('the safeguard asks once per head when the range changes the lockfile', async ({
    expect,
    services,
    openSession,
    fakeNpm,
    settledStatus,
  }) => {
    const sessionId = await openSession('lock-change');
    okValueFrom(await services.trust.set({ sessionId, trusted: true }));
    const asked = await settledStatus(sessionId, 'needs-approval');
    expect(asked.inputs).toStrictEqual(['package-lock.json']);
    expect(fakeNpm.calls()).toStrictEqual([]);

    okValueFrom(
      await services.deps.install({ sessionId, expectedHeadSha: asked.headSha, reinstall: false }),
    );
    await settledStatus(sessionId, 'done');
    expect(fakeNpm.calls()).toHaveLength(1);
  });

  test('Skip leaves the checkout uninstalled for that head, with a clear status', async ({
    expect,
    signal,
    services,
    openSession,
    fakeNpm,
    settledStatus,
  }) => {
    const sessionId = await openSession('lock-change');
    okValueFrom(await services.trust.set({ sessionId, trusted: true }));
    const asked = await settledStatus(sessionId, 'needs-approval');
    await expect(
      services.deps.skip({ sessionId, expectedHeadSha: 'f'.repeat(40) }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'stale-review' } });
    await expect(
      services.deps.skip({ sessionId, expectedHeadSha: asked.headSha }),
    ).resolves.toMatchObject({
      ok: true,
      value: { state: 'declined', inputs: ['package-lock.json'] },
    });
    await services.sessions.getReview({ sessionId }, { signal });
    await expect(services.deps.status({ sessionId })).resolves.toMatchObject({
      value: { state: 'declined' },
    });
    expect(fakeNpm.calls()).toStrictEqual([]);
  });

  test('turning the safeguard off for the repository installs without asking', async ({
    expect,
    services,
    openSession,
    repo,
    settledStatus,
  }) => {
    const sessionId = await openSession('lock-change');
    okValueFrom(await services.trust.set({ sessionId, trusted: false }));
    okValueFrom(
      await services.deps.setRepositorySettings({
        repositoryPath: repo.directory,
        safeguard: false,
        override: '',
      }),
    );
    okValueFrom(await services.trust.set({ sessionId, trusted: true }));
    await expect(settledStatus(sessionId, 'done')).resolves.toMatchObject({ inputs: [] });
  });

  test('a missing tool fails clearly, naming it and how to get it', async ({
    expect,
    services,
    openSession,
    settledStatus,
    repo,
  }) => {
    const sessionId = await openSession('bun');
    okValueFrom(
      await services.deps.setRepositorySettings({
        repositoryPath: repo.directory,
        safeguard: false,
        override: '',
      }),
    );
    okValueFrom(await services.trust.set({ sessionId, trusted: true }));
    const failed = await settledStatus(sessionId, 'failed');
    expect(failed.detail).toContain('bun not found (for bun).');
    expect(failed.detail).toContain('https://bun.sh');
  });

  test('runs .beuve steps after the detected install, then the hook with its variables', async ({
    expect,
    services,
    openSession,
    fakeNpm,
    settledStatus,
  }) => {
    const sessionId = await openSession('configured');
    okValueFrom(await services.trust.set({ sessionId, trusted: true }));
    const asked = await settledStatus(sessionId, 'needs-approval');
    expect(asked.inputs).toStrictEqual(['.beuve/config.json', '.beuve/hooks/install']);
    okValueFrom(
      await services.deps.install({ sessionId, expectedHeadSha: asked.headSha, reinstall: false }),
    );
    await settledStatus(sessionId, 'done');
    const calls = fakeNpm.calls();
    expect(calls.map((call) => call.argv[0])).toStrictEqual(['ci', 'run']);
    const checkout = await realpath(calls[0]?.cwd ?? '');
    await expect(realpath(calls[1]?.cwd ?? '')).resolves.toBe(path.join(checkout, 'src'));
    expect(readFileSync(path.join(checkout, 'hook-ran'), 'utf8').trim()).toBe(
      `${asked.headSha} ${sessionId} ${calls[0]?.cwd ?? ''}`,
    );
  });

  test('the Settings override wins over .beuve/config.json, and must parse', async ({
    expect,
    services,
    openSession,
    fakeNpm,
    repo,
    settledStatus,
  }) => {
    await expect(
      services.deps.setRepositorySettings({
        repositoryPath: repo.directory,
        safeguard: false,
        override: '{"install": {"steps": [{"run": "npm"}]}}',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid-request',
        message: expect.stringContaining('install.steps.0.run') as unknown,
      },
    });
    okValueFrom(
      await services.deps.setRepositorySettings({
        repositoryPath: repo.directory,
        safeguard: false,
        override: JSON.stringify({ install: { hook: 'instead', steps: [{ run: ['npm', 'x'] }] } }),
      }),
    );
    const sessionId = await openSession('configured');
    okValueFrom(await services.trust.set({ sessionId, trusted: true }));
    await settledStatus(sessionId, 'done');
    expect(fakeNpm.calls().map((call) => call.argv)).toStrictEqual([['x']]);
  });

  test('an invalid .beuve/config.json fails the install with the field it names', async ({
    expect,
    services,
    openSession,
    repo,
    settledStatus,
  }) => {
    okValueFrom(
      await services.deps.setRepositorySettings({
        repositoryPath: repo.directory,
        safeguard: false,
        override: '',
      }),
    );
    const sessionId = await openSession('bad-config');
    okValueFrom(await services.trust.set({ sessionId, trusted: true }));
    const failed = await settledStatus(sessionId, 'failed');
    expect(failed.detail).toContain('.beuve/config.json: install.steps.0.run');
  });

  test('Cancel stops an install in flight, its process group included', async ({
    expect,
    services,
    openSession,
    fakeHang,
    repo,
    settledStatus,
  }) => {
    okValueFrom(
      await services.deps.setRepositorySettings({
        repositoryPath: repo.directory,
        safeguard: false,
        override: '',
      }),
    );
    const sessionId = await openSession('hanging');
    okValueFrom(await services.trust.set({ sessionId, trusted: true }));
    await settledStatus(sessionId, 'running');
    await waitUntil(() => {
      return fakeHang.grandchildren().length > 0;
    }, 'the hanging step');
    await expect(services.deps.cancel({ sessionId })).resolves.toMatchObject({
      ok: true,
      value: { state: 'failed', detail: 'Cancelled.' },
    });
    const log = okValueFrom(await services.deps.readLog({ sessionId }));
    expect(log.text).toContain('waiting');
    expect(log.text).toContain('Cancelled.');
  });

  test('a trace probe takes packages from the installed checkout, else from the clone', async ({
    expect,
    createServices,
    openSession,
    fakeNpm,
    repo,
    signal,
  }) => {
    const roots: string[] = [];
    const services = createServices({
      installs: { toolchains: fakeToolchains(new Map([['npm', fakeNpm.command]])) },
      trace: {
        runner: {
          run: async (request) => {
            await Promise.resolve();
            roots.push(request.dependencyRoot);
            return err({ kind: 'cancelled' });
          },
        },
      },
    });
    const statuses: DependencyStatusView[] = [];
    services.deps.onStatus((event) => {
      statuses.push(event);
    });
    const probe = async (sessionId: string): Promise<string> => {
      const before = roots.length;
      okValueFrom(await services.trace.run({ sessionId, path: 'src/a.ts', line: 2 }));
      await waitUntil(() => {
        return roots.length > before;
      }, 'the probe');
      return realpath(roots.at(-1) ?? '');
    };
    const waiting = await openSession('lock-change');
    okValueFrom(await services.trust.set({ sessionId: waiting, trusted: true }));
    await waitUntil(() => {
      return statuses.at(-1)?.state === 'needs-approval';
    }, 'the safeguard');
    await expect(probe(waiting)).resolves.toBe(repo.directory);

    const installed = await openSession('feature');
    okValueFrom(await services.sessions.getReview({ sessionId: installed }, { signal }));
    await waitUntil(() => {
      return statuses.at(-1)?.sessionId === installed && statuses.at(-1)?.state === 'done';
    }, 'the install');
    const checkout = await realpath(fakeNpm.calls()[0]?.cwd ?? '');
    await expect(probe(installed)).resolves.toBe(checkout);
  });
});
