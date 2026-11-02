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

  test('hoists Markdown into a docs group ahead of the code, in path order', ({ expect }) => {
    const groups = orderReviewFiles([
      file('src/a.ts'),
      file('docs/z.md'),
      file('README.md'),
      file('CHANGELOG.md', 'formatting-only'),
    ]);
    const summary = groups.map(({ id, paths }) => {
      return { id, paths };
    });
    expect(summary).toStrictEqual([
      { id: 'docs', paths: ['README.md', 'docs/z.md'] },
      { id: 'changes', paths: ['src/a.ts'] },
      { id: 'config-and-mechanical', paths: ['CHANGELOG.md'] },
    ]);
  });

  test('puts the files that use others before the files they use', ({ expect }) => {
    const [changes] = orderReviewFiles(
      [file('app.ts'), file('lib/a.ts'), file('lib/b.ts'), file('z-util.ts'), file('other.ts')],
      [
        { dependent: 'app.ts', dependency: 'lib/a.ts' },
        { dependent: 'lib/a.ts', dependency: 'z-util.ts' },
        { dependent: 'app.ts', dependency: 'lib/b.ts' },
        { dependent: 'lib/b.ts', dependency: 'z-util.ts' },
      ],
    );
    expect(changes?.label).toBe('Changes, importers first');
    expect(changes?.paths).toStrictEqual([
      'app.ts',
      'lib/a.ts',
      'lib/b.ts',
      'other.ts',
      'z-util.ts',
    ]);
  });

  test('breaks cycles at the first path in sorted order, every time', ({ expect }) => {
    const edges = [
      { dependent: 'a.ts', dependency: 'b.ts' },
      { dependent: 'b.ts', dependency: 'c.ts' },
      { dependent: 'c.ts', dependency: 'a.ts' },
    ];
    const files = [file('c.ts'), file('a.ts'), file('b.ts')];
    const first = orderReviewFiles(files, edges)[0]?.paths;
    const shuffled = orderReviewFiles(files.toReversed(), edges.toReversed())[0]?.paths;
    expect(first).toStrictEqual(['c.ts', 'a.ts', 'b.ts']);
    expect(shuffled).toStrictEqual(first);
  });

  test('ignores self edges, duplicate edges and edges outside the ordinary files', ({ expect }) => {
    const [changes] = orderReviewFiles(
      [file('a.ts'), file('b.ts'), file('package.json', 'config')],
      [
        { dependent: 'a.ts', dependency: 'a.ts' },
        { dependent: 'a.ts', dependency: 'b.ts' },
        { dependent: 'a.ts', dependency: 'b.ts' },
        { dependent: 'a.ts', dependency: 'package.json' },
        { dependent: 'a.ts', dependency: 'unchanged.ts' },
        { dependent: 'unchanged.ts', dependency: 'a.ts' },
      ],
    );
    expect(changes?.paths).toStrictEqual(['a.ts', 'b.ts']);
  });

  test('omits empty groups', ({ expect }) => {
    expect(orderReviewFiles([])).toStrictEqual([]);
    expect(orderReviewFiles([file('go.sum', 'lockfile')]).map(({ id }) => id)).toStrictEqual([
      'config-and-mechanical',
    ]);
  });

  test('walks a long chain without recursing', ({ expect }) => {
    const names = Array.from({ length: 20_000 }, (_, index) => {
      return `f${String(index).padStart(5, '0')}.ts`;
    });
    const chain = names.slice(1).map((name, index): DependencyEdge => {
      return { dependent: names[index] ?? '', dependency: name };
    });
    const [changes] = orderReviewFiles(
      names.map((name) => file(name)),
      chain,
    );
    expect(changes?.paths[0]).toBe('f00000.ts');
    expect(changes?.paths).toHaveLength(20_000);
  });
});

function file(path: string, mechanical?: MechanicalReason): OrderableFile {
  return { path, mechanical };
}
