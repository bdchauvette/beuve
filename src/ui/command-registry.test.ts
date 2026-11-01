import { describe } from 'vitest';

import { acceleratorsFor } from '#contract/accelerators-for.ts';
import { commandCatalog } from '#contract/command-catalog.ts';

import { test } from './testing/test.ts';

import { chatHelp } from './chat-help.ts';
import { commandRegistry } from './command-registry.ts';
import { parseChatCommand } from './parse-chat-command.ts';

describe('commandRegistry', () => {
  test('gives every catalog command, and only those, a behaviour, in catalog order', ({
    expect,
  }) => {
    expect(commandRegistry.map((command) => command.id)).toStrictEqual(
      commandCatalog.map((command) => command.id),
    );
  });

  test('has unique ids', ({ expect }) => {
    const ids = commandRegistry.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('gives every shortcut a menu item on both platforms (ADR 0068)', ({ expect }) => {
    const unlisted = commandCatalog.filter((command) => {
      return (
        (acceleratorsFor(command, 'mac').length > 0 && command.menu === undefined) ||
        (acceleratorsFor(command, 'linux').length > 0 &&
          (command.linuxMenu ?? command.menu) === undefined)
      );
    });
    expect(unlisted.map((command) => command.id)).toStrictEqual([]);
  });

  test('binds no bare letter, digit or punctuation key', ({ expect }) => {
    const bare = commandCatalog.flatMap((command) => {
      return [...acceleratorsFor(command, 'mac'), ...acceleratorsFor(command, 'linux')].filter(
        (key) => {
          return !/(?:^|\+)(?:Cmd|Ctrl|Alt)\+/u.test(key) && !/(?:^|\+)F\d+$/u.test(key);
        },
      );
    });
    expect(bare).toStrictEqual([]);
  });

  test('runs main commands in main and documents in-place keys only', ({ expect }) => {
    expect(
      commandRegistry
        .filter((command) => (command.run.kind === 'main') !== (command.handler === 'main'))
        .map((command) => command.id),
    ).toStrictEqual([]);
    expect(
      commandRegistry
        .filter((command) => {
          return (
            command.run.kind === 'none' &&
            (command.menu !== undefined || command.keys !== undefined)
          );
        })
        .map((command) => command.id),
    ).toStrictEqual([]);
  });

  test('feeds /help every chat command', ({ expect }) => {
    const slashes = commandRegistry
      .map((command) => command.slash)
      .filter((slash) => slash !== undefined);
    const undocumented = slashes.filter((slash) => {
      return chatHelp.every((line) => !line.startsWith(`${slash} — `));
    });
    expect(undocumented).toStrictEqual([]);
  });

  test('runs slash commands that start with their usage', ({ expect }) => {
    const mismatched = commandRegistry.filter((command) => {
      return (
        command.run.kind === 'slash' &&
        command.slash !== undefined &&
        !command.slash.startsWith(command.run.text.trim().split('=', 1)[0] ?? '')
      );
    });
    expect(mismatched).toStrictEqual([]);
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
      '/order',
      '/sidebar',
      '/sheets',
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
});
