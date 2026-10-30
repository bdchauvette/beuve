import { describe } from 'vitest';

import type { MechanicalReason } from './mechanical-reason.ts';
import { orderReviewFiles } from './order-review-files.ts';
import type { DependencyEdge, OrderableFile } from './order-review-files.ts';
import { test } from './testing/test.ts';

describe('orderReviewFiles', () => {
  test('orders by path without edges, with config and mechanical files last', ({ expect }) => {
    const groups = orderReviewFiles([
      file('src/b.ts'),
      file('pnpm-lock.yaml', 'lockfile'),
      file('src/a.ts'),
      file('package.json', 'config'),
      file('src/gen.ts', 'generated'),
      file('src/old.ts', 'pure-rename'),
      file('src/fmt.ts', 'formatting-only'),
    ]);
    expect(groups).toStrictEqual([
      { id: 'changes', label: 'Changes', paths: ['src/a.ts', 'src/b.ts'] },
      {
        id: 'config-and-mechanical',
        label: 'Config and mechanical',
        paths: ['package.json', 'src/old.ts', 'src/fmt.ts', 'src/gen.ts', 'pnpm-lock.yaml'],
        reasons: ['config', 'pure-rename', 'formatting-only', 'generated', 'lockfile'],
      },
    ]);
  });

  test('puts dependencies before the files that use them and keeps helpers beside their user', ({
    expect,
  }) => {
    const [changes] = orderReviewFiles(
      [file('app.ts'), file('lib/a.ts'), file('lib/b.ts'), file('z-util.ts'), file('other.ts')],
      [
        edge('app.ts', 'lib/a.ts'),
        edge('lib/a.ts', 'z-util.ts'),
        edge('app.ts', 'lib/b.ts'),
        edge('lib/b.ts', 'z-util.ts'),
      ],
    );
    expect(changes?.label).toBe('Changes, dependencies first');
    expect(changes?.paths).toStrictEqual([
      'z-util.ts',
      'lib/a.ts',
      'lib/b.ts',
      'app.ts',
      'other.ts',
    ]);
  });

  test('breaks cycles at the first path in sorted order, every time', ({ expect }) => {
    const edges = [edge('a.ts', 'b.ts'), edge('b.ts', 'c.ts'), edge('c.ts', 'a.ts')];
    const files = [file('c.ts'), file('a.ts'), file('b.ts')];
    const first = orderReviewFiles(files, edges)[0]?.paths;
    const shuffled = orderReviewFiles(files.toReversed(), edges.toReversed())[0]?.paths;
    expect(first).toStrictEqual(['c.ts', 'b.ts', 'a.ts']);
    expect(shuffled).toStrictEqual(first);
  });

  test('ignores self edges, duplicate edges and edges outside the ordinary files', ({ expect }) => {
    const [changes] = orderReviewFiles(
      [file('a.ts'), file('b.ts'), file('package.json', 'config')],
      [
        edge('a.ts', 'a.ts'),
        edge('a.ts', 'b.ts'),
        edge('a.ts', 'b.ts'),
        edge('a.ts', 'package.json'),
        edge('a.ts', 'unchanged.ts'),
        edge('unchanged.ts', 'a.ts'),
      ],
    );
    expect(changes?.paths).toStrictEqual(['b.ts', 'a.ts']);
  });

  test('omits empty groups', ({ expect }) => {
    expect(orderReviewFiles([])).toStrictEqual([]);
    expect(orderReviewFiles([file('go.sum', 'lockfile')]).map(({ id }) => id)).toStrictEqual([
      'config-and-mechanical',
    ]);
  });

  test('walks a long chain without recursing', ({ expect }) => {
    const names = Array.from(
      { length: 20_000 },
      (_, index) => `f${String(index).padStart(5, '0')}.ts`,
    );
    const chain = names.slice(1).map((name, index) => edge(names[index] ?? '', name));
    const [changes] = orderReviewFiles(
      names.map((name) => file(name)),
      chain,
    );
    expect(changes?.paths[0]).toBe('f19999.ts');
    expect(changes?.paths).toHaveLength(20_000);
  });
});

function file(path: string, mechanical?: MechanicalReason): OrderableFile {
  return { path, mechanical };
}

function edge(dependent: string, dependency: string): DependencyEdge {
  return { dependent, dependency };
}
