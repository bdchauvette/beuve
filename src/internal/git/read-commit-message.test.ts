import { describe } from 'vitest';

import { readCommitMessage } from './read-commit-message.ts';
import type { CommitSha } from './object-id.ts';
import { test } from './testing/test.ts';

describe('readCommitMessage', () => {
  test('reads a commit’s message on the object reader, and nothing for other objects', async ({
    expect,
    repo,
    repository: git,
    signal,
  }) => {
    repo.write('a.txt', 'a\n');
    const commit = await repo.commit(
      'subject line\n\nbody\n\nClaude-Session: https://claude.ai/code/x',
    );
    const tree = (await repo.git('show', '--no-patch', '--format=%T', commit)) as CommitSha;

    await expect(readCommitMessage(git, commit, { signal })).resolves.toStrictEqual({
      ok: true,
      value: 'subject line\n\nbody\n\nClaude-Session: https://claude.ai/code/x\n',
    });
    await expect(readCommitMessage(git, tree, { signal })).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
    await expect(
      readCommitMessage(git, 'f'.repeat(40) as CommitSha, { signal }),
    ).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
  });
});
