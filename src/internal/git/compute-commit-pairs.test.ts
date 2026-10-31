import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { computeCommitPairs } from './compute-commit-pairs.ts';
import type { CommitPair } from './compute-commit-pairs.ts';
import type { CommitSha } from './object-id.ts';
import { openRepository } from './open-repository.ts';
import type { RepositoryTemplate, TestRepository } from './testing/test-repository.ts';
import { test } from './testing/test.ts';

describe('computeCommitPairs', () => {
  test('pairs like git range-diff, with a per-pair interdiff for the modified commit', async ({
    expect,
    repositories,
    signal,
  }) => {
    const { repo, value: series } = await repositories.fromTemplate(reworkedSeries());
    const git = okValueFrom(await openRepository(repo.directory, { signal }));
    const result = okValueFrom(await computeCommitPairs(git, series.previous, series.next));
    const ours = result.pairs.map((pair) => describePair(pair));
    expect(ours).toStrictEqual(['=change a ten', '!change b twenty (and 21)', '<add c', '>add d']);
    expect(ours).toStrictEqual(await rangeDiff(repo, series.previous, series.next));

    expect(result.pairs[1]).toMatchObject({
      kind: 'modified',
      interdiff: { kind: 'clean', files: [{ path: 'b.txt', hunks: [{ newStart: 18 }] }] },
    });
    expect(result.pairs[1]).toMatchObject({
      interdiff: { files: [{ patch: expect.stringContaining('-21\n+twentyone\n') as unknown }] },
    });
    expect(result.nextCommits.map(({ subject }) => subject)).toStrictEqual([
      'change a ten',
      'change b twenty (and 21)',
      'add d',
    ]);
  });

  test('caps the per-pair interdiffs', async ({ expect, repositories, signal }) => {
    const { repo, value: series } = await repositories.fromTemplate(reworkedSeries());
    const git = okValueFrom(await openRepository(repo.directory, { signal }));
    const result = await computeCommitPairs(git, series.previous, series.next, {
      maxInterdiffs: 0,
    });
    expect(okValueFrom(result).pairs[1]).toMatchObject({
      kind: 'modified',
      interdiff: { kind: 'skipped', reason: 'too-many-pairs' },
    });
  });
});

interface Range {
  readonly base: CommitSha;
  readonly head: CommitSha;
}

/** A series rebased onto a moved main: one commit kept, one amended, one dropped, one added. */
function reworkedSeries(): RepositoryTemplate<{ readonly previous: Range; readonly next: Range }> {
  return {
    name: 'compute-commit-pairs: reworked series',
    build: async (repo): Promise<{ readonly previous: Range; readonly next: Range }> => {
      const fiftyLines = `${Array.from({ length: 50 }, (_, index) => String(index + 1)).join('\n')}\n`;
      const replaceLine = async (file: string, line: number, content: string): Promise<void> => {
        const shown = await repo.git('show', `HEAD:${file}`);
        const lines = shown.split('\n');
        repo.write(file, `${lines.with(line - 1, content).join('\n')}\n`);
      };
      repo.write('a.txt', fiftyLines);
      repo.write('b.txt', fiftyLines);
      const base = await repo.commit('base');
      await repo.git('switch', '--quiet', '--create', 'topic');
      await replaceLine('a.txt', 10, 'ten');
      await repo.commit('change a ten');
      await replaceLine('b.txt', 20, 'twenty');
      await repo.commit('change b twenty');
      repo.write('c.txt', 'new\n');
      const oldHead = await repo.commit('add c');
      await repo.git('switch', '--quiet', 'main');
      await replaceLine('a.txt', 40, 'forty');
      const newBase = await repo.commit('upstream');
      await repo.git('switch', '--quiet', 'topic');
      await repo.git('rebase', '--quiet', 'main');
      await repo.git('reset', '--quiet', '--hard', 'HEAD~1');
      await replaceLine('b.txt', 21, 'twentyone');
      await repo.git(
        'commit',
        '--quiet',
        '--amend',
        '--all',
        '--message',
        'change b twenty (and 21)',
      );
      repo.write('d.txt', 'd\n');
      const newHead = await repo.commit('add d');
      return { previous: { base, head: oldHead }, next: { base: newBase, head: newHead } };
    },
  };
}

/** `=` unchanged, `!` modified, `<` dropped, `>` added, then the subject range-diff prints. */
function describePair(pair: CommitPair): string {
  switch (pair.kind) {
    case 'unchanged': {
      return `=${pair.next.subject}`;
    }
    case 'modified': {
      return `!${pair.next.subject}`;
    }
    case 'dropped': {
      return `<${pair.previous.subject}`;
    }
    case 'added': {
      return `>${pair.next.subject}`;
    }
  }
}

/** `git range-diff`'s own pairing, for agreement on the same ranges. */
async function rangeDiff(
  repo: TestRepository,
  previous: { base: string; head: string },
  next: { base: string; head: string },
): Promise<string[]> {
  const output = await repo.git(
    'range-diff',
    '--no-color',
    '--no-patch',
    `${previous.base}..${previous.head}`,
    `${next.base}..${next.head}`,
  );
  const log = await repo.git('log', '--format=%h %s', `${next.base}..${next.head}`);
  const subjects = new Map(
    log.split('\n').map((line) => {
      return [line.slice(0, line.indexOf(' ')), line.slice(line.indexOf(' ') + 1)];
    }),
  );
  return output.split('\n').map((line) => {
    const match = /^\s*\S+:\s+\S+ ([=!<>]) \s*\S+:\s+(\S+) (.*)$/u.exec(line);
    if (match === null) {
      throw new Error(`unexpected range-diff line: ${line}`);
    }
    const [, sign = '', newSha = '', subject = ''] = match;
    return `${sign}${subjects.get(newSha) ?? subject}`;
  });
}
