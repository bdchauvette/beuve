import { describe } from 'vitest';

import { stageImpactFinding } from './stage-impact-finding.ts';
import type { FindingContext, StageableFinding } from './stage-impact-finding.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';

describe('stageImpactFinding', () => {
  test('stages the finding on its function with its metrics', ({ expect, deps }) => {
    expect(stageImpactFinding(finding(), context(), deps)).toMatchObject({
      ok: true,
      value: {
        anchor: { kind: 'lines', path: 'src/parse.ts', startLine: 20, endLine: 80 },
        severity: 'issue',
        origin: {
          kind: 'impact-finding',
          metric: 'cognitive-complexity',
          functionName: 'Parser.parseAll',
          value: 22,
          threshold: 15,
          percentile: 97.4,
        },
        title: 'Cognitive complexity 22 exceeds 15 in Parser.parseAll',
        body:
          'ImpactGate measured a cognitive complexity of 22 for `Parser.parseAll`, over the limit of 15. It was 9 at the base (introduced).\n\n' +
          'It ranks at the 97th percentile of the functions in this change.',
      },
    });
  });

  test('is a nit when the change did not make it worse', ({ expect, deps }) => {
    for (const trend of ['unchanged', 'improved'] as const) {
      const result = stageImpactFinding({ ...finding(), trend }, context(), deps);
      expect(result.ok && result.value.severity).toBe('nit');
    }
    const worsened = stageImpactFinding({ ...finding(), trend: 'worsened' }, context(), deps);
    expect(worsened.ok && worsened.value.severity).toBe('issue');
  });

  test('describes new functions and keeps long titles within the limit', ({ expect, deps }) => {
    const result = stageImpactFinding(
      { ...finding(), baseValue: undefined, functionName: 'f'.repeat(300), percentile: 1 },
      context(),
      deps,
    );
    expect(result.ok ? result.value.title : '').toHaveLength(200);
    expect(result.ok && result.value.body).toContain('The function is new.');
    expect(result.ok && result.value.body).toContain('1st percentile');
  });
});

function finding(): StageableFinding {
  return {
    kind: 'cognitive-complexity',
    path: 'src/parse.ts',
    functionName: 'Parser.parseAll',
    startLine: 20,
    endLine: 80,
    value: 22,
    limit: 15,
    baseValue: 9,
    trend: 'introduced',
    percentile: 97.4,
  };
}

function context(): FindingContext {
  return { sessionId: testUraIds.sessionId, headSha: testUraIds.headSha };
}
