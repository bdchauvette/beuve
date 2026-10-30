import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { ReviewOrderView } from '#contract/ipc-contract.ts';

import { createDiffFileView } from './testing/create-diff-file-view.ts';
import { createTwoHunkFileView } from './testing/create-two-hunk-file-view.ts';
import { planReviewStream } from './plan-review-stream.ts';

function review(): Parameters<typeof planReviewStream>[0] {
  return {
    headSha: 'h1',
    files: [
      createDiffFileView('package.json', ['+x']),
      createTwoHunkFileView(),
      createDiffFileView('src/b.ts', ['+y']),
    ],
    fileAttribution: [
      { path: 'package.json', pairIds: ['c2'], hunkPairIds: [['c2']] },
      { path: 'src/a.ts', pairIds: ['c1', 'c2'], hunkPairIds: [['c1'], ['c2']] },
      { path: 'src/b.ts', pairIds: ['c1'], hunkPairIds: [['c1']] },
    ],
  };
}

function order(headSha = 'h1'): ReviewOrderView {
  return {
    sessionId: 's',
    headSha,
    requestedMode: 'imports',
    mode: 'imports',
    paths: ['src/b.ts', 'src/a.ts', 'package.json'],
    groups: [
      { id: 'changes', label: 'Changes', paths: ['src/b.ts', 'src/a.ts'] },
      {
        id: 'config-and-mechanical',
        label: 'Config & mechanical',
        paths: ['package.json'],
        reasons: ['config'],
      },
    ],
  };
}

describe('planReviewStream', () => {
  test('keeps the review’s own order without an order for its head', ({ expect }) => {
    const plan = planReviewStream(review(), order('h0'), undefined);
    expect(plan.files.map(({ path }) => path)).toStrictEqual([
      'package.json',
      'src/a.ts',
      'src/b.ts',
    ]);
    expect(plan.groupLabels).toStrictEqual(new Map());
  });

  test('orders the files by group and labels every group but the plain changes', ({ expect }) => {
    const plan = planReviewStream(review(), order(), undefined);
    expect(plan.files.map(({ path }) => path)).toStrictEqual([
      'src/b.ts',
      'src/a.ts',
      'package.json',
    ]);
    expect(plan.groupLabels).toStrictEqual(new Map([[2, 'Config & mechanical']]));
  });

  test('appends files the order leaves out', ({ expect }) => {
    const partial: ReviewOrderView = {
      ...order(),
      groups: [{ id: 'changes', label: '', paths: ['src/b.ts'] }],
    };
    const plan = planReviewStream(review(), partial, undefined);
    expect(plan.files.map(({ path }) => path)).toStrictEqual([
      'src/b.ts',
      'package.json',
      'src/a.ts',
    ]);
  });

  test('narrows to a commit pair’s files and hunks, keeping the group labels in place', ({
    expect,
  }) => {
    const plan = planReviewStream(review(), order(), 'c2');
    expect(plan.files.map(({ path, hunks }) => [path, hunks.length])).toStrictEqual([
      ['src/a.ts', 1],
      ['package.json', 1],
    ]);
    expect(plan.groupLabels).toStrictEqual(new Map([[1, 'Config & mechanical']]));
  });
});
