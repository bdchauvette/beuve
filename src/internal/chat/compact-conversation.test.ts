import { describe } from 'vitest';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ChatCompaction } from './build-compaction-prompt.ts';
import type { ChatModel, ChatModelOutput, ChatModelRequest } from './chat-model.ts';
import type { CommitSha } from './chat-message.ts';
import type { ChatQuestion } from './chat-question.ts';
import { compactConversation } from './compact-conversation.ts';
import { createChatQuestion } from './testing/create-chat-question.ts';
import { test } from './testing/test.ts';

function fakeModel(
  answer: Result<string, 'boom'>,
  seen: ChatModelRequest[] = [],
): ChatModel<'boom'> {
  return {
    runText: async (request): Promise<Result<ChatModelOutput, 'boom'>> => {
      seen.push(request);
      await Promise.resolve();
      return answer.ok
        ? ok({
            value: answer.value,
            model: 'fake',
            turns: 1,
            costUsd: 0,
            durationMs: 1,
            deniedToolUses: 0,
          })
        : answer;
    },
  };
}

function compaction(overrides: Partial<ChatCompaction> = {}): ChatCompaction {
  return {
    baseSha: question().baseSha,
    headSha: head(),
    worktreePath: '/work/repo',
    files: question().files,
    worktreePaths: new Set(['docs/x.md']),
    turns: [
      {
        role: 'user',
        content: 'Why does [[@1]] trim?',
        mentions: [{ path: 'src/a.ts', side: 'head', startLine: 12, endLine: 13, sha: head() }],
      },
      { role: 'assistant', content: 'Because of [[src/a.ts:12-13]].' },
    ],
    ...overrides,
  };
}

describe('compactConversation', () => {
  test('asks for a note over the turns and the earlier summary, and validates its citations', async ({
    expect,
  }) => {
    const seen: ChatModelRequest[] = [];
    const note =
      '**Asked**\n- why parse trims\n\n**Places**\n- [[src/a.ts:12-13]]\n- [[/work/repo/docs/x.md:2]]\n- [[ghost.ts:1]]\n- [[nope]]';
    const result = await compactConversation(compaction({ summary: 'Earlier: b.ts is new.' }), {
      model: fakeModel(ok(note), seen),
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        citations: [
          { path: 'src/a.ts', startLine: 12, endLine: 13, side: 'head' },
          { path: 'docs/x.md', startLine: 2, endLine: 2, side: 'head' },
        ],
        dropped: [{ path: 'ghost.ts', reason: 'unknown-path' }],
        malformedCitations: 1,
        omittedTurns: 0,
      },
    });
    expect(result.ok && result.value.content).toContain('`ghost.ts:1-1`');
    expect(result.ok && result.value.content).toContain('[[docs/x.md:2-2]]');
    const [request] = seen;
    expect(request?.cwd).toBe('/work/repo');
    expect(request?.system).toContain('**Asked**, **Concluded**, **Open questions**, **Places**');
    expect(request?.prompt).toContain('Earlier: b.ts is new.');
    expect(request?.prompt).toContain('Why does «selection 1: src/a.ts:12-13» trim?');
    expect(request?.prompt).toContain('- modified src/a.ts');
  });

  test('drops the oldest turns past the budget and says so', async ({ expect }) => {
    const seen: ChatModelRequest[] = [];
    const turns = Array.from({ length: 6 }, (_, index) => ({
      role: 'user' as const,
      content: `question ${String(index)} ${'x'.repeat(400)}`,
    }));
    const result = await compactConversation(compaction({ turns }), {
      model: fakeModel(ok('**Asked**\n- things'), seen),
      budget: { maxTurnsChars: 1000, maxTurnChars: 500, maxSummaryChars: 100, maxListedFiles: 1 },
    });
    expect(result).toMatchObject({ ok: true, value: { omittedTurns: 4 } });
    expect(seen[0]?.prompt).toContain('[beuve: 4 older turns omitted for size]');
    expect(seen[0]?.prompt).toContain('question 5');
    expect(seen[0]?.prompt).not.toContain('question 1 ');
    expect(seen[0]?.prompt).toContain('[beuve: 1 more files]');
  });

  test('refuses with nothing to compact and passes model failures through', async ({ expect }) => {
    const seen: ChatModelRequest[] = [];
    const empty = compaction({ turns: [] });
    const nothing = await compactConversation(empty, { model: fakeModel(ok('x'), seen) });
    expect(nothing).toStrictEqual({ ok: false, error: { kind: 'nothing-to-compact' } });
    expect(seen).toStrictEqual([]);
    const failing = fakeModel(err('boom'));
    const failed = await compactConversation(compaction(), { model: failing });
    expect(failed).toStrictEqual({ ok: false, error: { kind: 'model', error: 'boom' } });
  });
});

function question(): ChatQuestion {
  return createChatQuestion();
}

function head(): CommitSha {
  return question().headSha;
}
