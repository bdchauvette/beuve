import { describe } from 'vitest';

import { test } from './testing/test.ts';
import { withShortcut } from './with-shortcut.ts';

describe('withShortcut', () => {
  test('puts the shortcut after the label', ({ expect }) => {
    expect(withShortcut({ label: 'Next', shortcut: '⌘G' })).toBe('Next (⌘G)');
  });

  test('leaves the label alone without a shortcut', ({ expect }) => {
    expect(withShortcut({ label: 'Next', shortcut: '' })).toBe('Next');
  });
});
