import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { commandRegistry } from './command-registry.ts';
import { matchChatCommands } from './match-chat-commands.ts';
import { parseChatCommand } from './parse-chat-command.ts';

describe('matchChatCommands', () => {
  test('lists nothing for a question or an empty input', ({ expect }) => {
    expect(matchChatCommands('')).toStrictEqual([]);
    expect(matchChatCommands('why /review?')).toStrictEqual([]);
    expect(matchChatCommands(' /review')).toStrictEqual([]);
  });

  test('offers every registered chat command after a lone slash', ({ expect }) => {
    const names = new Set(
      matchChatCommands('/').map((suggestion) => suggestion.text.split(' ', 1)[0]),
    );
    const registered = new Set(
      commandRegistry.flatMap((command) => {
        return command.slash?.split(' ', 1)[0] ?? [];
      }),
    );
    expect(names).toStrictEqual(registered);
  });

  test('filters by what is typed, ignoring case, with the /help line as description', ({
    expect,
  }) => {
    expect(matchChatCommands('/SUM')).toStrictEqual([
      {
        text: '/summarize',
        label: '/summarize',
        description: commandRegistry.find((command) => command.id === 'summarize')?.help,
        isComplete: true,
      },
    ]);
  });

  test('offers each choice of an alternative, keeping an option name on each', ({ expect }) => {
    expect(matchChatCommands('/diff ').map((suggestion) => suggestion.text)).toStrictEqual([
      '/diff split',
      '/diff inline',
    ]);
    expect(matchChatCommands('/review --e').map((suggestion) => suggestion.text)).toStrictEqual([
      '/review --effort=low',
      '/review --effort=medium',
      '/review --effort=high',
    ]);
  });

  test('leaves a placeholder for the reviewer to type, showing the usage', ({ expect }) => {
    expect(matchChatCommands('/review').find((suggestion) => !suggestion.isComplete)).toStrictEqual(
      expect.objectContaining({
        text: '/review ',
        label: '/review <path-prefix>…',
        isComplete: false,
      }),
    );
  });

  test('closes once the input is the only command left', ({ expect }) => {
    expect(matchChatCommands('/compact')).toStrictEqual([]);
    expect(matchChatCommands('/clear').map((suggestion) => suggestion.text)).toStrictEqual([
      '/clear queue',
      '/clear',
    ]);
  });

  test('completes only to commands the parser accepts', ({ expect }) => {
    const refused = matchChatCommands('/')
      .filter((suggestion) => suggestion.isComplete)
      .filter((suggestion) => parseChatCommand(suggestion.text).kind === 'invalid');
    expect(refused).toStrictEqual([]);
  });
});
