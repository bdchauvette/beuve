import { describe, expect, it } from 'vitest';

import { parseChatCommand } from './parse-chat-command.ts';

describe('parseChatCommand', () => {
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
});
