import { describe } from 'vitest';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { askQuestion } from './ask-question.ts';
import type { ChatDelta, ChatModel, ChatModelOutput, ChatModelRequest } from './chat-model.ts';
import { createChatQuestion } from './testing/create-chat-question.ts';
import { promptTextOf } from './testing/prompt-text-of.ts';
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
        duration: Temporal.Duration.from({ milliseconds: 900 }),
        deniedToolUses: 0,
      });
    },
  };
}

describe('askQuestion', () => {
  test('asks in the head worktree and returns the answer with validated citations', async ({
    expect,
    signal,
  }) => {
    const seen: ChatModelRequest[] = [];
    const answer =
      'It trims because of [[src/a.ts:12-13]]; see also [[src/c.ts:1]] and [[docs/x.md:2-4]].\n';
    const result = await askQuestion(
      createChatQuestion({ worktreePaths: new Set(['docs/x.md']) }),
      { model: fakeModel(ok(answer), seen), signal },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      cwd: '/work/repo',
      timeout: Temporal.Duration.from({ minutes: 5 }),
    });
    expect(promptTextOf(seen[0])).toContain('Why does parse trim the first part?');
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
        usage: {
          model: 'fake-model',
          turns: 2,
          duration: Temporal.Duration.from({ milliseconds: 900 }),
        },
      },
    });
  });

  test('never accepts a citation of a deleted file', async ({ expect, signal }) => {
    const question = createChatQuestion({
      files: [{ path: 'old.ts', status: 'deleted', binary: false, patch: '' }],
    });
    const result = await askQuestion(question, {
      model: fakeModel(ok('Gone: [[old.ts:1]].')),
      signal,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { citations: [], answer: 'Gone: `old.ts:1-1`.' },
    });
  });

  test('passes streamed deltas through', async ({ expect, signal }) => {
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
      signal,
    });
    expect(received).toStrictEqual(deltas);
  });

  test('wraps model failures and cancellation', async ({ expect, signal }) => {
    const timedOut = fakeModel(err({ kind: 'timeout' }));
    await expect(
      askQuestion(createChatQuestion(), { model: timedOut, signal }),
    ).resolves.toStrictEqual({
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

  test('offers notes when asked to, and splits the answer at the ones it proposed', async ({
    expect,
    signal,
  }) => {
    const seen: ChatModelRequest[] = [];
    const answer = [
      'Two notes, see [[src/a.ts:12]].',
      ':::note issue [[src/a.ts:12]] Empty input',
      'Returns `undefined` for [[src/a.ts:12]].',
      ':::',
      ':::note nit [[src/c.ts:1]] Elsewhere',
      'Not in the diff.',
      ':::',
      'Also [[src/b.ts:2]] and [[src/a.ts:12]].',
    ].join('\n');
    const proposals = { labels: ['issue', 'nit'], maxProposals: 5 };
    const result = await askQuestion(createChatQuestion({ proposals }), {
      model: fakeModel(ok(answer), seen),
      signal,
    });
    expect(seen[0]?.system).toContain(':::note <label> [[path:start-end]]');
    expect(seen[0]?.system).toContain('issue, nit (most urgent first)');
    expect(result).toMatchObject({
      ok: true,
      value: {
        answer:
          'Two notes, see [[src/a.ts:12-12]].\n\nAlso [[src/b.ts:2-2]] and [[src/a.ts:12-12]].',
        pieces: [
          { kind: 'text', text: 'Two notes, see [[src/a.ts:12-12]].' },
          {
            kind: 'proposal',
            proposal: {
              path: 'src/a.ts',
              startLine: 12,
              endLine: 12,
              label: 'issue',
              title: 'Empty input',
              body: 'Returns `undefined` for [[src/a.ts:12]].',
            },
          },
          { kind: 'dropped-proposal', reason: 'unknown-file' },
          { kind: 'text', text: 'Also [[src/b.ts:2-2]] and [[src/a.ts:12-12]].' },
        ],
        citations: [
          { path: 'src/a.ts', startLine: 12, endLine: 12, side: 'head' },
          { path: 'src/b.ts', startLine: 2, endLine: 2, side: 'head' },
        ],
      },
    });

    const plain = await askQuestion(createChatQuestion(), {
      model: fakeModel(ok(answer), seen),
      signal,
    });
    expect(seen[1]?.system).not.toContain(':::note');
    expect(plain.ok && plain.value.pieces).toMatchObject([{ kind: 'text' }]);
  });

  test('refuses empty and oversized questions without calling the model', async ({
    expect,
    signal,
  }) => {
    const seen: ChatModelRequest[] = [];
    const model = fakeModel(ok('x'), seen);
    const blank = createChatQuestion({ question: ' \n' });
    await expect(askQuestion(blank, { model, signal })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'empty-question' },
    });
    const long = createChatQuestion({ question: 'x'.repeat(8001) });
    await expect(askQuestion(long, { model, signal })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'question-too-long', maxChars: 8000 },
    });
    expect(seen).toHaveLength(0);
  });
});
