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
  }) => {
    const { repo, value: series } = repositories.fromTemplate(reworkedSeries());
    const git = okValueFrom(await openRepository(repo.directory));
    const result = okValueFrom(await computeCommitPairs(git, series.previous, series.next));
    const ours = result.pairs.map((pair) => describePair(pair));
    expect(ours).toStrictEqual(['=change a ten', '!change b twenty (and 21)', '<add c', '>add d']);
    expect(ours).toStrictEqual(rangeDiff(repo, series.previous, series.next));

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

  test('caps the per-pair interdiffs', async ({ expect, repositories }) => {
    const { repo, value: series } = repositories.fromTemplate(reworkedSeries());
    const git = okValueFrom(await openRepository(repo.directory));
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
    build: (repo): { readonly previous: Range; readonly next: Range } => {
      const fiftyLines = `${Array.from({ length: 50 }, (_, index) => String(index + 1)).join('\n')}\n`;
      const replaceLine = (file: string, line: number, content: string): void => {
        const lines = repo.git('show', `HEAD:${file}`).split('\n');
        repo.write(file, `${lines.with(line - 1, content).join('\n')}\n`);
      };
      repo.write('a.txt', fiftyLines);
      repo.write('b.txt', fiftyLines);
      const base = repo.commit('base');
      repo.git('switch', '--quiet', '--create', 'topic');
      replaceLine('a.txt', 10, 'ten');
      repo.commit('change a ten');
      replaceLine('b.txt', 20, 'twenty');
      repo.commit('change b twenty');
      repo.write('c.txt', 'new\n');
      const oldHead = repo.commit('add c');
      repo.git('switch', '--quiet', 'main');
      replaceLine('a.txt', 40, 'forty');
      const newBase = repo.commit('upstream');
      repo.git('switch', '--quiet', 'topic');
      repo.git('rebase', '--quiet', 'main');
      repo.git('reset', '--quiet', '--hard', 'HEAD~1');
      replaceLine('b.txt', 21, 'twentyone');
      repo.git('commit', '--quiet', '--amend', '--all', '--message', 'change b twenty (and 21)');
      repo.write('d.txt', 'd\n');
      const newHead = repo.commit('add d');
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
function rangeDiff(
  repo: TestRepository,
  previous: { base: string; head: string },
  next: { base: string; head: string },
): string[] {
  const output = repo.git(
    'range-diff',
    '--no-color',
    '--no-patch',
    `${previous.base}..${previous.head}`,
    `${next.base}..${next.head}`,
  );
  const subjects = new Map(
    repo
      .git('log', '--format=%h %s', `${next.base}..${next.head}`)
      .split('\n')
      .map((line) => [line.slice(0, line.indexOf(' ')), line.slice(line.indexOf(' ') + 1)]),
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
