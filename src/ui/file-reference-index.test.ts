import { describe } from 'vitest';

import { FileReferenceIndex } from './file-reference-index.ts';
import { test } from './testing/test.ts';

function indexOf(): FileReferenceIndex {
  return new FileReferenceIndex([
    'src/ui/beuve-review.ts',
    'src/ui/path-text.ts',
    'src/main/path-text.ts',
    'README.md',
    'Makefile',
  ]);
}

describe('FileReferenceIndex', () => {
  test.for([
    ['src/ui/beuve-review.ts', { path: 'src/ui/beuve-review.ts', lines: undefined }],
    ['./README.md', { path: 'README.md', lines: undefined }],
    ['Makefile', { path: 'Makefile', lines: undefined }],
    [
      'src/ui/beuve-review.ts:12',
      { path: 'src/ui/beuve-review.ts', lines: { start: 12, end: 12 } },
    ],
    [
      'src/ui/beuve-review.ts:12-20',
      { path: 'src/ui/beuve-review.ts', lines: { start: 12, end: 20 } },
    ],
    [
      'src/ui/beuve-review.ts:12–20',
      { path: 'src/ui/beuve-review.ts', lines: { start: 12, end: 20 } },
    ],
    [
      'src/ui/beuve-review.ts:12:5',
      { path: 'src/ui/beuve-review.ts', lines: { start: 12, end: 12 } },
    ],
    [
      'src/ui/beuve-review.ts#L3-L7',
      { path: 'src/ui/beuve-review.ts', lines: { start: 3, end: 7 } },
    ],
    ['src/ui/beuve-review.ts#L3', { path: 'src/ui/beuve-review.ts', lines: { start: 3, end: 3 } }],
  ] as const)('reads %s', ([text, expected], { expect }) => {
    expect(indexOf().resolve(text)).toStrictEqual(expected);
  });

  test('takes a unique tail from a directory boundary', ({ expect }) => {
    const index = indexOf();
    expect(index.resolve('beuve-review.ts:4')).toStrictEqual({
      path: 'src/ui/beuve-review.ts',
      lines: { start: 4, end: 4 },
    });
    expect(index.resolve('ui/path-text.ts')).toStrictEqual({
      path: 'src/ui/path-text.ts',
      lines: undefined,
    });
  });

  test('leaves a tail that several files end in unresolved', ({ expect }) => {
    expect(indexOf().resolve('path-text.ts')).toBeUndefined();
  });

  test('finds the repository path at the end of an absolute one', ({ expect }) => {
    expect(indexOf().resolve('/home/me/checkout/src/ui/path-text.ts:9')).toStrictEqual({
      path: 'src/ui/path-text.ts',
      lines: { start: 9, end: 9 },
    });
  });

  test('names nothing outside the index', ({ expect }) => {
    const index = indexOf();
    expect(index.resolve('src/ui/missing.ts')).toBeUndefined();
    expect(index.resolve('review.ts')).toBeUndefined();
    expect(index.resolve('ui')).toBeUndefined();
    expect(index.resolve('https://example.com/README.md')).toBeUndefined();
    expect(index.resolve('')).toBeUndefined();
  });

  test('keeps the first line of a backwards range and drops line 0', ({ expect }) => {
    const index = indexOf();
    expect(index.resolve('README.md:9-3')?.lines).toStrictEqual({ start: 9, end: 9 });
    expect(index.resolve('README.md:0')?.lines).toBeUndefined();
  });

  test('is empty with no paths', ({ expect }) => {
    expect(new FileReferenceIndex([]).isEmpty).toBe(true);
    expect(indexOf().isEmpty).toBe(false);
  });
});
