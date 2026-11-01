import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';
import type { TerminalDataEvent, TerminalExitEvent } from '#contract/ipc-contract.ts';

import type { MainServices } from '../../main-services.ts';
import { test as baseTest } from '../../testing/test.ts';
import { createFakePty } from './create-fake-pty.ts';
import type { FakePty } from './create-fake-pty.ts';
import { terminalTemplate } from './terminal-template.ts';

/** A session on `feature` and its head. */
export interface OpenedSession {
  readonly sessionId: string;
  readonly headSha: string;
}

/** Opens a local session from `main` to `feature`. */
export type OpenSession = () => Promise<OpenedSession>;

/** `src/main`'s `test` with terminals over a fake `node-pty` (ADR 0058, 0095). */
export const test = baseTest
  .extend('repo', async ({ repositories }): Promise<TestRepository> => {
    const { repo } = await repositories.fromTemplate(terminalTemplate());
    return repo;
  })
  .extend('fakePty', (): FakePty => createFakePty())
  .extend('terminalData', (): TerminalDataEvent[] => {
    return [];
  })
  .extend('terminalExits', (): TerminalExitEvent[] => {
    return [];
  })
  .extend('services', ({ createServices, fakePty, terminalData, terminalExits }): MainServices => {
    const services = createServices({
      terminal: {
        spawn: fakePty.spawn,
        environment: { SHELL: '/bin/fish', PATH: '/usr/bin', ELECTRON_ENABLE_LOGGING: '1' },
        version: '9.9.9',
        outputDelay: Temporal.Duration.from({ milliseconds: 1 }),
      },
    });
    services.terminal.onData((event) => {
      terminalData.push(event);
    });
    services.terminal.onExit((event) => {
      terminalExits.push(event);
    });
    return services;
  })
  .extend('openSession', ({ services, repo }): OpenSession => {
    return async () => {
      const created = okValueFrom(
        await services.sessions.createLocal({
          repoPath: repo.directory,
          baseRef: 'main',
          headRef: 'feature',
        }),
      );
      return { sessionId: created.id, headSha: created.headSha };
    };
  });
