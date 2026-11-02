import { describe } from 'vitest';

import { createReviewEditsHarness } from './testing/create-review-edits-harness.ts';
import { test } from './testing/test.ts';

interface Reply {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

interface ReviewRef {
  readonly sessionId: string;
  readonly headSha: string;
}

function reviewOf(): ReviewRef {
  return { sessionId: 's1', headSha: 'a'.repeat(40) };
}

function ok(value: unknown): Reply {
  return { ok: true, value };
}

function failed(message: string): Reply {
  return { ok: false, error: { code: 'invalid-request', message } };
}

describe('ReviewEditsController', () => {
  test('reads the branch state of the open session', async ({ expect }) => {
    const { reviewEdits, invoked } = createReviewEditsHarness({
      review: reviewOf(),
      replies: { 'review-edits:get': ok({ branch: 'review/x' }) },
    });
    await reviewEdits.load('s1');
    expect(invoked).toStrictEqual([['review-edits:get', { sessionId: 's1' }]]);
    expect(reviewEdits.view).toStrictEqual({ branch: 'review/x' });
  });

  test('ignores an answer for a session that is no longer open', async ({ expect }) => {
    const { reviewEdits } = createReviewEditsHarness({
      review: reviewOf(),
      replies: { 'review-edits:get': ok({ branch: 'review/x' }) },
    });
    await reviewEdits.load('s2');
    expect(reviewEdits.view).toBeUndefined();
  });

  test('forgets the branch and the flow on reset', async ({ expect }) => {
    const { reviewEdits } = createReviewEditsHarness({
      review: reviewOf(),
      replies: { 'review-edits:get': ok({ branch: 'review/x' }) },
    });
    await reviewEdits.load('s1');
    reviewEdits.reset();
    expect(reviewEdits.view).toBeUndefined();
    expect(reviewEdits.flow).toStrictEqual({ kind: 'idle' });
  });

  test('previews staging and keeps the plan to confirm', async ({ expect }) => {
    const { reviewEdits } = createReviewEditsHarness({
      review: reviewOf(),
      replies: { 'review-edits:preview-suggestions': ok({ digest: 'd1' }) },
    });
    await reviewEdits.previewStage();
    expect(reviewEdits.flow).toStrictEqual({ kind: 'preview', plan: { digest: 'd1' } });
  });

  test('shows a failed preview', async ({ expect }) => {
    const { reviewEdits } = createReviewEditsHarness({
      review: reviewOf(),
      replies: { 'review-edits:preview-suggestions': failed('no edits') },
    });
    await reviewEdits.previewStage();
    expect(reviewEdits.flow).toStrictEqual({ kind: 'failed', text: 'no edits' });
  });

  test('stages exactly the previewed plan and refreshes the dock', async ({ expect }) => {
    const { reviewEdits, invoked, refreshed } = createReviewEditsHarness({
      review: reviewOf(),
      replies: {
        'review-edits:preview-suggestions': ok({ digest: 'd1' }),
        'review-edits:stage-suggestions': ok({
          created: 1,
          attached: 2,
          updated: 3,
          unchanged: 4,
        }),
      },
    });
    await reviewEdits.previewStage();
    await reviewEdits.stage();
    expect(invoked.at(-1)).toStrictEqual([
      'review-edits:stage-suggestions',
      { sessionId: 's1', digest: 'd1' },
    ]);
    expect(reviewEdits.flow).toStrictEqual({
      kind: 'done',
      text: 'Staged: 1 new, 2 attached to notes, 3 updated, 4 already there.',
    });
    await expect.poll(() => refreshed).toStrictEqual(['s1']);
  });

  test('stages nothing without a preview', async ({ expect }) => {
    const { reviewEdits, invoked } = createReviewEditsHarness({ review: reviewOf() });
    await reviewEdits.stage();
    expect(invoked).toStrictEqual([]);
  });

  test('previews only one action at a time', async ({ expect }) => {
    const { reviewEdits, invoked } = createReviewEditsHarness({
      review: reviewOf(),
      replies: { 'review-edits:preview-suggestions': ok({ digest: 'd1' }) },
    });
    const first = reviewEdits.previewStage();
    await reviewEdits.previewDiscard();
    await first;
    expect(invoked.map(([channel]) => channel)).toStrictEqual(['review-edits:preview-suggestions']);
  });

  test('discards exactly what the confirmation showed and reads the branch again', async ({
    expect,
  }) => {
    const { reviewEdits, invoked } = createReviewEditsHarness({
      review: reviewOf(),
      replies: {
        'review-edits:preview-discard': ok({ digest: 'd2' }),
        'review-edits:discard': ok({ branch: 'review/x' }),
      },
    });
    await reviewEdits.previewDiscard();
    expect(reviewEdits.flow.kind).toBe('discard');
    await reviewEdits.discard();
    expect(invoked.map(([channel]) => channel)).toStrictEqual([
      'review-edits:preview-discard',
      'review-edits:discard',
      'review-edits:get',
    ]);
    expect(reviewEdits.flow).toStrictEqual({ kind: 'done', text: 'Discarded review/x.' });
  });

  test('keeps a failed discard visible', async ({ expect }) => {
    const { reviewEdits } = createReviewEditsHarness({
      review: reviewOf(),
      replies: {
        'review-edits:preview-discard': ok({ digest: 'd2' }),
        'review-edits:discard': failed('changed since'),
      },
    });
    await reviewEdits.previewDiscard();
    await reviewEdits.discard();
    expect(reviewEdits.flow).toStrictEqual({ kind: 'failed', text: 'changed since' });
  });

  test('drops a finished status line but keeps a pending confirmation', async ({ expect }) => {
    const { reviewEdits } = createReviewEditsHarness({
      review: reviewOf(),
      replies: { 'review-edits:preview-suggestions': ok({ digest: 'd1' }) },
    });
    await reviewEdits.previewStage();
    reviewEdits.clearStatus();
    expect(reviewEdits.flow.kind).toBe('preview');
    reviewEdits.cancel();
    expect(reviewEdits.flow).toStrictEqual({ kind: 'idle' });
  });

  test('opens the branch at a place and says where', async ({ expect }) => {
    const { reviewEdits, invoked, notices } = createReviewEditsHarness({
      review: reviewOf(),
      replies: {
        'review-edits:open': ok({ branch: 'review/x', created: true, editorName: 'Zed' }),
      },
    });
    await reviewEdits.open({ path: 'src/a.ts', line: 3 });
    expect(invoked[0]).toStrictEqual([
      'review-edits:open',
      { sessionId: 's1', path: 'src/a.ts', line: 3 },
    ]);
    expect(notices).toStrictEqual([
      {
        tone: 'info',
        text: 'Opened review edits on review/x, a new local branch beuve never pushes, in Zed.',
      },
    ]);
  });

  test('says why the branch did not open', async ({ expect }) => {
    const { reviewEdits, notices } = createReviewEditsHarness({
      review: reviewOf(),
      replies: { 'review-edits:open': failed('no editor') },
    });
    await reviewEdits.open(undefined);
    expect(notices).toStrictEqual([{ tone: 'error', text: 'no editor' }]);
  });

  test('does nothing without a review', async ({ expect }) => {
    const { reviewEdits, invoked } = createReviewEditsHarness();
    await reviewEdits.open(undefined);
    await reviewEdits.previewStage();
    await reviewEdits.previewDiscard();
    expect(invoked).toStrictEqual([]);
  });
});
