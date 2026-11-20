import { describe } from 'vitest';

import { describeAddressedNotesSwitch } from './describe-addressed-notes-switch.ts';
import { test } from './testing/test.ts';

describe('describeAddressedNotesSwitch', () => {
  test('says whether addressed notes are listed and how to change it', ({ expect }) => {
    expect(describeAddressedNotesSwitch(true)).toContain('listed');
    expect(describeAddressedNotesSwitch(false)).toContain('hidden');
  });
});
