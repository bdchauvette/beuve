import { describe } from 'vitest';

import type { UraItemView } from '#contract/ipc-contract.ts';

import { noteStatusChange } from './note-status-change.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';
import { test } from './testing/test.ts';

describe('noteStatusChange', () => {
  test('withdraws the staged notes of a mixed selection, leaving the others', ({ expect }) => {
    expect(
      noteStatusChange(
        [note('a', 'staged'), note('b', 'withdrawn'), note('c', 'staged')],
        'withdrawn',
      ),
    ).toStrictEqual({ itemIds: ['a', 'c'], change: { kind: 'status', to: 'withdrawn' } });
    expect(
      noteStatusChange([note('a', 'addressed'), note('b', 'staged')], 'withdrawn'),
    ).toStrictEqual({ itemIds: ['b'], change: { kind: 'status', to: 'withdrawn' } });
  });

  test('restores every note when all of them have the status', ({ expect }) => {
    expect(
      noteStatusChange([note('a', 'withdrawn'), note('b', 'withdrawn')], 'withdrawn'),
    ).toStrictEqual({ itemIds: ['a', 'b'], change: { kind: 'status', to: 'staged' } });
    expect(noteStatusChange([note('a', 'addressed')], 'addressed')).toStrictEqual({
      itemIds: ['a'],
      change: { kind: 'status', to: 'staged' },
    });
  });

  test('does nothing with no notes, or none staged to change', ({ expect }) => {
    expect(noteStatusChange([], 'addressed')).toBeUndefined();
    expect(noteStatusChange([note('a', 'withdrawn')], 'addressed')).toBeUndefined();
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
