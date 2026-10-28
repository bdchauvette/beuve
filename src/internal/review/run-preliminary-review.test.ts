import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { CommitSha } from './agent-insight.ts';
import type { ModelInsight } from './insight-output-schema.ts';
import { reviewRunKey } from './review-run-key.ts';
import type { ModelOutput, ModelRequest, ReviewModel } from './review-model.ts';
import { runPreliminaryReview } from './run-preliminary-review.ts';
import { createReviewInput } from './testing/create-review-input.ts';

function clock(): Date {
  return new Date('2026-10-28T12:00:00.000Z');
}

function counter(): () => string {
  let next = 0;
  return (): string => {
    next += 1;
    return `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
  };
}

interface ModelError {
  readonly kind: 'timeout';
  readonly timeoutMs: number;
}

function fakeModel(
  answer: Result<{ insights: ModelInsight[] }, ModelError>,
  seen: ModelRequest<unknown>[] = [],
): ReviewModel<ModelError> {
  return {
    run: async <T>(request: ModelRequest<T>): Promise<Result<ModelOutput<T>, ModelError>> => {
      seen.push(request);
      await Promise.resolve();
      if (!answer.ok) {
        return answer;
      }
      const schema: z.ZodType<T> = request.outputSchema;
      return ok({
        value: schema.parse(answer.value),
        model: 'fake-model',
        turns: 3,
        costUsd: 0.02,
        durationMs: 1200,
        deniedToolUses: 0,
      });
    },
  };
}

const insight: ModelInsight = {
  path: 'src/a.ts',
  lineStart: 12,
  lineEnd: 13,
  severity: 'risk',
  category: 'type-mismatch',
  title: '`parts[0]` may be undefined',
  body: 'With `noUncheckedIndexedAccess`, `first.trim()` can throw.',
  confidence: 0.85,
};

describe('runPreliminaryReview', () => {
  it('asks the model in the worktree and returns validated, pending insights of a new run', async () => {
    const seen: ModelRequest<unknown>[] = [];
    const input = createReviewInput();
    const result = await runPreliminaryReview(input, {
      model: fakeModel(ok({ insights: [insight, { ...insight, path: 'README.md' }] }), seen),
      clock,
      ids: counter(),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ cwd: '/work/repo', timeoutMs: 600_000 });
    expect(seen[0]?.prompt).toContain('src/a.ts');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const runId = '00000000-0000-4000-8000-000000000001';
    expect(result.value.run).toEqual({
      id: runId,
      sessionId: input.sessionId,
      pathScope: [],
      scope: 'full',
      baseSha: input.scope.baseSha,
      headSha: input.scope.headSha,
      fromHeadSha: undefined,
      model: 'fake-model',
      insightCount: 1,
      droppedCount: 1,
      createdAt: '2026-10-28T12:00:00.000Z',
    });
    expect(result.value.insights).toEqual([
      {
        ...insight,
        id: '00000000-0000-4000-8000-000000000002',
        runId,
        sessionId: input.sessionId,
        headSha: input.scope.headSha,
        side: 'head',
        status: 'pending',
        model: 'fake-model',
        createdAt: '2026-10-28T12:00:00.000Z',
      },
    ]);
    expect(result.value.dropped.unknownFile).toBe(1);
    expect(result.value.usage).toEqual({
      turns: 3,
      costUsd: 0.02,
      durationMs: 1200,
      deniedToolUses: 0,
    });
  });

  it('passes model failures through', async () => {
    const result = await runPreliminaryReview(createReviewInput(), {
      model: fakeModel(err({ kind: 'timeout', timeoutMs: 5 })),
      clock,
      ids: counter(),
    });
    expect(result).toEqual({ ok: false, error: { kind: 'timeout', timeoutMs: 5 } });
  });

  it('records an empty run without calling the model when there is no text to review', async () => {
    const seen: ModelRequest<unknown>[] = [];
    const base = createReviewInput();
    const result = await runPreliminaryReview(
      { ...base, files: base.files.map((file) => ({ ...file, binary: true })) },
      { model: fakeModel(ok({ insights: [] }), seen), clock, ids: counter() },
    );
    expect(seen).toEqual([]);
    expect(result).toMatchObject({ ok: true, value: { insights: [], run: { model: 'none' } } });
  });

  it('records the normalized path scope the input was limited to', async () => {
    const result = await runPreliminaryReview(
      createReviewInput({ pathScope: ['src/b.ts/', 'src/a.ts'] }),
      { model: fakeModel(ok({ insights: [] })), clock, ids: counter() },
    );
    expect(result).toMatchObject({
      ok: true,
      value: { run: { pathScope: ['src/a.ts', 'src/b.ts'] } },
    });
  });

  it('records the reviewed head for interdiffs and keys runs by session, head and path scope', async () => {
    const base = createReviewInput();
    const fromHeadSha = 'd'.repeat(40) as CommitSha;
    const input = {
      ...base,
      scope: { ...base.scope, kind: 'interdiff' as const, outcome: 'exact' as const, fromHeadSha },
    };
    const result = await runPreliminaryReview(input, {
      model: fakeModel(ok({ insights: [] })),
      clock,
      ids: counter(),
    });
    expect(result).toMatchObject({ ok: true, value: { run: { scope: 'interdiff', fromHeadSha } } });
    expect(reviewRunKey(input)).toBe(reviewRunKey(base));
    expect(reviewRunKey(base)).toBe(`review:${base.sessionId}@${base.scope.headSha}#[]`);
    expect(reviewRunKey({ ...base, pathScope: ['src/a.ts'] })).not.toBe(reviewRunKey(base));
  });
});
