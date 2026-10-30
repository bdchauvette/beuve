import type { KeyPlatform } from '#contract/command-catalog.ts';

const macModifiers: Readonly<Record<string, string>> = {
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Cmd: '⌘',
};
const separator = /\+(?!$)/u;
const macOrder = ['Ctrl', 'Alt', 'Shift', 'Cmd'];
const linuxOrder = ['Ctrl', 'Alt', 'Shift'];

const keyNames: Readonly<Record<string, readonly [mac: string, linux: string]>> = {
  Up: ['↑', '↑'],
  Down: ['↓', '↓'],
  Left: ['←', '←'],
  Right: ['→', '→'],
  Return: ['↩', 'Enter'],
  Escape: ['Esc', 'Esc'],
  Tab: ['⇥', 'Tab'],
  Delete: ['⌫', 'Delete'],
  PageUp: ['⇞', 'Page Up'],
  PageDown: ['⇟', 'Page Down'],
  Home: ['↖', 'Home'],
  End: ['↘', 'End'],
  Plus: ['+', '+'],
  Space: ['Space', 'Space'],
};

/**
 * An Electron accelerator (`Alt+Cmd+Down`, `Ctrl+Shift+O`, `Return`) as the platform writes it:
 * `⌥⌘↓` on macOS, `Ctrl+Shift+O` and `Alt+↓` on Linux. Pure.
 */
export function displayAccelerator(accelerator: string, platform: KeyPlatform): string {
  const parts = accelerator.split(separator);
  const key = parts.at(-1) ?? '';
  const modifiers = new Set(parts.slice(0, -1));
  const names = keyNames[key];
  const shown = names === undefined ? key : platform === 'mac' ? names[0] : names[1];
  if (platform === 'mac') {
    const ordered = macOrder.filter((modifier) => modifiers.has(modifier));
    return `${ordered.map((modifier) => macModifiers[modifier] ?? modifier).join('')}${shown}`;
  }
  const ordered = linuxOrder.filter((modifier) => modifiers.has(modifier));
  return [...ordered, shown].join('+');
}
