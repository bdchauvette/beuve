import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { fetchRefs } from './fetch-refs.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import { resolveRevision } from './resolve-revision.ts';
import { startHoldServer } from './testing/start-hold-server.ts';
import { writeHoldScript } from './testing/write-hold-script.ts';
import type { TestRepository } from './testing/test-repository.ts';
import type { TestRepositories } from './testing/test.ts';
import { test } from './testing/test.ts';

describe('fetchRefs', () => {
  test('fetches pull request heads into refs/beuve/ and follows force-pushes', async ({
    expect,
    repositories,
    signal,
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
    await expect(
      fetchRefs(git, { remote: 'origin', refspecs: spec }, { signal }),
    ).resolves.toStrictEqual({
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
    await expect(
      fetchRefs(git, { remote: 'origin', refspecs: spec }, { signal }),
    ).resolves.toStrictEqual({
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

  test('an aborted fetch leaves no lock or temporary pack, and the next one succeeds', async ({
    expect,
    repositories,
    closing,
    signal,
  }) => {
    const { upstream, clone, git, bare } = await withRemote(repositories);
    const server = closing(await startHoldServer(signal));
    const uploadPack = writeHoldScript(
      { directory: upstream.scratch(), name: 'upload-pack' },
      server.port,
      {
        kind: 'upload-pack',
      },
    );
    await clone.git('remote', 'add', 'slow', bare);
    await clone.git('config', 'remote.slow.uploadpack', uploadPack.command);
    const spec = ['+refs/heads/main:refs/beuve/pr/7/base'];
    const controller = new AbortController();
    const fetching = fetchRefs(
      git,
      { remote: 'slow', refspecs: spec },
      {
        signal: AbortSignal.any([signal, controller.signal]),
      },
    );
    const held = await server.next();
    controller.abort();
    await expect(fetching).resolves.toMatchObject({ ok: false, error: { kind: 'aborted' } });
    await expect(held.ended).resolves.toBeDefined();
    await expect(leftovers(clone)).resolves.toStrictEqual([]);
    await expect(
      fetchRefs(git, { remote: 'origin', refspecs: spec }, { signal }),
    ).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
    await expect(resolveRevision(git, 'refs/beuve/pr/7/base')).resolves.toStrictEqual({
      ok: true,
      value: await upstream.git('rev-parse', 'main'),
    });
  });

  test('refuses destinations outside refs/beuve/, option-like remotes and unsafe refs', async ({
    expect,
    repositories,
    signal,
  }) => {
    const { git } = await withRemote(repositories);
    const refused = [
      await fetchRefs(
        git,
        { remote: 'origin', refspecs: ['+refs/pull/1/head:refs/heads/main'] },
        { signal },
      ),
      await fetchRefs(
        git,
        { remote: '--upload-pack=touch /tmp/x', refspecs: ['refs/pull/1/head:refs/beuve/x'] },
        {
          signal,
        },
      ),
      await fetchRefs(
        git,
        { remote: 'origin', refspecs: ['refs/pull/*/head:refs/beuve/*'] },
        { signal },
      ),
      await fetchRefs(
        git,
        { remote: 'origin', refspecs: ['refs/pull/1/../head:refs/beuve/x'] },
        { signal },
      ),
      await fetchRefs(
        git,
        { remote: 'https://user:secret@github.com/o/r.git', refspecs: ['refs/a:refs/beuve/a'] },
        {
          signal,
        },
      ),
      await fetchRefs(git, { remote: 'origin', refspecs: [] }, { signal }),
    ];
    for (const result of refused) {
      expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-argument' } });
    }
  });

  test('reports a ref the remote lacks as a failed command', async ({
    expect,
    repositories,
    signal,
  }) => {
    const { git } = await withRemote(repositories);
    const missing = await fetchRefs(
      git,
      { remote: 'origin', refspecs: ['+refs/pull/9/head:refs/beuve/pr/9/head'] },
      {
        signal,
      },
    );
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
/** Lock files and temporary packs anywhere under `.git`. */
async function leftovers(repo: TestRepository): Promise<readonly string[]> {
  const entries = await readdir(path.join(repo.directory, '.git'), { recursive: true });
  return entries.filter((entry) => {
    return entry.endsWith('.lock') || path.basename(entry).startsWith('tmp_');
  });
}

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
