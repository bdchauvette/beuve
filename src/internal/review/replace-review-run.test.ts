import { describe, expect, it } from 'vitest';

import type {
  AgentInsight,
  AgentInsightId,
  CommitSha,
  ReviewRun,
  ReviewRunId,
  SessionId,
} from './agent-insight.ts';
import { findReviewRun } from './find-review-run.ts';
import { insertReviewRun } from './insert-review-run.ts';
import { listAgentInsights } from './list-agent-insights.ts';
import { replaceReviewRun } from './replace-review-run.ts';
import { setAgentInsightStatus } from './set-agent-insight-status.ts';
import { createReviewTestDatabase } from './testing/create-review-test-database.ts';

const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId;
const head = 'c'.repeat(40) as CommitSha;

function run(id: string): ReviewRun {
  return {
    id: id as ReviewRunId,
    sessionId,
    scope: 'full',
    baseSha: 'b'.repeat(40) as CommitSha,
    headSha: head,
    fromHeadSha: undefined,
    model: 'fake-model-1',
    insightCount: 1,
    droppedCount: 0,
    createdAt: '2026-10-28T12:00:00.000Z',
  };
}

function insight(id: string, owner: ReviewRun): AgentInsight {
  return {
    id: id as AgentInsightId,
    runId: owner.id,
    sessionId,
    headSha: head,
    path: 'src/a.ts',
    side: 'head',
    lineStart: 3,
    lineEnd: 3,
    severity: 'warning',
    category: 'edge-case',
    title: 'Empty input',
    body: 'An empty string reaches `split`.',
    confidence: 0.6,
    status: 'pending',
    model: owner.model,
    createdAt: owner.createdAt,
  };
}

const old = run('22222222-2222-4222-8222-222222222222');
const next = run('33333333-3333-4333-8333-333333333333');
const oldInsight = insight('44444444-4444-4444-8444-444444444444', old);
const nextInsight = insight('55555555-5555-4555-8555-555555555555', next);

describe('replaceReviewRun', () => {
  it('replaces the stored run for the head and drops its insights and statuses', () => {
    const db = createReviewTestDatabase([sessionId]);
    insertReviewRun(db, old, [oldInsight]);
    setAgentInsightStatus(db, oldInsight.id, 'dismissed');
    expect(replaceReviewRun(db, next, [nextInsight])).toEqual({ ok: true, value: true });
    expect(findReviewRun(db, sessionId, head)).toEqual({ ok: true, value: next });
    expect(listAgentInsights(db, sessionId, head)).toEqual({ ok: true, value: [nextInsight] });
  });

  it('inserts when there is nothing to replace', () => {
    const db = createReviewTestDatabase([sessionId]);
    expect(replaceReviewRun(db, next, [])).toEqual({ ok: true, value: false });
  });

  it('keeps the old run when the new one cannot be stored', () => {
    const db = createReviewTestDatabase([sessionId]);
    insertReviewRun(db, old, [oldInsight]);
    const orphan = { ...next, sessionId: next.id as string as SessionId };
    expect(replaceReviewRun(db, orphan, [])).toMatchObject({
      ok: false,
      error: { kind: 'session-not-found' },
    });
    expect(() => replaceReviewRun(db, next, [{ ...nextInsight, confidence: 3 }])).toThrow();
    expect(listAgentInsights(db, sessionId, head)).toEqual({ ok: true, value: [oldInsight] });
  });
});
