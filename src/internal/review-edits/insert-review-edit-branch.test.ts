import { describe } from 'vitest';

import { deleteReviewEditBranch } from './delete-review-edit-branch.ts';
import { findReviewEditBranch } from './find-review-edit-branch.ts';
import { insertReviewEditBranch } from './insert-review-edit-branch.ts';
import { listEditSuggestions } from './list-edit-suggestions.ts';
import { recordEditSuggestion } from './record-edit-suggestion.ts';
import type { CommitSha, ReviewEditBranch, SessionId } from './review-edit-branch.ts';
import { test } from './testing/test.ts';

describe('review-edits ownership', () => {
  test('records one branch per session and refuses a name another session owns', ({
    expect,
    db,
  }) => {
    const mine = branch({ sessionId: 's1', name: 'review/pr-1' });
    expect(insertReviewEditBranch(db, mine)).toStrictEqual({ ok: true, value: undefined });
    expect(findReviewEditBranch(db, { sessionId: 's1' })).toStrictEqual({ ok: true, value: mine });
    expect(findReviewEditBranch(db, { repoPath: '/repo', branch: 'review/pr-1' })).toStrictEqual({
      ok: true,
      value: mine,
    });
    expect(
      insertReviewEditBranch(db, branch({ sessionId: 's2', name: 'review/pr-1' })),
    ).toStrictEqual({
      ok: false,
      error: { kind: 'branch-taken', repoPath: '/repo', branch: 'review/pr-1' },
    });
    expect(
      insertReviewEditBranch(db, branch({ sessionId: 's1', name: 'review/other' })),
    ).toStrictEqual({
      ok: false,
      error: { kind: 'session-taken', sessionId: 's1' },
    });
    expect(findReviewEditBranch(db, { sessionId: 's2' })).toStrictEqual({
      ok: true,
      value: undefined,
    });
  });

  test('remembers harvested suggestions by head and target, and forgets them on discard', ({
    expect,
    db,
  }) => {
    insertReviewEditBranch(db, branch({ sessionId: 's1', name: 'review/pr-1' }));
    const head = 'a'.repeat(40) as CommitSha;
    const first = {
      sessionId: 's1' as SessionId,
      headSha: head,
      target: 'lines:src/a.ts:3-4',
      itemId: 'i1',
      fingerprint: 'f1',
    };
    recordEditSuggestion(db, first);
    recordEditSuggestion(db, { ...first, fingerprint: 'f2' });
    expect(
      listEditSuggestions(db, { sessionId: 's1', headSha: head }).values().toArray(),
    ).toStrictEqual([{ ...first, fingerprint: 'f2' }]);
    db.prepare("DELETE FROM ura_items WHERE id = 'i1';").run();
    expect(listEditSuggestions(db, { sessionId: 's1', headSha: head }).size).toBe(0);
    recordEditSuggestion(db, { ...first, itemId: 'i2' });
    deleteReviewEditBranch(db, 's1');
    expect(listEditSuggestions(db, { sessionId: 's1', headSha: head }).size).toBe(0);
    expect(findReviewEditBranch(db, { sessionId: 's1' })).toStrictEqual({
      ok: true,
      value: undefined,
    });
  });
});

/** A session and the branch name it owns. */
interface Owner {
  readonly sessionId: string;
  readonly name: string;
}

function branch({ sessionId, name }: Owner): ReviewEditBranch {
  return {
    sessionId: sessionId as SessionId,
    repoPath: '/repo',
    branch: name,
    baseSha: 'b'.repeat(40) as CommitSha,
    createdAt: '2026-10-31T12:00:00.000Z',
  };
}
