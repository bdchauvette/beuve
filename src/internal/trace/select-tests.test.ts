import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { selectTests } from './select-tests.ts';

function files(): string[] {
  return [
    'src/cart/total.ts',
    'src/cart/total.test.ts',
    'src/cart/__tests__/total.ts',
    'test/cart/total.spec.ts',
    'src/cart/checkout.ts',
    'src/cart/checkout.test.ts',
    'src/app.test.ts',
    'src/other.test.ts',
  ];
}

function imports(): Map<string, readonly string[]> {
  return new Map<string, readonly string[]>([
    ['src/cart/checkout.ts', ['src/cart/total.ts']],
    ['src/cart/checkout.test.ts', ['src/cart/checkout.ts']],
    ['src/app.test.ts', ['src/cart/total.ts']],
    ['src/cart/total.test.ts', ['src/cart/total.ts']],
  ]);
}

describe('selectTests', () => {
  test('runs a changed test file itself', ({ expect }) => {
    expect(
      selectTests({ changedPath: 'src/other.test.ts', files: files(), imports: imports() }),
    ).toStrictEqual([{ path: 'src/other.test.ts', reason: 'self', distance: 0 }]);
  });

  test('ranks named tests that import the file, then nearby names, then importers', ({
    expect,
  }) => {
    expect(
      selectTests({
        changedPath: 'src/cart/total.ts',
        files: files(),
        imports: imports(),
        maxFiles: 10,
      }),
    ).toStrictEqual([
      { path: 'src/cart/total.test.ts', reason: 'name', distance: 0 },
      { path: 'src/cart/__tests__/total.ts', reason: 'name', distance: 0 },
      { path: 'test/cart/total.spec.ts', reason: 'name', distance: 0 },
      { path: 'src/app.test.ts', reason: 'imports', distance: 1 },
      { path: 'src/cart/checkout.test.ts', reason: 'transitive', distance: 2 },
    ]);
  });

  test('caps the selection and the import depth', ({ expect }) => {
    expect(
      selectTests({
        changedPath: 'src/cart/total.ts',
        files: files(),
        imports: imports(),
        maxFiles: 1,
      }),
    ).toHaveLength(1);
    expect(
      selectTests({
        changedPath: 'src/cart/total.ts',
        files: files().filter((file) => !file.includes('total.')),
        imports: imports(),
        maxDepth: 1,
      }),
    ).toStrictEqual([{ path: 'src/app.test.ts', reason: 'imports', distance: 1 }]);
  });

  test('finds nothing for an unreferenced file', ({ expect }) => {
    expect(
      selectTests({ changedPath: 'src/lonely.ts', files: files(), imports: imports() }),
    ).toStrictEqual([]);
  });
});
