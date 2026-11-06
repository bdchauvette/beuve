import { describe } from 'vitest';

import { test } from '../testing/test.ts';
import { queueStacksFrom } from './queue-stacks-from.ts';
import type { StackNode } from './queue-stacks-from.ts';

function pull(number: number, branches: string): StackNode {
  const [baseBranch, branch] = branches.split('<-', 2);
  return {
    key: `github.com/o/r#${String(number)}`,
    host: 'github.com',
    owner: 'o',
    repo: 'r',
    number,
    branch,
    baseBranch,
    isFork: false,
  };
}

function stacksOf(nodes: readonly StackNode[], queued: readonly number[]): Record<string, string> {
  const stacks = queueStacksFrom({
    nodes,
    queued: new Set(queued.map((number) => `github.com/o/r#${String(number)}`)),
  });
  return Object.fromEntries(
    stacks.entries().map(([key, { id, depth, size, position }]) => {
      return [
        key.replace('github.com/o/r', ''),
        `${id.replace('github.com/o/r', '')} d${String(depth)} p${String(position)}/${String(size)}`,
      ];
    }),
  );
}

describe('queueStacksFrom', () => {
  test('stacks pull requests whose base is another one’s head, bottom first', ({ expect }) => {
    const nodes = [
      pull(3, 'b<-c'),
      pull(1, 'main<-a'),
      pull(2, 'a<-b'),
      pull(9, 'main<-lone'),
      { ...pull(4, 'a<-other'), repo: 'R' },
    ];
    expect(stacksOf(nodes, [1, 2, 3, 4, 9])).toStrictEqual({
      '#1': '#1 d0 p0/4',
      '#2': '#1 d1 p1/4',
      '#3': '#1 d2 p2/4',
      '#4': '#1 d1 p3/4',
    });
  });

  test('keeps a stack whose middle is not queued in one piece', ({ expect }) => {
    const nodes = [pull(1, 'main<-a'), pull(2, 'a<-b'), pull(3, 'b<-c')];
    expect(stacksOf(nodes, [1, 3])).toStrictEqual({
      '#1': '#1 d0 p0/3',
      '#2': '#1 d1 p1/3',
      '#3': '#1 d2 p2/3',
    });
  });

  test('a stack where only the top is queued keeps the bottom as its id', ({ expect }) => {
    const nodes = [pull(5, 'b<-c'), pull(4, 'a<-b'), pull(2, 'main<-a')];
    expect(stacksOf(nodes, [5])).toStrictEqual({
      '#2': '#2 d0 p0/3',
      '#4': '#2 d1 p1/3',
      '#5': '#2 d2 p2/3',
    });
  });

  test('branches: two pull requests on one base, each before what sits on it', ({ expect }) => {
    const nodes = [
      pull(1, 'main<-a'),
      pull(7, 'a<-y'),
      pull(3, 'a<-x'),
      pull(8, 'x<-z'),
      pull(9, 'main<-other'),
    ];
    expect(stacksOf(nodes, [7])).toStrictEqual({
      '#1': '#1 d0 p0/4',
      '#3': '#1 d1 p1/4',
      '#8': '#1 d2 p2/4',
      '#7': '#1 d1 p3/4',
    });
  });

  test('leaves out stacks with nothing queued, forks’ heads and cycles', ({ expect }) => {
    expect(stacksOf([pull(1, 'main<-a'), pull(2, 'a<-b')], [])).toStrictEqual({});
    const fork = { ...pull(1, 'main<-a'), isFork: true };
    expect(stacksOf([fork, pull(2, 'a<-b')], [1, 2])).toStrictEqual({});
    expect(stacksOf([pull(1, 'b<-a'), pull(2, 'a<-b')], [1, 2])).toStrictEqual({});
  });
});
