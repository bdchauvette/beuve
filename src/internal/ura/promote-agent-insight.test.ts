import { describe, expect, it } from 'vitest';

import { promoteAgentInsight } from './promote-agent-insight.ts';
import type { PromotableInsight } from './promote-agent-insight.ts';
import { fixedUraDeps } from './testing/fixed-ura-deps.ts';
import { testUraIds } from './testing/test-ura-ids.ts';

const insight: PromotableInsight = {
  id: testUraIds.insightId,
  sessionId: testUraIds.sessionId,
  headSha: testUraIds.headSha,
  path: 'src/a.ts',
  lineStart: 4,
  lineEnd: 6,
  severity: 'risk',
  title: 'Unchecked input',
  body: 'The value reaches `exec` unchecked.',
};

describe('promoteAgentInsight', () => {
  it('stages the insight on its lines, keeping its id', () => {
    const result = promoteAgentInsight(insight, fixedUraDeps());
    expect(result).toMatchObject({
      ok: true,
      value: {
        sessionId: insight.sessionId,
        headSha: insight.headSha,
        anchor: { kind: 'lines', path: 'src/a.ts', startLine: 4, endLine: 6 },
        severity: 'issue',
        origin: { kind: 'agent-insight', insightId: insight.id },
        title: 'Unchecked input',
        body: insight.body,
        status: { kind: 'staged' },
      },
    });
  });

  it('never blocks by default, and lets the reviewer choose', () => {
    const severity = (value: PromotableInsight['severity']): string | undefined => {
      const result = promoteAgentInsight({ ...insight, severity: value }, fixedUraDeps());
      return result.ok ? result.value.severity : undefined;
    };
    expect([severity('risk'), severity('warning'), severity('info')]).toEqual([
      'issue',
      'issue',
      'nit',
    ]);
    const chosen = promoteAgentInsight(insight, fixedUraDeps(), 'blocker');
    expect(chosen.ok && chosen.value.severity).toBe('blocker');
  });
});
