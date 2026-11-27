import { describe } from 'vitest';

import { isUraItemPosted } from './is-ura-item-posted.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';
import type { UraPostingPiece } from './ura-posting.ts';

describe('isUraItemPosted', () => {
  test.for<[string, readonly UraPostingPiece[], boolean]>([
    ['nothing posted', [], false],
    ['only the text', [{ kind: 'note' }], false],
    ['only the suggestions', [suggestion(0), suggestion(1)], false],
    ['the text and one of two suggestions', [{ kind: 'note' }, suggestion(1)], false],
    ['every piece', [suggestion(1), { kind: 'note' }, suggestion(0)], true],
  ])('with %s is %s', ([, pieces, expected], { expect }) => {
    const item = createTestUraItem({
      suggestions: [
        { path: 'src/app.ts', startLine: 10, endLine: 10, replacement: 'a' },
        { path: 'src/b.ts', startLine: 1, endLine: 0, replacement: 'b' },
      ],
    });
    const postings = pieces.map((piece) => {
      return { itemId: item.id, piece };
    });
    expect(isUraItemPosted(item, postings)).toBe(expected);
  });

  test('reads only the item’s own postings, and takes a note without suggestions by its text', ({
    expect,
  }) => {
    const item = createTestUraItem();
    expect(isUraItemPosted(item, [{ itemId: testUraIds.itemId(9), piece: { kind: 'note' } }])).toBe(
      false,
    );
    expect(isUraItemPosted(item, [{ itemId: item.id, piece: { kind: 'note' } }])).toBe(true);
  });
});

function suggestion(position: number): UraPostingPiece {
  return { kind: 'suggestion', position };
}
