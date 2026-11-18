import { describe } from 'vitest';

import { dockSelectionAfter } from './dock-selection-after.ts';
import type { DockGesture, DockSelection } from './dock-selection-after.ts';
import { test } from './testing/test.ts';

describe('dockSelectionAfter', () => {
  test('extends a range with Shift from the cursor, then from the same anchor', ({ expect }) => {
    const down = after(empty(), { kind: 'extend', from: 'b', to: 'c' });
    expect(down).toStrictEqual({ selected: ['b', 'c'], anchor: 'b' });
    const further = after(down, { kind: 'extend', from: 'c', to: 'd' });
    expect(further).toStrictEqual({ selected: ['b', 'c', 'd'], anchor: 'b' });
    expect(after(further, { kind: 'extend', from: 'd', to: 'a' })).toStrictEqual({
      selected: ['a', 'b'],
      anchor: 'b',
    });
  });

  test('toggles one note with ⌘/Ctrl, starting from the cursor’s', ({ expect }) => {
    const two = after(empty(), { kind: 'toggle', from: 'a', to: 'c' });
    expect(two).toStrictEqual({ selected: ['a', 'c'], anchor: 'c' });
    const three = after(two, { kind: 'toggle', from: 'c', to: 'b' });
    expect(three).toStrictEqual({ selected: ['a', 'b', 'c'], anchor: 'b' });
    expect(after(three, { kind: 'toggle', from: 'b', to: 'a' })).toStrictEqual({
      selected: ['b', 'c'],
      anchor: 'a',
    });
  });

  test('clears when the last toggled note goes', ({ expect }) => {
    const one: DockSelection = { selected: ['a'], anchor: 'a' };
    expect(after(one, { kind: 'toggle', from: 'a', to: 'a' })).toStrictEqual(empty());
  });

  test('extends a range from the last toggled note', ({ expect }) => {
    const toggled = after(empty(), { kind: 'toggle', from: 'a', to: 'c' });
    expect(after(toggled, { kind: 'extend', from: 'c', to: 'e' })).toStrictEqual({
      selected: ['c', 'd', 'e'],
      anchor: 'c',
    });
  });

  test.for([['move'], ['clear']] as const)('a %s clears the selection', ([kind], { expect }) => {
    const picked: DockSelection = { selected: ['a', 'b'], anchor: 'a' };
    expect(after(picked, { kind })).toStrictEqual(empty());
  });

  test('selects every note, keeping the anchor', ({ expect }) => {
    expect(after(empty(), { kind: 'all' })).toStrictEqual({
      selected: ['a', 'b', 'c', 'd', 'e'],
      anchor: 'a',
    });
    expect(after({ selected: ['c'], anchor: 'c' }, { kind: 'all' }).anchor).toBe('c');
  });

  test('clears on a range to a note that is gone', ({ expect }) => {
    expect(after(empty(), { kind: 'extend', from: 'a', to: 'z' })).toStrictEqual(empty());
  });
});

function after(selection: DockSelection, gesture: DockGesture): DockSelection {
  return dockSelectionAfter(selection, { gesture, order: ['a', 'b', 'c', 'd', 'e'] });
}

function empty(): DockSelection {
  return { selected: [], anchor: undefined };
}
