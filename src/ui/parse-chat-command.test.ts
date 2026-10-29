import { describe, expect, it } from 'vitest';

import { chatHelp } from './chat-help.ts';
import { parseChatCommand } from './parse-chat-command.ts';

describe('parseChatCommand', () => {
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
    });
    expect(parseChatCommand('/REVIEW')).toMatchObject({ kind: 'review' });
  });

  it('parses path prefixes, normalized and deduplicated', () => {
    expect(parseChatCommand('/review ./src/ui/ src/ui docs')).toEqual({
      kind: 'review',
      pathPrefixes: ['src/ui', 'docs'],
      fresh: false,
    });
  });

  it('parses --fresh and --effort in either form, mixed with prefixes', () => {
    expect(parseChatCommand('/review src --fresh --effort=high')).toEqual({
      kind: 'review',
      pathPrefixes: ['src'],
      fresh: true,
      effort: 'high',
    });
    expect(parseChatCommand('/review --effort low')).toEqual({
      kind: 'review',
      pathPrefixes: [],
      fresh: false,
      effort: 'low',
    });
    expect(parseChatCommand('/review -- --fresh')).toEqual({
      kind: 'review',
      pathPrefixes: ['--fresh'],
      fresh: false,
    });
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
    expect(parseChatCommand(' /CLEAR ')).toEqual({ kind: 'clear' });
    expect(parseChatCommand('/clear now')).toEqual({
      kind: 'invalid',
      message: '/clear takes no arguments. Type /help for the commands.',
    });
    expect(parseChatCommand('/explain foo')).toEqual({
      kind: 'invalid',
      message: 'Unknown command /explain. Type /help for the commands.',
    });
  });

  it('parses /layout and /sidebar', () => {
    expect(parseChatCommand('/layout b')).toEqual({ kind: 'layout', layout: 'b' });
    expect(parseChatCommand('/sidebar left')).toEqual({ kind: 'sidebar', side: 'left' });
    expect(parseChatCommand('/layout d').kind).toBe('invalid');
    expect(parseChatCommand('/sidebar').kind).toBe('invalid');
  });
});
