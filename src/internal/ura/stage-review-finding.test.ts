import { describe } from 'vitest';

import { stageReviewFinding } from './stage-review-finding.ts';
import type { ReviewFindingSource, StageableReviewFinding } from './stage-review-finding.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';

describe('stageReviewFinding', () => {
  test('stages the finding on its lines, naming its answer and index', ({ expect, deps }) => {
    expect(stageReviewFinding(finding(), source(), { deps })).toMatchObject({
      ok: true,
      value: {
        sessionId: source().sessionId,
        headSha: source().headSha,
        anchor: { kind: 'lines', path: 'src/a.ts', startLine: 4, endLine: 6 },
        severity: 'issue',
        origin: { kind: 'chat-answer', messageId: testUraIds.messageId, finding: 2 },
        title: 'Unchecked input',
        body: finding().body,
        status: { kind: 'staged' },
      },
    });
  });

  test('never blocks by default, and lets the reviewer choose', ({ expect, deps }) => {
    const severity = (value: StageableReviewFinding['severity']): string | undefined => {
      const result = stageReviewFinding({ ...finding(), severity: value }, source(), { deps });
      if (result.ok) {
        return result.value.severity;
      }
      return undefined;
    };
    expect([severity('risk'), severity('warning'), severity('info')]).toStrictEqual([
      'issue',
      'issue',
      'nitpick',
    ]);
    const chosen = stageReviewFinding(finding(), source(), { deps, severity: 'smell' });
    expect(chosen.ok && chosen.value.severity).toBe('smell');
    expect(chosen.ok && chosen.value.blocking).toBe(false);
  });
});

function finding(): StageableReviewFinding {
  return {
    path: 'src/a.ts',
    startLine: 4,
    endLine: 6,
    severity: 'risk',
    title: 'Unchecked input',
    body: 'The value reaches `exec` unchecked.',
  };
}

function source(): ReviewFindingSource {
  return {
    sessionId: testUraIds.sessionId,
    headSha: testUraIds.headSha,
    messageId: testUraIds.messageId,
    finding: 2,
  };
}
