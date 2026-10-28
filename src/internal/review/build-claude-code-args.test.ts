import { describe, expect, it } from 'vitest';

import { buildClaudeCodeArgs } from './build-claude-code-args.ts';

describe('buildClaudeCodeArgs', () => {
  it('builds a headless, read-only, schema-constrained run with the prompt left for stdin', () => {
    expect(
      buildClaudeCodeArgs({ system: '-starts with a dash', jsonSchema: '{"type":"object"}' }),
    ).toEqual([
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

  it('adds model, effort and budget only when given', () => {
    const args = buildClaudeCodeArgs({
      system: 's',
      jsonSchema: '{}',
      model: 'opus',
      effort: 'high',
      maxBudgetUsd: 0.5,
    });
    expect(args.slice(-3)).toEqual(['--model=opus', '--effort=high', '--max-budget-usd=0.5']);
  });

  it('never grants a tool that writes, runs commands or reaches the network', () => {
    const args = buildClaudeCodeArgs({ system: 's', jsonSchema: '{}' });
    const granted = args
      .filter((arg) => arg.startsWith('--tools=') || arg.startsWith('--allowed-tools='))
      .flatMap((arg) => arg.slice(arg.indexOf('=') + 1).split(','));
    expect(new Set(granted)).toEqual(new Set(['Read', 'Grep', 'Glob']));
    expect(args.some((arg) => arg.includes('dangerously') || arg.includes('bypass'))).toBe(false);
  });
});
