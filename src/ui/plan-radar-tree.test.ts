import { describe, expect, it } from 'vitest';

import { planRadarTree } from './plan-radar-tree.ts';
import type { RadarTreeInput } from './plan-radar-tree.ts';

const input: RadarTreeInput = {
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

describe('planRadarTree', () => {
  it('lists the whole tree in neighborhood mode and opens the way to each change', () => {
    const plan = planRadarTree(input, 'neighborhood');
    expect(plan.paths).toEqual([...input.paths, 'packages/web/src/old.ts']);
    expect(plan.expandedPaths).toEqual([
      'packages',
      'packages/web',
      'packages/web/src',
      'packages/web/src/view',
    ]);
    expect(plan.gitStatus).toEqual([
      { path: 'packages/web/src/view/list.ts', status: 'modified' },
      { path: 'packages/web/src/old.ts', status: 'deleted' },
      { path: 'README.md', status: 'added' },
    ]);
  });

  it('lists only the changed files in diff-only mode', () => {
    const plan = planRadarTree(input, 'diff-only');
    expect(plan.paths).toEqual(input.files.map((file) => file.path));
    expect(plan.expandedPaths).toEqual(planRadarTree(input, 'neighborhood').expandedPaths);
  });

  it('maps each changed file to its innermost package root', () => {
    const plan = planRadarTree(input, 'neighborhood');
    expect([...plan.packageOf]).toEqual([
      ['packages/web/src/view/list.ts', 'packages/web'],
      ['packages/web/src/old.ts', 'packages/web'],
      ['README.md', ''],
    ]);
    const noRoots = planRadarTree({ ...input, packageRoots: [] }, 'diff-only');
    expect(noRoots.packageOf.get('README.md')).toBe('');
  });

  it('works before the tree has loaded', () => {
    const plan = planRadarTree({ ...input, paths: [], packageRoots: [] }, 'neighborhood');
    expect(plan.paths).toEqual(input.files.map((file) => file.path));
  });
});
