import { describe, expect, it } from 'vitest';

import { applyEdits } from './apply-edits.ts';
import type { SourceEdit } from './instrumentation-plan.ts';

describe('applyEdits', () => {
  it('inserts in offset order', () => {
    expect(applyEdits('abc', [edit(2, 'Y', 'open', 0, 0), edit(1, 'X', 'open', 0, 1)])).toBe(
      'aXbYc',
    );
  });

  it('closes before opening and nests wrappers at one offset', () => {
    const edits = [
      edit(0, '<inner>', 'open', 2, 1),
      edit(0, '<outer>', 'open', 5, 0),
      edit(5, '</outer>', 'close', 5, 2),
      edit(2, '</inner>', 'close', 2, 3),
      edit(2, '<next>', 'open', 3, 4),
      edit(5, '</next>', 'close', 3, 5),
    ];
    expect(applyEdits('ab cd', edits)).toBe('<outer><inner>ab</inner><next> cd</next></outer>');
  });

  it('keeps creation order between equal spans', () => {
    const edits = [
      edit(0, '1', 'open', 1, 0),
      edit(0, '2', 'open', 1, 1),
      edit(1, ')1', 'close', 1, 2),
      edit(1, ')2', 'close', 1, 3),
    ];
    expect(applyEdits('x', edits)).toBe('12x)2)1');
  });

  it('clamps offsets past the end', () => {
    expect(applyEdits('ab', [edit(9, '!', 'open', 0, 0)])).toBe('ab!');
  });
});

function edit(
  offset: number,
  text: string,
  side: SourceEdit['side'],
  span: number,
  order: number,
): SourceEdit {
  return { offset, text, side, span, order };
}
