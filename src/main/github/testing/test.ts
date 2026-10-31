import { writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import type {
  CiStatusChangedView,
  OpenPullRequestResponse,
  PullRequestUpdatedView,
} from '#contract/ipc-contract.ts';
import { createGhCliCredentialProvider } from '#internal/auth/create-gh-cli-credential-provider.ts';
import type { FakeGhScenario } from '#internal/auth/testing/write-fake-gh.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { createFakeGithubApi } from '#internal/github/testing/create-fake-github-api.ts';
import type { FakeGithubApi } from '#internal/github/testing/create-fake-github-api.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import type { MainServices } from '../../main-services.ts';
import { test as baseTest } from '../../testing/test.ts';
import type { ScriptedClaude } from '../../testing/create-scripted-claude.ts';
import { pullRequestTemplate } from './pull-request-template.ts';

const remoteUrl = 'https://github.com/octo-org/hello-world.git';

/** Everything around the pull request under review: the repositories, the fakes and the files. */
export interface GithubWorld {
  /** The author's repository, with `feature` checked out. */
  readonly upstream: TestRepository;
  /** The reviewer's clone: empty, with `origin` redirected to {@link bare}. */
  readonly clone: TestRepository;
  /** The bare remote `origin` resolves to, holding `main` and `refs/pull/7/head`. */
  readonly bare: string;
  readonly baseSha: string;
  readonly firstHead: string;
  /** The fake REST API serving pull request 7. */
  readonly api: FakeGithubApi;
  /** The token the fake `gh` hands out. */
  readonly token: string;
  /** The fake `gh` scenario file, and the file it logs its calls to. */
  readonly scenarioFile: string;
  readonly callsFile: string;
  /** Rewrites the fake `gh` scenario. */
  readonly writeScenario: (scenario: FakeGhScenario) => void;
  /** The fake `claude` answering chat questions. */
  readonly claude: ScriptedClaude;
}

/** Opens pull request 7 into `repoPath`, or wherever the clone was remembered. */
export type OpenPull = (repoPath?: string) => Promise<OpenPullRequestResponse>;

/** Services that read the world's fakes, for tests that restart the app. */
export type RecreateServices = (previous: MainServices) => MainServices;

/**
 * `src/main`'s `test` for GitHub pull request sessions (ADR 0058), all local: `world` is
 * {@link GithubWorld}, `services` use its fake API, fake `gh` and fake `claude` with scheduled
 * polling off, `updates` and `ciEvents` record what they publish, `openPull` opens the pull
 * request, `opened` opens it into the clone and returns the session id and `recreate` builds
 * fresh services over the same database.
 */
export const test = baseTest
  .extend('world', async ({ repositories, tempDir, fakeClaude }): Promise<GithubWorld> => {
    const { repo: upstream, value } = await repositories.fromTemplate(pullRequestTemplate());
    const { baseSha, firstHead } = value;
    const bare = path.join(tempDir, 'hello-world.git');
    await upstream.git('init', '--quiet', '--bare', bare);
    await upstream.git(
      'push',
      '--quiet',
      bare,
      `${baseSha}:refs/heads/main`,
      'feature:refs/pull/7/head',
    );
    const clone = await repositories.create();
    await clone.git('remote', 'add', 'origin', remoteUrl);
    await clone.git('config', `url.${bare}.insteadOf`, remoteUrl);

    const api = createFakeGithubApi();
    api.pullRequests.set(7, {
      number: 7,
      title: 'Make the answer right',
      body: 'REQ-1: the answer is 42.\n\nSee https://github.com/octo-org/hello-world/issues/1.',
      author: 'octocat',
      headRef: 'feature',
      headSha: firstHead,
      baseRef: 'main',
      baseSha,
      isDraft: false,
      state: 'open',
      updatedAt: '2026-10-28T10:00:00Z',
    });

    const token = 'gho_fake_token';
    const callsFile = path.join(tempDir, 'gh-calls.jsonl');
    const scenarioFile = path.join(tempDir, 'gh-scenario.json');
    const writeScenario = (scenario: FakeGhScenario): void => {
      writeFileSync(scenarioFile, JSON.stringify(scenario));
    };
    writeScenario({ hosts: { 'github.com': { token, login: 'reviewer' } }, callsFile });
    const claude = fakeClaude.scripted({ chunks: ['Because of REQ-1.'] }, 'chat');
    return {
      upstream,
      clone,
      bare,
      baseSha,
      firstHead,
      api,
      token,
      scenarioFile,
      callsFile,
      writeScenario,
      claude,
    };
  })
  .extend('updates', (): PullRequestUpdatedView[] => {
    return [];
  })
  .extend('ciEvents', (): CiStatusChangedView[] => {
    return [];
  })
  .extend(
    'recreate',
    ({ world, createServices, fakeGhScript, tempDir, updates, ciEvents }): RecreateServices => {
      return (previous) => {
        void previous.dispose();
        const next = createServices({
          github: {
            credentials: createGhCliCredentialProvider({
              command: process.execPath,
              leadingArgs: [fakeGhScript, world.scenarioFile],
              inheritedEnv: { PATH: process.env['PATH'], HOME: tempDir },
            }),
            fetch: async (url, init) => {
              return world.api.fetch(url, init);
            },
            polling: { scheduled: false },
          },
        });
        next.github.onPullRequestUpdated((event) => {
          updates.push(event);
        });
        next.github.onCiStatus((event) => {
          ciEvents.push(event);
        });
        return next;
      };
    },
  )
  .extend(
    'services',
    ({ world, createServices, fakeGhScript, tempDir, updates, ciEvents }): MainServices => {
      const services = createServices({
        claude: {
          ...world.claude.settings,
          killGrace: Temporal.Duration.from({ milliseconds: 200 }),
        },
        github: {
          credentials: createGhCliCredentialProvider({
            command: process.execPath,
            leadingArgs: [fakeGhScript, world.scenarioFile],
            inheritedEnv: { PATH: process.env['PATH'], HOME: tempDir },
          }),
          fetch: world.api.fetch,
          settingsPath: path.join(tempDir, 'settings.json'),
          polling: { scheduled: false },
        },
      });
      services.github.onPullRequestUpdated((event) => {
        updates.push(event);
      });
      services.github.onCiStatus((event) => {
        ciEvents.push(event);
      });
      return services;
    },
  )
  .extend('openPull', ({ services, signal }): OpenPull => {
    return async (repoPath) => {
      return okValueFrom(
        await services.github.openPullRequest(
          {
            ref: 'https://github.com/octo-org/hello-world/pull/7/files',
            ...(repoPath !== undefined && { repoPath }),
          },
          { signal },
        ),
      );
    };
  })
  .extend('opened', ({ world, openPull }): (() => Promise<string>) => {
    return async () => {
      const result = await openPull(world.clone.directory);
      if (result.kind !== 'opened') {
        throw new Error(`${result.failure}: ${result.message}`);
      }
      return result.session.id;
    };
  });
