import { describe } from 'vitest';

import { insertUraItem } from './insert-ura-item.ts';
import { listUraPostings } from './list-ura-postings.ts';
import { recordUraPostings } from './record-ura-postings.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import type { UraPosting } from './ura-posting.ts';
import { test } from './testing/test.ts';

describe('recordUraPostings', () => {
  test('records, replaces and lists each piece, which cascade with their item', ({
    expect,
    db,
  }) => {
    const first = createTestUraItem({ id: testUraIds.itemId(1) });
    const second = createTestUraItem({ id: testUraIds.itemId(2) });
    insertUraItem(db, first);
    insertUraItem(db, second);
    expect(listUraPostings(db, testUraIds.sessionId)).toStrictEqual([]);

    const early = '2026-10-28T12:00:00.000Z';
    const late = '2026-10-28T13:00:00.000Z';
    recordUraPostings(db, [
      posting({ itemId: first.id, at: early }),
      posting({ itemId: first.id, at: early, position: 0, placement: 'comment' }),
      posting({ itemId: first.id, at: early, position: 1, placement: 'suggestion-comment' }),
      posting({ itemId: second.id, at: early }),
    ]);
    recordUraPostings(db, [
      { ...posting({ itemId: first.id, at: late, position: 1 }), headSha: testUraIds.laterHeadSha },
    ]);
    expect(listUraPostings(db, testUraIds.sessionId)).toStrictEqual([
      posting({ itemId: first.id, at: early }),
      posting({ itemId: first.id, at: early, position: 0, placement: 'comment' }),
      posting({ itemId: second.id, at: early }),
      { ...posting({ itemId: first.id, at: late, position: 1 }), headSha: testUraIds.laterHeadSha },
    ]);

    db.prepare('DELETE FROM ura_items WHERE id = ?;').run(second.id);
    expect(listUraPostings(db, testUraIds.sessionId).map((entry) => entry.itemId)).toStrictEqual([
      first.id,
      first.id,
      first.id,
    ]);
  });

  test('rejects an unknown item', ({ expect, db }) => {
    expect(() => {
      recordUraPostings(db, [
        posting({ itemId: testUraIds.itemId(9), at: '2026-10-28T12:00:00.000Z' }),
      ]);
    }).toThrow('FOREIGN KEY');
  });

  test('refuses a note’s own text in a suggestion’s comment', ({ expect, db }) => {
    insertUraItem(db, createTestUraItem({ id: testUraIds.itemId(1) }));
    expect(() => {
      recordUraPostings(db, [
        {
          ...posting({ itemId: testUraIds.itemId(1), at: '2026-10-28T12:00:00.000Z' }),
          placement: 'suggestion-comment',
        },
      ]);
    }).toThrow(/CHECK/u);
  });
});

/** Which piece of which item, when, and where it went. */
interface PostingSource {
  readonly itemId: UraPosting['itemId'];
  readonly at: string;
  /** A suggestion's position; the note's own text without one. */
  readonly position?: number;
  readonly placement?: UraPosting['placement'];
}

function posting({ itemId, at, position, placement = 'body' }: PostingSource): UraPosting {
  let piece: UraPosting['piece'] = { kind: 'note' };
  if (position !== undefined) {
    piece = { kind: 'suggestion', position };
  }
  return {
    itemId,
    sessionId: testUraIds.sessionId,
    target: 'github',
    piece,
    url: 'https://github.com/o/r/pull/1#pullrequestreview-1',
    headSha: testUraIds.headSha,
    placement,
    postedAt: at,
  };
}
