import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { planRadarTree } from './plan-radar-tree.ts';
import type { RadarTreeInput } from './plan-radar-tree.ts';

function input(): RadarTreeInput {
  return {
    paths: [
      'package.json',
      'packages/web/package.json',
      'packages/web/src/app.ts',
      'packages/web/src/view/list.ts',
      'packages/api/package.json',
      'packages/api/src/server.ts',
      'README.md',
    ],
    packageRoots: ['', 'packages/api', 'packages/web'],
    files: [
      { path: 'packages/web/src/view/list.ts', status: 'modified' },
      { path: 'packages/web/src/old.ts', status: 'deleted' },
      { path: 'README.md', status: 'copied' },
    ],
  };
}

describe('planRadarTree', () => {
  test('lists the whole tree in neighborhood mode and opens the way to each change', ({
    expect,
  }) => {
    const plan = planRadarTree(input(), 'neighborhood');
    expect(plan.paths).toStrictEqual([...input().paths, 'packages/web/src/old.ts']);
    expect(plan.expandedPaths).toStrictEqual([
      'packages',
      'packages/web',
      'packages/web/src',
      'packages/web/src/view',
    ]);
    expect(plan.gitStatus).toStrictEqual([
      { path: 'packages/web/src/view/list.ts', status: 'modified' },
      { path: 'packages/web/src/old.ts', status: 'deleted' },
      { path: 'README.md', status: 'added' },
    ]);
  });

  test('lists only the changed files in diff-only mode', ({ expect }) => {
    const plan = planRadarTree(input(), 'diff-only');
    expect(plan.paths).toStrictEqual(input().files.map((file) => file.path));
    expect(plan.expandedPaths).toStrictEqual(planRadarTree(input(), 'neighborhood').expandedPaths);
  });

  test('maps each changed file to its innermost package root', ({ expect }) => {
    const plan = planRadarTree(input(), 'neighborhood');
    expect([...plan.packageOf]).toStrictEqual([
      ['packages/web/src/view/list.ts', 'packages/web'],
      ['packages/web/src/old.ts', 'packages/web'],
      ['README.md', ''],
    ]);
    const noRoots = planRadarTree({ ...input(), packageRoots: [] }, 'diff-only');
    expect(noRoots.packageOf.get('README.md')).toBe('');
  });

  test('works before the tree has loaded', ({ expect }) => {
    const plan = planRadarTree({ ...input(), paths: [], packageRoots: [] }, 'neighborhood');
    expect(plan.paths).toStrictEqual(input().files.map((file) => file.path));
  });

  test('narrows the listing to paths containing every term, ignoring case', ({ expect }) => {
    const plan = planRadarTree(input(), 'neighborhood', { layout: 'tree', query: 'WEB  src' });
    expect(plan.paths).toStrictEqual([
      'packages/web/src/app.ts',
      'packages/web/src/view/list.ts',
      'packages/web/src/old.ts',
    ]);
    expect(plan.gitStatus).toStrictEqual([
      { path: 'packages/web/src/view/list.ts', status: 'modified' },
      { path: 'packages/web/src/old.ts', status: 'deleted' },
    ]);
  });

  test('filters the changed files alone in diff-only mode', ({ expect }) => {
    const plan = planRadarTree(input(), 'diff-only', { layout: 'tree', query: 'readme' });
    expect(plan.paths).toStrictEqual(['README.md']);
  });

  test('opens the way to every match while a filter is set', ({ expect }) => {
    const plan = planRadarTree(input(), 'neighborhood', { layout: 'tree', query: 'server' });
    expect(plan.paths).toStrictEqual(['packages/api/src/server.ts']);
    expect(plan.expandedPaths).toStrictEqual(['packages', 'packages/api', 'packages/api/src']);
  });

  test('lists nothing when no path matches', ({ expect }) => {
    const plan = planRadarTree(input(), 'neighborhood', { layout: 'tree', query: 'zzz' });
    expect(plan.paths).toStrictEqual([]);
    expect(plan.gitStatus).toStrictEqual([]);
  });

  test('opens no directories in the flat layout', ({ expect }) => {
    const plan = planRadarTree(input(), 'neighborhood', { layout: 'flat', query: '' });
    expect(plan.paths).toStrictEqual(planRadarTree(input(), 'neighborhood').paths);
    expect(plan.expandedPaths).toStrictEqual([]);
  });
});
