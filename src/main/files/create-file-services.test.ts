import { describe } from 'vitest';

import { isVersionAtLeast } from '#internal/git/is-version-at-least.ts';
import { parseGitVersion } from '#internal/git/parse-git-version.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from './testing/test.ts';

describe('createFileServices (integration: SQLite + git)', () => {
  test('lists the head tree and its package roots', async ({
    expect,
    files,
    repo,
    sessionId,
    signal,
  }) => {
    const tree = okValueFrom(await files.getTree({ sessionId }, { signal }));
    expect(tree.paths).toStrictEqual([
      'package.json',
      'packages/web/package.json',
      'packages/web/src/app.ts',
      'services/api/go.mod',
    ]);
    expect(tree.packageRoots).toStrictEqual(['', 'packages/web', 'services/api']);
    expect(tree.headSha).toBe(await repo.git('rev-parse', 'feature'));
    expect(okValueFrom(await files.getTree({ sessionId }, { signal }))).toStrictEqual(tree);
  });

  test('reads the review files’ attributes from .gitattributes at the head', async ({
    expect,
    files,
    repo,
    sessionId,
    signal,
  }) => {
    repo.write(
      '.gitattributes',
      'services/** linguist-generated\npackages/** -linguist-generated\n**/gone.ts -diff\n',
    );
    const head = await repo.commit('attributes');
    const attributes = okValueFrom(await files.getFileAttributes({ sessionId }, { signal }));
    expect(attributes.headSha).toBe(head);
    expect(attributes).toMatchObject(await expectedAttributes(repo));
    expect(okValueFrom(await files.getFileAttributes({ sessionId }, { signal }))).toStrictEqual(
      attributes,
    );
  });

  test('reads both sides of a reviewed file, leaving out an absent side', async ({
    expect,
    files,
    sessionId,
  }) => {
    await expect(
      files.getFilePair({ sessionId, path: 'packages/web/src/app.ts' }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        path: 'packages/web/src/app.ts',
        oldContents: 'export const a = 1;\n',
        newContents: 'export const a = 2;\n',
      },
    });
    expect(
      okValueFrom(await files.getFilePair({ sessionId, path: 'services/api/go.mod' })),
    ).toStrictEqual({
      path: 'services/api/go.mod',
      newContents: 'module api\n',
    });
    expect(
      okValueFrom(await files.getFilePair({ sessionId, path: 'packages/web/src/gone.ts' })),
    ).toStrictEqual({ path: 'packages/web/src/gone.ts', oldContents: 'old\n' });
  });

  test('refuses files outside the review', async ({ expect, files, sessionId }) => {
    await expect(files.getFilePair({ sessionId, path: 'package.json' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
  });
});

/** `git check-attr --source` needs git 2.40; older gits report nothing. */
async function expectedAttributes(repo: TestRepository): Promise<object> {
  const version = parseGitVersion(await repo.git('--version'));
  if (version === undefined || !isVersionAtLeast(version, 2, 40)) {
    return { generated: [], notGenerated: [], noDiff: [] };
  }
  return {
    generated: ['services/api/go.mod'],
    notGenerated: ['packages/web/src/app.ts', 'packages/web/src/gone.ts'],
    noDiff: ['packages/web/src/gone.ts'],
  };
}
