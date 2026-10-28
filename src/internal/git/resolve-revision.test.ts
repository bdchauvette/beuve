import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import { resolveRevision } from './resolve-revision.ts';

describe('resolveRevision', () => {
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

  it('resolves branches, relative revisions, abbreviations and annotated tags to commits', async () => {
    repo.write('a.txt', '1');
    const first = repo.commit('first');
    repo.write('a.txt', '2');
    const second = repo.commit('second');
    repo.git('tag', '--annotate', 'v1', '--message', 'tag', first);
    await expect(resolveRevision(git, 'main')).resolves.toEqual({ ok: true, value: second });
    await expect(resolveRevision(git, 'HEAD~1')).resolves.toEqual({ ok: true, value: first });
    await expect(resolveRevision(git, first.slice(0, 10))).resolves.toEqual({
      ok: true,
      value: first,
    });
    await expect(resolveRevision(git, 'v1')).resolves.toEqual({ ok: true, value: first });
  });

  it('reports unknown revisions and non-commits', async () => {
    repo.commit('only');
    await expect(resolveRevision(git, 'no-such-branch')).resolves.toEqual({
      ok: false,
      error: { kind: 'unknown-revision', revision: 'no-such-branch' },
    });
    await expect(resolveRevision(git, 'HEAD^{tree}')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'unknown-revision' },
    });
  });

  it('refuses option-like and control-character input', async () => {
    repo.commit('only');
    for (const revision of ['--output=/tmp/x', '-p', '', 'main\nHEAD', 'a\u{7F}b']) {
      await expect(resolveRevision(git, revision)).resolves.toMatchObject({
        ok: false,
        error: { kind: 'invalid-argument', argument: revision },
      });
    }
  });
});
