import { test as baseTest } from '#testing/test.ts';

import { createFakeGithub } from './create-fake-github.ts';
import { createFakeGithubApi } from './create-fake-github-api.ts';

/**
 * `#testing/test.ts` with the GitHub fakes (ADR 0058), both in process and never on the network:
 * `fakeGithub` is {@link createFakeGithub} (a client over a scripted `fetch`), `fakeGithubApi` is
 * {@link createFakeGithubApi} (a stateful fake of the REST API).
 */
export const test = baseTest
  .extend('fakeGithub', () => createFakeGithub)
  .extend('fakeGithubApi', () => createFakeGithubApi);
