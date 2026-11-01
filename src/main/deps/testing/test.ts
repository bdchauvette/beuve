import type { DependencyStatusView } from '#contract/ipc-contract.ts';
import type { FakeTool } from '#internal/deps/testing/write-fake-tool.ts';
import { writeFakeTool } from '#internal/deps/testing/write-fake-tool.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import type { MainServices } from '../../main-services.ts';
import { test as baseTest } from '../../testing/test.ts';
import { waitUntil } from '../../testing/wait-until.ts';
import { dependencyTemplate } from './dependency-template.ts';
import { fakeToolchains } from './fake-toolchains.ts';

/** Opens a local session from `main` to `branch` and answers its id. */
export type OpenSession = (branch: string) => Promise<string>;

/** Waits until the session's last published status is `state`, and answers it. */
export type SettledStatus = (
  sessionId: string,
  state: DependencyStatusView['state'],
) => Promise<DependencyStatusView>;

/** The branches of {@link dependencyTemplate}. */
export type DependencyBranch =
  'feature' | 'lock-change' | 'bun' | 'configured' | 'bad-config' | 'hanging';

/**
 * `src/main`'s `test` with dependency installs over fake package managers (ADR 0058, 0089):
 *
 * - `repo`: {@link dependencyTemplate}.
 * - `fakeNpm`: a fake `npm` that creates `node_modules/.installed`; `fakeHang` one that hangs.
 * - `services`: main services whose toolchains find `npm` (the fake), `hang` and nothing else,
 *   with a 200 ms kill grace.
 * - `depsEvents`: every `deps:status` event; `openSession`, `settledStatus`.
 */
export const test = baseTest
  .extend('repo', async ({ repositories }): Promise<TestRepository> => {
    const { repo } = await repositories.fromTemplate(dependencyTemplate());
    return repo;
  })
  .extend('fakeNpm', ({ tempDir }): FakeTool => {
    return writeFakeTool(
      { directory: tempDir, name: 'npm' },
      { creates: ['node_modules/.installed'], prints: 'added 1 package\n' },
    );
  })
  .extend('fakeHang', ({ tempDir }): FakeTool => {
    return writeFakeTool({ directory: tempDir, name: 'hang' }, { hangs: true });
  })
  .extend('depsEvents', (): DependencyStatusView[] => {
    return [];
  })
  .extend('services', ({ createServices, fakeNpm, fakeHang, depsEvents }): MainServices => {
    const services = createServices({
      installs: {
        toolchains: fakeToolchains(
          new Map([
            ['npm', fakeNpm.command],
            ['hang', fakeHang.command],
          ]),
        ),
        killGrace: Temporal.Duration.from({ milliseconds: 200 }),
      },
    });
    services.deps.onStatus((event) => {
      depsEvents.push(event);
    });
    return services;
  })
  .extend('openSession', ({ services, repo }): OpenSession => {
    return async (branch): Promise<string> => {
      const created = await services.sessions.createLocal({
        repoPath: repo.directory,
        baseRef: 'main',
        headRef: branch,
      });
      return okValueFrom(created).id;
    };
  })
  .extend('settledStatus', ({ depsEvents }): SettledStatus => {
    return async (sessionId, state): Promise<DependencyStatusView> => {
      const last = (): DependencyStatusView | undefined => {
        return depsEvents.findLast((event) => event.sessionId === sessionId);
      };
      await waitUntil(() => {
        return last()?.state === state;
      }, `deps ${state}`);
      const settled = last();
      if (settled === undefined) {
        throw new Error('no status');
      }
      return settled;
    };
  });
