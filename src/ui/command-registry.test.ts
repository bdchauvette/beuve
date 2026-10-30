import { describe, expect, it } from 'vitest';

import { chatHelp } from './chat-help.ts';
import { commandRegistry } from './command-registry.ts';
import { keybindings } from './keybindings.ts';
import { parseChatCommand } from './parse-chat-command.ts';

describe('commandRegistry', () => {
  it('has no agent-insight keys any more', () => {
    const keys = commandRegistry
      .filter((command) => command.scope === 'Diff')
      .flatMap((command) => command.keys);
    for (const key of [']', '[', 'y', 'd']) {
      expect(keys).not.toContain(key);
    }
  });

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

  it('has an entry for every chat command the parser knows', () => {
    const parsed = [
      '/review',
      '/summarize',
      '/abstract',
      '/editor',
      '/diff',
      '/whitespace',
      '/generated',
      '/sidebar',
      '/trust',
      '/untrust',
      '/clear',
      '/compact',
      '/help',
    ];
    for (const name of parsed) {
      expect(parseChatCommand(name).kind).not.toBe('question');
      expect(commandRegistry.some((command) => command.slash?.split(' ', 1)[0] === name)).toBe(
        true,
      );
    }
    for (const command of commandRegistry) {
      const name = command.slash?.split(' ', 1)[0];
      if (name !== undefined) {
        expect(parsed).toContain(name);
      }
    }
  });

  it('has a runnable entry for every diff stream key', () => {
    const diffKeys = ['j', 'k', 'p', 'Shift+p', 'r', 'Esc', 'm', 'e', 'i', 's', 'w', 'o', 'Space'];
    const listed = commandRegistry
      .filter((command) => command.scope === 'Diff' && command.run.kind === 'zone-key')
      .flatMap((command) => command.keys);
    expect(listed.toSorted(byName)).toEqual(diffKeys.toSorted(byName));
  });
});

function byName(left: string, right: string): number {
  return left.localeCompare(right);
}
