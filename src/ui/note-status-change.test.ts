import { describe } from 'vitest';

import type { UraItemView } from '#contract/ipc-contract.ts';

import { noteStatusChange } from './note-status-change.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';
import { test } from './testing/test.ts';

describe('noteStatusChange', () => {
  test('withdraws every note of a mixed selection that is not withdrawn yet', ({ expect }) => {
    expect(
      noteStatusChange(
        [note('a', 'staged'), note('b', 'withdrawn'), note('c', 'addressed')],
        'withdrawn',
      ),
    ).toStrictEqual({ itemIds: ['a', 'c'], change: { kind: 'withdraw' } });
    expect(
      noteStatusChange([note('a', 'withdrawn'), note('b', 'staged')], 'addressed'),
    ).toStrictEqual({ itemIds: ['a', 'b'], change: { kind: 'mark-addressed' } });
  });

  test('reopens every note when all of them have the status', ({ expect }) => {
    expect(
      noteStatusChange([note('a', 'withdrawn'), note('b', 'withdrawn')], 'withdrawn'),
    ).toStrictEqual({ itemIds: ['a', 'b'], change: { kind: 'reopen' } });
    expect(noteStatusChange([note('a', 'addressed')], 'addressed')).toStrictEqual({
      itemIds: ['a'],
      change: { kind: 'reopen' },
    });
  });

  test('does nothing with no notes', ({ expect }) => {
    expect(noteStatusChange([], 'addressed')).toBeUndefined();
  });
});

function note(id: string, status: 'staged' | 'withdrawn' | 'addressed'): UraItemView {
  if (status === 'addressed') {
    return createUraItemView({
      id,
      status: { kind: status, atSha: 'b'.repeat(40), by: 'reviewer' },
    });
  }
  return createUraItemView({ id, status: { kind: status } });
}
