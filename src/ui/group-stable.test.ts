import { describe, expect, it } from 'vitest';

import { groupStable } from './group-stable.ts';

interface Item {
  readonly id: string;
  readonly paths: readonly string[];
}

function keys(item: Item): readonly string[] {
  return item.paths;
}

describe('groupStable', () => {
  it('groups items under each of their keys, in input order', () => {
    const a = { id: 'a', paths: ['x'] };
    const b = { id: 'b', paths: ['y', 'x'] };
    const groups = groupStable([a, b], keys);
    expect(groups.get('x')).toEqual([a, b]);
    expect(groups.get('y')).toEqual([b]);
    expect(groups.get('z')).toBeUndefined();
  });

  it('lists an item once under a key it names twice', () => {
    const a = { id: 'a', paths: ['x', 'x'] };
    expect(groupStable([a], keys).get('x')).toEqual([a]);
  });

  it('keeps the previous array of a group whose members did not change', () => {
    const a = { id: 'a', paths: ['x'] };
    const b = { id: 'b', paths: ['y'] };
    const first = groupStable([a, b], keys);
    const changed = { id: 'b', paths: ['y'] };
    const second = groupStable([a, changed], keys, first);
    expect(second.get('x')).toBe(first.get('x'));
    expect(second.get('y')).not.toBe(first.get('y'));
    expect(second.get('y')).toEqual([changed]);
  });

  it('replaces a group whose order or size changed', () => {
    const a = { id: 'a', paths: ['x'] };
    const b = { id: 'b', paths: ['x'] };
    const first = groupStable([a, b], keys);
    expect(groupStable([b, a], keys, first).get('x')).not.toBe(first.get('x'));
    expect(groupStable([a], keys, first).get('x')).toEqual([a]);
  });
});
