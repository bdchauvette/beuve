import { describe, expect, it } from 'vitest';

import { displayKey } from './display-key.ts';

describe('displayKey', () => {
  it('keeps macOS symbols on macOS and spells them out elsewhere', () => {
    expect(displayKey('⌘⇧P', 'darwin')).toBe('⌘⇧P');
    expect(displayKey('⌘⇧P', 'linux')).toBe('Ctrl+Shift+P');
    expect(displayKey('⌘K', undefined)).toBe('Ctrl+K');
    expect(displayKey('Shift+j', 'linux')).toBe('Shift+j');
  });
});
