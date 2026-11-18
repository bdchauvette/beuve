import { describe } from 'vitest';

import type { IpcResult, ReviewThreadsView } from '#contract/ipc-contract.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { createGitCaches } from '../sessions/create-git-caches.ts';
import { test } from '../ura/testing/test.ts';

import { createThreadServices } from './create-thread-services.ts';
import type { ThreadAdapter } from './create-thread-services.ts';

function adapterNamed(name: string, isSupported: boolean, asked: string[]): ThreadAdapter {
  return {
    supports: (): boolean => {
      return isSupported;
    },
    list: async (source): Promise<IpcResult<ReviewThreadsView>> => {
      await Promise.resolve();
      asked.push(`${name}:${source.kind}`);
      return { ok: true, value: { kind: 'threads', threads: [], isTruncated: false } };
    },
  };
}

describe(
  'createThreadServices (integration: SQLite + git, no Electron)',
  { timeout: 30_000 },
  () => {
    test('answers unsupported for a session no adapter serves', async ({
      expect,
      services,
      sessionId,
      signal,
    }) => {
      expect(okValueFrom(await services.threads.getThreads(sessionId, { signal }))).toStrictEqual({
        kind: 'unsupported',
      });
    });

    test('asks the first adapter that supports the session’s source', async ({
      expect,
      sessionId,
      db,
      deps,
      logger,
      signal,
    }) => {
      const asked: string[] = [];
      const threads = createThreadServices({
        context: {
          db,
          deps,
          logger: logger.logger,
          git: { logger: logger.logger },
          caches: createGitCaches(),
        },
        adapters: [
          adapterNamed('gitlab', false, asked),
          adapterNamed('other', true, asked),
          adapterNamed('late', true, asked),
        ],
      });
      expect(okValueFrom(await threads.getThreads(sessionId, { signal }))).toStrictEqual({
        kind: 'threads',
        threads: [],
        isTruncated: false,
      });
      expect(asked).toStrictEqual(['other:local']);
    });

    test('fails for a session that does not exist', async ({ expect, services, signal }) => {
      await expect(
        services.threads.getThreads('00000000-0000-4000-8000-000000000000', { signal }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
    });
  },
);
