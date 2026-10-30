import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { displayAccelerator } from './display-accelerator.ts';

describe('displayAccelerator', () => {
  test.for([
    ['Alt+Cmd+Down', 'mac', '⌥⌘↓'],
    ['Shift+Cmd+B', 'mac', '⇧⌘B'],
    ['Ctrl+Cmd+S', 'mac', '⌃⌘S'],
    ['Cmd+>', 'mac', '⌘>'],
    ['Return', 'mac', '↩'],
    ['Ctrl+Shift+O', 'linux', 'Ctrl+Shift+O'],
    ['Alt+Down', 'linux', 'Alt+↓'],
    ['Ctrl+PageDown', 'linux', 'Ctrl+Page Down'],
    ['Ctrl+Plus', 'linux', 'Ctrl++'],
    ['Escape', 'linux', 'Esc'],
  ] as const)('%s on %s reads %s', ([accelerator, platform, shown], { expect }) => {
    expect(displayAccelerator(accelerator, platform)).toBe(shown);
  });
});
