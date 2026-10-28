import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listTreeBlobs } from './list-tree-blobs.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import { readBlobs } from './read-blobs.ts';
import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';

describe('listTreeBlobs', () => {
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

  it('lists tracked files with blob names that readBlobs can read, paths unquoted', async () => {
    repo.write('src/a b/ü.ts', 'export const a = 1;\n');
    repo.write('main.ts', 'export const b = 2;\n');
    const head = repo.commit('first');

    const listed = await listTreeBlobs(git, head);
    expect(listed.ok).toBe(true);
    if (!listed.ok) {
      return;
    }
    expect(listed.value.map((blob) => blob.path)).toEqual(['main.ts', 'src/a b/ü.ts']);
    const blobs = await readBlobs(
      git,
      listed.value.map(({ objectId }) => ({ objectId })),
    );
    expect(blobs.ok && blobs.value.get(listed.value[1]?.objectId ?? '')).toMatchObject({
      kind: 'text',
      text: 'export const a = 1;\n',
    });
  });
});
