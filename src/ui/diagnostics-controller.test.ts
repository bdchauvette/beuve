import { describe } from 'vitest';

import type { DiagnosticsView, ReviewView } from '#contract/ipc-contract.ts';

import { DiagnosticsController } from './diagnostics-controller.ts';
import type { DiagnosticsBridge, DiagnosticsTarget } from './diagnostics-controller.ts';
import { createFakeHost } from './testing/create-fake-host.ts';
import { createReviewView } from './testing/create-review-view.ts';
import { test } from './testing/test.ts';

/** What the controller asked of `lsp:diagnostics`, and the way to answer it. */
interface AskedQuestion {
  readonly request: DiagnosticsQuestion;
  readonly answer: (result: unknown) => void;
}

interface DiagnosticsQuestion {
  readonly sessionId: string;
  readonly sha: string;
  readonly path: string;
}

interface HeldBridge {
  readonly bridge: DiagnosticsBridge;
  readonly asked: AskedQuestion[];
}

/** A bridge whose `lsp:diagnostics` answers when the test says so. */
function createHeldBridge(): HeldBridge {
  const asked: AskedQuestion[] = [];
  const bridge = {
    invoke: async (_channel: 'lsp:diagnostics', request: DiagnosticsQuestion): Promise<unknown> => {
      return new Promise((resolve) => {
        asked.push({ request, answer: resolve });
      });
    },
  } as unknown as DiagnosticsBridge;
  return { bridge, asked };
}

interface SettledReply {
  readonly ok: true;
  readonly value: DiagnosticsView;
}

function settled(sha: string): SettledReply {
  return { ok: true, value: { sha, state: 'settled', diagnostics: [], omitted: 0 } };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface Harness {
  readonly diagnostics: DiagnosticsController;
  readonly asked: AskedQuestion[];
  readonly updates: () => number;
  /** Opens another review, or none, as the window does. */
  readonly showReview: (next: ReviewView | undefined) => void;
}

function createHarness(review: ReviewView | undefined): Harness {
  const held = createHeldBridge();
  const { host, updates } = createFakeHost();
  let current = review;
  const diagnostics = new DiagnosticsController(host, {
    bridge: (): DiagnosticsBridge => {
      return held.bridge;
    },
    target: (): DiagnosticsTarget | undefined => {
      if (current === undefined) {
        return undefined;
      }
      return { sessionId: current.session.id, headSha: current.headSha };
    },
  });
  return {
    diagnostics,
    asked: held.asked,
    updates,
    showReview: (next): void => {
      current = next;
    },
  };
}

describe('DiagnosticsController', () => {
  test('asks at the head the review shows, and keeps the answer', async ({ expect }) => {
    const review = createReviewView();
    const { diagnostics, asked } = createHarness(review);
    diagnostics.want('src/a.ts');
    expect(diagnostics.byPath.get('src/a.ts')).toStrictEqual({ kind: 'checking' });
    await flush();
    expect(asked.map(({ request }) => request)).toStrictEqual([
      { sessionId: 's1', sha: review.headSha, path: 'src/a.ts' },
    ]);
    asked[0]?.answer(settled(review.headSha));
    await flush();
    expect(diagnostics.byPath.get('src/a.ts')).toMatchObject({ kind: 'ready' });
  });

  test('asks once per file, however often a card wants it', async ({ expect }) => {
    const { diagnostics, asked } = createHarness(createReviewView());
    diagnostics.want('src/a.ts');
    diagnostics.want('src/a.ts');
    await flush();
    diagnostics.want('src/a.ts');
    expect(asked).toHaveLength(1);
  });

  test('has a few questions in flight at once and asks the rest as they are answered', async ({
    expect,
  }) => {
    const review = createReviewView();
    const { diagnostics, asked } = createHarness(review);
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      diagnostics.want(`src/${name}.ts`);
    }
    await flush();
    expect(asked).toHaveLength(3);
    asked[0]?.answer(settled(review.headSha));
    await flush();
    expect(asked).toHaveLength(4);
    expect(diagnostics.byPath.get('src/e.ts')).toStrictEqual({ kind: 'checking' });
  });

  test('forgets the answers when the head moves, and drops one that arrives late', async ({
    expect,
  }) => {
    const first = createReviewView({ headSha: 'a'.repeat(40) });
    const second = createReviewView({ headSha: 'b'.repeat(40) });
    const { diagnostics, asked, showReview } = createHarness(first);
    diagnostics.want('src/a.ts');
    await flush();
    showReview(second);
    expect(diagnostics.byPath.size).toBe(0);
    diagnostics.want('src/a.ts');
    await flush();
    expect(asked.map(({ request }) => request.sha)).toStrictEqual(['a'.repeat(40), 'b'.repeat(40)]);
    asked[0]?.answer(settled('a'.repeat(40)));
    await flush();
    expect(diagnostics.byPath.get('src/a.ts')).toStrictEqual({ kind: 'checking' });
    asked[1]?.answer(settled('b'.repeat(40)));
    await flush();
    expect(diagnostics.byPath.get('src/a.ts')).toMatchObject({ kind: 'ready' });
  });

  test('forgets everything on reset, so the cards ask again', async ({ expect }) => {
    const review = createReviewView();
    const { diagnostics, asked, updates } = createHarness(review);
    diagnostics.want('src/a.ts');
    await flush();
    asked[0]?.answer(settled(review.headSha));
    await flush();
    const before = updates();
    diagnostics.reset();
    expect(updates()).toBeGreaterThan(before);
    expect(diagnostics.byPath.size).toBe(0);
    diagnostics.want('src/a.ts');
    await flush();
    expect(asked).toHaveLength(2);
  });

  test('shows nothing for a failed question', async ({ expect }) => {
    const { diagnostics, asked } = createHarness(createReviewView());
    diagnostics.want('src/a.ts');
    await flush();
    asked[0]?.answer({ ok: false, error: { code: 'lsp-failed', message: 'x' } });
    await flush();
    expect(diagnostics.byPath.get('src/a.ts')).toStrictEqual({ kind: 'failed' });
  });

  test('asks nothing without a review', async ({ expect }) => {
    const { diagnostics, asked } = createHarness(undefined);
    diagnostics.want('src/a.ts');
    await flush();
    expect(asked).toHaveLength(0);
    expect(diagnostics.byPath.size).toBe(0);
  });
});
