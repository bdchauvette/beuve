import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { moveDatabaseAside } from './move-database-aside.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';
import { openAppDatabase } from './open-app-database.ts';
import { test } from '../testing/test.ts';

describe('moveDatabaseAside', () => {
  test('moves the database to a timestamped name that still opens with its rows', async ({
    expect,
    tempDir,
    logger,
  }) => {
    const location = path.join(tempDir, 'beuve.db');
    {
      using db = okValueFrom(openAppDatabase({ location, logger: logger.logger }));
      db.exec("CREATE TABLE kept (title TEXT NOT NULL) STRICT; INSERT INTO kept VALUES ('old');");
    }
    const moved = await moveDatabaseAside(location);
    expect(moved?.path).toMatch(/beuve\.db\.reset-\d{4}-\d\d-\d\dT\d{6}Z$/u);
    expect(moved?.files).toStrictEqual([{ from: location, to: moved?.path }]);
    await expect(entriesOf(tempDir)).resolves.toStrictEqual([path.basename(moved?.path ?? '')]);
    using kept = okValueFrom(
      openAppDatabase({ location: moved?.path ?? '', logger: logger.logger }),
    );
    expect(kept.prepare('SELECT title FROM kept;').all()).toMatchObject([{ title: 'old' }]);
  });

  test(
    'takes the -wal and -shm along under the same name, and never overwrites an earlier copy',
    { concurrent: false },
    async ({ expect, tempDir, clock, signal }) => {
      clock.set('2026-11-11T16:15:30Z');
      const location = path.join(tempDir, 'beuve.db');
      const first = `${location}.reset-2026-11-11T161530Z`;
      const second = `${first}-2`;
      await writeFile(location, 'first', { signal });
      await expect(moveDatabaseAside(location)).resolves.toStrictEqual({
        path: first,
        files: [{ from: location, to: first }],
      });
      await writeFile(location, 'second', { signal });
      await writeFile(`${location}-wal`, 'log', { signal });
      await writeFile(`${location}-shm`, 'index', { signal });
      await expect(moveDatabaseAside(location)).resolves.toStrictEqual({
        path: second,
        files: [
          { from: location, to: second },
          { from: `${location}-wal`, to: `${second}-wal` },
          { from: `${location}-shm`, to: `${second}-shm` },
        ],
      });
      await expect(readFile(first, { encoding: 'utf8', signal })).resolves.toBe('first');
      await expect(readFile(second, { encoding: 'utf8', signal })).resolves.toBe('second');
      await expect(readFile(`${second}-wal`, { encoding: 'utf8', signal })).resolves.toBe('log');
      await expect(readFile(`${second}-shm`, { encoding: 'utf8', signal })).resolves.toBe('index');
      await expect(entriesOf(tempDir)).resolves.toStrictEqual([
        'beuve.db.reset-2026-11-11T161530Z',
        'beuve.db.reset-2026-11-11T161530Z-2',
        'beuve.db.reset-2026-11-11T161530Z-2-shm',
        'beuve.db.reset-2026-11-11T161530Z-2-wal',
      ]);
    },
  );

  test('moves nothing when there is no database', async ({ expect, tempDir, signal }) => {
    await writeFile(path.join(tempDir, 'beuve.db-wal'), 'stray', { signal });
    await expect(moveDatabaseAside(path.join(tempDir, 'beuve.db'))).resolves.toBeUndefined();
    await expect(entriesOf(tempDir)).resolves.toStrictEqual(['beuve.db-wal']);
  });
});

/** The names in `directory`, sorted, since `readdir` promises no order. */
async function entriesOf(directory: string): Promise<string[]> {
  const names = await readdir(directory);
  return names.toSorted((a, b) => a.localeCompare(b));
}
