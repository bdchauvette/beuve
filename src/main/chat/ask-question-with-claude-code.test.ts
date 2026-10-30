import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, describe, expect, it } from 'vitest';

import { askQuestion } from '#internal/chat/ask-question.ts';
import type { ChatDelta } from '#internal/chat/chat-model.ts';
import { createChatQuestion } from '#internal/chat/testing/create-chat-question.ts';
import { createClaudeCodeModel } from '#internal/llm/create-claude-code-model.ts';
import type { LanguageModel } from '#internal/llm/language-model.ts';
import { writeFakeClaude } from '#internal/llm/testing/write-fake-claude.ts';

/** The chat domain driven through the real Claude Code adapter and the fake `claude` (ADR 0031). */
describe('askQuestion with the Claude Code adapter (fake claude)', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'beuve-chat-'));
  const directory = realpathSync(temporary);
  const script = writeFakeClaude(directory);
  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const model = (mode: string, name: string, chat?: object): LanguageModel => {
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
  };
  const question = createChatQuestion({ worktreePath: directory });

  it('streams the answer and returns it with validated citations', async () => {
    const deltas: ChatDelta[] = [];
    const result = await askQuestion(question, {
      model: model('chat', 'success', {
        preamble: 'Let me grep.',
        chunks: ['It trims ', `[[${directory}/src/a.ts:12-13]] and [[src/zzz.ts:1]].`],
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
    expect(deltas[0]).toEqual({ kind: 'append', text: 'Let me grep.' });
    expect(deltas[1]).toEqual({ kind: 'reset' });
    expect(
      deltas
        .slice(2)
        .map((delta) => (delta.kind === 'append' ? delta.text : ''))
        .join(''),
    ).toBe(`It trims [[${directory}/src/a.ts:12-13]] and [[src/zzz.ts:1]].`);
  });

  it('reports a failed run as the adapter error', async () => {
    expect(await askQuestion(question, { model: model('not-logged-in', 'login') })).toMatchObject({
      ok: false,
      error: { kind: 'model', error: { kind: 'not-authenticated' } },
    });
  });

  it('cancels a slow answer', async () => {
    const controller = new AbortController();
    const running = askQuestion(question, {
      model: model('chat', 'slow', { chunks: ['a', 'b', 'c'], delayMs: 5000 }),
      signal: controller.signal,
    });
    await delay(300);
    controller.abort();
    expect(await running).toEqual({
      ok: false,
      error: { kind: 'model', error: { kind: 'cancelled' } },
    });
  });
});
