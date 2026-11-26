import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { createUraItemView } from './testing/create-ura-item-view.ts';
import { isNoteInFilter } from './is-note-in-filter.ts';

describe('isNoteInFilter', () => {
  const outdated = createUraItemView({
    placement: { kind: 'outdated', reason: 'lines-changed' },
  });
  const withdrawn = createUraItemView({ status: { kind: 'withdrawn' } });
  const staged = createUraItemView();

  test('all keeps every note', ({ expect }) => {
    expect([staged, outdated, withdrawn].map((item) => isNoteInFilter(item, 'all'))).toStrictEqual([
      true,
      true,
      true,
    ]);
  });

  test('open keeps the staged notes, outdated ones included', ({ expect }) => {
    expect([staged, outdated, withdrawn].map((item) => isNoteInFilter(item, 'open'))).toStrictEqual(
      [true, true, false],
    );
  });

  test('outdated keeps the notes whose lines left the head', ({ expect }) => {
    expect(
      [staged, outdated, withdrawn].map((item) => isNoteInFilter(item, 'outdated')),
    ).toStrictEqual([false, true, false]);
  });

  test('closed keeps the notes that are not staged', ({ expect }) => {
    expect(
      [staged, outdated, withdrawn].map((item) => isNoteInFilter(item, 'closed')),
    ).toStrictEqual([false, false, true]);
  });
});
