import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ModelFinding } from './finding-output-schema.ts';
import type { ChatQuestion } from './chat-question.ts';
import { reviewChange } from './review-change.ts';
import type { ReviewProgress } from './review-change.ts';
import type { ReviewModel, ReviewModelOutput, ReviewModelRequest } from './review-model.ts';
import { createChatQuestion } from './testing/create-chat-question.ts';
import { promptTextOf } from './testing/prompt-text-of.ts';
import { test } from './testing/test.ts';

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

function firstPass(seen: ReviewModelRequest<unknown>[] = []): ReviewModel<string> {
  return scripted(ok({ findings: findings() }), seen);
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
      request.onProgress?.({ kind: 'tool-start', id: 't1', tool: 'Read', description: 'read it' });
      await Promise.resolve();
      if (!answer.ok) {
        return answer;
      }
      const parsed = request.outputSchema.safeParse(answer.value);
      if (parsed.success) {
        return ok({
          value: parsed.data,
          model: 'fake',
          turns: 1,
          costUsd: 0,
          duration: Temporal.Duration.from({ milliseconds: 1 }),
          deniedToolUses: 0,
        });
      }
      return err('invalid-output');
    },
  };
}

describe('reviewChange', () => {
  test('finds, keeps what is on the diff, verifies and drops the refuted findings', async ({
    expect,
    signal,
  }) => {
    const seen: ReviewModelRequest<unknown>[] = [];
    const checked: ReviewModelRequest<unknown>[] = [];
    const progress: ReviewProgress[] = [];
    const result = await reviewChange(question(), {
      model: firstPass(seen),
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
        progress.push(event);
      },
      signal,
    });
    const { review, citations } = okValueFrom(result);
    expect(review).toStrictEqual({
      findings: [{ ...findings()[0], check: 'unconfirmed' }],
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
    expect(citations).toStrictEqual([
      { path: 'src/a.ts', startLine: 12, endLine: 12, side: 'head' },
    ]);
    expect(seen[0]?.system).toContain("beuve's preliminary reviewer");
    expect(promptTextOf(seen[0])).toContain('Review the whole change');
    expect(promptTextOf(seen[0])).not.toContain("## The reviewer's question");
    expect(promptTextOf(checked[0])).toContain('## Finding 2: src/b.ts:2-2');
    const read = { kind: 'tool-start', id: 't1', tool: 'Read', description: 'read it' } as const;
    expect(progress).toStrictEqual([
      { kind: 'reviewing', files: 2 },
      { kind: 'model', pass: 'review', progress: read },
      { kind: 'verifying', findings: 2 },
      { kind: 'model', pass: 'verify', progress: read },
    ]);
    expect(seen[0]?.messages[0]?.cache).toBe(true);
    expect(seen[0]?.effort).toBeUndefined();
    expect(checked[0]?.effort).toBe('low');
  });

  test('skips the pass without a verifier, and keeps findings unchecked when it fails', async ({
    expect,
    signal,
  }) => {
    const skipped = await reviewChange(question(), {
      model: firstPass(),
      signal,
    });
    expect(skipped.ok && skipped.value.review).toMatchObject({
      verification: 'skipped',
      findings: [{ check: 'unchecked' }, { check: 'unchecked' }],
    });
    const failed = await reviewChange(question(), {
      model: firstPass(),
      verifier: scripted(err('rate-limited')),
      signal,
    });
    expect(failed.ok && failed.value.review).toMatchObject({
      verification: 'failed',
      findings: [{ check: 'unchecked' }, { check: 'unchecked' }],
      dropped: { unconfirmed: 0 },
    });
  });

  test('shares one time budget: no verification once it is nearly spent', async ({
    expect,
    signal,
  }) => {
    const checked: ReviewModelRequest<unknown>[] = [];
    const result = await reviewChange(question(), {
      model: firstPass(),
      verifier: scripted(ok({ verdicts: [] }), checked),
      timeout: Temporal.Duration.from({ seconds: 4 }),
      signal,
    });
    expect(result.ok && result.value.review.verification).toBe('failed');
    expect(checked).toStrictEqual([]);
  });

  test('gives the verifier what the first pass left of the budget', async ({ expect, signal }) => {
    const checked: ReviewModelRequest<unknown>[] = [];
    await reviewChange(question(), {
      model: firstPass(),
      verifier: scripted(ok({ verdicts: [] }), checked),
      timeout: Temporal.Duration.from({ minutes: 10 }),
      signal,
    });
    const given = checked[0]?.timeout ?? new Temporal.Duration();
    expect(Temporal.Duration.compare(given, { minutes: 10 })).toBeLessThanOrEqual(0);
    expect(Temporal.Duration.compare(given, { minutes: 9, seconds: 55 })).toBeGreaterThan(0);
  });

  test('fails on a cancelled verification and on a failed first pass', async ({
    expect,
    signal,
  }) => {
    const controller = new AbortController();
    const cancelling: ReviewModel<string> = {
      run: async () => {
        controller.abort();
        await Promise.resolve();
        return err('cancelled');
      },
    };
    const stopped = await reviewChange(question(), {
      model: firstPass(),
      verifier: cancelling,
      signal: controller.signal,
    });
    expect(stopped).toStrictEqual({ ok: false, error: { kind: 'model', error: 'cancelled' } });
    const timeout = scripted(err('timeout'));
    const failed = await reviewChange(question(), { model: timeout, signal });
    expect(failed).toStrictEqual({ ok: false, error: { kind: 'model', error: 'timeout' } });
  });

  test('asks nothing when no changed text file is in scope', async ({ expect, signal }) => {
    const seen: ReviewModelRequest<unknown>[] = [];
    const result = await reviewChange(createChatQuestion({ files: [] }), {
      model: firstPass(seen),
      signal,
    });
    expect(result.ok && result.value.review).toMatchObject({ findings: [], fileCount: 0 });
    expect(seen).toStrictEqual([]);
  });
});

function question(): ChatQuestion {
  return createChatQuestion({
    task: { kind: 'review', pathScope: [], maxFindings: 12 },
  });
}

function findings(): ModelFinding[] {
  return [
    finding({ title: 'Empty input' }),
    finding({ path: 'src/b.ts', startLine: 2, endLine: 2, title: 'Constant result' }),
    finding({ startLine: 1, endLine: 2, title: 'Before the hunk' }),
  ];
}
