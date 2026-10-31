import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from './testing/test.ts';

/**
 * The data path of the diff insights (ADR 0061): the renderer derives them from the stored
 * `/review` answers, so the findings, their lines and the head they were made at must arrive
 * on `chat:list` and in `chat:stream`'s `message` events with no other channel (ADR 0072).
 */
describe('chat: /review findings for the renderer (integration: SQLite + git + fake claude)', () => {
  test('carry their lines, check and head on chat:list and chat:stream', async ({
    expect,
    fakeClaude,
    startChat,
    signal,
  }) => {
    const claude = fakeClaude.scripted(
      {
        chunks: [],
        structured: {
          findings: [
            finding({
              line: 2,
              severity: 'warning',
              title: 'The constant hides a missing computation',
            }),
            finding({ line: 3, severity: 'risk', title: 'The closing brace swallows a return' }),
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
    const { headSha } = okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));

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

    const listed = okValueFrom(chat.list({ sessionId })).messages.filter(({ answerKind }) => {
      return answerKind === 'review';
    });
    expect(
      listed.map(({ headSha: head, status }) => {
        return [head, status];
      }),
    ).toStrictEqual([
      [headSha, 'done'],
      [headSha, 'done'],
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

/** A finding the fake model reports on one line of `feature.rs`. */
interface FindingSpec {
  readonly line: number;
  readonly severity: string;
  readonly title: string;
}

function finding({ line, severity, title }: FindingSpec): object {
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
