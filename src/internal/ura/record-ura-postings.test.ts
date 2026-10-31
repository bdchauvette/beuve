import { describe } from 'vitest';

import { insertUraItem } from './insert-ura-item.ts';
import { listUraPostings } from './list-ura-postings.ts';
import { recordUraPostings } from './record-ura-postings.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import type { UraPosting } from './ura-posting.ts';
import { test } from './testing/test.ts';

describe('recordUraPostings', () => {
  test('records, replaces and lists postings, which cascade with their item', ({ expect, db }) => {
    const first = createTestUraItem({ id: testUraIds.itemId(1) });
    const second = createTestUraItem({ id: testUraIds.itemId(2) });
    insertUraItem(db, first);
    insertUraItem(db, second);
    expect(listUraPostings(db, testUraIds.sessionId)).toStrictEqual([]);

    const posting = (itemId: UraPosting['itemId'], at: string): UraPosting => {
      return {
        itemId,
        sessionId: testUraIds.sessionId,
        target: 'github',
        url: 'https://github.com/o/r/pull/1#pullrequestreview-1',
        headSha: testUraIds.headSha,
        placement: 'inline',
        postedAt: at,
      };
    };
    recordUraPostings(db, [
      posting(first.id, '2026-10-28T12:00:00.000Z'),
      posting(second.id, '2026-10-28T12:00:00.000Z'),
    ]);
    recordUraPostings(db, [
      {
        ...posting(first.id, '2026-10-28T13:00:00.000Z'),
        headSha: testUraIds.laterHeadSha,
        placement: 'body',
      },
    ]);
    expect(listUraPostings(db, testUraIds.sessionId)).toStrictEqual([
      posting(second.id, '2026-10-28T12:00:00.000Z'),
      {
        ...posting(first.id, '2026-10-28T13:00:00.000Z'),
        headSha: testUraIds.laterHeadSha,
        placement: 'body',
      },
    ]);

    db.prepare('DELETE FROM ura_items WHERE id = ?;').run(second.id);
    expect(listUraPostings(db, testUraIds.sessionId).map((entry) => entry.itemId)).toStrictEqual([
      first.id,
    ]);
  });

  test('rejects an unknown item', ({ expect, db }) => {
    expect(() => {
      recordUraPostings(db, [
        {
          itemId: testUraIds.itemId(9),
          sessionId: testUraIds.sessionId,
          target: 'github',
          url: 'https://github.com/o/r/pull/1',
          headSha: testUraIds.headSha,
          placement: 'inline',
          postedAt: '2026-10-28T12:00:00.000Z',
        },
      ]);
    }).toThrow('FOREIGN KEY');
  });
});
