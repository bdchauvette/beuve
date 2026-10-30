import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { keyPlatformOf } from './key-platform-of.ts';
import { shortcutOf } from './shortcut-of.ts';

describe('shortcutOf', () => {
  test('writes a command’s first key the platform’s way', ({ expect }) => {
    expect(shortcutOf('toggle-reviewed', 'mac')).toBe('⌘D');
    expect(shortcutOf('expand', 'linux')).toBe('Ctrl+Shift+]');
    expect(shortcutOf('commit-pairs', 'mac')).toBe('');
  });

  test('reads Node’s and the browser’s platform names', ({ expect }) => {
    expect([
      keyPlatformOf('darwin'),
      keyPlatformOf('MacIntel'),
      keyPlatformOf('Linux x86_64'),
    ]).toStrictEqual(['mac', 'mac', 'linux']);
    expect(keyPlatformOf(undefined)).toBe('linux');
  });
});
