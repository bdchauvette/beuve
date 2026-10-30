import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { displayKey } from './display-key.ts';

describe('displayKey', () => {
  test('keeps macOS symbols on macOS and spells them out elsewhere', ({ expect }) => {
    expect(displayKey('⌘⇧P', 'darwin')).toBe('⌘⇧P');
    expect(displayKey('⌘⇧P', 'linux')).toBe('Ctrl+Shift+P');
    expect(displayKey('⌘K', undefined)).toBe('Ctrl+K');
    expect(displayKey('Shift+j', 'linux')).toBe('Shift+j');
  });
});
