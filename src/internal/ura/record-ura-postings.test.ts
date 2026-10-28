import { describe, expect, it } from 'vitest';

import { insertUraItem } from './insert-ura-item.ts';
import { listUraPostings } from './list-ura-postings.ts';
import { recordUraPostings } from './record-ura-postings.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { createUraTestDatabase } from './testing/create-ura-test-database.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import type { UraPosting } from './ura-posting.ts';

const { sessionId, headSha, laterHeadSha } = testUraIds;

describe('recordUraPostings', () => {
  it('records, replaces and lists postings, which cascade with their item', () => {
    const db = createUraTestDatabase([sessionId]);
    const first = createTestUraItem({ id: testUraIds.itemId(1) });
    const second = createTestUraItem({ id: testUraIds.itemId(2) });
    insertUraItem(db, first);
    insertUraItem(db, second);
    expect(listUraPostings(db, sessionId)).toEqual([]);

    const posting = (itemId: UraPosting['itemId'], at: string): UraPosting => ({
      itemId,
      sessionId,
      target: 'github',
      url: 'https://github.com/o/r/pull/1#pullrequestreview-1',
      headSha,
      placement: 'inline',
      postedAt: at,
    });
    recordUraPostings(db, [
      posting(first.id, '2026-10-28T12:00:00.000Z'),
      posting(second.id, '2026-10-28T12:00:00.000Z'),
    ]);
    recordUraPostings(db, [
      {
        ...posting(first.id, '2026-10-28T13:00:00.000Z'),
        headSha: laterHeadSha,
        placement: 'body',
      },
    ]);
    expect(listUraPostings(db, sessionId)).toEqual([
      posting(second.id, '2026-10-28T12:00:00.000Z'),
      {
        ...posting(first.id, '2026-10-28T13:00:00.000Z'),
        headSha: laterHeadSha,
        placement: 'body',
      },
    ]);

    db.prepare('DELETE FROM ura_items WHERE id = ?;').run(second.id);
    expect(listUraPostings(db, sessionId).map((entry) => entry.itemId)).toEqual([first.id]);
  });

  it('rejects an unknown item', () => {
    const db = createUraTestDatabase([sessionId]);
    expect(() => {
      recordUraPostings(db, [
        {
          itemId: testUraIds.itemId(9),
          sessionId,
          target: 'github',
          url: 'https://github.com/o/r/pull/1',
          headSha,
          placement: 'inline',
          postedAt: '2026-10-28T12:00:00.000Z',
        },
      ]);
    }).toThrow('FOREIGN KEY');
  });
});
