import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { createSession } from '#internal/session/create-session.ts';
import { insertSession } from '#internal/session/insert-session.ts';
import { listSessions } from '#internal/session/list-sessions.ts';
import type { SessionSource } from '#internal/session/session.ts';
import { openDatabase } from '#sqlite/open-database.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { openAppDatabase } from './open-app-database.ts';
import { resetDatabase } from './reset-database.ts';
import { test } from '../testing/test.ts';

describe('resetDatabase', () => {
  test('moves the database aside, removes the checkouts and prunes their records, keeping the review edits', async ({
    expect,
    tempDir,
    repo,
    deps,
    logger,
    signal,
  }) => {
    repo.write('app.ts', 'export const answer = 1;\n');
    await repo.commit('base');
    await repo.git('switch', '--quiet', '--create', 'feature');
    repo.write('app.ts', 'export const answer = 2;\n');
    const head = await repo.commit('change');
    await repo.git('switch', '--quiet', 'main');
    const userData = path.join(tempDir, 'user-data');
    await mkdir(userData);
    const location = path.join(userData, 'beuve.db');
    const worktreeRoot = path.join(userData, 'worktrees');
    const checkout = path.join(worktreeRoot, 'repo-1234', head);
    const edits = path.join(userData, 'review-edits', 'repo-1234', 'review-feature');
    await repo.git('worktree', 'add', '--quiet', '--detach', checkout, head);
    await repo.git('worktree', 'add', '--quiet', '-b', 'review/feature', edits, head);
    const db = openAppDatabase(location);
    const source: SessionSource = {
      kind: 'local',
      repoPath: repo.directory,
      baseRef: 'main',
      headRef: 'feature',
    };
    const session = okValueFrom(createSession(source, head, deps));
    okValueFrom(insertSession(db, session));

    const reset = await resetDatabase({
      db,
      location,
      worktreeRoot,
      git: { signal },
      logger: logger.logger,
    });

    expect(db.isOpen).toBe(false);
    expect(reset.prunedRepositories).toStrictEqual([repo.directory]);
    expect(reset.moved?.path).toMatch(/beuve\.db\.reset-\d{4}-\d\d-\d\dT\d{6}Z$/u);
    await expect(entriesOf(userData)).resolves.toStrictEqual([
      path.basename(reset.moved?.path ?? ''),
      'review-edits',
    ]);
    const worktrees = await repo.git('worktree', 'list', '--porcelain');
    expect(worktreeLines(worktrees)).toStrictEqual([
      `worktree ${repo.directory}`,
      `worktree ${edits}`,
    ]);
    await expect(repo.git('rev-parse', 'review/feature')).resolves.toBe(head);
    await expect(
      readFile(path.join(repo.directory, 'app.ts'), { encoding: 'utf8', signal }),
    ).resolves.toBe('export const answer = 1;\n');
    using kept = openAppDatabase(reset.moved?.path ?? '');
    expect(okValueFrom(listSessions(kept)).map(({ id }) => id)).toStrictEqual([session.id]);
  });

  test('still moves a database whose sessions cannot be read, and prunes nothing', async ({
    expect,
    tempDir,
    logger,
  }) => {
    const location = path.join(tempDir, 'beuve.db');
    const worktreeRoot = path.join(tempDir, 'worktrees');
    const db = openDatabase(location);
    db.exec('CREATE TABLE unrelated (id TEXT) STRICT;');

    const reset = await resetDatabase({ db, location, worktreeRoot, logger: logger.logger });

    expect(reset.prunedRepositories).toStrictEqual([]);
    await expect(entriesOf(tempDir)).resolves.toStrictEqual([
      path.basename(reset.moved?.path ?? ''),
    ]);
    expect(logger.lines).toContainEqual(
      expect.objectContaining({
        message: 'could not list the sessions to prune their repositories',
      }),
    );
  });
});

/** The names in `directory`, sorted, since `readdir` promises no order. */
async function entriesOf(directory: string): Promise<string[]> {
  const names = await readdir(directory);
  return names.toSorted((a, b) => a.localeCompare(b));
}

function worktreeLines(porcelain: string): string[] {
  return porcelain.split('\n').filter((line) => line.startsWith('worktree '));
}
