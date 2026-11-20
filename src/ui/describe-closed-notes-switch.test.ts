import { describe } from 'vitest';

import { describeClosedNotesSwitch } from './describe-closed-notes-switch.ts';
import { test } from './testing/test.ts';

describe('describeClosedNotesSwitch', () => {
  test('says whether closed notes are listed and how to change it', ({ expect }) => {
    expect(describeClosedNotesSwitch(true)).toContain('listed');
    expect(describeClosedNotesSwitch(false)).toContain('hidden');
  });
});
