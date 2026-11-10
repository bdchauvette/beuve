import { describe } from 'vitest';

import { uraSeverities } from '#internal/ura/ura-severities.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from './testing/test.ts';

/**
 * Notes an ordinary answer proposes (ADR 0132): main parses and checks them when the answer
 * completes, stores them as parts of it, and stages one only when the reviewer asks, reading it
 * from the stored answer.
 */
describe(
  'chat: proposed review notes (integration: SQLite + git + fake claude)',
  { timeout: 30_000 },
  () => {
    test('are offered, checked, stored and staged once each', async ({
      expect,
      fakeClaude,
      startChat,
      signal,
    }) => {
      const claude = fakeClaude.scripted({ chunks: answerChunks() }, 'proposals');
      const { services, chat, sessionId, settled } = await startChat(claude.settings);
      const { headSha } = okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));

      const asked = okValueFrom(
        await chat.ask({ sessionId, question: 'Any notes worth leaving?' }),
      );
      const done = await settled(asked.answer.id);
      expect(claude.calls()[0]?.args.join('\n')).toContain(
        ':::note <label> [[path:start-end]] <optional one-line title>',
      );
      expect(claude.calls()[0]?.args.join('\n')).toContain(
        `${uraSeverities.join(', ')} (most urgent first)`,
      );
      expect(done).toMatchObject({
        status: 'done',
        citations: [{ path: 'feature.rs', startLine: 1, endLine: 2 }],
      });
      expect(done.parts.filter(({ kind }) => kind !== 'tool-call')).toMatchObject([
        { kind: 'text', text: 'Two notes on [[feature.rs:1-2]].' },
        {
          kind: 'proposal',
          proposal: 0,
          note: {
            path: 'feature.rs',
            startLine: 2,
            endLine: 2,
            label: 'question',
            title: 'Why a constant?',
            body: 'Should this be computed?',
          },
        },
        { kind: 'dropped-proposal', reason: 'unknown-file' },
        { kind: 'text', text: 'That is all.' },
      ]);
      expect(okValueFrom(chat.list({ sessionId })).messages.at(-1)).toStrictEqual(done);

      const staged = okValueFrom(
        await services.ura.stageNoteProposal({ messageId: asked.answer.id, proposal: 0 }),
      );
      expect(staged).toMatchObject({
        created: true,
        item: {
          severity: 'question',
          origin: { kind: 'chat-answer', messageId: asked.answer.id, proposal: 0 },
          anchor: { kind: 'lines', path: 'feature.rs', startLine: 2, endLine: 2 },
          headSha,
          title: 'Why a constant?',
          body: 'Should this be computed?',
          status: { kind: 'staged' },
        },
      });
      const again = okValueFrom(
        await services.ura.stageNoteProposal({ messageId: asked.answer.id, proposal: 0 }),
      );
      expect(again).toMatchObject({ created: false, item: { id: staged.item.id } });

      okValueFrom(await services.ura.transition({ itemId: staged.item.id, to: 'withdrawn' }));
      const restaged = okValueFrom(
        await services.ura.stageNoteProposal({
          messageId: asked.answer.id,
          proposal: 0,
          severity: 'nit',
        }),
      );
      expect(restaged).toMatchObject({
        created: false,
        item: { id: staged.item.id, status: { kind: 'staged' } },
      });

      await expect(
        services.ura.stageNoteProposal({ messageId: asked.answer.id, proposal: 1 }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
      await expect(
        services.ura.stageNoteProposal({ messageId: asked.question.id, proposal: 0 }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
      expect(
        okValueFrom(await services.ura.list({ sessionId })).items.map(({ origin }) => origin),
      ).toStrictEqual([{ kind: 'chat-answer', messageId: asked.answer.id, proposal: 0 }]);
    });
  },
);

function answerChunks(): string[] {
  return [
    'Two notes on [[feature.rs:1-2]].\n\n',
    ':::note question [[feature.rs:2]] Why a constant?\n',
    'Should this be computed?\n:::\n',
    ':::note nit [[app.rs:2]] Not in the diff\nIt is unchanged.\n:::\n',
    'That is all.',
  ];
}
