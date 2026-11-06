import { describe } from 'vitest';

import { createCodeNavigationHarness } from './testing/create-code-navigation-harness.ts';
import { createReviewView } from './testing/create-review-view.ts';
import { test } from './testing/test.ts';

interface OkReply {
  readonly ok: true;
  readonly value: unknown;
}

interface FailedReply {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
}

function ok(value: unknown): OkReply {
  return { ok: true, value };
}

function failed(message: string): FailedReply {
  return { ok: false, error: { code: 'invalid-request', message } };
}

function callers(): OkReply {
  return ok({ root: { id: 'n1' }, calls: [{ from: 'n2' }] });
}

interface SheetRange {
  readonly startLine: number;
  readonly startCharacter: number;
  readonly endLine: number;
  readonly endCharacter: number;
}

function rangeOf(): SheetRange {
  return { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 1 };
}

describe('CodeNavigationController', () => {
  test('starts with nothing open', ({ expect }) => {
    const { navigation } = createCodeNavigationHarness();
    expect(navigation.peek).toBeUndefined();
    expect(navigation.flow).toBeUndefined();
  });

  test('asks for the callers at the head the reviewer sees', async ({ expect }) => {
    const review = createReviewView();
    const { navigation, invoked } = createCodeNavigationHarness({
      review,
      replies: { 'lsp:call-hierarchy': callers() },
    });
    await navigation.openPeek('a.ts', 3);
    expect(invoked).toStrictEqual([
      [
        'lsp:call-hierarchy',
        {
          sessionId: 's1',
          expectedHeadSha: review.headSha,
          path: 'a.ts',
          line: 3,
          direction: 'incoming',
        },
      ],
    ]);
    expect(navigation.peek).toMatchObject({ path: 'a.ts', line: 3, status: 'ready' });
  });

  test('says a file without a head line has nothing to peek at', async ({ expect }) => {
    const { navigation, invoked } = createCodeNavigationHarness({ review: createReviewView() });
    await navigation.openPeek('a.ts', undefined);
    expect(invoked).toStrictEqual([]);
    expect(navigation.peek).toStrictEqual({
      path: 'a.ts',
      line: undefined,
      status: 'error',
      message: 'This file has no head-side change to peek at.',
    });
  });

  test('shows the peek loading until the answer comes', async ({ expect }) => {
    const { navigation } = createCodeNavigationHarness({
      review: createReviewView(),
      replies: { 'lsp:call-hierarchy': callers() },
    });
    const asking = navigation.openPeek('a.ts', 3);
    expect(navigation.peek).toStrictEqual({ path: 'a.ts', line: 3, status: 'loading' });
    await asking;
  });

  test('drops an answer once another review is open', async ({ expect }) => {
    const { navigation, showReview } = createCodeNavigationHarness({
      review: createReviewView(),
      replies: { 'lsp:call-hierarchy': callers() },
    });
    const asking = navigation.openPeek('a.ts', 3);
    showReview(createReviewView({ sessionId: 's2' }));
    await asking;
    expect(navigation.peek?.status).toBe('loading');
  });

  test('asks nothing without a review', async ({ expect }) => {
    const { navigation, invoked } = createCodeNavigationHarness();
    await navigation.openPeek('a.ts', 3);
    await navigation.openFlow('a.ts', 3);
    expect(invoked).toStrictEqual([]);
  });

  test('shows the callers of an expanded node and keeps the root’s', async ({ expect }) => {
    const { navigation } = createCodeNavigationHarness({
      review: createReviewView(),
      replies: { 'lsp:call-hierarchy': callers() },
    });
    await navigation.openPeek('a.ts', 3);
    await navigation.expandPeek('n2');
    const { peek } = navigation;
    expect(peek?.status === 'ready' && peek.children.keys().toArray()).toStrictEqual(['n1', 'n2']);
    expect(peek?.status === 'ready' && peek.children.get('n2')).toStrictEqual({
      status: 'ready',
      calls: [{ from: 'n2' }],
    });
  });

  test('asks for a node’s callers against the same file and line', async ({ expect }) => {
    const { navigation, invoked } = createCodeNavigationHarness({
      review: createReviewView(),
      replies: { 'lsp:call-hierarchy': callers() },
    });
    await navigation.openPeek('a.ts', 3);
    await navigation.expandPeek('n2');
    expect(invoked).toHaveLength(2);
    expect(invoked.at(-1)?.[1]).toMatchObject({ nodeId: 'n2', path: 'a.ts', line: 3 });
  });

  test('expands nothing before a peek is ready', async ({ expect }) => {
    const { navigation, invoked } = createCodeNavigationHarness({ review: createReviewView() });
    await navigation.expandPeek('n2');
    expect(invoked).toStrictEqual([]);
  });

  test('shows an error that main reported for the peek', async ({ expect }) => {
    const { navigation } = createCodeNavigationHarness({
      review: createReviewView(),
      replies: { 'lsp:call-hierarchy': failed('server gone') },
    });
    await navigation.openPeek('a.ts', 3);
    expect(navigation.peek).toMatchObject({ status: 'error', message: 'server gone' });
  });

  test('opens the flow and closes the peek, and the other way round', async ({ expect }) => {
    const { navigation } = createCodeNavigationHarness({
      review: createReviewView(),
      replies: {
        'lsp:call-hierarchy': callers(),
        'flow:get-graph': ok({ kind: 'graph', graph: { nodes: [] } }),
      },
    });
    await navigation.openPeek('a.ts', 3);
    await navigation.openFlow('a.ts', 3);
    expect(navigation.peek).toBeUndefined();
    expect(navigation.flow).toMatchObject({ status: 'ready', path: 'a.ts', line: 3 });
    await navigation.openPeek('a.ts', 3);
    expect(navigation.flow).toBeUndefined();
    expect(navigation.peek?.status).toBe('ready');
  });

  test('says a file without a head line has no flow', async ({ expect }) => {
    const { navigation } = createCodeNavigationHarness({ review: createReviewView() });
    await navigation.openFlow('a.ts', undefined);
    expect(navigation.flow).toMatchObject({
      status: 'error',
      message: 'This file has no head-side change to draw a flow for.',
    });
  });

  test('closes the portals, and all of them for a new review', async ({ expect }) => {
    const { navigation } = createCodeNavigationHarness({
      review: createReviewView(),
      replies: {
        'lsp:call-hierarchy': callers(),
        'flow:get-graph': ok({ kind: 'graph', graph: {} }),
      },
    });
    await navigation.openPeek('a.ts', 3);
    navigation.closePeek();
    expect(navigation.peek).toBeUndefined();
    await navigation.openFlow('a.ts', 3);
    navigation.closeFlow();
    expect(navigation.flow).toBeUndefined();
    await navigation.openPeek('a.ts', 3);
    navigation.reset();
    expect(navigation.peek).toBeUndefined();
  });

  test('opens a definition in a window and says so', async ({ expect }) => {
    const { navigation, notices, invoked } = createCodeNavigationHarness({
      review: createReviewView(),
    });
    await navigation.runSheet({ kind: 'open', path: 'a.ts', range: rangeOf() });
    expect(invoked.map(([channel]) => channel)).toStrictEqual(['sheet:open']);
    expect(notices).toStrictEqual([{ tone: 'info', text: 'Opened a.ts:1 in a sheet.' }]);
  });

  test('opens no sheet without a review', async ({ expect }) => {
    const { navigation, invoked } = createCodeNavigationHarness();
    await navigation.runSheet({ kind: 'open', path: 'a.ts', range: rangeOf() });
    expect(invoked).toStrictEqual([]);
  });
});
