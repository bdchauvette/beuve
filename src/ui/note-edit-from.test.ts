import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { createUraItemView } from './testing/create-ura-item-view.ts';
import { noteEditFrom } from './note-edit-from.ts';

describe('noteEditFrom', () => {
  test('starts from the note’s current lines and its text', ({ expect }) => {
    const moved = { kind: 'lines', path: 'src/b.ts', startLine: 9, endLine: 11 } as const;
    const item = createUraItemView({
      severity: 'nitpick',
      blocking: true,
      body: 'Use `at(-1)`.',
      placement: { kind: 'current', anchor: moved },
    });
    expect(noteEditFrom(item)).toStrictEqual({
      itemId: item.id,
      headSha: item.headSha,
      anchor: moved,
      draft: {
        severity: 'nitpick',
        blocking: true,
        title: 'Handle the empty list',
        body: 'Use `at(-1)`.',
      },
      suggestions: [],
    });
  });

  test('keeps a whole-file note on its file, with its suggestions as fields', ({ expect }) => {
    const anchor = { kind: 'file', path: 'src/a.ts' } as const;
    const item = createUraItemView({
      anchor,
      placement: { kind: 'current', anchor },
      suggestions: [
        {
          path: 'src/a.ts',
          startLine: 1,
          endLine: 1,
          replacement: 'b',
          patch: '@@ -1 +1 @@\n-a\n+b\n',
        },
      ],
    });
    expect(noteEditFrom(item)).toMatchObject({
      anchor,
      suggestions: [
        {
          id: item.suggestions[0]?.id,
          path: 'src/a.ts',
          startLine: 1,
          endLine: 1,
          replacement: 'b',
        },
      ],
    });
  });

  test('has nothing for a note the diff does not mark', ({ expect }) => {
    const addressedAt = 'b'.repeat(40);
    const unmarked = [
      createUraItemView({ placement: { kind: 'outdated', reason: 'lines-changed' } }),
      createUraItemView({ status: { kind: 'withdrawn' } }),
      createUraItemView({ status: { kind: 'addressed', atSha: addressedAt, by: 'reviewer' } }),
      createUraItemView({ placement: { kind: 'current', anchor: { kind: 'change' } } }),
    ];
    expect(unmarked.map((item) => noteEditFrom(item))).toStrictEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
