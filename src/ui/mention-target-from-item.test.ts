import { describe } from 'vitest';

import { mentionTargetFromItem } from './mention-target-from-item.ts';
import { createDiffFileView } from './testing/create-diff-file-view.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';
import { test } from './testing/test.ts';

function filesOf(): ReturnType<typeof createDiffFileView>[] {
  return [createDiffFileView('src/a.ts', [' one', '-two', '+three', ' four'])];
}

describe('mentionTargetFromItem', () => {
  test('puts a note’s lines in the chat at the head', ({ expect }) => {
    expect(mentionTargetFromItem(createUraItemView(), filesOf())).toStrictEqual({
      path: 'src/a.ts',
      side: 'head',
      startLine: 3,
      endLine: 4,
    });
  });

  test('puts a file note’s file in the chat', ({ expect }) => {
    const item = createUraItemView({
      anchor: { kind: 'file', path: 'src/a.ts' },
      placement: { kind: 'current', anchor: { kind: 'file', path: 'src/a.ts' } },
    });
    expect(mentionTargetFromItem(item, filesOf())).toStrictEqual({
      path: 'src/a.ts',
      side: 'head',
    });
  });

  test('says an outdated note has no lines at this head', ({ expect }) => {
    const item = createUraItemView({
      placement: { kind: 'outdated', reason: 'head-moved' } as never,
    });
    expect(mentionTargetFromItem(item, filesOf())).toBe(
      'That note is outdated: its lines are not at this head.',
    );
  });

  test('says when the note’s file is not in the diff', ({ expect }) => {
    expect(mentionTargetFromItem(createUraItemView(), [])).toBe(
      'That note’s file is not in this diff.',
    );
  });

  test('says a note on the whole change cannot be a chip', ({ expect }) => {
    const item = createUraItemView({
      anchor: { kind: 'change' },
      placement: { kind: 'current', anchor: { kind: 'change' } },
    });
    expect(mentionTargetFromItem(item, filesOf())).toBe(
      'That note is on the whole change; pick a line or file note.',
    );
  });
});
