import { describe } from 'vitest';

import { createReviewDataHarness } from './testing/create-review-data-harness.ts';
import { createReviewView } from './testing/create-review-view.ts';
import { test } from './testing/test.ts';

interface Reply {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

interface FailureOptions {
  readonly code: string;
  readonly message: string;
}

function ok(value: unknown): Reply {
  return { ok: true, value };
}

function failed(error: FailureOptions): Reply {
  return { ok: false, error };
}

function channelsOf(invoked: readonly (readonly [string, unknown])[]): string[] {
  return invoked.map(([channel]) => channel).toSorted((x, y) => x.localeCompare(y));
}

describe('ReviewDataController', () => {
  test('shows the marks and progress of an arriving review at once', ({ expect }) => {
    const review = createReviewView({ files: ['a.ts', 'b.ts'], reviewed: ['b.ts'] });
    const { data } = createReviewDataHarness({ review });
    data.open(review);
    expect([...data.marks]).toStrictEqual([
      ['a.ts', 'no'],
      ['b.ts', 'yes'],
    ]);
    expect(data.progress).toStrictEqual({ reviewed: 1, total: 2 });
  });

  test('starts the tree, order and attribute loads', async ({ expect }) => {
    const review = createReviewView();
    const { data, invoked } = createReviewDataHarness({ review });
    data.open(review);
    await expect
      .poll(() => channelsOf(invoked))
      .toStrictEqual(['session:get-file-attributes', 'session:get-order', 'session:get-tree']);
  });

  test('drops answers once another review is open', async ({ expect }) => {
    const review = createReviewView();
    const { data, invoked, showReview } = createReviewDataHarness({
      review,
      replies: {
        'session:get-tree': ok({ sessionId: 's1', headSha: review.headSha, paths: ['a.ts'] }),
        'session:get-order': ok({ mode: 'path', files: [] }),
        'session:get-file-attributes': ok({ headSha: review.headSha }),
      },
    });
    data.open(review);
    showReview(createReviewView({ sessionId: 's2' }));
    await expect.poll(() => invoked.length).toBe(3);
    await Promise.resolve();
    expect(data.tree).toBeUndefined();
    expect(data.order).toBeUndefined();
    expect(data.fileAttributes).toBeUndefined();
  });

  test('keeps what loaded for the open review and forgets it on reset', async ({ expect }) => {
    const review = createReviewView();
    const { data } = createReviewDataHarness({
      review,
      replies: {
        'session:get-tree': ok({ sessionId: 's1', headSha: review.headSha, paths: ['a.ts'] }),
        'session:get-order': ok({ mode: 'path', files: [] }),
        'session:get-file-attributes': ok({ headSha: review.headSha }),
      },
    });
    data.open(review);
    await expect.poll(() => data.tree?.paths).toStrictEqual(['a.ts']);
    await expect.poll(() => data.order?.mode).toBe('path');
    await expect.poll(() => data.fileAttributes?.headSha).toBe(review.headSha);
    data.reset();
    expect(data.tree).toBeUndefined();
    expect(data.order).toBeUndefined();
    expect(data.fileAttributes).toBeUndefined();
    expect(data.marks.size).toBe(1);
  });

  test('reads the tree once per head', async ({ expect }) => {
    const review = createReviewView();
    const { data, invoked } = createReviewDataHarness({
      review,
      replies: {
        'session:get-tree': ok({ sessionId: 's1', headSha: review.headSha, paths: ['a.ts'] }),
      },
    });
    data.open(review);
    await expect.poll(() => data.tree).toBeDefined();
    data.open(review);
    await expect
      .poll(() => {
        return invoked.filter(([channel]) => channel === 'session:get-order').length;
      })
      .toBe(2);
    expect(invoked.filter(([channel]) => channel === 'session:get-tree')).toHaveLength(1);
  });

  test('says why the file order is missing', async ({ expect }) => {
    const review = createReviewView();
    const { data, notices } = createReviewDataHarness({
      review,
      replies: { 'session:get-order': failed({ code: 'invalid-request', message: 'no git' }) },
    });
    await data.reloadOrder(review);
    expect(notices).toStrictEqual([{ tone: 'error', text: 'File order: no git' }]);
    expect(data.order).toBeUndefined();
  });

  test('stays quiet when the order request was superseded', async ({ expect }) => {
    const review = createReviewView();
    const { data, notices } = createReviewDataHarness({
      review,
      replies: { 'session:get-order': failed({ code: 'cancelled', message: 'cancelled' }) },
    });
    await data.reloadOrder(review);
    expect(notices).toStrictEqual([]);
  });

  test('drops an order for a mode that is no longer chosen', async ({ expect }) => {
    const review = createReviewView();
    const { data, chooseOrder } = createReviewDataHarness({
      review,
      replies: { 'session:get-order': ok({ mode: 'path', files: [] }) },
    });
    const pending = data.reloadOrder(review);
    chooseOrder('calls');
    await pending;
    expect(data.order).toBeUndefined();
  });

  test('stores a file mark against the head the reviewer sees', async ({ expect }) => {
    const review = createReviewView({ files: ['a.ts'] });
    const { data, invoked } = createReviewDataHarness({
      review,
      replies: {
        'review:set-file-reviewed': ok({ reviewed: 'yes', progress: { reviewed: 1, total: 1 } }),
      },
    });
    data.open(review);
    await data.setFileReviewed('a.ts', true);
    expect(invoked.find(([channel]) => channel === 'review:set-file-reviewed')).toStrictEqual([
      'review:set-file-reviewed',
      { sessionId: 's1', path: 'a.ts', reviewed: true, expectedHeadSha: review.headSha },
    ]);
    expect(data.marks.get('a.ts')).toBe('yes');
    expect(data.progress).toStrictEqual({ reviewed: 1, total: 1 });
  });

  test('keeps the marks and says so when a mark is refused', async ({ expect }) => {
    const review = createReviewView({ files: ['a.ts'] });
    const { data, notices } = createReviewDataHarness({
      review,
      replies: {
        'review:set-file-reviewed': failed({ code: 'stale-review', message: 'head moved' }),
      },
    });
    data.open(review);
    await data.setFileReviewed('a.ts', true);
    expect(data.marks.get('a.ts')).toBe('no');
    expect(notices).toStrictEqual([{ tone: 'error', text: 'head moved' }]);
  });
});
