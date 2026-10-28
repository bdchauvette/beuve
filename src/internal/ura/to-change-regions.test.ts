import { describe, expect, it } from 'vitest';

import { toChangeRegions } from './to-change-regions.ts';

describe('toChangeRegions', () => {
  it('treats a hunk without lines as one region', () => {
    expect(toChangeRegions({ oldStart: 5, oldCount: 2, newStart: 5, newCount: 3 })).toEqual([
      { before: 4, removed: 2, added: 3 },
    ]);
  });

  it('reads -a,0 as an insertion after line a', () => {
    expect(toChangeRegions({ oldStart: 7, oldCount: 0, newStart: 8, newCount: 2 })).toEqual([
      { before: 7, removed: 0, added: 2 },
    ]);
  });

  it('reads +c,0 as a pure deletion', () => {
    expect(toChangeRegions({ oldStart: 3, oldCount: 2, newStart: 2, newCount: 0 })).toEqual([
      { before: 2, removed: 2, added: 0 },
    ]);
  });

  it('splits a hunk with context lines into its changed runs', () => {
    const hunk = {
      oldStart: 10,
      oldCount: 7,
      newStart: 10,
      newCount: 7,
      lines: [
        { kind: 'context' },
        { kind: 'removed' },
        { kind: 'added' },
        { kind: 'added' },
        { kind: 'context' },
        { kind: 'context' },
        { kind: 'removed' },
        { kind: 'context' },
        { kind: 'context' },
      ],
    } as const;
    expect(toChangeRegions(hunk)).toEqual([
      { before: 10, removed: 1, added: 2 },
      { before: 13, removed: 1, added: 0 },
    ]);
  });

  it('handles an insertion-only hunk with lines', () => {
    const hunk = {
      oldStart: 4,
      oldCount: 0,
      newStart: 5,
      newCount: 1,
      lines: [{ kind: 'added' }],
    } as const;
    expect(toChangeRegions(hunk)).toEqual([{ before: 4, removed: 0, added: 1 }]);
  });

  it('returns nothing for an empty hunk', () => {
    expect(toChangeRegions({ oldStart: 0, oldCount: 0, newStart: 0, newCount: 0 })).toEqual([]);
  });
});
