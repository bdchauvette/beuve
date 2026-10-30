import { describe } from 'vitest';

import { resolveRevision } from './resolve-revision.ts';
import { test } from './testing/test.ts';

describe('resolveRevision', () => {
  test('resolves branches, relative revisions, abbreviations and annotated tags to commits', async ({
    expect,
    repo,
    repository: git,
  }) => {
    repo.write('a.txt', '1');
    const first = await repo.commit('first');
    repo.write('a.txt', '2');
    const second = await repo.commit('second');
    await repo.git('tag', '--annotate', 'v1', '--message', 'tag', first);
    await expect(resolveRevision(git, 'main')).resolves.toStrictEqual({ ok: true, value: second });
    await expect(resolveRevision(git, 'HEAD~1')).resolves.toStrictEqual({ ok: true, value: first });
    await expect(resolveRevision(git, first.slice(0, 10))).resolves.toStrictEqual({
      ok: true,
      value: first,
    });
    await expect(resolveRevision(git, 'v1')).resolves.toStrictEqual({ ok: true, value: first });
  });

  test('reports unknown revisions and non-commits', async ({ expect, repo, repository: git }) => {
    await repo.commit('only');
    await expect(resolveRevision(git, 'no-such-branch')).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'unknown-revision', revision: 'no-such-branch' },
    });
    await expect(resolveRevision(git, 'HEAD^{tree}')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'unknown-revision' },
    });
  });

  test('refuses option-like and control-character input', async ({
    expect,
    repo,
    repository: git,
  }) => {
    await repo.commit('only');
    for (const revision of ['--output=/tmp/x', '-p', '', 'main\nHEAD', 'a\u{7F}b']) {
      await expect(resolveRevision(git, revision)).resolves.toMatchObject({
        ok: false,
        error: { kind: 'invalid-argument', argument: revision },
      });
    }
  });
});
