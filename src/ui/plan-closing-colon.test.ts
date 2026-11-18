import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { planClosingColon } from './plan-closing-colon.ts';

describe('planClosingColon', () => {
  test('replaces an exact shortcode with its emoji', ({ expect }) => {
    expect(planClosingColon({ text: 'Shipped :tada', caret: 13 })).toStrictEqual({
      start: 8,
      end: 13,
      insert: '🎉',
    });
    expect(planClosingColon({ text: ':+1', caret: 3 })).toStrictEqual({
      start: 0,
      end: 3,
      insert: '👍',
    });
  });

  test('takes any case', ({ expect }) => {
    expect(planClosingColon({ text: ':Tada', caret: 5 })).toStrictEqual({
      start: 0,
      end: 5,
      insert: '🎉',
    });
  });

  test('leaves the colon to be typed after a partial or unknown name', ({ expect }) => {
    expect(planClosingColon({ text: ':tad', caret: 4 })).toBeUndefined();
    expect(planClosingColon({ text: ':nosuchname', caret: 11 })).toBeUndefined();
    expect(planClosingColon({ text: '10:30', caret: 5 })).toBeUndefined();
  });

  test('reads only what is before the caret', ({ expect }) => {
    expect(planClosingColon({ text: ':tada later', caret: 5 })).toStrictEqual({
      start: 0,
      end: 5,
      insert: '🎉',
    });
  });
});
