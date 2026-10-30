import { describe, expect, it } from 'vitest';

import type { CommitPairView } from '#contract/ipc-contract.ts';

import { describeCommitPair } from './describe-commit-pair.ts';

const oldSha = 'a'.repeat(40);
const newSha = 'b'.repeat(40);

describe('describeCommitPair', () => {
  it('describes a modified pair with both shas, its stats and its interdiff', () => {
    const pair: CommitPairView = {
      id: newSha,
      kind: 'modified',
      subject: 'parse input, handle errors',
      previous: { sha: oldSha, subject: 'parse input', additions: 4, deletions: 0 },
      next: { sha: newSha, subject: 'parse input, handle errors', additions: 5, deletions: 1 },
      similarity: 0.756,
      interdiff: { kind: 'clean', files: [] },
    };
    expect(describeCommitPair(pair)).toEqual({
      id: newSha,
      kind: 'modified',
      commits: 'aaaaaaa → bbbbbbb',
      chip: 'changed',
      subject: 'parse input, handle errors',
      stats: '+5 −1',
      title: [
        `was ${oldSha}`,
        `now ${newSha}`,
        'previously “parse input”',
        '76% of changed lines in common',
        'changed since review in 0 files',
      ].join('\n'),
      isFilterable: true,
    });
  });

  it('marks a dropped commit with a dot for the new side and makes it unfilterable', () => {
    const row = describeCommitPair({
      id: oldSha,
      kind: 'dropped',
      subject: 'add c',
      previous: { sha: oldSha, subject: 'add c', additions: 1, deletions: 0 },
    });
    expect(row).toMatchObject({
      commits: 'aaaaaaa → ·',
      chip: 'dropped',
      stats: '+1 −0',
      isFilterable: false,
    });
    expect(row.title).toBe(`was ${oldSha}\nno longer in this pull request`);
  });

  it('leaves the stats empty for an empty commit and explains a missing interdiff', () => {
    const row = describeCommitPair({
      id: newSha,
      kind: 'modified',
      subject: 'bump',
      previous: { sha: oldSha, subject: 'bump', additions: 0, deletions: 0 },
      next: { sha: newSha, subject: 'bump', additions: 0, deletions: 0 },
      interdiff: { kind: 'unavailable', reason: 'too-many-pairs' },
    });
    expect(row.stats).toBe('');
    expect(row.title).toContain('too many changed commits');
    expect(
      describeCommitPair({
        id: newSha,
        kind: 'added',
        subject: 'docs',
        next: { sha: newSha, subject: 'docs', additions: 2, deletions: 0 },
      }).commits,
    ).toBe('· → bbbbbbb');
  });
});
