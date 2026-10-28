import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fetchRefs } from './fetch-refs.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import { resolveRevision } from './resolve-revision.ts';
import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';

describe('fetchRefs', () => {
  let upstream: TestRepository;
  let clone: TestRepository;
  let git: GitRepository;
  let bare: string;

  beforeEach(async () => {
    upstream = createTestRepository();
    upstream.write('a.txt', 'a\n');
    upstream.commit('first');
    bare = path.join(upstream.scratch(), 'remote.git');
    execFileSync('git', ['init', '--quiet', '--bare', bare]);
    upstream.git('push', '--quiet', bare, 'main:refs/heads/main');
    clone = createTestRepository();
    clone.git('remote', 'add', 'origin', bare);
    const opened = await openRepository(clone.directory);
    if (!opened.ok) {
      throw new Error(opened.error.kind);
    }
    git = opened.value;
  });

  afterEach(() => {
    upstream.cleanup();
    clone.cleanup();
  });

  it('fetches pull request heads into refs/beuve/ and follows force-pushes', async () => {
    upstream.git('switch', '--quiet', '-c', 'topic');
    upstream.write('b.txt', 'b\n');
    const first = upstream.commit('topic');
    upstream.git('push', '--quiet', bare, 'topic:refs/pull/7/head');

    const spec = [
      '+refs/pull/7/head:refs/beuve/pr/7/head',
      '+refs/heads/main:refs/beuve/pr/7/base',
    ];
    expect(await fetchRefs(git, 'origin', spec)).toEqual({ ok: true, value: undefined });
    expect(await resolveRevision(git, 'refs/beuve/pr/7/head')).toEqual({ ok: true, value: first });

    upstream.git('commit', '--quiet', '--amend', '--message', 'rewritten');
    const second = upstream.git('rev-parse', 'HEAD');
    upstream.git('push', '--quiet', '--force', bare, 'topic:refs/pull/7/head');
    expect(await fetchRefs(git, 'origin', spec)).toEqual({ ok: true, value: undefined });
    expect(await resolveRevision(git, 'refs/beuve/pr/7/head')).toEqual({ ok: true, value: second });
    expect(clone.git('tag', '--list')).toBe('');
    expect(clone.git('for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes')).toBe('');
  });

  it('refuses destinations outside refs/beuve/, option-like remotes and unsafe refs', async () => {
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

  it('reports a ref the remote lacks as a failed command', async () => {
    const missing = await fetchRefs(git, 'origin', ['+refs/pull/9/head:refs/beuve/pr/9/head']);
    expect(missing).toMatchObject({ ok: false, error: { kind: 'command-failed' } });
  });
});
