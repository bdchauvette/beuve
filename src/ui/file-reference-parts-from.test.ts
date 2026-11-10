import { describe } from 'vitest';

import { FileReferenceIndex } from './file-reference-index.ts';
import { fileReferencePartsFrom } from './file-reference-parts-from.ts';
import { test } from './testing/test.ts';

function indexOf(): FileReferenceIndex {
  return new FileReferenceIndex(['src/ui/beuve-review.ts', 'README.md']);
}

describe('fileReferencePartsFrom', () => {
  test('splits prose around the files it names', ({ expect }) => {
    expect(
      fileReferencePartsFrom('See src/ui/beuve-review.ts:12-14. Then README.md: done.', indexOf()),
    ).toStrictEqual([
      { kind: 'text', text: 'See ' },
      {
        kind: 'reference',
        text: 'src/ui/beuve-review.ts:12-14',
        reference: { path: 'src/ui/beuve-review.ts', lines: { start: 12, end: 14 } },
      },
      { kind: 'text', text: '. Then ' },
      {
        kind: 'reference',
        text: 'README.md',
        reference: { path: 'README.md', lines: undefined },
      },
      { kind: 'text', text: ': done.' },
    ]);
  });

  test('reads a name in brackets', ({ expect }) => {
    expect(fileReferencePartsFrom('(README.md)', indexOf())).toStrictEqual([
      { kind: 'text', text: '(' },
      { kind: 'reference', text: 'README.md', reference: { path: 'README.md', lines: undefined } },
      { kind: 'text', text: ')' },
    ]);
  });

  test('leaves prose that names no known file as it is', ({ expect }) => {
    const text = 'The e.g. case in src/other.ts and a/b, version 1.2.';
    expect(fileReferencePartsFrom(text, indexOf())).toStrictEqual([{ kind: 'text', text }]);
  });

  test('looks nothing up with an empty index', ({ expect }) => {
    expect(fileReferencePartsFrom('README.md', new FileReferenceIndex([]))).toStrictEqual([
      { kind: 'text', text: 'README.md' },
    ]);
  });
});
