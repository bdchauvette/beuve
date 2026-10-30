import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from './testing/test.ts';

/**
 * The data path of the diff insights (ADR 0061): the renderer derives them from the stored
 * `/review` answers, so the findings, their lines and the head they were made at must arrive
 * on `chat:list` and `chat:message-updated` with no other channel.
 */
describe('chat: /review findings for the renderer (integration: SQLite + git + fake claude)', () => {
  test('carry their lines, check and head on chat:list and chat:message-updated', async ({
    expect,
    fakeClaude,
    startChat,
  }) => {
    const claude = fakeClaude.scripted(
      {
        chunks: [],
        structured: {
          findings: [
            finding(2, 'warning', 'The constant hides a missing computation'),
            finding(3, 'risk', 'The closing brace swallows a return'),
          ],
          verdicts: [
            { finding: 1, verdict: 'confirmed', reason: 'Line 2 returns a constant.' },
            { finding: 2, verdict: 'refuted', reason: 'Line 3 is only a brace.' },
          ],
        },
      },
      'insights',
    );
    const { services, chat, sessionId, settled } = await startChat(claude.settings);
    const { headSha } = okValueFrom(await services.sessions.getReview({ sessionId }));

    const verified = okValueFrom(
      await chat.ask({ sessionId, question: '/review', command: { kind: 'review' } }),
    );
    const scoped = okValueFrom(
      await chat.ask({
        sessionId,
        question: '/review --fresh --no-verify feature.rs',
        command: { kind: 'review', fresh: true, verify: false, pathPrefixes: ['feature.rs'] },
      }),
    );
    const verifiedUpdate = await settled(verified.answer.id);
    await settled(scoped.answer.id);

    const listed = okValueFrom(chat.list({ sessionId })).messages.filter(
      ({ answerKind }) => answerKind === 'review',
    );
    expect(listed.map(({ headSha: head, status }) => [head, status])).toStrictEqual([
      [headSha, 'complete'],
      [headSha, 'complete'],
    ]);
    expect(listed[0]?.review?.findings).toMatchObject([
      { path: 'feature.rs', startLine: 2, endLine: 2, severity: 'warning', check: 'confirmed' },
    ]);
    expect(listed[1]?.review?.findings).toMatchObject([
      { startLine: 2, check: 'unchecked' },
      { startLine: 3, severity: 'risk', check: 'unchecked' },
    ]);
    expect(listed[0]).toStrictEqual(verifiedUpdate);
  });
});

function finding(line: number, severity: string, title: string): object {
  return {
    path: 'feature.rs',
    startLine: line,
    endLine: line,
    severity,
    category: 'edge-case',
    title,
    body: `**${title}**: check line ${String(line)}.`,
    confidence: 0.8,
  };
}
