import { describe } from 'vitest';

import { test } from '../testing/test.ts';
import { queueStacksFrom } from './queue-stacks-from.ts';
import type { StackableItem } from './queue-stacks-from.ts';

function pull(number: number, branches: string): StackableItem {
  const [baseBranch, branch] = branches.split('<-', 2);
  return {
    key: `github.com/o/r#${String(number)}`,
    kind: 'pull-request',
    host: 'github.com',
    owner: 'o',
    repo: 'r',
    ...(branch !== undefined && { branch }),
    ...(baseBranch !== undefined && { baseBranch }),
  };
}

describe('queueStacksFrom', () => {
  test('stacks pull requests whose base is another queued head, bottom first', ({ expect }) => {
    const stacks = queueStacksFrom([
      pull(3, 'b<-c'),
      pull(1, 'main<-a'),
      pull(2, 'a<-b'),
      pull(9, 'main<-lone'),
      { ...pull(4, 'a<-other'), repo: 'R' },
    ]);
    expect(Object.fromEntries(stacks)).toStrictEqual({
      'github.com/o/r#1': { id: 'github.com/o/r#1', depth: 0, size: 4 },
      'github.com/o/r#2': { id: 'github.com/o/r#1', depth: 1, size: 4 },
      'github.com/o/r#3': { id: 'github.com/o/r#1', depth: 2, size: 4 },
      'github.com/o/r#4': { id: 'github.com/o/r#1', depth: 1, size: 4 },
    });
  });

  test('splits a stack whose middle is not queued, and survives a cycle', ({ expect }) => {
    const split = queueStacksFrom([pull(1, 'main<-a'), pull(3, 'b<-c')]);
    expect(split.size).toBe(0);
    const cycle = queueStacksFrom([pull(1, 'b<-a'), pull(2, 'a<-b')]);
    expect(cycle.size).toBe(0);
  });

  test('never stacks branches without a pull request', ({ expect }) => {
    const branch: StackableItem = {
      key: 'github.com/o/r:claude/x',
      kind: 'branch',
      host: 'github.com',
      owner: 'o',
      repo: 'r',
      branch: 'claude/x',
      baseBranch: 'a',
    };
    expect(queueStacksFrom([pull(1, 'main<-a'), branch]).size).toBe(0);
  });
});
