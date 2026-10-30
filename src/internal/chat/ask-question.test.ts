import { describe } from 'vitest';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { askQuestion } from './ask-question.ts';
import type { ChatDelta, ChatModel, ChatModelOutput, ChatModelRequest } from './chat-model.ts';
import { createChatQuestion } from './testing/create-chat-question.ts';
import { test } from './testing/test.ts';

interface FakeError {
  readonly kind: 'timeout' | 'cancelled';
}

function fakeModel(
  answer: Result<string, FakeError>,
  seen: ChatModelRequest[] = [],
  deltas: readonly ChatDelta[] = [],
): ChatModel<FakeError> {
  return {
    runText: async (request: ChatModelRequest): Promise<Result<ChatModelOutput, FakeError>> => {
      seen.push(request);
      for (const delta of deltas) {
        request.onText?.(delta);
        await Promise.resolve();
      }
      if (request.signal?.aborted === true) {
        return err({ kind: 'cancelled' });
      }
      if (!answer.ok) {
        return answer;
      }
      return ok({
        value: answer.value,
        model: 'fake-model',
        turns: 2,
        costUsd: 0.01,
        durationMs: 900,
        deniedToolUses: 0,
      });
    },
  };
}

describe('askQuestion', () => {
  test('asks in the head worktree and returns the answer with validated citations', async ({
    expect,
  }) => {
    const seen: ChatModelRequest[] = [];
    const answer =
      'It trims because of [[src/a.ts:12-13]]; see also [[src/c.ts:1]] and [[docs/x.md:2-4]].\n';
    const result = await askQuestion(
      createChatQuestion({ worktreePaths: new Set(['docs/x.md']) }),
      { model: fakeModel(ok(answer), seen) },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ cwd: '/work/repo', timeoutMs: 300_000 });
    expect(seen[0]?.prompt).toContain('Why does parse trim the first part?');
    expect(seen[0]?.system).toContain('[[path:start-end]]');
    expect(result).toMatchObject({
      ok: true,
      value: {
        answer:
          'It trims because of [[src/a.ts:12-13]]; see also `src/c.ts:1-1` and [[docs/x.md:2-4]].',
        citations: [
          { path: 'src/a.ts', startLine: 12, endLine: 13, side: 'head' },
          { path: 'docs/x.md', startLine: 2, endLine: 4, side: 'head' },
        ],
        dropped: [{ path: 'src/c.ts', startLine: 1, endLine: 1, reason: 'unknown-path' }],
        malformedCitations: 0,
        usage: { model: 'fake-model', turns: 2, durationMs: 900 },
      },
    });
  });

  test('never accepts a citation of a deleted file', async ({ expect }) => {
    const question = createChatQuestion({
      files: [{ path: 'old.ts', status: 'deleted', binary: false, patch: '' }],
    });
    const result = await askQuestion(question, { model: fakeModel(ok('Gone: [[old.ts:1]].')) });
    expect(result).toMatchObject({
      ok: true,
      value: { citations: [], answer: 'Gone: `old.ts:1-1`.' },
    });
  });

  test('passes streamed deltas through', async ({ expect }) => {
    const deltas: ChatDelta[] = [
      { kind: 'append', text: 'Let me look.' },
      { kind: 'reset' },
      { kind: 'append', text: 'Done.' },
    ];
    const received: ChatDelta[] = [];
    await askQuestion(createChatQuestion(), {
      model: fakeModel(ok('Done.'), [], deltas),
      onDelta: (delta) => {
        received.push(delta);
      },
    });
    expect(received).toStrictEqual(deltas);
  });

  test('wraps model failures and cancellation', async ({ expect }) => {
    const timedOut = fakeModel(err({ kind: 'timeout' }));
    await expect(askQuestion(createChatQuestion(), { model: timedOut })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'model', error: { kind: 'timeout' } },
    });
    const controller = new AbortController();
    controller.abort();
    const never = fakeModel(ok('never'));
    await expect(
      askQuestion(createChatQuestion(), { model: never, signal: controller.signal }),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'model', error: { kind: 'cancelled' } } });
  });

  test('refuses empty and oversized questions without calling the model', async ({ expect }) => {
    const seen: ChatModelRequest[] = [];
    const model = fakeModel(ok('x'), seen);
    const blank = createChatQuestion({ question: ' \n' });
    await expect(askQuestion(blank, { model })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'empty-question' },
    });
    const long = createChatQuestion({ question: 'x'.repeat(8001) });
    await expect(askQuestion(long, { model })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'question-too-long', maxChars: 8000 },
    });
    expect(seen).toHaveLength(0);
  });
});
