import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { chatHelp } from './chat-help.ts';
import { parseChatCommand } from './parse-chat-command.ts';

describe('parseChatCommand', () => {
  test('parses /diff and /whitespace with and without a choice', ({ expect }) => {
    expect(parseChatCommand('/diff')).toStrictEqual({ kind: 'diff' });
    expect(parseChatCommand('/diff Inline')).toStrictEqual({ kind: 'diff', layout: 'unified' });
    expect(parseChatCommand('/diff split')).toStrictEqual({ kind: 'diff', layout: 'split' });
    expect(parseChatCommand('/diff wide')).toMatchObject({ kind: 'invalid' });
    expect(parseChatCommand('/whitespace')).toStrictEqual({ kind: 'whitespace' });
    expect(parseChatCommand('/whitespace ignore')).toStrictEqual({
      kind: 'whitespace',
      ignoreWhitespace: true,
    });
    expect(parseChatCommand('/whitespace show')).toStrictEqual({
      kind: 'whitespace',
      ignoreWhitespace: false,
    });
    expect(parseChatCommand('/whitespace ignore show')).toMatchObject({ kind: 'invalid' });
  });

  test('parses /generated with and without a choice', ({ expect }) => {
    expect(parseChatCommand('/generated')).toStrictEqual({ kind: 'generated' });
    expect(parseChatCommand('/generated Show')).toStrictEqual({
      kind: 'generated',
      showGenerated: true,
    });
    expect(parseChatCommand('/generated hide')).toStrictEqual({
      kind: 'generated',
      showGenerated: false,
    });
    expect(parseChatCommand('/generated maybe')).toMatchObject({ kind: 'invalid' });
  });

  test('parses /insights with and without a choice', ({ expect }) => {
    expect(parseChatCommand('/insights')).toStrictEqual({ kind: 'insights' });
    expect(parseChatCommand('/insights HIDE')).toStrictEqual({
      kind: 'insights',
      showInsights: false,
    });
    expect(parseChatCommand('/insights show')).toStrictEqual({
      kind: 'insights',
      showInsights: true,
    });
    expect(parseChatCommand('/insights maybe')).toMatchObject({ kind: 'invalid' });
  });

  test('parses /editor with and without a choice', ({ expect }) => {
    expect(parseChatCommand('/editor')).toStrictEqual({ kind: 'editor' });
    expect(parseChatCommand('/editor Zed')).toStrictEqual({ kind: 'editor', editorId: 'zed' });
    expect(parseChatCommand('/editor code')).toStrictEqual({ kind: 'editor', editorId: 'vscode' });
    expect(parseChatCommand('/editor cursor')).toStrictEqual({
      kind: 'editor',
      editorId: 'cursor',
    });
    expect(parseChatCommand('/editor emacs')).toMatchObject({ kind: 'invalid' });
    expect(parseChatCommand('/editor zed cursor')).toMatchObject({ kind: 'invalid' });
  });

  test('parses /trust and /untrust, which take no arguments', ({ expect }) => {
    expect(parseChatCommand('/trust')).toStrictEqual({ kind: 'trust' });
    expect(parseChatCommand(' /UNTRUST ')).toStrictEqual({ kind: 'untrust' });
    expect(parseChatCommand('/trust now')).toMatchObject({ kind: 'invalid' });
    expect(parseChatCommand('/untrust all')).toMatchObject({ kind: 'invalid' });
  });

  test('lists /trust and /untrust in the help', ({ expect }) => {
    expect(chatHelp.some((line) => line.startsWith('/trust'))).toBe(true);
    expect(chatHelp.some((line) => line.startsWith('/untrust'))).toBe(true);
  });

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

  test('parses /sidebar', ({ expect }) => {
    expect(parseChatCommand('/sidebar left')).toStrictEqual({ kind: 'sidebar', side: 'left' });
    expect(parseChatCommand('/layout a').kind).toBe('invalid');
    expect(parseChatCommand('/sidebar').kind).toBe('invalid');
  });
});
