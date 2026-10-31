import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { grepTree } from './grep-tree.ts';
import type { TreeGrepQuery } from './grep-tree.ts';
import { hostilePathNames } from './testing/hostile-path-names.ts';
import { test } from './testing/test.ts';

function query(overrides: Partial<TreeGrepQuery> = {}): TreeGrepQuery {
  return { pattern: 'needle', ignoreCase: false, maxMatches: 100, maxLineChars: 300, ...overrides };
}

describe('grepTree', () => {
  test('finds fixed strings at the commit, not in the working tree', async ({
    expect,
    repo,
    repository,
    signal,
  }) => {
    repo.write('a.ts', 'one needle\nnone\n(needle+)*\n');
    repo.write('src/b.ts', 'NEEDLE upper\n');
    repo.write('bin.dat', Buffer.concat([Buffer.from('needle\n'), Buffer.from([0, 1])]));
    const commit = await repo.commit('needles');
    repo.write('a.ts', 'needle in the working tree only\n');
    await expect(grepTree(repository, commit, query({ signal }))).resolves.toStrictEqual({
      ok: true,
      value: {
        matches: [
          { path: 'a.ts', line: 1, text: 'one needle' },
          { path: 'a.ts', line: 3, text: '(needle+)*' },
        ],
        isCapped: false,
      },
    });
    await expect(
      grepTree(repository, commit, query({ ignoreCase: true, scope: 'src', signal })),
    ).resolves.toMatchObject({
      ok: true,
      value: { matches: [{ path: 'src/b.ts', line: 1, text: 'NEEDLE upper' }] },
    });
    await expect(
      grepTree(repository, commit, query({ pattern: 'needle+)*', signal })),
    ).resolves.toMatchObject({ ok: true, value: { matches: [{ line: 3 }] } });
  });

  test('caps, filters, cuts long lines and finds nothing gracefully', async ({
    expect,
    repo,
    repository,
    signal,
  }) => {
    repo.write('a.ts', 'needle 1\nneedle 2\nneedle 3\n');
    repo.write('b.md', `needle ${'x'.repeat(1000)}\n`);
    const commit = await repo.commit('needles');
    await expect(
      grepTree(repository, commit, query({ maxMatches: 2, signal })),
    ).resolves.toMatchObject({
      ok: true,
      value: { matches: [{ line: 1 }, { line: 2 }], isCapped: true },
    });
    const markdown = okValueFrom(
      await grepTree(
        repository,
        commit,
        query({
          accept: (file) => {
            return file.endsWith('.md');
          },
          maxLineChars: 10,
          signal,
        }),
      ),
    );
    expect(markdown.matches).toStrictEqual([{ path: 'b.md', line: 1, text: 'needle xxx' }]);
    await expect(
      grepTree(repository, commit, query({ pattern: 'absent', signal })),
    ).resolves.toStrictEqual({ ok: true, value: { matches: [], isCapped: false } });
    await expect(
      grepTree(repository, commit, query({ pattern: 'needle\n1', signal })),
    ).resolves.toStrictEqual({ ok: true, value: { matches: [], isCapped: false } });
  });

  test('reports hostile paths exactly as stored', async ({ expect, repo, repository, signal }) => {
    const names = hostilePathNames();
    for (const name of names) {
      repo.write(name, 'needle\n');
    }
    const commit = await repo.commit('hostile');
    const found = okValueFrom(await grepTree(repository, commit, query({ signal })));
    expect(new Set(found.matches.map((match) => match.path))).toStrictEqual(new Set(names));
  });

  test('refuses anything but a full commit sha', async ({ expect, repository, signal }) => {
    await expect(
      grepTree(repository, 'HEAD' as Parameters<typeof grepTree>[1], query({ signal })),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'invalid-argument' } });
  });
});
