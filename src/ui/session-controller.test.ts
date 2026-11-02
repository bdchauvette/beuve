import { describe } from 'vitest';

import { createReviewView } from './testing/create-review-view.ts';
import { createSessionHarness } from './testing/create-session-harness.ts';
import { test } from './testing/test.ts';

interface OkReply {
  readonly ok: true;
  readonly value: unknown;
}

interface FailedReply {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
}

interface FailureOptions {
  readonly code: string;
  readonly message: string;
}

function ok(value: unknown): OkReply {
  return { ok: true, value };
}

function failed(error: FailureOptions): FailedReply {
  return { ok: false, error };
}

function listed(...ids: string[]): OkReply {
  return ok(
    ids.map((id) => {
      return { id };
    }),
  );
}

describe('SessionController', () => {
  test('says there is no bridge when the page has none', ({ expect }) => {
    const { session } = createSessionHarness({ hasBridge: false });
    session.hostConnected();
    expect(session.note).toBe('Running without the Electron bridge.');
  });

  test('lists the sessions and counts them', async ({ expect }) => {
    const { session } = createSessionHarness({
      replies: { 'session:list': listed('s1', 's2') },
    });
    await session.refresh();
    expect(session.sessions.map(({ id }) => id)).toStrictEqual(['s1', 's2']);
    expect(session.note).toBe('2 sessions');
  });

  test('says why the list is missing', async ({ expect }) => {
    const { session } = createSessionHarness({
      replies: { 'session:list': failed({ code: 'invalid-request', message: 'no store' }) },
    });
    await session.refresh();
    expect(session.sessions).toStrictEqual([]);
    expect(session.note).toBe('Sessions unavailable: no store');
  });

  test('starts a new session afresh and then reports its review', async ({ expect }) => {
    const review = createReviewView({ sessionId: 's1' });
    const { session, hooks, loaded, invoked } = createSessionHarness({
      replies: { 'session:get-review': ok(review), 'session:list': listed('s1') },
    });
    await session.select('s1');
    expect(hooks).toStrictEqual(['closed', 'switching', 'settled']);
    expect(invoked[0]).toStrictEqual([
      'session:get-review',
      { sessionId: 's1', ignoreWhitespace: false },
    ]);
    expect(session.review).toBe(review);
    expect(session.selectedId).toBe('s1');
    expect(session.isLoading).toBe(false);
    expect(session.reviewRef).toStrictEqual({ sessionId: 's1', headSha: review.headSha });
    expect(loaded).toStrictEqual([{ review, previousHead: undefined }]);
  });

  test('reads the review with the whitespace choice', async ({ expect }) => {
    const { session, invoked } = createSessionHarness({
      ignoresWhitespace: true,
      replies: { 'session:get-review': ok(createReviewView()), 'session:list': listed('s1') },
    });
    await session.select('s1');
    expect(invoked[0]).toStrictEqual([
      'session:get-review',
      { sessionId: 's1', ignoreWhitespace: true },
    ]);
  });

  test('reloads the same session in place and says which head it showed', async ({ expect }) => {
    const first = createReviewView({ headSha: 'a'.repeat(40) });
    const { session, hooks, loaded } = createSessionHarness({
      replies: { 'session:get-review': ok(first), 'session:list': listed('s1') },
    });
    await session.select('s1');
    await session.select('s1');
    expect(hooks).toStrictEqual([
      'closed',
      'switching',
      'settled',
      'closed',
      'reloading',
      'settled',
    ]);
    expect(loaded.map(({ previousHead }) => previousHead)).toStrictEqual([
      undefined,
      first.headSha,
    ]);
  });

  test('keeps the selection and shows the error when the review does not load', async ({
    expect,
  }) => {
    const { session, hooks, loaded } = createSessionHarness({
      replies: { 'session:get-review': failed({ code: 'not-found', message: 'gone' }) },
    });
    await session.select('s1');
    expect(session.review).toBeUndefined();
    expect(session.error).toBe('gone');
    expect(session.selectedId).toBe('s1');
    expect(session.isLoading).toBe(false);
    expect(hooks).toContain('settled');
    expect(loaded).toStrictEqual([]);
  });

  test('says nothing when a newer load superseded this one', async ({ expect }) => {
    const { session, hooks, loaded } = createSessionHarness({
      replies: { 'session:get-review': failed({ code: 'cancelled', message: 'cancelled' }) },
    });
    await session.select('s1');
    expect(hooks).not.toContain('settled');
    expect(loaded).toStrictEqual([]);
    expect(session.error).toBe('');
  });

  test('lists a session it did not know about', async ({ expect }) => {
    const { session, invoked } = createSessionHarness({
      replies: { 'session:get-review': ok(createReviewView()), 'session:list': listed('s1') },
    });
    await session.select('s1');
    await expect
      .poll(() => {
        return invoked.some(([channel]) => channel === 'session:list');
      })
      .toBe(true);
  });

  test('does nothing without a bridge', async ({ expect }) => {
    const { session, hooks } = createSessionHarness({ hasBridge: false });
    await session.select('s1');
    await session.open({ repoPath: '/r', baseRef: 'main', headRef: 'feature' });
    expect(hooks).toStrictEqual([]);
    expect(session.selectedId).toBe('');
  });

  test('creates a local session, lists and selects it', async ({ expect }) => {
    const { session, hooks, invoked } = createSessionHarness({
      replies: {
        'session:create-local': ok({ id: 's9' }),
        'session:list': listed('s9'),
        'session:get-review': ok(createReviewView({ sessionId: 's9' })),
      },
    });
    await session.open({ repoPath: '/r', baseRef: 'main', headRef: 'feature' });
    expect(invoked.map(([channel]) => channel)).toStrictEqual([
      'session:create-local',
      'session:list',
      'session:get-review',
    ]);
    expect(hooks.slice(0, 2)).toStrictEqual(['closed', 'closed']);
    expect(session.selectedId).toBe('s9');
    expect(session.isOpening).toBe(false);
  });

  test('keeps the failure of a local session that did not open', async ({ expect }) => {
    const { session } = createSessionHarness({
      replies: {
        'session:create-local': failed({ code: 'not-a-repository', message: 'not a repository' }),
      },
    });
    await session.open({ repoPath: '/r', baseRef: 'main', headRef: 'feature' });
    expect(session.localFailure).toStrictEqual({ message: 'not a repository' });
    expect(session.selectedId).toBe('');
    session.clearLocalFailure();
    expect(session.localFailure).toBeUndefined();
  });

  test('records the saved progress and shows what changed since', async ({ expect }) => {
    const review = createReviewView({ sessionId: 's1' });
    const { session, invoked } = createSessionHarness({
      replies: {
        'session:get-review': ok(review),
        'session:list': listed('s1'),
        'session:mark-reviewed': ok(undefined),
      },
    });
    await session.select('s1');
    await session.markReviewed();
    expect(invoked.find(([channel]) => channel === 'session:mark-reviewed')).toStrictEqual([
      'session:mark-reviewed',
      { sessionId: 's1', expectedHeadSha: review.headSha },
    ]);
    expect(session.savedProgress).toMatchObject({ sessionId: 's1', sha: review.headSha });
    expect(session.isMarking).toBe(false);
  });

  test('shows why saving progress failed', async ({ expect }) => {
    const { session } = createSessionHarness({
      replies: {
        'session:get-review': ok(createReviewView()),
        'session:list': listed('s1'),
        'session:mark-reviewed': failed({ code: 'stale-review', message: 'head moved' }),
      },
    });
    await session.select('s1');
    await session.markReviewed();
    expect(session.error).toBe('head moved');
    expect(session.savedProgress).toBeUndefined();
  });

  test('saves no progress without a review', async ({ expect }) => {
    const { session, invoked } = createSessionHarness();
    await session.markReviewed();
    expect(invoked).toStrictEqual([]);
  });
});
