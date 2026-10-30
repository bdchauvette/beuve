import { describe, expect, it } from 'vitest';

import { chatHelp } from './chat-help.ts';
import { parseChatCommand } from './parse-chat-command.ts';

describe('parseChatCommand', () => {
  it('parses /diff and /whitespace with and without a choice', () => {
    expect(parseChatCommand('/diff')).toEqual({ kind: 'diff' });
    expect(parseChatCommand('/diff Inline')).toEqual({ kind: 'diff', layout: 'unified' });
    expect(parseChatCommand('/diff split')).toEqual({ kind: 'diff', layout: 'split' });
    expect(parseChatCommand('/diff wide')).toMatchObject({ kind: 'invalid' });
    expect(parseChatCommand('/whitespace')).toEqual({ kind: 'whitespace' });
    expect(parseChatCommand('/whitespace ignore')).toEqual({
      kind: 'whitespace',
      ignoreWhitespace: true,
    });
    expect(parseChatCommand('/whitespace show')).toEqual({
      kind: 'whitespace',
      ignoreWhitespace: false,
    });
    expect(parseChatCommand('/whitespace ignore show')).toMatchObject({ kind: 'invalid' });
  });

  it('parses /generated with and without a choice', () => {
    expect(parseChatCommand('/generated')).toEqual({ kind: 'generated' });
    expect(parseChatCommand('/generated Show')).toEqual({ kind: 'generated', showGenerated: true });
    expect(parseChatCommand('/generated hide')).toEqual({
      kind: 'generated',
      showGenerated: false,
    });
    expect(parseChatCommand('/generated maybe')).toMatchObject({ kind: 'invalid' });
  });

  it('parses /editor with and without a choice', () => {
    expect(parseChatCommand('/editor')).toEqual({ kind: 'editor' });
    expect(parseChatCommand('/editor Zed')).toEqual({ kind: 'editor', editorId: 'zed' });
    expect(parseChatCommand('/editor code')).toEqual({ kind: 'editor', editorId: 'vscode' });
    expect(parseChatCommand('/editor cursor')).toEqual({ kind: 'editor', editorId: 'cursor' });
    expect(parseChatCommand('/editor emacs')).toMatchObject({ kind: 'invalid' });
    expect(parseChatCommand('/editor zed cursor')).toMatchObject({ kind: 'invalid' });
  });

  it('parses /trust and /untrust, which take no arguments', () => {
    expect(parseChatCommand('/trust')).toEqual({ kind: 'trust' });
    expect(parseChatCommand(' /UNTRUST ')).toEqual({ kind: 'untrust' });
    expect(parseChatCommand('/trust now')).toMatchObject({ kind: 'invalid' });
    expect(parseChatCommand('/untrust all')).toMatchObject({ kind: 'invalid' });
  });

  it('lists /trust and /untrust in the help', () => {
    expect(chatHelp.some((line) => line.startsWith('/trust'))).toBe(true);
    expect(chatHelp.some((line) => line.startsWith('/untrust'))).toBe(true);
  });

  it('parses /review for the whole session', () => {
    expect(parseChatCommand('  /review ')).toEqual({
      kind: 'review',
      pathPrefixes: [],
      fresh: false,
      verify: true,
    });
    expect(parseChatCommand('/REVIEW')).toMatchObject({ kind: 'review' });
  });

  it('parses path prefixes, normalized and deduplicated', () => {
    expect(parseChatCommand('/review ./src/ui/ src/ui docs')).toEqual({
      kind: 'review',
      pathPrefixes: ['src/ui', 'docs'],
      fresh: false,
      verify: true,
    });
  });

  it('parses --fresh and --effort in either form, mixed with prefixes', () => {
    expect(parseChatCommand('/review src --fresh --effort=high')).toEqual({
      kind: 'review',
      pathPrefixes: ['src'],
      fresh: true,
      verify: true,
      effort: 'high',
    });
    expect(parseChatCommand('/review --effort low')).toEqual({
      kind: 'review',
      pathPrefixes: [],
      fresh: false,
      verify: true,
      effort: 'low',
    });
    expect(parseChatCommand('/review -- --fresh')).toEqual({
      kind: 'review',
      pathPrefixes: ['--fresh'],
      fresh: false,
      verify: true,
    });
  });

  it('parses --no-verify, which skips the verification pass', () => {
    expect(parseChatCommand('/review --no-verify src')).toEqual({
      kind: 'review',
      pathPrefixes: ['src'],
      fresh: false,
      verify: false,
    });
  });

  it('parses /summarize and its alias /abstract', () => {
    expect(parseChatCommand('/summarize')).toEqual({ kind: 'summarize' });
    expect(parseChatCommand(' /Abstract ')).toEqual({ kind: 'summarize' });
    expect(parseChatCommand('/summarize src')).toEqual({
      kind: 'invalid',
      message: '/summarize takes no arguments. Type /help for the commands.',
    });
    expect(chatHelp.some((line) => line.startsWith('/summarize'))).toBe(true);
    expect(chatHelp.some((line) => line.startsWith('/abstract'))).toBe(true);
  });

  it('explains malformed /review commands instead of failing', () => {
    for (const input of [
      '/review --effort=max',
      '/review --effort',
      '/review --force',
      '/review /etc',
      '/review ../outside',
    ]) {
      expect(parseChatCommand(input)).toMatchObject({ kind: 'invalid' });
    }
    expect(parseChatCommand('/review --force')).toEqual({
      kind: 'invalid',
      message: '/review has no option --force. Type /help for its options.',
    });
  });

  it('parses /help, empty input, plain questions and unknown commands', () => {
    expect(parseChatCommand('/help')).toEqual({ kind: 'help' });
    expect(parseChatCommand('/?')).toEqual({ kind: 'help' });
    expect(parseChatCommand(' '.repeat(3))).toEqual({ kind: 'empty' });
    expect(parseChatCommand('why does run_fast skip checks?')).toEqual({
      kind: 'question',
      text: 'why does run_fast skip checks?',
    });
    expect(parseChatCommand(' /CLEAR ')).toEqual({ kind: 'clear', queuedOnly: false });
    expect(parseChatCommand('/clear Queue')).toEqual({ kind: 'clear', queuedOnly: true });
    expect(parseChatCommand('/clear now')).toEqual({
      kind: 'invalid',
      message: '/clear takes nothing, or queue to drop only the waiting questions.',
    });
    expect(parseChatCommand('/Compact')).toEqual({ kind: 'compact' });
    expect(parseChatCommand('/compact all')).toEqual({
      kind: 'invalid',
      message: '/compact takes no arguments. Type /help for the commands.',
    });
    expect(parseChatCommand('/explain foo')).toEqual({
      kind: 'invalid',
      message: 'Unknown command /explain. Type /help for the commands.',
    });
  });

  it('parses /sidebar', () => {
    expect(parseChatCommand('/sidebar left')).toEqual({ kind: 'sidebar', side: 'left' });
    expect(parseChatCommand('/layout a').kind).toBe('invalid');
    expect(parseChatCommand('/sidebar').kind).toBe('invalid');
  });
});
