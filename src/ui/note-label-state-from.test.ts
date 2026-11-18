import { describe } from 'vitest';

import { noteLabelStateFrom } from './note-label-state-from.ts';
import { test } from './testing/test.ts';

describe('noteLabelStateFrom', () => {
  test('reads no notes as a new note', ({ expect }) => {
    expect(noteLabelStateFrom([])).toStrictEqual({ severity: 'issue', blocking: false });
  });

  test('keeps the label and Blocking the notes share', ({ expect }) => {
    const notes = [
      { severity: 'question', blocking: true },
      { severity: 'question', blocking: true },
    ] as const;
    expect(noteLabelStateFrom(notes)).toStrictEqual({ severity: 'question', blocking: true });
  });

  test('says mixed for each part the notes disagree on', ({ expect }) => {
    const labels = [
      { severity: 'issue', blocking: false },
      { severity: 'nitpick', blocking: false },
    ] as const;
    expect(noteLabelStateFrom(labels)).toStrictEqual({ severity: 'mixed', blocking: false });
    const blocking = [
      { severity: 'issue', blocking: true },
      { severity: 'issue', blocking: false },
    ] as const;
    expect(noteLabelStateFrom(blocking)).toStrictEqual({ severity: 'issue', blocking: 'mixed' });
  });
});
