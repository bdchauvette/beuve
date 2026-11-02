import { describe } from 'vitest';

import { mentionTargetFromPalette } from './mention-target-from-palette.ts';
import { createDiffFileView } from './testing/create-diff-file-view.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';
import { test } from './testing/test.ts';

function pick(): string {
  return 'Pick a file or a staged note in the palette first.';
}

function filesOf(): ReturnType<typeof createDiffFileView>[] {
  return [createDiffFileView('src/a.ts', [' one', '-two', '+three', ' four'])];
}

describe('mentionTargetFromPalette', () => {
  test('takes the highlighted file', ({ expect }) => {
    const action = { kind: 'file', path: 'src/b.ts', isChanged: false } as const;
    expect(mentionTargetFromPalette({ action, items: [], files: [] })).toStrictEqual({
      path: 'src/b.ts',
      side: 'head',
    });
  });

  test('takes the highlighted note’s lines', ({ expect }) => {
    const item = createUraItemView({ id: 'i1' });
    const action = { kind: 'ura-item', itemId: 'i1' } as const;
    expect(mentionTargetFromPalette({ action, items: [item], files: filesOf() })).toStrictEqual({
      path: 'src/a.ts',
      side: 'head',
      startLine: 3,
      endLine: 4,
    });
  });

  test('says what to pick for a row that is neither', ({ expect }) => {
    const action = { kind: 'session', sessionId: 's1' } as const;
    expect(mentionTargetFromPalette({ action, items: [], files: [] })).toBe(pick());
  });

  test('says what to pick with no highlighted row', ({ expect }) => {
    expect(mentionTargetFromPalette({ action: undefined, items: [], files: [] })).toBe(pick());
  });

  test('says what to pick for a note that is gone', ({ expect }) => {
    const action = { kind: 'ura-item', itemId: 'gone' } as const;
    expect(mentionTargetFromPalette({ action, items: [], files: [] })).toBe(pick());
  });
});
