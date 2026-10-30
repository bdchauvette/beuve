import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { chatHelp } from './chat-help.ts';
import { commandRegistry } from './command-registry.ts';
import { keybindings } from './keybindings.ts';
import { parseChatCommand } from './parse-chat-command.ts';

describe('commandRegistry', () => {
  test('has no agent-insight keys any more', ({ expect }) => {
    const keys = commandRegistry
      .filter((command) => command.scope === 'Diff')
      .flatMap((command) => command.keys);
    for (const key of [']', '[', 'y', 'd']) {
      expect(keys).not.toContain(key);
    }
  });

  test('has unique ids', ({ expect }) => {
    const ids = commandRegistry.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('feeds the shortcuts overlay every command with a key, in order', ({ expect }) => {
    expect(keybindings.map((binding) => binding.action)).toStrictEqual(
      commandRegistry.filter((command) => command.keys.length > 0).map((command) => command.title),
    );
  });

  test('feeds /help every chat command', ({ expect }) => {
    const slashes = commandRegistry
      .map((command) => command.slash)
      .filter((slash) => slash !== undefined);
    const undocumented = slashes.filter((slash) =>
      chatHelp.every((line) => !line.startsWith(`${slash} — `)),
    );
    expect(undocumented).toStrictEqual([]);
  });

  test('runs slash commands that start with their usage', ({ expect }) => {
    const mismatched = commandRegistry.filter(
      (command) =>
        command.run.kind === 'slash' &&
        command.slash?.startsWith(command.run.text.trim().split('=', 1)[0] ?? '') !== true,
    );
    expect(mismatched).toStrictEqual([]);
  });

  test('marks unavailable commands as doing nothing', ({ expect }) => {
    const unavailable = commandRegistry.filter((entry) => !entry.available);
    expect(unavailable.map((command) => command.run.kind)).toStrictEqual(
      unavailable.map(() => 'none'),
    );
  });

  test('has an entry for every chat command the parser knows', ({ expect }) => {
    const parsed = new Set([
      '/review',
      '/summarize',
      '/abstract',
      '/editor',
      '/diff',
      '/whitespace',
      '/generated',
      '/insights',
      '/sidebar',
      '/trust',
      '/untrust',
      '/clear',
      '/compact',
      '/help',
    ]);
    for (const name of parsed) {
      expect(parseChatCommand(name).kind).not.toBe('question');
      expect(commandRegistry.some((command) => command.slash?.split(' ', 1)[0] === name)).toBe(
        true,
      );
    }
    const registered = commandRegistry
      .map((command) => command.slash?.split(' ', 1)[0])
      .filter((name) => name !== undefined);
    expect(registered.filter((name) => !parsed.has(name))).toStrictEqual([]);
  });

  test('has a runnable entry for every diff stream key', ({ expect }) => {
    const diffKeys = ['j', 'k', 'p', 'Shift+p', 'r', 'Esc', 'm', 'e', 'i', 's', 'w', 'o', 'Space'];
    const listed = commandRegistry
      .filter((command) => command.scope === 'Diff' && command.run.kind === 'zone-key')
      .flatMap((command) => command.keys);
    expect(listed.toSorted(byName)).toStrictEqual(diffKeys.toSorted(byName));
  });
});

function byName(left: string, right: string): number {
  return left.localeCompare(right);
}
