import type { SetupFinishedEvent } from '#contract/ipc-contract.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';

import { test as terminalTest } from '../../terminal/testing/test.ts';
import { setupTemplate } from './setup-template.ts';

/**
 * The terminal fixtures (a fake `node-pty`, ADR 0095) over a Node repository with a GitHub
 * `origin`, and `setupFinished`: every `setup:finished` the services emit (ADR 0130).
 */
export const test = terminalTest
  .extend('repo', async ({ repositories }): Promise<TestRepository> => {
    const { repo } = await repositories.fromTemplate(setupTemplate());
    return repo;
  })
  .extend('setupFinished', ({ services }): SetupFinishedEvent[] => {
    const events: SetupFinishedEvent[] = [];
    services.setup.onFinished((event) => {
      events.push(event);
    });
    return events;
  });
