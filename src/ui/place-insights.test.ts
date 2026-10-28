import { describe, expect, it } from 'vitest';

import { placeInsights } from './place-insights.ts';

const patch = [
  'diff --git a/a.ts b/a.ts',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -10,3 +10,4 @@ fn',
  ' keep', // 4: head 10
  '-old', // 5
  '+new', // 6: head 11
  '+more', // 7: head 12
  ' tail', // 8: head 13
  '@@ -40,1 +41,1 @@',
  '-x', // 10
  '+y', // 11: head 41
  String.raw`\ No newline at end of file`, // 12
  '',
].join('\n');

describe('placeInsights', () => {
  it('places each insight after the last shown head line of its range', () => {
    const one = { id: 'one', lineStart: 11, lineEnd: 12 };
    const two = { id: 'two', lineStart: 10, lineEnd: 10 };
    const three = { id: 'three', lineStart: 13, lineEnd: 30 };
    const { afterLine, unplaced } = placeInsights(patch, [one, two, three]);
    expect([...afterLine]).toEqual([
      [7, [one]],
      [4, [two]],
      [8, [three]],
    ]);
    expect(unplaced).toEqual([]);
  });

  it('steps over a no-newline note and reports ranges the patch does not show', () => {
    const last = { lineStart: 41, lineEnd: 41 };
    const hidden = { lineStart: 20, lineEnd: 25 };
    const { afterLine, unplaced } = placeInsights(patch, [last, hidden]);
    expect(afterLine.get(12)).toEqual([last]);
    expect(unplaced).toEqual([hidden]);
  });
});
