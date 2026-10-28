import type { DatabaseSync } from 'node:sqlite';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';
import { withTransaction } from '#pkg/sqlite/with-transaction.ts';

import type { AgentInsight, ReviewRun, ReviewStoreError } from './agent-insight.ts';
import { carryOverStoredStatuses } from './carry-over-stored-statuses.ts';
import { serializePathScope } from './serialize-path-scope.ts';
import { sqliteErrorCode } from './sqlite-error-code.ts';

const foreignKeyViolation = 787;
const uniqueViolation = 2067;

/**
 * Persists a finished run and its insights in one transaction, so a (session, head, path scope)
 * either has a complete run or none. A second run for the same key is `duplicate-run`. Insights
 * that match one the reviewer already promoted or dismissed at this head (any run) arrive with
 * that status (ADR 0024).
 */
export function insertReviewRun(
  db: DatabaseSync,
  run: ReviewRun,
  insights: readonly AgentInsight[],
): Result<void, Extract<ReviewStoreError, { kind: 'session-not-found' | 'duplicate-run' }>> {
  try {
    withTransaction(db, () => {
      const stored = carryOverStoredStatuses(db, run, insights);
      db.prepare(
        `INSERT INTO review_runs (id, session_id, scope, path_scope, base_sha, head_sha, from_head_sha, model,
                                  insight_count, dropped_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?);`,
      ).run(
        run.id,
        run.sessionId,
        run.scope,
        serializePathScope(run.pathScope),
        run.baseSha,
        run.headSha,
        run.fromHeadSha ?? '',
        run.model,
        run.insightCount,
        run.droppedCount,
        run.createdAt,
      );
      const insert = db.prepare(
        `INSERT INTO agent_insights (id, run_id, session_id, head_sha, path, line_start, line_end,
                                     severity, category, title, body, confidence, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      );
      for (const insight of stored) {
        insert.run(
          insight.id,
          insight.runId,
          insight.sessionId,
          insight.headSha,
          insight.path,
          insight.lineStart,
          insight.lineEnd,
          insight.severity,
          insight.category,
          insight.title,
          insight.body,
          insight.confidence,
          insight.status,
          insight.createdAt,
        );
      }
    });
  } catch (error: unknown) {
    switch (sqliteErrorCode(error)) {
      case foreignKeyViolation: {
        return err({ kind: 'session-not-found', sessionId: run.sessionId });
      }
      case uniqueViolation: {
        return err({
          kind: 'duplicate-run',
          sessionId: run.sessionId,
          headSha: run.headSha,
          pathScope: run.pathScope,
        });
      }
      default: {
        throw error;
      }
    }
  }
  return ok(undefined);
}
