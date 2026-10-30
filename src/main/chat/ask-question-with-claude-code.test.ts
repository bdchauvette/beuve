import { writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { describe } from 'vitest';

import { askQuestion } from '#internal/chat/ask-question.ts';
import type { ChatDelta } from '#internal/chat/chat-model.ts';
import { createChatQuestion } from '#internal/chat/testing/create-chat-question.ts';
import { createClaudeCodeModel } from '#internal/llm/create-claude-code-model.ts';
import type { LanguageModel } from '#internal/llm/language-model.ts';

import { test } from '../testing/test.ts';

/** The chat domain driven through the real Claude Code adapter and the fake `claude` (ADR 0031). */
describe('askQuestion with the Claude Code adapter (fake claude)', { timeout: 30_000 }, () => {
  test('streams the answer and returns it with validated citations', async ({
    expect,
    tempDir,
    claudeScript,
  }) => {
    const deltas: ChatDelta[] = [];
    const result = await askQuestion(createChatQuestion({ worktreePath: tempDir }), {
      model: fakeModel(claudeScript, tempDir, 'chat', 'success', {
        preamble: 'Let me grep.',
        chunks: ['It trims ', `[[${tempDir}/src/a.ts:12-13]] and [[src/zzz.ts:1]].`],
      }),
      onDelta: (delta) => {
        deltas.push(delta);
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        answer: 'It trims [[src/a.ts:12-13]] and `src/zzz.ts:1-1`.',
        citations: [{ path: 'src/a.ts', startLine: 12, endLine: 13, side: 'head' }],
        dropped: [{ path: 'src/zzz.ts', reason: 'unknown-path' }],
        usage: { model: 'fake-model-1' },
      },
    });
    expect(deltas[0]).toStrictEqual({ kind: 'append', text: 'Let me grep.' });
    expect(deltas[1]).toStrictEqual({ kind: 'reset' });
    expect(
      deltas
        .slice(2)
        .map((delta) => (delta.kind === 'append' ? delta.text : ''))
        .join(''),
    ).toBe(`It trims [[${tempDir}/src/a.ts:12-13]] and [[src/zzz.ts:1]].`);
  });

  test('reports a failed run as the adapter error', async ({ expect, tempDir, claudeScript }) => {
    const result = await askQuestion(createChatQuestion({ worktreePath: tempDir }), {
      model: fakeModel(claudeScript, tempDir, 'not-logged-in', 'login'),
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'model', error: { kind: 'not-authenticated' } },
    });
  });

  test('cancels a slow answer', async ({ expect, tempDir, claudeScript }) => {
    const controller = new AbortController();
    const running = askQuestion(createChatQuestion({ worktreePath: tempDir }), {
      model: fakeModel(claudeScript, tempDir, 'chat', 'slow', {
        chunks: ['a', 'b', 'c'],
        delayMs: 5000,
      }),
      signal: controller.signal,
    });
    await delay(300);
    controller.abort();
    await expect(running).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'model', error: { kind: 'cancelled' } },
    });
  });
});

function fakeModel(
  script: string,
  directory: string,
  mode: string,
  name: string,
  chat?: object,
): LanguageModel {
  const file = path.join(directory, `${name}.json`);
  if (chat !== undefined) {
    writeFileSync(file, JSON.stringify(chat));
  }
  return createClaudeCodeModel({
    command: process.execPath,
    leadingArgs: [script, mode, file],
    inheritedEnv: { PATH: process.env['PATH'] },
    killGrace: Temporal.Duration.from({ milliseconds: 200 }),
  });
}
