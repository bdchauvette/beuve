import { describe, expect, it } from 'vitest';

import type { AgentInsight, AgentInsightId } from './agent-insight.ts';
import { carryOverStatuses } from './carry-over-statuses.ts';
import { dedupeInsights } from './dedupe-insights.ts';

function insight(id: string, overrides: Partial<AgentInsight> = {}): AgentInsight {
  return {
    id: id as AgentInsightId,
    runId: 'r' as never,
    sessionId: 's' as never,
    headSha: 'c'.repeat(40) as never,
    path: 'src/a.ts',
    side: 'head',
    lineStart: 3,
    lineEnd: 4,
    severity: 'warning',
    category: 'edge-case',
    title: 'Empty input',
    body: 'b',
    confidence: 0.6,
    status: 'pending',
    model: 'm',
    createdAt: '2026-10-28T12:00:00.000Z',
    ...overrides,
  };
}

describe('carryOverStatuses', () => {
  it('copies the status of a matching decided insight', () => {
    const [carried] = carryOverStatuses(
      [insight('new')],
      [insight('old', { status: 'dismissed' })],
    );
    expect(carried?.status).toBe('dismissed');
    expect(carried?.id).toBe('new');
  });

  it('uses the newest decided match and ignores pending ones', () => {
    const previous = [
      insight('a'),
      insight('b', { status: 'promoted' }),
      insight('c', { status: 'dismissed' }),
    ];
    expect(carryOverStatuses([insight('new')], previous)[0]?.status).toBe('promoted');
  });

  it('leaves unmatched insights pending and keeps statuses already set', () => {
    const previous = [insight('old', { status: 'dismissed' })];
    const unmatched = insight('x', { path: 'src/other.ts' });
    const promoted = insight('y', { status: 'promoted' });
    expect(carryOverStatuses([unmatched, promoted], previous)).toEqual([unmatched, promoted]);
  });
});

describe('dedupeInsights', () => {
  it('keeps the first of insights with the same range and title', () => {
    const newest = insight('new', { title: 'EMPTY input' });
    const older = insight('old');
    const shifted = insight('shifted', { lineStart: 4, lineEnd: 5 });
    expect(dedupeInsights([newest, older, shifted])).toEqual([newest, shifted]);
  });
});
