import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { resolveNoteListVerdict } from './resolve-note-list-verdict.ts';

describe('resolveNoteListVerdict', () => {
  test('uses the derived verdict until the reviewer picks another', ({ expect }) => {
    expect(resolveNoteListVerdict(undefined, 'comment', 0)).toStrictEqual({
      value: 'comment',
      source: 'derived',
    });
    expect(resolveNoteListVerdict('comment', 'comment', 0)).toStrictEqual({
      value: 'comment',
      source: 'derived',
    });
    expect(resolveNoteListVerdict('approve', 'comment', 0)).toStrictEqual({
      value: 'approve',
      source: 'chosen',
    });
    expect(resolveNoteListVerdict('request-changes', 'approve', 0)).toStrictEqual({
      value: 'request-changes',
      source: 'chosen',
    });
  });

  test('refuses to approve over staged blocking notes, keeping the derived verdict', ({
    expect,
  }) => {
    expect(resolveNoteListVerdict('approve', 'request-changes', 1)).toStrictEqual({
      value: 'request-changes',
      source: 'derived',
      refusal: "Can't approve while a blocking note is staged: withdraw it or turn off Blocking.",
    });
    expect(resolveNoteListVerdict('approve', 'request-changes', 2).refusal).toContain(
      '2 blocking notes are staged',
    );
    expect(resolveNoteListVerdict('comment', 'request-changes', 2)).toStrictEqual({
      value: 'comment',
      source: 'chosen',
    });
  });
});
