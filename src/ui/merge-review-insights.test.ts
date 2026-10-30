import { describe } from 'vitest';

import { mergeReviewInsights } from './merge-review-insights.ts';
import { createFindingView } from './testing/create-finding-view.ts';
import { createReviewMessageView } from './testing/create-review-message-view.ts';
import { test } from './testing/test.ts';

function head(): string {
  return 'a'.repeat(40);
}

describe('mergeReviewInsights', () => {
  test('lists the findings of completed review answers at the head, in order', ({ expect }) => {
    const first = createFindingView({ title: 'First' });
    const second = createFindingView({ path: 'src/b.ts', title: 'Second' });
    const insights = mergeReviewInsights([createReviewMessageView([first, second])], head());
    expect(insights).toStrictEqual([
      { key: 'm1:0', messageId: 'm1', index: 0, finding: first, sources: ['m1:0'] },
      { key: 'm1:1', messageId: 'm1', index: 1, finding: second, sources: ['m1:1'] },
    ]);
  });

  test('ignores other heads, other kinds and answers that did not complete', ({ expect }) => {
    const messages = [
      createReviewMessageView(undefined, { id: 'old', headSha: 'b'.repeat(40) }),
      createReviewMessageView(undefined, { id: 'running', status: 'streaming' }),
      createReviewMessageView(undefined, { id: 'answer', answerKind: 'answer' }),
      createReviewMessageView(undefined, { id: 'question', role: 'user' }),
    ];
    expect(mergeReviewInsights(messages, head())).toStrictEqual([]);
  });

  test('merges scopes: findings of different files from different runs all show', ({ expect }) => {
    const a = createFindingView({ path: 'src/a.ts' });
    const b = createFindingView({ path: 'src/b.ts' });
    const insights = mergeReviewInsights(
      [
        createReviewMessageView([a], { id: 'scoped-a', createdAt: '2026-10-30T10:00:00.000Z' }),
        createReviewMessageView([b], { id: 'scoped-b', createdAt: '2026-10-30T10:05:00.000Z' }),
      ],
      head(),
    );
    expect(insights.map(({ messageId }) => messageId)).toStrictEqual(['scoped-b', 'scoped-a']);
  });

  test('keeps the newest of a finding made twice, and remembers where else it came from', ({
    expect,
  }) => {
    const older = createFindingView({
      startLine: 3,
      endLine: 4,
      title: 'Unchecked `null` return.',
    });
    const newer = createFindingView({
      startLine: 4,
      endLine: 6,
      category: 'error-handling',
      title: 'unchecked  null **return**',
    });
    const insights = mergeReviewInsights(
      [
        createReviewMessageView([older], { id: 'older', createdAt: '2026-10-30T10:00:00.000Z' }),
        createReviewMessageView([newer], { id: 'newer', createdAt: '2026-10-30T11:00:00.000Z' }),
      ],
      head(),
    );
    expect(insights).toStrictEqual([
      {
        key: 'newer:0',
        messageId: 'newer',
        index: 0,
        finding: newer,
        sources: ['newer:0', 'older:0'],
      },
    ]);
  });

  test('does not merge findings that differ in file, lines or title', ({ expect }) => {
    const base = createFindingView({ startLine: 3, endLine: 4 });
    const others = [
      createFindingView({ path: 'src/b.ts' }),
      createFindingView({ startLine: 5, endLine: 6 }),
      createFindingView({ startLine: 3, endLine: 4, title: 'Another problem' }),
    ];
    const insights = mergeReviewInsights(
      [
        createReviewMessageView([base], { id: 'one', createdAt: '2026-10-30T10:00:00.000Z' }),
        createReviewMessageView(others, { id: 'two', createdAt: '2026-10-30T11:00:00.000Z' }),
      ],
      head(),
    );
    expect(insights).toHaveLength(4);
  });

  test('keeps two problems of one category on the same lines apart across runs', ({ expect }) => {
    const empty = createFindingView({ category: 'edge-case', title: 'Empty list throws' });
    const overflow = createFindingView({ category: 'edge-case', title: 'Index can overflow' });
    const insights = mergeReviewInsights(
      [
        createReviewMessageView([empty], { id: 'one', createdAt: '2026-10-30T10:00:00.000Z' }),
        createReviewMessageView([overflow], { id: 'two', createdAt: '2026-10-30T11:00:00.000Z' }),
      ],
      head(),
    );
    expect(insights.map(({ key }) => key)).toStrictEqual(['two:0', 'one:0']);
  });

  test('does not merge findings within one answer', ({ expect }) => {
    const twin = createFindingView({ title: 'Same lines, same category' });
    const insights = mergeReviewInsights([createReviewMessageView([twin, twin])], head());
    expect(insights.map(({ key }) => key)).toStrictEqual(['m1:0', 'm1:1']);
  });
});
