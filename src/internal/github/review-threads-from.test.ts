import { describe } from 'vitest';

import type { ReviewCommentRecord } from './review-comment-record.ts';
import { reviewThreadsFrom } from './review-threads-from.ts';
import { test } from './testing/test.ts';

function record(id: number, overrides: Partial<ReviewCommentRecord> = {}): ReviewCommentRecord {
  return {
    id,
    replyTo: undefined,
    path: 'src/a.ts',
    side: 'RIGHT',
    isFileLevel: false,
    line: 10,
    startLine: undefined,
    commitId: 'head',
    originalLine: 10,
    originalStartLine: undefined,
    originalCommitId: 'first',
    author: 'rita',
    body: `comment ${String(id)}`,
    at: `2026-10-0${String(id)}T10:00:00Z`,
    url: `https://example.test/${String(id)}`,
    ...overrides,
  };
}

describe('reviewThreadsFrom', () => {
  test('puts a comment on the lines it has now, at the commit it is placed on', ({ expect }) => {
    expect(
      reviewThreadsFrom([record(1, { line: 12, startLine: 10 }), record(2, { side: 'LEFT' })]),
    ).toStrictEqual([
      {
        id: '1',
        path: 'src/a.ts',
        side: 'head',
        startLine: 10,
        endLine: 12,
        sha: 'head',
        isOutdated: false,
        comments: [
          {
            id: '1',
            author: 'rita',
            body: 'comment 1',
            at: '2026-10-01T10:00:00Z',
            url: 'https://example.test/1',
          },
        ],
      },
      expect.objectContaining({ id: '2', side: 'base', startLine: 10, endLine: 10 }),
    ]);
  });

  test('keeps where an outdated comment was first written, and says it is outdated', ({
    expect,
  }) => {
    const [thread] = reviewThreadsFrom([
      record(1, { line: undefined, originalLine: 7, originalStartLine: 5 }),
    ]);
    expect(thread).toMatchObject({
      startLine: 5,
      endLine: 7,
      sha: 'first',
      isOutdated: true,
    });
  });

  test('gives a whole-file comment no lines, and a comment with no place none either', ({
    expect,
  }) => {
    const [file, lost] = reviewThreadsFrom([
      record(1, { isFileLevel: true, line: undefined }),
      record(2, { line: undefined, originalLine: undefined }),
    ]);
    expect(file).toMatchObject({ isOutdated: false, sha: 'head' });
    expect(file).not.toHaveProperty('startLine');
    expect(lost).toMatchObject({ isOutdated: true, sha: 'first' });
    expect(lost).not.toHaveProperty('endLine');
  });

  test('joins replies to the thread of the comment they answer, however deep, in time order', ({
    expect,
  }) => {
    const threads = reviewThreadsFrom([
      record(3, { replyTo: 2 }),
      record(2, { replyTo: 1 }),
      record(1),
      record(4, { line: 40 }),
    ]);
    expect(
      threads.map((thread) => {
        return thread.comments.map((comment) => comment.id);
      }),
    ).toStrictEqual([['1', '2', '3'], ['4']]);
  });

  test('starts a thread from a reply whose parent was not read, and terminates on a cycle', ({
    expect,
  }) => {
    const threads = reviewThreadsFrom([
      record(5, { replyTo: 99 }),
      record(6, { replyTo: 7 }),
      record(7, { replyTo: 6 }),
    ]);
    expect(threads.flatMap((thread) => thread.comments)).toHaveLength(3);
    expect(threads.some((thread) => thread.id === '5')).toBe(true);
  });

  test('orders threads by their first comment, then by id', ({ expect }) => {
    const threads = reviewThreadsFrom([
      record(2, { at: '2026-10-05T10:00:00Z' }),
      record(1, { at: '2026-10-05T10:00:00Z' }),
      record(3, { at: '2026-10-01T10:00:00Z' }),
    ]);
    expect(threads.map((thread) => thread.id)).toStrictEqual(['3', '1', '2']);
  });

  test('is empty without comments', ({ expect }) => {
    expect(reviewThreadsFrom([])).toStrictEqual([]);
  });
});
