import type { CheckpointView, ReviewRangeView } from '#contract/ipc-contract.ts';
import { test } from './testing/test.ts';

import { reviewRangeMenuFrom } from './review-range-menu-from.ts';

test('offers no range menu until progress was saved', ({ expect }) => {
  expect(reviewRangeMenuFrom(undefined)).toBeUndefined();
  expect(reviewRangeMenuFrom({ choice: { kind: 'whole' }, checkpoints: [] })).toBeUndefined();
});

test('offers since the last save and the whole change, the default checked', ({ expect }) => {
  const menu = reviewRangeMenuFrom(range({ kind: 'since-last' }, ['c1']));
  expect(menu?.label).toBe('Since last saved progress');
  expect(
    menu?.options.map(({ key, isChecked, checkpoint }) => {
      return [key, isChecked, checkpoint?.id];
    }),
  ).toStrictEqual([
    ['since-last', true, 'c1'],
    ['whole', false, undefined],
  ]);
  expect(menu?.earlier).toStrictEqual([]);
});

test('lists earlier saves newest first and checks the chosen one', ({ expect }) => {
  const menu = reviewRangeMenuFrom(
    range({ kind: 'since-checkpoint', checkpointId: 'c1' }, ['c1', 'c2', 'c3']),
  );
  expect(menu?.label).toBe('Since an earlier save');
  expect(
    menu?.earlier.map(({ key, isChecked }) => {
      return [key, isChecked];
    }),
  ).toStrictEqual([
    ['c2', false],
    ['c1', true],
  ]);
  expect(menu?.earlier[1]?.choice).toStrictEqual({ kind: 'since-checkpoint', checkpointId: 'c1' });
  expect(menu?.options.some(({ isChecked }) => isChecked)).toBe(false);
});

test('names the whole change when it is chosen', ({ expect }) => {
  expect(reviewRangeMenuFrom(range({ kind: 'whole' }, ['c1']))?.label).toBe('Whole change');
});

function range(choice: ReviewRangeView['choice'], ids: readonly string[]): ReviewRangeView {
  return { choice, checkpoints: ids.map((id) => checkpoint(id)) };
}

function checkpoint(id: string): CheckpointView {
  return {
    id,
    baseSha: 'b'.repeat(40),
    headSha: 'a'.repeat(40),
    savedAt: '2026-11-18T12:00:00.000Z',
  };
}
