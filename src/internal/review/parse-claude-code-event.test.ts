import { describe, expect, it } from 'vitest';

import { parseClaudeCodeEvent } from './parse-claude-code-event.ts';
import type { ClaudeCodeEvent } from './parse-claude-code-event.ts';
import { claudeCodeStreamFixture } from './testing/claude-code-stream-fixture.ts';

describe('parseClaudeCodeEvent', () => {
  it('reads init, tool use, rate limit and result from a real Claude Code stream', () => {
    const events = claudeCodeStreamFixture
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => parseClaudeCodeEvent(line))
      .filter((event) => event.kind !== 'other');
    expect(events).toEqual<ClaudeCodeEvent[]>([
      {
        kind: 'init',
        model: 'claude-sonnet-5-5',
        version: '2.1.312',
        tools: ['Glob', 'Grep', 'Read', 'StructuredOutput'],
      },
      { kind: 'rate-limit', status: 'allowed', resetsAt: 1_793_224_800 },
      { kind: 'tool-use', tools: ['Glob'] },
      { kind: 'tool-use', tools: ['Read'] },
      { kind: 'tool-use', tools: ['StructuredOutput'] },
      {
        kind: 'result',
        result: {
          subtype: 'success',
          isError: false,
          text: '{"value":1}',
          hasStructuredOutput: true,
          structuredOutput: { value: 1 },
          apiErrorStatus: undefined,
          turns: 4,
          costUsd: expect.closeTo(0.0270372, 12) as number,
          durationMs: 7915,
          deniedToolUses: 0,
        },
      },
    ]);
  });

  it('rejects lines that are not stream-json events', () => {
    expect(parseClaudeCodeEvent('Error: something')).toEqual({
      kind: 'invalid',
      reason: 'not JSON',
    });
    expect(parseClaudeCodeEvent('[1,2]')).toEqual({
      kind: 'invalid',
      reason: 'not a stream-json event',
    });
    expect(parseClaudeCodeEvent('{"type":"result"}')).toEqual({
      kind: 'invalid',
      reason: 'malformed result event',
    });
  });

  it('treats an error subtype without is_error as an error', () => {
    const event = parseClaudeCodeEvent('{"type":"result","subtype":"error_during_execution"}');
    expect(event).toMatchObject({ kind: 'result', result: { isError: true } });
  });
});
