import { describe } from 'vitest';

import { createUraHarness } from './testing/create-ura-harness.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';
import { test } from './testing/test.ts';

interface ReviewRef {
  readonly sessionId: string;
  readonly headSha: string;
}

interface Reply {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

interface FailureOptions {
  readonly code: string;
  readonly message: string;
}

function reviewOf(): ReviewRef {
  return { sessionId: 's1', headSha: 'a'.repeat(40) };
}

function ok(value: unknown): Reply {
  return { ok: true, value };
}

function failed(error: FailureOptions): Reply {
  return { ok: false, error };
}

function chatItem(finding?: number): ReturnType<typeof createUraItemView> {
  if (finding === undefined) {
    return createUraItemView({ origin: { kind: 'chat-answer', messageId: 'm1' } });
  }
  return createUraItemView({ origin: { kind: 'chat-answer', messageId: 'm1', finding } });
}

describe('UraController', () => {
  test('refreshes when the open session changes and ignores other sessions', async ({ expect }) => {
    const { ura, emit, invoked } = createUraHarness({
      review: reviewOf(),
      replies: {
        'ura:list': ok({ items: [createUraItemView()], derivedVerdict: 'comment' }),
      },
    });
    ura.hostConnected();
    emit('ura:changed', { sessionId: 's2' });
    emit('ura:changed', { sessionId: 's1' });
    await expect.poll(() => ura.items.length).toBe(1);
    expect(invoked).toStrictEqual([['ura:list', { sessionId: 's1' }]]);
    expect(ura.derivedVerdict).toBe('comment');
  });

  test('stops listening when the host disconnects', ({ expect }) => {
    const { ura, listening } = createUraHarness();
    ura.hostConnected();
    expect(listening()).toBe(1);
    ura.hostDisconnected();
    expect(listening()).toBe(0);
  });

  test('keeps the list it has when another session answers late', async ({ expect }) => {
    const { ura } = createUraHarness({
      review: reviewOf(),
      replies: { 'ura:list': ok({ items: [createUraItemView()], derivedVerdict: 'approve' }) },
    });
    await ura.refresh('s2');
    expect(ura.items).toStrictEqual([]);
  });

  test('forgets items, chosen verdict and notice on reset', async ({ expect }) => {
    const { ura } = createUraHarness({
      review: reviewOf(),
      replies: {
        'ura:list': ok({
          items: [createUraItemView()],
          derivedVerdict: 'approve',
          chosenVerdict: 'comment',
          verdictNotice: 'moved',
        }),
      },
    });
    await ura.refresh('s1');
    ura.reset();
    expect(ura.items).toStrictEqual([]);
    expect(ura.chosenVerdict).toBeUndefined();
    expect(ura.verdictNotice).toBe('');
  });

  test('counts only staged items', async ({ expect }) => {
    const { ura } = createUraHarness({
      review: reviewOf(),
      replies: {
        'ura:list': ok({
          items: [createUraItemView(), createUraItemView({ status: { kind: 'withdrawn' } })],
          derivedVerdict: 'approve',
        }),
      },
    });
    await ura.refresh('s1');
    expect(ura.stagedCount).toBe(1);
  });

  test('knows which answers and findings are staged', async ({ expect }) => {
    const { ura } = createUraHarness({
      review: reviewOf(),
      replies: {
        'ura:list': ok({ items: [chatItem(), chatItem(2)], derivedVerdict: 'approve' }),
      },
    });
    await ura.refresh('s1');
    expect([...ura.stagedMessageIds()]).toStrictEqual(['m1']);
    expect([...ura.stagedFindings()]).toStrictEqual(['m1:2']);
  });

  test('tells the composer there is no session', async ({ expect }) => {
    const { ura, invoked } = createUraHarness();
    const settled: (string | undefined)[] = [];
    await ura.create({
      anchor: { kind: 'change' },
      headSha: 'a'.repeat(40),
      draft: { severity: 'issue', title: 't', body: '' },
      settle: (error): void => {
        settled.push(error);
      },
    });
    expect(settled).toStrictEqual(['No review session is open.']);
    expect(invoked).toStrictEqual([]);
  });

  test('keeps the composer open with the error when staging fails', async ({ expect }) => {
    const { ura } = createUraHarness({
      review: reviewOf(),
      replies: { 'ura:create': failed({ code: 'invalid-request', message: 'too long' }) },
    });
    const settled: (string | undefined)[] = [];
    await ura.create({
      anchor: { kind: 'change' },
      headSha: 'a'.repeat(40),
      draft: { severity: 'issue', title: 't', body: '' },
      settle: (error): void => {
        settled.push(error);
      },
    });
    expect(settled).toStrictEqual(['too long']);
    expect(ura.notice).toBeUndefined();
  });

  test('closes the composer and says what was staged', async ({ expect }) => {
    const { ura, invoked } = createUraHarness({
      review: reviewOf(),
      replies: { 'ura:create': ok(createUraItemView({ title: 'Handle it' })) },
    });
    const settled: (string | undefined)[] = [];
    await ura.create({
      anchor: { kind: 'change' },
      headSha: 'a'.repeat(40),
      draft: { severity: 'issue', title: 'Handle it', body: 'b' },
      suggestedPatch: 'patch',
      settle: (error): void => {
        settled.push(error);
      },
    });
    expect(settled).toStrictEqual([undefined]);
    expect(ura.notice).toStrictEqual({ tone: 'info', text: 'Staged “Handle it”.' });
    expect(invoked[0]?.[0]).toBe('ura:create');
    expect(invoked[0]?.[1]).toMatchObject({
      sessionId: 's1',
      title: 'Handle it',
      suggestedPatch: 'patch',
    });
  });

  test('shows a new order at once and puts it right when main refuses', async ({ expect }) => {
    const first = createUraItemView({ id: 'i1' });
    const second = createUraItemView({ id: 'i2' });
    const { ura, invoked } = createUraHarness({
      review: reviewOf(),
      replies: {
        'ura:list': ok({ items: [first, second], derivedVerdict: 'approve' }),
        'ura:reorder': failed({ code: 'invalid-request', message: 'out of date' }),
      },
    });
    await ura.refresh('s1');
    await ura.reorder(['i2', 'i1']);
    expect(invoked.map(([channel]) => channel)).toStrictEqual([
      'ura:list',
      'ura:reorder',
      'ura:list',
    ]);
    expect(ura.items.map(({ id }) => id)).toStrictEqual(['i1', 'i2']);
    expect(ura.notice).toStrictEqual({ tone: 'error', text: 'out of date' });
  });

  test('reads a moved head as a quiet note', async ({ expect }) => {
    const { ura } = createUraHarness({
      review: reviewOf(),
      replies: {
        'ura:set-verdict': failed({ code: 'stale-review', message: 'head moved' }),
        'ura:list': ok({ items: [], derivedVerdict: 'approve' }),
      },
    });
    await ura.setVerdict('comment');
    expect(ura.notice).toStrictEqual({ tone: 'info', text: 'head moved' });
  });

  test('sets the verdict against the head the reviewer sees, or clears it', async ({ expect }) => {
    const { ura, invoked } = createUraHarness({ review: reviewOf() });
    await ura.setVerdict('request-changes');
    await ura.setVerdict(undefined);
    expect(invoked).toStrictEqual([
      [
        'ura:set-verdict',
        { sessionId: 's1', expectedHeadSha: 'a'.repeat(40), verdict: 'request-changes' },
      ],
      ['ura:set-verdict', { sessionId: 's1', expectedHeadSha: 'a'.repeat(40) }],
    ]);
  });

  test('does not stage a finding that is staged already', async ({ expect }) => {
    const { ura, invoked } = createUraHarness({
      review: reviewOf(),
      replies: { 'ura:list': ok({ items: [chatItem(2)], derivedVerdict: 'approve' }) },
    });
    await ura.refresh('s1');
    await ura.stageReviewFinding('m1', 2);
    expect(invoked.map(([channel]) => channel)).toStrictEqual(['ura:list']);
  });

  test('says when a finding was already staged', async ({ expect }) => {
    const { ura } = createUraHarness({
      review: reviewOf(),
      replies: {
        'ura:stage-review-finding': ok({
          item: createUraItemView({ title: 'Edge' }),
          created: false,
        }),
      },
    });
    await ura.stageReviewFinding('m1', 0);
    expect(ura.notice).toStrictEqual({ tone: 'info', text: '“Edge” is already staged.' });
  });

  test('exports, copies and reports the size', async ({ expect }) => {
    const { ura, invoked } = createUraHarness({
      review: reviewOf(),
      replies: {
        'ura:export': ok({ text: 'x'.repeat(2048), itemCount: 2, outdatedCount: 1 }),
        'clipboard:write-text': ok(undefined),
      },
    });
    await ura.export('github');
    expect(invoked.map(([channel]) => channel)).toStrictEqual([
      'ura:export',
      'clipboard:write-text',
    ]);
    expect(ura.isExporting).toBe(false);
    expect(ura.notice).toStrictEqual({
      tone: 'info',
      text: 'Copied the GitHub review JSON: 2 items, 1 outdated, 2.0 K characters.',
    });
  });

  test('reports a clipboard that refused', async ({ expect }) => {
    const { ura } = createUraHarness({
      review: reviewOf(),
      replies: {
        'ura:export': ok({ text: 'x', itemCount: 1, outdatedCount: 0 }),
        'clipboard:write-text': failed({ code: 'invalid-request', message: 'denied' }),
      },
    });
    await ura.export('agent-json');
    expect(ura.isExporting).toBe(false);
    expect(ura.notice).toStrictEqual({ tone: 'error', text: 'Could not copy: denied' });
  });

  test('exports nothing without a review', async ({ expect }) => {
    const { ura, invoked } = createUraHarness();
    await ura.export('agent-xml');
    expect(invoked).toStrictEqual([]);
    expect(ura.isExporting).toBe(false);
  });
});
