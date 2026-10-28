import { describe, expect, it } from 'vitest';

import { selectTests } from './select-tests.ts';

const files = [
  'src/cart/total.ts',
  'src/cart/total.test.ts',
  'src/cart/__tests__/total.ts',
  'test/cart/total.spec.ts',
  'src/cart/checkout.ts',
  'src/cart/checkout.test.ts',
  'src/app.test.ts',
  'src/other.test.ts',
];
const imports = new Map<string, readonly string[]>([
  ['src/cart/checkout.ts', ['src/cart/total.ts']],
  ['src/cart/checkout.test.ts', ['src/cart/checkout.ts']],
  ['src/app.test.ts', ['src/cart/total.ts']],
  ['src/cart/total.test.ts', ['src/cart/total.ts']],
]);

describe('selectTests', () => {
  it('runs a changed test file itself', () => {
    expect(selectTests({ changedPath: 'src/other.test.ts', files, imports })).toEqual([
      { path: 'src/other.test.ts', reason: 'self', distance: 0 },
    ]);
  });

  it('ranks named tests that import the file, then nearby names, then importers', () => {
    expect(selectTests({ changedPath: 'src/cart/total.ts', files, imports, maxFiles: 10 })).toEqual(
      [
        { path: 'src/cart/total.test.ts', reason: 'name', distance: 0 },
        { path: 'src/cart/__tests__/total.ts', reason: 'name', distance: 0 },
        { path: 'test/cart/total.spec.ts', reason: 'name', distance: 0 },
        { path: 'src/app.test.ts', reason: 'imports', distance: 1 },
        { path: 'src/cart/checkout.test.ts', reason: 'transitive', distance: 2 },
      ],
    );
  });

  it('caps the selection and the import depth', () => {
    expect(
      selectTests({ changedPath: 'src/cart/total.ts', files, imports, maxFiles: 1 }),
    ).toHaveLength(1);
    expect(
      selectTests({
        changedPath: 'src/cart/total.ts',
        files: files.filter((file) => !file.includes('total.')),
        imports,
        maxDepth: 1,
      }),
    ).toEqual([{ path: 'src/app.test.ts', reason: 'imports', distance: 1 }]);
  });

  it('finds nothing for an unreferenced file', () => {
    expect(selectTests({ changedPath: 'src/lonely.ts', files, imports })).toEqual([]);
  });
});
