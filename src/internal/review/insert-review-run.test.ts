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
import { setAgentInsightStatus } from './set-agent-insight-status.ts';
import { createReviewTestDatabase } from './testing/create-review-test-database.ts';

const checkFailed = /CHECK/u;
const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId;
const head = 'c'.repeat(40) as CommitSha;

const run: ReviewRun = {
  id: '22222222-2222-4222-8222-222222222222' as ReviewRunId,
  sessionId,
  scope: 'interdiff',
  baseSha: 'b'.repeat(40) as CommitSha,
  headSha: head,
  fromHeadSha: 'd'.repeat(40) as CommitSha,
  model: 'claude-sonnet-5-5',
  insightCount: 2,
  droppedCount: 1,
  createdAt: '2026-10-28T12:00:00.000Z',
};

function insight(id: string, path: string, lineStart: number): AgentInsight {
  return {
    id: id as AgentInsightId,
    runId: run.id,
    sessionId,
    headSha: head,
    path,
    side: 'head',
    lineStart,
    lineEnd: lineStart + 1,
    severity: 'risk',
    category: 'security',
    title: 'Path traversal',
    body: 'A `..` segment escapes the root.',
    confidence: 0.7,
    status: 'pending',
    model: run.model,
    createdAt: run.createdAt,
  };
}

const second = insight('33333333-3333-4333-8333-333333333333', 'src/z.ts', 4);
const first = insight('44444444-4444-4444-8444-444444444444', 'src/a.ts', 9);

describe('insertReviewRun', () => {
  it('round-trips a run and its insights, listed by path and line', () => {
    const db = createReviewTestDatabase([sessionId]);
    expect(insertReviewRun(db, run, [second, first])).toEqual({ ok: true, value: undefined });
    expect(findReviewRun(db, sessionId, head)).toEqual({ ok: true, value: run });
    expect(listAgentInsights(db, sessionId, head)).toEqual({ ok: true, value: [first, second] });
    expect(listAgentInsights(db, sessionId, 'e'.repeat(40) as CommitSha)).toEqual({
      ok: true,
      value: [],
    });
  });

  it('round-trips a full-review run without a previous head', () => {
    const db = createReviewTestDatabase([sessionId]);
    const full: ReviewRun = { ...run, scope: 'full', fromHeadSha: undefined, insightCount: 0 };
    insertReviewRun(db, full, []);
    expect(findReviewRun(db, sessionId, head)).toEqual({ ok: true, value: full });
  });

  it('allows one run per session and head, atomically', () => {
    const db = createReviewTestDatabase([sessionId]);
    insertReviewRun(db, run, [first]);
    const again = { ...run, id: '55555555-5555-4555-8555-555555555555' as ReviewRunId };
    expect(insertReviewRun(db, again, [])).toEqual({
      ok: false,
      error: { kind: 'duplicate-run', sessionId, headSha: head },
    });
    expect(listAgentInsights(db, sessionId, head)).toEqual({ ok: true, value: [first] });
  });

  it('rejects unknown sessions and rolls back the run when an insight is invalid', () => {
    const db = createReviewTestDatabase([sessionId]);
    expect(insertReviewRun(db, { ...run, sessionId: run.id as string as SessionId }, [])).toEqual({
      ok: false,
      error: { kind: 'session-not-found', sessionId: run.id },
    });
    expect(() => insertReviewRun(db, run, [{ ...first, confidence: 2 }])).toThrow(checkFailed);
    expect(findReviewRun(db, sessionId, head)).toEqual({ ok: true, value: undefined });
  });

  it('cascades when the session is deleted', () => {
    const db = createReviewTestDatabase([sessionId]);
    insertReviewRun(db, run, [first]);
    db.prepare('DELETE FROM sessions WHERE id = ?;').run(sessionId);
    expect(db.prepare('SELECT count(*) AS n FROM agent_insights;').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM review_runs;').get()).toEqual({ n: 0 });
  });
});

describe('setAgentInsightStatus', () => {
  it('promotes and dismisses insights, and reports unknown ids', () => {
    const db = createReviewTestDatabase([sessionId]);
    insertReviewRun(db, run, [first, second]);
    expect(setAgentInsightStatus(db, first.id, 'promoted')).toEqual({ ok: true, value: undefined });
    expect(setAgentInsightStatus(db, second.id, 'dismissed')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(listAgentInsights(db, sessionId, head)).toEqual({
      ok: true,
      value: [
        { ...first, status: 'promoted' },
        { ...second, status: 'dismissed' },
      ],
    });
    const missing = '66666666-6666-4666-8666-666666666666' as AgentInsightId;
    expect(setAgentInsightStatus(db, missing, 'promoted')).toEqual({
      ok: false,
      error: { kind: 'insight-not-found', id: missing },
    });
  });
});
