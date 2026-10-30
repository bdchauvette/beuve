import path from 'node:path';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { fetchRefs } from './fetch-refs.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import { resolveRevision } from './resolve-revision.ts';
import type { TestRepository } from './testing/test-repository.ts';
import type { TestRepositories } from './testing/test.ts';
import { test } from './testing/test.ts';

describe('fetchRefs', () => {
  test('fetches pull request heads into refs/beuve/ and follows force-pushes', async ({
    expect,
    repositories,
  }) => {
    const { upstream, clone, git, bare } = await withRemote(repositories);
    await upstream.git('switch', '--quiet', '-c', 'topic');
    upstream.write('b.txt', 'b\n');
    const first = await upstream.commit('topic');
    await upstream.git('push', '--quiet', bare, 'topic:refs/pull/7/head');

    const spec = [
      '+refs/pull/7/head:refs/beuve/pr/7/head',
      '+refs/heads/main:refs/beuve/pr/7/base',
    ];
    await expect(fetchRefs(git, 'origin', spec)).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
    await expect(resolveRevision(git, 'refs/beuve/pr/7/head')).resolves.toStrictEqual({
      ok: true,
      value: first,
    });

    await upstream.git('commit', '--quiet', '--amend', '--message', 'rewritten');
    const second = await upstream.git('rev-parse', 'HEAD');
    await upstream.git('push', '--quiet', '--force', bare, 'topic:refs/pull/7/head');
    await expect(fetchRefs(git, 'origin', spec)).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
    await expect(resolveRevision(git, 'refs/beuve/pr/7/head')).resolves.toStrictEqual({
      ok: true,
      value: second,
    });
    await expect(clone.git('tag', '--list')).resolves.toBe('');
    await expect(
      clone.git('for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'),
    ).resolves.toBe('');
  });

  test('refuses destinations outside refs/beuve/, option-like remotes and unsafe refs', async ({
    expect,
    repositories,
  }) => {
    const { git } = await withRemote(repositories);
    const refused = [
      await fetchRefs(git, 'origin', ['+refs/pull/1/head:refs/heads/main']),
      await fetchRefs(git, '--upload-pack=touch /tmp/x', ['refs/pull/1/head:refs/beuve/x']),
      await fetchRefs(git, 'origin', ['refs/pull/*/head:refs/beuve/*']),
      await fetchRefs(git, 'origin', ['refs/pull/1/../head:refs/beuve/x']),
      await fetchRefs(git, 'https://user:secret@github.com/o/r.git', ['refs/a:refs/beuve/a']),
      await fetchRefs(git, 'origin', []),
    ];
    for (const result of refused) {
      expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-argument' } });
    }
  });

  test('reports a ref the remote lacks as a failed command', async ({ expect, repositories }) => {
    const { git } = await withRemote(repositories);
    const missing = await fetchRefs(git, 'origin', ['+refs/pull/9/head:refs/beuve/pr/9/head']);
    expect(missing).toMatchObject({ ok: false, error: { kind: 'command-failed' } });
  });
});

interface WithRemote {
  readonly upstream: TestRepository;
  readonly clone: TestRepository;
  readonly git: GitRepository;
  readonly bare: string;
}

/** `upstream` pushes `main` to the bare repository `bare`; `clone` has it as `origin`, unfetched. */
async function withRemote(repositories: TestRepositories): Promise<WithRemote> {
  const upstream = await repositories.create();
  upstream.write('a.txt', 'a\n');
  await upstream.commit('first');
  const bare = path.join(upstream.scratch(), 'remote.git');
  await upstream.git('init', '--quiet', '--bare', bare);
  await upstream.git('push', '--quiet', bare, 'main:refs/heads/main');
  const clone = await repositories.create();
  await clone.git('remote', 'add', 'origin', bare);
  const git = okValueFrom(await openRepository(clone.directory));
  return { upstream, clone, git, bare };
}
