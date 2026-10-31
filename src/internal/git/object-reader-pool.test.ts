import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { ObjectReaderPool } from './object-reader-pool.ts';
import { openRepository } from './open-repository.ts';
import { resolveRevision } from './resolve-revision.ts';
import { test } from './testing/test.ts';

describe('ObjectReaderPool', () => {
  test('handles opened with a pool share one reader per root, stopped on dispose', async ({
    expect,
    repo,
    signal,
  }) => {
    const commit = await repo.commit('first');
    const pool = new ObjectReaderPool();
    const first = okValueFrom(
      await openRepository(repo.directory, { objectReaders: pool, signal }),
    );
    const second = okValueFrom(
      await openRepository(repo.directory, { objectReaders: pool, signal, probe: first }),
    );
    await expect(resolveRevision(first, 'main')).resolves.toStrictEqual({
      ok: true,
      value: commit,
    });
    await expect(resolveRevision(second, 'HEAD')).resolves.toStrictEqual({
      ok: true,
      value: commit,
    });
    expect(pool.stats.values().toArray()).toStrictEqual([
      { starts: 1, restarts: 0, isRunning: true },
    ]);
    await pool[Symbol.asyncDispose]();
    expect(pool.stats.values().toArray()).toStrictEqual([]);
    await expect(resolveRevision(first, 'main')).resolves.toStrictEqual({
      ok: true,
      value: commit,
    });
  });

  test('a handle bound to an aborted signal answers aborted', async ({ expect, repo, signal }) => {
    await repo.commit('first');
    await using pool = new ObjectReaderPool();
    const probe = okValueFrom(await openRepository(repo.directory, { signal }));
    const aborted = okValueFrom(
      await openRepository(repo.directory, {
        objectReaders: pool,
        probe,
        signal: AbortSignal.abort(),
      }),
    );
    await expect(resolveRevision(aborted, 'main')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'aborted' },
    });
  });
});
