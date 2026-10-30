import { describe } from 'vitest';

import { describeModelEntry } from './describe-model-entry.ts';
import { test } from './testing/test.ts';

describe('describeModelEntry', () => {
  test('says what each kind runs, and whether a key is set', ({ expect }) => {
    const common = { hasApiKey: false, isRemote: false, isDefault: false };
    expect(
      describeModelEntry({
        ...common,
        id: 'claude-code',
        label: 'Claude Code (your login)',
        kind: 'claude-code-cli',
        isDefault: true,
      }),
    ).toStrictEqual({
      title: 'Claude Code (your login)',
      detail: 'Runs Claude Code with your login · its default model',
    });
    expect(
      describeModelEntry({
        ...common,
        id: 'claude-1',
        label: 'Console',
        kind: 'claude-agent-sdk',
        executable: { source: 'bundled' },
        effort: 'high',
        hasApiKey: true,
      }).detail,
    ).toBe(
      'Via Claude Code (Agent SDK) on bundled Claude Code · claude-opus-5-5 · effort high · API key set',
    );
  });

  test('warns about a server off this machine', ({ expect }) => {
    const remote = describeModelEntry({
      id: 'openai-1',
      label: 'Gateway',
      kind: 'openai-compatible',
      model: 'gpt-x',
      baseUrl: 'https://llm.example.com/v1',
      tools: false,
      hasApiKey: true,
      isRemote: true,
      isDefault: false,
    });
    expect(remote).toStrictEqual({
      title: 'Gateway',
      detail: 'gpt-x at https://llm.example.com/v1 · no tools · API key set',
      warning: 'Not on this machine: the diff and your questions are sent to this server.',
    });
  });
});
