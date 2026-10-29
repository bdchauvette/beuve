import { describe, expect, it } from 'vitest';

import { chatHelp } from './chat-help.ts';
import { commandRegistry } from './command-registry.ts';
import { keybindings } from './keybindings.ts';

describe('commandRegistry', () => {
  it('has unique ids', () => {
    const ids = commandRegistry.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('feeds the shortcuts overlay every command with a key, in order', () => {
    expect(keybindings.map((binding) => binding.action)).toEqual(
      commandRegistry.filter((command) => command.keys.length > 0).map((command) => command.title),
    );
  });

  it('feeds /help every chat command', () => {
    for (const command of commandRegistry) {
      if (command.slash !== undefined) {
        expect(chatHelp.some((line) => line.startsWith(`${command.slash ?? ''} — `))).toBe(true);
      }
    }
  });

  it('runs slash commands that start with their usage', () => {
    for (const command of commandRegistry) {
      if (command.run.kind === 'slash') {
        expect(command.slash?.startsWith(command.run.text.trim().split('=', 1)[0] ?? '')).toBe(
          true,
        );
      }
    }
  });

  it('marks unavailable commands as doing nothing', () => {
    const unavailable = commandRegistry.filter((entry) => !entry.available);
    expect(unavailable.map((command) => command.run.kind)).toEqual(unavailable.map(() => 'none'));
  });
});
