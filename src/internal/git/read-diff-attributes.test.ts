import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isVersionAtLeast } from './is-version-at-least.ts';

import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import { readDiffAttributes } from './read-diff-attributes.ts';

describe('readDiffAttributes', () => {
  let repo: TestRepository;
  let git: GitRepository;
  beforeEach(async () => {
    repo = createTestRepository();
    const opened = await openRepository(repo.directory);
    if (!opened.ok) {
      throw new Error(opened.error.kind);
    }
    git = opened.value;
  });
  afterEach(() => {
    repo.cleanup();
  });

  it('reads the attributes of the commit, not of the working tree', async () => {
    repo.write(
      '.gitattributes',
      ['gen/** linguist-generated', 'gen/keep.ts -linguist-generated', '*.snap -diff', ''].join(
        '\n',
      ),
    );
    repo.write('gen/api.ts', 'a\n');
    repo.write('gen/keep.ts', 'b\n');
    repo.write('src/a b.snap', 'c\n');
    repo.write('src/main.ts', 'd\n');
    const head = repo.commit('attributes');
    repo.write('.gitattributes', 'src/main.ts linguist-generated\n');

    const read = await readDiffAttributes(git, head, [
      'gen/api.ts',
      'gen/keep.ts',
      'src/a b.snap',
      'src/main.ts',
      'gone/deleted.ts',
    ]);
    if (!isVersionAtLeast(git.version, 2, 40)) {
      expect(read).toMatchObject({ ok: false, error: { kind: 'unsupported-git-version' } });
      return;
    }
    expect(read.ok && Object.fromEntries(read.value)).toEqual({
      'gen/api.ts': { generated: true },
      'gen/keep.ts': { generated: false },
      'src/a b.snap': { diff: false },
    });
  });

  it('answers an empty map for no paths', async () => {
    const head = repo.commit('empty');
    const read = await readDiffAttributes(git, head, []);
    expect(read.ok ? read.value.size : read.error.kind).toBe(
      isVersionAtLeast(git.version, 2, 40) ? 0 : 'unsupported-git-version',
    );
  });
});
