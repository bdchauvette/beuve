import { describe, expect, it } from 'vitest';

import type {
  AgentInsight,
  AgentInsightId,
  CommitSha,
  ReviewRun,
  ReviewRunId,
  SessionId,
} from './agent-insight.ts';
import { findAgentInsight } from './find-agent-insight.ts';
import { insertReviewRun } from './insert-review-run.ts';
import { setAgentInsightStatus } from './set-agent-insight-status.ts';
import { createReviewTestDatabase } from './testing/create-review-test-database.ts';

const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId;
const head = 'c'.repeat(40) as CommitSha;
const insightId = '33333333-3333-4333-8333-333333333333' as AgentInsightId;

const run: ReviewRun = {
  id: '22222222-2222-4222-8222-222222222222' as ReviewRunId,
  sessionId,
  scope: 'full',
  pathScope: [],
  baseSha: 'b'.repeat(40) as CommitSha,
  headSha: head,
  fromHeadSha: undefined,
  model: 'claude-sonnet-5-5',
  insightCount: 1,
  droppedCount: 0,
  createdAt: '2026-10-28T12:00:00.000Z',
};

const insight: AgentInsight = {
  id: insightId,
  runId: run.id,
  sessionId,
  headSha: head,
  path: 'src/a.ts',
  side: 'head',
  lineStart: 3,
  lineEnd: 4,
  severity: 'warning',
  category: 'edge-case',
  title: 'Empty input',
  body: 'Check `[]`.',
  confidence: 0.6,
  status: 'pending',
  model: run.model,
  createdAt: run.createdAt,
};

describe('findAgentInsight', () => {
  it('finds an insight by id with its current status and model', () => {
    const db = createReviewTestDatabase([sessionId]);
    insertReviewRun(db, run, [insight]);
    expect(findAgentInsight(db, insightId)).toEqual({ ok: true, value: insight });
    setAgentInsightStatus(db, insightId, 'promoted');
    expect(findAgentInsight(db, insightId)).toMatchObject({
      ok: true,
      value: { status: 'promoted' },
    });
  });

  it('reports an unknown id as insight-not-found', () => {
    const db = createReviewTestDatabase([sessionId]);
    const missing = '44444444-4444-4444-8444-444444444444' as AgentInsightId;
    expect(findAgentInsight(db, missing)).toEqual({
      ok: false,
      error: { kind: 'insight-not-found', id: missing },
    });
  });
});
