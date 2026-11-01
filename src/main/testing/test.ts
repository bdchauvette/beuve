import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { DatabaseSync } from 'node:sqlite';

import { writeFakeGh } from '#internal/auth/testing/write-fake-gh.ts';
import { startFakeOpenAiApi } from '#internal/llm/testing/start-fake-open-ai-api.ts';
import type {
  FakeOpenAiApi,
  FakeOpenAiOptions,
} from '#internal/llm/testing/start-fake-open-ai-api.ts';
import { writeFakeClaude } from '#internal/llm/testing/write-fake-claude.ts';
import { countingSessionDeps } from '#internal/session/testing/counting-session-deps.ts';
import type { SessionDeps } from '#internal/session/session.ts';
import { test as baseTest } from '#internal/git/testing/test.ts';
import { runMigrations } from '#sqlite/run-migrations.ts';

import { appMigrations } from '../database/app-migrations.ts';
import { createMainServices } from '../create-main-services.ts';
import { resolveNodeRuntime } from '../node-runtime/resolve-node-runtime.ts';
import type { NodeRuntime, NodeRuntimeError } from '../node-runtime/resolve-node-runtime.ts';
import type { MainServicesOptions } from '../create-main-services.ts';
import type { MainServices } from '../main-services.ts';
import type { Result } from '#x/result/result.ts';
import { createScriptedClaude } from './create-scripted-claude.ts';
import type { ClaudeScript, ScriptedClaude } from './create-scripted-claude.ts';

/** Builds {@link MainServices} for one test; a missing option takes the fixture's value. */
export type CreateServices = (
  options?: Partial<Omit<MainServicesOptions, 'db' | 'logger'>>,
) => MainServices;

/** The fake `claude` for one test. */
export interface FakeClaude {
  /** The path of the fake script, shared by every test of the worker. */
  readonly script: string;
  /** A `chat`-mode run answering `script`, with its call log in the test's `tempDir`. */
  readonly scripted: (script: ClaudeScript, name?: string) => ScriptedClaude;
}

/**
 * `#internal/git/testing/test.ts` plus the `src/main` composition (ADR 0058). `src/main` may use
 * the git testing helpers and the domains' fakes; the domains may not use each other's.
 *
 * - `db`: the migrated app database (`appMigrations`).
 * - `deps`: session deps with counting ids.
 * - `worktreeRoot`: where session checkouts go, in the test's `tempDir`.
 * - `nodeRuntime` (worker): the `node` on `PATH`, resolved as `npm start` does (ADR 0083).
 * - `createServices`: {@link CreateServices}; every result is disposed after the test.
 * - `services`: `createServices()`.
 * - `claudeScript` (worker): the fake `claude` script, written once.
 * - `fakeClaude`: {@link FakeClaude}.
 * - `fakeGhScript` (worker): the fake `gh` script, written once.
 * - `openAiApi`: starts fake OpenAI-compatible servers, each closed after the test.
 */
export const test = baseTest
  .extend('db', ({ db }): DatabaseSync => {
    runMigrations(db, appMigrations);
    return db;
  })
  .extend('deps', (): SessionDeps => countingSessionDeps())
  .extend('worktreeRoot', ({ tempDir }): string => path.join(tempDir, 'worktrees'))
  .extend(
    'nodeRuntime',
    { scope: 'worker' },
    async (): Promise<Result<NodeRuntime, NodeRuntimeError>> => {
      return resolveNodeRuntime({
        packaged: false,
        resourcesPath: '',
        pathVariable: process.env['PATH'],
      });
    },
  )
  .extend(
    'createServices',
    ({ db, logger, deps, worktreeRoot, nodeRuntime }, { onCleanup }): CreateServices => {
      const created: MainServices[] = [];
      onCleanup(async () => {
        for (const services of created.toReversed()) {
          await services.dispose();
        }
      });
      return (options = {}): MainServices => {
        const services = createMainServices({
          db,
          logger: logger.logger,
          deps,
          worktreeRoot,
          nodeRuntime,
          ...options,
        });
        created.push(services);
        return services;
      };
    },
  )
  .extend('services', ({ createServices }): MainServices => createServices())
  .extend('claudeScript', { scope: 'worker' }, ({ tempRoot }): string => {
    const directory = mkdtempSync(path.join(tempRoot, 'fake-claude-'));
    return writeFakeClaude(directory);
  })
  .extend('fakeGhScript', { scope: 'worker' }, ({ tempRoot }): string => {
    const directory = mkdtempSync(path.join(tempRoot, 'fake-gh-'));
    return writeFakeGh(directory);
  })
  .extend('fakeClaude', ({ claudeScript, tempDir }): FakeClaude => {
    const home = path.join(tempDir, 'claude');
    mkdirSync(home);
    return {
      script: claudeScript,
      scripted: (script, name = 'chat'): ScriptedClaude => {
        return createScriptedClaude(
          { fakeClaudePath: claudeScript, directory: home, name },
          script,
        );
      },
    };
  })
  .extend(
    'openAiApi',
    ({}, { onCleanup }): ((options?: FakeOpenAiOptions) => Promise<FakeOpenAiApi>) => {
      const started: FakeOpenAiApi[] = [];
      onCleanup(() => {
        for (const api of started) {
          api.close();
        }
      });
      return async (options): Promise<FakeOpenAiApi> => {
        const api = await startFakeOpenAiApi(options);
        started.push(api);
        return api;
      };
    },
  );
