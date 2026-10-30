import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { parseClaudeCodeEvent } from './parse-claude-code-event.ts';
import type { ClaudeCodeEvent } from './claude-code-event-from.ts';
import { claudeCodeStreamFixture } from './testing/claude-code-stream-fixture.ts';
import { claudeCodeTextStreamFixture } from './testing/claude-code-text-stream-fixture.ts';

describe('parseClaudeCodeEvent', () => {
  test('reads init, tool use, rate limit and result from a real Claude Code stream', ({
    expect,
  }) => {
    const events = claudeCodeStreamFixture
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => parseClaudeCodeEvent(line))
      .filter((event) => event.kind !== 'other');
    expect(events).toStrictEqual<ClaudeCodeEvent[]>([
      {
        kind: 'init',
        model: 'claude-sonnet-5-5',
        version: '2.1.312',
        tools: ['Glob', 'Grep', 'Read', 'StructuredOutput'],
        apiKeySource: 'none',
      },
      { kind: 'rate-limit', status: 'allowed', resetsAt: 1_793_224_800 },
      { kind: 'message-start' },
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
          duration: Temporal.Duration.from({ milliseconds: 7915 }),
          deniedToolUses: 0,
          usage: undefined,
        },
      },
    ]);
  });

  test('reads message starts and text deltas from a real stream with partial messages', ({
    expect,
  }) => {
    const events = claudeCodeTextStreamFixture
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => parseClaudeCodeEvent(line))
      .filter((event) => event.kind !== 'other' && event.kind !== 'rate-limit');
    expect(events).toStrictEqual<ClaudeCodeEvent[]>([
      {
        kind: 'init',
        model: 'claude-haiku-5-5',
        version: '2.1.312',
        tools: ['Glob', 'Grep', 'Read'],
        apiKeySource: 'none',
      },
      { kind: 'message-start' },
      { kind: 'text-delta', text: 'hi there' },
      {
        kind: 'result',
        result: {
          subtype: 'success',
          isError: false,
          text: 'hi there',
          hasStructuredOutput: false,
          structuredOutput: undefined,
          apiErrorStatus: undefined,
          turns: 1,
          costUsd: expect.closeTo(7.7363e-4, 12) as number,
          duration: Temporal.Duration.from({ milliseconds: 9217 }),
          deniedToolUses: 0,
          usage: undefined,
        },
      },
    ]);
  });

  test("ignores a subagent's stream events and deltas that carry no text", ({ expect }) => {
    const delta = (fields: object): string =>
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } },
        ...fields,
      });
    expect(parseClaudeCodeEvent(delta({ parent_tool_use_id: 'toolu_1' }))).toStrictEqual({
      kind: 'other',
    });
    expect(parseClaudeCodeEvent(delta({}))).toStrictEqual({
      kind: 'text-delta',
      text: 'x',
    });
    const inputDelta = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{' },
      },
    });
    expect(parseClaudeCodeEvent(inputDelta)).toStrictEqual({ kind: 'other' });
  });

  test('rejects lines that are not stream-json events', ({ expect }) => {
    expect(parseClaudeCodeEvent('Error: something')).toStrictEqual({
      kind: 'invalid',
      reason: 'not JSON',
    });
    expect(parseClaudeCodeEvent('[1,2]')).toStrictEqual({
      kind: 'invalid',
      reason: 'not a stream-json event',
    });
    expect(parseClaudeCodeEvent('{"type":"result"}')).toStrictEqual({
      kind: 'invalid',
      reason: 'malformed result event',
    });
  });

  test('treats an error subtype without is_error as an error', ({ expect }) => {
    const event = parseClaudeCodeEvent('{"type":"result","subtype":"error_during_execution"}');
    expect(event).toMatchObject({ kind: 'result', result: { isError: true } });
  });
});
