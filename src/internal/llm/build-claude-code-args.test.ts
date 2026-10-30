import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { buildClaudeCodeArgs } from './build-claude-code-args.ts';

describe('buildClaudeCodeArgs', () => {
  test('builds a headless, read-only, schema-constrained run with the prompt left for stdin', ({
    expect,
  }) => {
    expect(
      buildClaudeCodeArgs({ system: '-starts with a dash', jsonSchema: '{"type":"object"}' }),
    ).toStrictEqual([
      '--print',
      '--output-format=stream-json',
      '--verbose',
      '--input-format=text',
      '--no-session-persistence',
      '--safe-mode',
      '--restricted',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--permission-mode=dontAsk',
      '--permission-prompts=none',
      '--tools=Read,Grep,Glob',
      '--allowed-tools=Read,Grep,Glob',
      '--disallowed-tools=Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch',
      '--append-system-prompt=-starts with a dash',
      '--json-schema={"type":"object"}',
    ]);
  });

  test('adds model, effort and budget only when given', ({ expect }) => {
    const args = buildClaudeCodeArgs({
      system: 's',
      jsonSchema: '{}',
      model: 'opus',
      effort: 'high',
      maxBudgetUsd: 0.5,
    });
    expect(args.slice(-3)).toStrictEqual(['--model=opus', '--effort=high', '--max-budget-usd=0.5']);
  });

  test('builds a free-form text run, streaming text deltas only when asked', ({ expect }) => {
    const plain = buildClaudeCodeArgs({ system: 's' });
    expect(plain.some((arg) => arg.startsWith('--json-schema'))).toBe(false);
    expect(plain).not.toContain('--include-partial-messages');
    expect(plain.at(-1)).toBe('--append-system-prompt=s');
    const streamed = buildClaudeCodeArgs({ system: 's', streamText: true, model: 'opus' });
    expect(streamed.slice(-2)).toStrictEqual(['--include-partial-messages', '--model=opus']);
  });

  test('never grants a tool that writes, runs commands or reaches the network', ({ expect }) => {
    const args = buildClaudeCodeArgs({ system: 's', jsonSchema: '{}' });
    const granted = args
      .filter((arg) => arg.startsWith('--tools=') || arg.startsWith('--allowed-tools='))
      .flatMap((arg) => arg.slice(arg.indexOf('=') + 1).split(','));
    expect(new Set(granted)).toStrictEqual(new Set(['Read', 'Grep', 'Glob']));
    expect(args.some((arg) => arg.includes('dangerously') || arg.includes('bypass'))).toBe(false);
  });
});
