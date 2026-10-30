import { describe, expect, it } from 'vitest';

import { stageReviewFinding } from './stage-review-finding.ts';
import type { ReviewFindingSource, StageableReviewFinding } from './stage-review-finding.ts';
import { fixedUraDeps } from './testing/fixed-ura-deps.ts';
import { testUraIds } from './testing/test-ura-ids.ts';

const finding: StageableReviewFinding = {
  path: 'src/a.ts',
  startLine: 4,
  endLine: 6,
  severity: 'risk',
  title: 'Unchecked input',
  body: 'The value reaches `exec` unchecked.',
};

const source: ReviewFindingSource = {
  sessionId: testUraIds.sessionId,
  headSha: testUraIds.headSha,
  messageId: testUraIds.messageId,
  finding: 2,
};

describe('stageReviewFinding', () => {
  it('stages the finding on its lines, naming its answer and index', () => {
    expect(stageReviewFinding(finding, source, fixedUraDeps())).toMatchObject({
      ok: true,
      value: {
        sessionId: source.sessionId,
        headSha: source.headSha,
        anchor: { kind: 'lines', path: 'src/a.ts', startLine: 4, endLine: 6 },
        severity: 'issue',
        origin: { kind: 'chat-answer', messageId: testUraIds.messageId, finding: 2 },
        title: 'Unchecked input',
        body: finding.body,
        status: { kind: 'staged' },
      },
    });
  });

  it('never blocks by default, and lets the reviewer choose', () => {
    const severity = (value: StageableReviewFinding['severity']): string | undefined => {
      const result = stageReviewFinding({ ...finding, severity: value }, source, fixedUraDeps());
      return result.ok ? result.value.severity : undefined;
    };
    expect([severity('risk'), severity('warning'), severity('info')]).toEqual([
      'issue',
      'issue',
      'nit',
    ]);
    const chosen = stageReviewFinding(finding, source, fixedUraDeps(), 'blocker');
    expect(chosen.ok && chosen.value.severity).toBe('blocker');
  });
});
