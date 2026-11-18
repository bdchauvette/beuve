import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { chatHelp } from './chat-help.ts';
import { parseChatCommand } from './parse-chat-command.ts';

describe('parseChatCommand', () => {
  test('parses /review for the whole session', ({ expect }) => {
    expect(parseChatCommand('  /review ')).toStrictEqual({
      kind: 'review',
      pathPrefixes: [],
      fresh: false,
      verify: true,
    });
    expect(parseChatCommand('/REVIEW')).toMatchObject({ kind: 'review' });
  });

  test('parses path prefixes, normalized and deduplicated', ({ expect }) => {
    expect(parseChatCommand('/review ./src/ui/ src/ui docs')).toStrictEqual({
      kind: 'review',
      pathPrefixes: ['src/ui', 'docs'],
      fresh: false,
      verify: true,
    });
  });

  test('parses --fresh and --effort in either form, mixed with prefixes', ({ expect }) => {
    expect(parseChatCommand('/review src --fresh --effort=high')).toStrictEqual({
      kind: 'review',
      pathPrefixes: ['src'],
      fresh: true,
      verify: true,
      effort: 'high',
    });
    expect(parseChatCommand('/review --effort low')).toStrictEqual({
      kind: 'review',
      pathPrefixes: [],
      fresh: false,
      verify: true,
      effort: 'low',
    });
    expect(parseChatCommand('/review -- --fresh')).toStrictEqual({
      kind: 'review',
      pathPrefixes: ['--fresh'],
      fresh: false,
      verify: true,
    });
  });

  test('parses --no-verify, which skips the verification pass', ({ expect }) => {
    expect(parseChatCommand('/review --no-verify src')).toStrictEqual({
      kind: 'review',
      pathPrefixes: ['src'],
      fresh: false,
      verify: false,
    });
  });

  test('parses /summarize and its alias /abstract', ({ expect }) => {
    expect(parseChatCommand('/summarize')).toStrictEqual({ kind: 'summarize' });
    expect(parseChatCommand(' /Abstract ')).toStrictEqual({ kind: 'summarize' });
    expect(parseChatCommand('/summarize src')).toStrictEqual({
      kind: 'invalid',
      message: '/summarize takes no arguments. Type /help for the commands.',
    });
    expect(chatHelp.some((line) => line.startsWith('/summarize'))).toBe(true);
    expect(chatHelp.some((line) => line.startsWith('/abstract'))).toBe(true);
  });

  test('explains malformed /review commands instead of failing', ({ expect }) => {
    for (const input of [
      '/review --effort=max',
      '/review --effort',
      '/review --force',
      '/review /etc',
      '/review ../outside',
    ]) {
      expect(parseChatCommand(input)).toMatchObject({ kind: 'invalid' });
    }
    expect(parseChatCommand('/review --force')).toStrictEqual({
      kind: 'invalid',
      message: '/review has no option --force. Type /help for its options.',
    });
  });

  test('parses /help, empty input, plain questions and unknown commands', ({ expect }) => {
    expect(parseChatCommand('/help')).toStrictEqual({ kind: 'help' });
    expect(parseChatCommand('/?')).toStrictEqual({ kind: 'help' });
    expect(parseChatCommand(' '.repeat(3))).toStrictEqual({ kind: 'empty' });
    expect(parseChatCommand('why does run_fast skip checks?')).toStrictEqual({
      kind: 'question',
      text: 'why does run_fast skip checks?',
    });
    expect(parseChatCommand(' /CLEAR ')).toStrictEqual({ kind: 'clear', queuedOnly: false });
    expect(parseChatCommand('/clear Queue')).toStrictEqual({ kind: 'clear', queuedOnly: true });
    expect(parseChatCommand('/clear now')).toStrictEqual({
      kind: 'invalid',
      message: '/clear takes nothing, or queue to drop only the waiting questions.',
    });
    expect(parseChatCommand('/Compact')).toStrictEqual({ kind: 'compact' });
    expect(parseChatCommand('/compact all')).toStrictEqual({
      kind: 'invalid',
      message: '/compact takes no arguments. Type /help for the commands.',
    });
    expect(parseChatCommand('/explain foo')).toStrictEqual({
      kind: 'invalid',
      message: 'Unknown command /explain. Type /help for the commands.',
    });
  });

  test.for([
    '/editor',
    '/editor zed',
    '/diff inline',
    '/whitespace ignore',
    '/generated show',
    '/insights hide',
    '/Order imports',
    '/sidebar left',
  ])('says %s is a setting, not a chat command, and where to set it', (input, { expect }) => {
    const command = parseChatCommand(input);
    expect(command).toMatchObject({ kind: 'invalid' });
    expect(JSON.stringify(command)).toContain('command palette');
  });

  test('still calls an unknown command unknown', ({ expect }) => {
    expect(parseChatCommand('/layout a')).toMatchObject({
      kind: 'invalid',
      message: 'Unknown command /layout. Type /help for the commands.',
    });
  });
});
