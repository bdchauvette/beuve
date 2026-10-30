import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ModelFinding } from './finding-output-schema.ts';
import { reviewChange } from './review-change.ts';
import type { ReviewProgress } from './review-change.ts';
import type { ReviewModel, ReviewModelOutput, ReviewModelRequest } from './review-model.ts';
import { createChatQuestion } from './testing/create-chat-question.ts';

function finding(overrides: Partial<ModelFinding>): ModelFinding {
  return {
    path: 'src/a.ts',
    startLine: 12,
    endLine: 12,
    severity: 'warning',
    category: 'edge-case',
    title: 'Empty input',
    body: 'An empty string yields `undefined`.',
    confidence: 0.8,
    ...overrides,
  };
}

/** Answers every run with `answer`, as the schema it is given parses it. */
function scripted(
  answer: Result<unknown, string>,
  seen: ReviewModelRequest<unknown>[] = [],
): ReviewModel<string> {
  return {
    run: async <T>(
      request: ReviewModelRequest<T>,
    ): Promise<Result<ReviewModelOutput<T>, string>> => {
      seen.push(request);
      await Promise.resolve();
      if (!answer.ok) {
        return answer;
      }
      const parsed = request.outputSchema.safeParse(answer.value);
      return parsed.success
        ? ok({
            value: parsed.data,
            model: 'fake',
            turns: 1,
            costUsd: 0,
            durationMs: 1,
            deniedToolUses: 0,
          })
        : err('invalid-output');
    },
  };
}

const question = createChatQuestion({
  task: { kind: 'review', pathScope: [], maxFindings: 12 },
});

const findings = [
  finding({ title: 'Empty input' }),
  finding({ path: 'src/b.ts', startLine: 2, endLine: 2, title: 'Constant result' }),
  finding({ startLine: 1, endLine: 2, title: 'Before the hunk' }),
];

describe('reviewChange', () => {
  it('finds, keeps what is on the diff, verifies and drops the refuted findings', async () => {
    const seen: ReviewModelRequest<unknown>[] = [];
    const checked: ReviewModelRequest<unknown>[] = [];
    const progress: ReviewProgress['kind'][] = [];
    const result = await reviewChange(question, {
      model: scripted(ok({ findings }), seen),
      verifier: scripted(
        ok({
          verdicts: [
            { finding: 1, verdict: 'unsure', reason: 'Cannot tell.' },
            { finding: 2, verdict: 'refuted', reason: 'b returns a constant on purpose.' },
          ],
        }),
        checked,
      ),
      onProgress: (event) => {
        progress.push(event.kind);
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const { review, citations, content } = result.value;
    expect(review).toEqual({
      findings: [{ ...findings[0], check: 'unconfirmed' }],
      dropped: {
        unknownFile: 0,
        outsideDiff: 1,
        lowConfidence: 0,
        duplicate: 0,
        overLimit: 0,
        unconfirmed: 1,
      },
      pathScope: [],
      fileCount: 2,
      verification: 'verified',
    });
    expect(citations).toEqual([{ path: 'src/a.ts', startLine: 12, endLine: 12, side: 'head' }]);
    expect(content).toContain('2 files: 1 finding, 1 dropped as unconfirmed.');
    expect(content).toContain('[[src/a.ts:12-12]]');
    expect(seen[0]?.system).toContain("beuve's preliminary reviewer");
    expect(seen[0]?.prompt).toContain('Review the whole change');
    expect(seen[0]?.prompt).not.toContain("## The reviewer's question");
    expect(checked[0]?.prompt).toContain('## Finding 2: src/b.ts:2-2');
    expect(progress).toEqual(['reviewing', 'verifying']);
  });

  it('skips the pass without a verifier, and keeps findings unchecked when it fails', async () => {
    const skipped = await reviewChange(question, { model: scripted(ok({ findings })) });
    expect(skipped.ok && skipped.value.review).toMatchObject({
      verification: 'skipped',
      findings: [{ check: 'unchecked' }, { check: 'unchecked' }],
    });
    const failed = await reviewChange(question, {
      model: scripted(ok({ findings })),
      verifier: scripted(err('rate-limited')),
    });
    expect(failed.ok && failed.value.review).toMatchObject({
      verification: 'failed',
      findings: [{ check: 'unchecked' }, { check: 'unchecked' }],
      dropped: { unconfirmed: 0 },
    });
  });

  it('shares one time budget: no verification once it is nearly spent', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'Temporal'], now: 0 });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const slow: ReviewModel<string> = {
      run: async (request) => {
        vi.setSystemTime(Temporal.Now.instant().add({ seconds: 598 }).toString());
        return scripted(ok({ findings })).run(request);
      },
    };
    const checked: ReviewModelRequest<unknown>[] = [];
    const result = await reviewChange(question, {
      model: slow,
      verifier: scripted(ok({ verdicts: [] }), checked),
    });
    expect(result.ok && result.value.review.verification).toBe('failed');
    expect(checked).toEqual([]);

    vi.setSystemTime(0);
    const quick: ReviewModel<string> = {
      run: async (request) => {
        vi.setSystemTime(Temporal.Now.instant().add({ seconds: 60 }).toString());
        return scripted(ok({ findings })).run(request);
      },
    };
    await reviewChange(question, {
      model: quick,
      verifier: scripted(ok({ verdicts: [] }), checked),
    });
    expect(checked[0]?.timeoutMs).toBe(540_000);
  });

  it('fails on a cancelled verification and on a failed first pass', async () => {
    const controller = new AbortController();
    const cancelling: ReviewModel<string> = {
      run: async () => {
        controller.abort();
        await Promise.resolve();
        return err('cancelled');
      },
    };
    const stopped = await reviewChange(question, {
      model: scripted(ok({ findings })),
      verifier: cancelling,
      signal: controller.signal,
    });
    expect(stopped).toEqual({ ok: false, error: { kind: 'model', error: 'cancelled' } });
    const timeout = scripted(err('timeout'));
    const failed = await reviewChange(question, { model: timeout });
    expect(failed).toEqual({ ok: false, error: { kind: 'model', error: 'timeout' } });
  });

  it('asks nothing when no changed text file is in scope', async () => {
    const seen: ReviewModelRequest<unknown>[] = [];
    const result = await reviewChange(createChatQuestion({ files: [] }), {
      model: scripted(ok({ findings }), seen),
    });
    expect(result.ok && result.value.review).toMatchObject({ findings: [], fileCount: 0 });
    expect(seen).toEqual([]);
  });
});
