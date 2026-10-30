import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IpcResult } from '#contract/ipc-contract.ts';
import { isVersionAtLeast } from '#internal/git/is-version-at-least.ts';
import { parseGitVersion } from '#internal/git/parse-git-version.ts';
import { createTestRepository } from '#internal/git/testing/create-test-repository.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { systemSessionDeps } from '#internal/session/system-session-deps.ts';
import { createLogger } from '#x/log/create-logger.ts';

import { openAppDatabase } from '../database/open-app-database.ts';
import { createSessionServices } from '../sessions/create-session-services.ts';
import type { SessionContext } from '../sessions/session-context.ts';

import { createFileServices } from './create-file-services.ts';
import type { FileServices } from './create-file-services.ts';

describe('createFileServices (integration: SQLite + git)', () => {
  let repo: TestRepository;
  let db: DatabaseSync;
  let files: FileServices;
  let sessionId: string;

  beforeEach(async () => {
    repo = createTestRepository();
    db = openAppDatabase(':memory:');
    const logger = createLogger('test', { sink: (): void => undefined });
    const context: SessionContext = { db, logger, deps: systemSessionDeps, git: { logger } };
    files = createFileServices({ context });
    repo.write('package.json', '{}\n');
    repo.write('packages/web/package.json', '{}\n');
    repo.write('packages/web/src/app.ts', 'export const a = 1;\n');
    repo.write('packages/web/src/gone.ts', 'old\n');
    repo.commit('base');
    repo.git('switch', '--quiet', '--create', 'feature');
    repo.write('packages/web/src/app.ts', 'export const a = 2;\n');
    repo.write('services/api/go.mod', 'module api\n');
    repo.git('rm', '--quiet', 'packages/web/src/gone.ts');
    repo.commit('feature');
    const sessions = createSessionServices({ db, logger });
    const created = value(
      await sessions.createLocal({ repoPath: repo.directory, baseRef: 'main', headRef: 'feature' }),
    );
    sessionId = created.id;
  });

  afterEach(() => {
    db.close();
    repo.cleanup();
  });

  it('lists the head tree and its package roots', async () => {
    const tree = value(await files.getTree({ sessionId }));
    expect(tree.paths).toEqual([
      'package.json',
      'packages/web/package.json',
      'packages/web/src/app.ts',
      'services/api/go.mod',
    ]);
    expect(tree.packageRoots).toEqual(['', 'packages/web', 'services/api']);
    expect(tree.headSha).toBe(repo.git('rev-parse', 'feature'));
    expect(value(await files.getTree({ sessionId }))).toEqual(tree);
  });

  it('reads the review files’ attributes from .gitattributes at the head', async () => {
    repo.write(
      '.gitattributes',
      'services/** linguist-generated\npackages/** -linguist-generated\n**/gone.ts -diff\n',
    );
    const head = repo.commit('attributes');
    const attributes = value(await files.getFileAttributes({ sessionId }));
    expect(attributes.headSha).toBe(head);
    const version = parseGitVersion(repo.git('--version'));
    if (version === undefined || !isVersionAtLeast(version, 2, 40)) {
      expect(attributes).toMatchObject({ generated: [], notGenerated: [], noDiff: [] });
      return;
    }
    expect(attributes).toMatchObject({
      generated: ['services/api/go.mod'],
      notGenerated: ['packages/web/src/app.ts', 'packages/web/src/gone.ts'],
      noDiff: ['packages/web/src/gone.ts'],
    });
    expect(value(await files.getFileAttributes({ sessionId }))).toEqual(attributes);
  });

  it('reads both sides of a reviewed file, leaving out an absent side', async () => {
    await expect(
      files.getFilePair({ sessionId, path: 'packages/web/src/app.ts' }),
    ).resolves.toEqual({
      ok: true,
      value: {
        path: 'packages/web/src/app.ts',
        oldContents: 'export const a = 1;\n',
        newContents: 'export const a = 2;\n',
      },
    });
    expect(value(await files.getFilePair({ sessionId, path: 'services/api/go.mod' }))).toEqual({
      path: 'services/api/go.mod',
      newContents: 'module api\n',
    });
    expect(value(await files.getFilePair({ sessionId, path: 'packages/web/src/gone.ts' }))).toEqual(
      { path: 'packages/web/src/gone.ts', oldContents: 'old\n' },
    );
  });

  it('refuses files outside the review', async () => {
    await expect(files.getFilePair({ sessionId, path: 'package.json' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
  });
});

function value<T>(result: IpcResult<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}
