import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';
import { listChangedFiles } from './list-changed-files.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';

describe('listChangedFiles', () => {
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

  it('lists line counts, binaries and renames since the merge-base', async () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${String(index)}`).join('\n');
    repo.write('moved.txt', `${lines}\n`);
    repo.write('edited.txt', 'a\nb\n');
    repo.commit('base');
    repo.git('switch', '--quiet', '--create', 'topic');
    repo.git('mv', 'moved.txt', 'renamed ü.txt');
    repo.write('edited.txt', 'a\nB\nc\n');
    repo.write('image.bin', new Uint8Array([0, 1, 2, 0]));
    const head = repo.commit('topic');
    repo.git('switch', '--quiet', 'main');
    repo.write('upstream.txt', 'noise\n');
    const base = repo.commit('upstream');

    await expect(listChangedFiles(git, { base, head })).resolves.toEqual({
      ok: true,
      value: [
        {
          path: 'edited.txt',
          previousPath: undefined,
          stats: { kind: 'text', added: 2, removed: 1 },
        },
        { path: 'image.bin', previousPath: undefined, stats: { kind: 'binary' } },
        {
          path: 'renamed ü.txt',
          previousPath: 'moved.txt',
          stats: { kind: 'text', added: 0, removed: 0 },
        },
      ],
    });
  });
});
