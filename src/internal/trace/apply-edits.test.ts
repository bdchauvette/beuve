import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { applyEdits } from './apply-edits.ts';
import type { SourceEdit } from './instrumentation-plan.ts';

describe('applyEdits', () => {
  test('inserts in offset order', ({ expect }) => {
    expect(
      applyEdits('abc', [
        { offset: 2, text: 'Y', side: 'open', span: 0, order: 0 },
        { offset: 1, text: 'X', side: 'open', span: 0, order: 1 },
      ]),
    ).toBe('aXbYc');
  });

  test('closes before opening and nests wrappers at one offset', ({ expect }) => {
    const edits: SourceEdit[] = [
      { offset: 0, text: '<inner>', side: 'open', span: 2, order: 1 },
      { offset: 0, text: '<outer>', side: 'open', span: 5, order: 0 },
      { offset: 5, text: '</outer>', side: 'close', span: 5, order: 2 },
      { offset: 2, text: '</inner>', side: 'close', span: 2, order: 3 },
      { offset: 2, text: '<next>', side: 'open', span: 3, order: 4 },
      { offset: 5, text: '</next>', side: 'close', span: 3, order: 5 },
    ];
    expect(applyEdits('ab cd', edits)).toBe('<outer><inner>ab</inner><next> cd</next></outer>');
  });

  test('keeps creation order between equal spans', ({ expect }) => {
    const edits: SourceEdit[] = [
      { offset: 0, text: '1', side: 'open', span: 1, order: 0 },
      { offset: 0, text: '2', side: 'open', span: 1, order: 1 },
      { offset: 1, text: ')1', side: 'close', span: 1, order: 2 },
      { offset: 1, text: ')2', side: 'close', span: 1, order: 3 },
    ];
    expect(applyEdits('x', edits)).toBe('12x)2)1');
  });

  test('clamps offsets past the end', ({ expect }) => {
    expect(applyEdits('ab', [{ offset: 9, text: '!', side: 'open', span: 0, order: 0 }])).toBe(
      'ab!',
    );
  });
});
