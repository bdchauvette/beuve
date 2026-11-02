import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import { appendChatMessage } from '#internal/chat/append-chat-message.ts';
import type { ChatMessageId, CommitSha, SessionId } from '#internal/chat/chat-message.ts';
import type { ChatFinding } from '#internal/chat/chat-review.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { lines } from '../testing/lines.ts';
import { appLines } from './testing/app-lines.ts';
import { test } from './testing/test.ts';

describe('URA services (integration: SQLite + git, no Electron)', { timeout: 30_000 }, () => {
  test('stages a chat answer as a note that remembers its message', async ({
    expect,
    services,
    sessionId,
  }) => {
    const messageId = '00000000-0000-4000-8000-0000000000aa';
    const staged = okValueFrom(
      await services.ura.create({
        sessionId,
        anchor: { kind: 'change' },
        severity: 'question',
        title: 'From the chat',
        body: 'An answer',
        origin: { kind: 'chat-answer', messageId },
      }),
    );
    expect(staged).toMatchObject({
      origin: { kind: 'chat-answer', messageId },
      status: { kind: 'staged' },
    });
    expect(
      okValueFrom(await services.ura.list({ sessionId })).items.map((item) => item.origin),
    ).toStrictEqual([{ kind: 'chat-answer', messageId }]);
  });

  test('creates, lists, edits, withdraws, restages and reorders human notes', async ({
    expect,
    services,
    repo,
    sessionId,
    changes,
    note,
  }) => {
    const head = await repo.git('rev-parse', 'feature');
    const first = await note({ startLine: 2, endLine: 3, title: 'Name the constant' });
    expect(first).toMatchObject({
      sessionId,
      headSha: head,
      anchor: { kind: 'lines', path: 'src/app.ts', startLine: 2, endLine: 3 },
      placement: { kind: 'current', anchor: { startLine: 2, endLine: 3 } },
      origin: { kind: 'human' },
      status: { kind: 'staged' },
    });
    const second = okValueFrom(
      await services.ura.create({
        sessionId,
        anchor: { kind: 'change' },
        severity: 'blocker',
        title: '  Missing tests  ',
        body: '',
      }),
    );
    expect(second.title).toBe('Missing tests');
    await expect(
      services.ura.create({
        sessionId,
        anchor: { kind: 'change' },
        severity: 'nit',
        title: 'Patch on the whole change',
        body: '',
        suggestedPatch: '@@ -1 +1 @@\n-a\n+b\n',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-request' } });

    const listed = okValueFrom(await services.ura.list({ sessionId }));
    expect(listed.items.map((item) => item.id)).toStrictEqual([first.id, second.id]);
    expect(listed.derivedVerdict).toBe('request-changes');

    const patch = '@@ -2 +2 @@\n-const answer = 1;\n+const answer = 2;\n';
    const edited = okValueFrom(
      await services.ura.update({ itemId: first.id, severity: 'nit', suggestedPatch: patch }),
    );
    expect(edited).toMatchObject({ severity: 'nit', title: 'Name the constant' });
    expect(edited.suggestedPatch).toBe(`--- a/src/app.ts\n+++ b/src/app.ts\n${patch}`);
    await expect(
      services.ura.update({ itemId: first.id, suggestedPatch: '@@ -9 +9 @@\n-x\n+y\n' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-request' } });
    expect(
      okValueFrom(await services.ura.update({ itemId: first.id, suggestedPatch: '' }))
        .suggestedPatch,
    ).toBeUndefined();

    expect(
      okValueFrom(await services.ura.transition({ itemId: second.id, to: 'withdrawn' })).status,
    ).toStrictEqual({ kind: 'withdrawn' });
    expect(okValueFrom(await services.ura.list({ sessionId })).derivedVerdict).toBe('approve');
    await expect(
      services.ura.transition({ itemId: second.id, to: 'addressed' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });
    okValueFrom(await services.ura.transition({ itemId: second.id, to: 'staged' }));
    await expect(
      services.ura.transition({ itemId: first.id, to: 'addressed' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });

    expect(services.ura.reorder({ sessionId, itemIds: [first.id] })).toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });
    okValueFrom(services.ura.reorder({ sessionId, itemIds: [second.id, first.id] }));
    expect(
      okValueFrom(await services.ura.list({ sessionId })).items.map((item) => item.id),
    ).toStrictEqual([second.id, first.id]);
    expect(changes.length).toBeGreaterThanOrEqual(7);
    expect(new Set(changes)).toStrictEqual(new Set([sessionId]));
    await expect(
      services.ura.update({ itemId: reviewMessageId(), title: 'x' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
  });

  test('re-anchors notes written at an older head, and flags replaced lines as outdated', async ({
    expect,
    services,
    repo,
    sessionId,
    changes,
    note,
  }) => {
    const shifted = await note({ startLine: 5, endLine: 6, title: 'Below the edit' });
    const replaced = await note({ startLine: 2, endLine: 2, title: 'On the edited line' });
    const fileNote = okValueFrom(
      await services.ura.create({
        sessionId,
        anchor: { kind: 'file', path: 'src/app.ts' },
        severity: 'question',
        title: 'Why a new file?',
        body: '',
      }),
    );
    const oldHead = await repo.git('rev-parse', 'feature');

    await repo.git('switch', '--quiet', 'feature');
    repo.write(
      'src/app.ts',
      lines(['// header', '// more', ...appLines().with(1, 'const answer = 42;')]),
    );
    const newHead = await repo.commit('author edits above');
    await repo.git('switch', '--quiet', 'main');

    const listed = okValueFrom(await services.ura.list({ sessionId }));
    expect(listed.headSha).toBe(newHead);
    const byId = new Map(
      listed.items.map((item) => {
        return [item.id, item];
      }),
    );
    expect(byId.get(shifted.id)).toMatchObject({
      headSha: oldHead,
      anchor: { startLine: 5, endLine: 6 },
      placement: { kind: 'current', anchor: { path: 'src/app.ts', startLine: 7, endLine: 8 } },
    });
    expect(byId.get(replaced.id)?.placement).toStrictEqual({
      kind: 'outdated',
      reason: 'lines-changed',
    });
    expect(byId.get(fileNote.id)?.placement).toMatchObject({ kind: 'current' });
    expect(changes).toContain(sessionId);

    okValueFrom(await services.ura.transition({ itemId: replaced.id, to: 'addressed' }));
    const exported = okValueFrom(await services.ura.export({ sessionId, target: 'agent-json' }));
    expect(exported).toMatchObject({ headSha: newHead, itemCount: 2, outdatedCount: 0 });
    expect(exported.text).toContain('"startLine": 7');

    await repo.git('switch', '--quiet', 'feature');
    await repo.git('rm', '--quiet', 'src/app.ts');
    await repo.commit('delete the file');
    await repo.git('switch', '--quiet', 'main');
    const deleted = okValueFrom(await services.ura.list({ sessionId }));
    expect(deleted.items.find((item) => item.id === shifted.id)?.placement).toStrictEqual({
      kind: 'outdated',
      reason: 'file-deleted',
    });
  });

  test('stages a /review finding from its stored answer, once, restaging a withdrawn one', async ({
    expect,
    services,
    repo,
    sessionId,
    db,
  }) => {
    const head = await repo.git('rev-parse', 'feature');
    storeReview(db, {
      sessionId,
      head,
      findings: [finding('Unchecked answer'), finding('Tab\tin the title')],
    });

    const staged = okValueFrom(
      await services.ura.stageReviewFinding({ messageId: reviewMessageId(), finding: 0 }),
    );
    expect(staged.created).toBe(true);
    expect(staged.item).toMatchObject({
      headSha: head,
      severity: 'issue',
      origin: { kind: 'chat-answer', messageId: reviewMessageId(), finding: 0 },
      anchor: { kind: 'lines', path: 'src/app.ts', startLine: 2, endLine: 2 },
      title: 'Unchecked answer',
      body: 'Check it.',
    });
    const again = okValueFrom(
      await services.ura.stageReviewFinding({ messageId: reviewMessageId(), finding: 0 }),
    );
    expect(again).toStrictEqual({ item: staged.item, created: false });
    expect(okValueFrom(await services.ura.list({ sessionId })).items).toHaveLength(1);

    okValueFrom(await services.ura.transition({ itemId: staged.item.id, to: 'withdrawn' }));
    const restaged = okValueFrom(
      await services.ura.stageReviewFinding({
        messageId: reviewMessageId(),
        finding: 0,
        severity: 'blocker',
      }),
    );
    expect(restaged).toMatchObject({
      created: false,
      item: { id: staged.item.id, status: { kind: 'staged' }, severity: 'issue' },
    });

    await expect(
      services.ura.stageReviewFinding({ messageId: reviewMessageId(), finding: 1 }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
    await expect(
      services.ura.stageReviewFinding({ messageId: reviewMessageId(), finding: 2 }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
    await expect(
      services.ura.stageReviewFinding({
        messageId: '55555555-5555-4555-8555-555555555555',
        finding: 0,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(okValueFrom(await services.ura.list({ sessionId })).items).toHaveLength(1);
  });

  test('exports every target and refuses to approve over a blocker', async ({
    expect,
    services,
    repo,
    sessionId,
    note,
  }) => {
    const head = await repo.git('rev-parse', 'feature');
    await note({ startLine: 2, endLine: 2, title: 'Prefer <const>' });
    const blocker = okValueFrom(
      await services.ura.create({
        sessionId,
        anchor: { kind: 'file', path: 'src/app.ts' },
        severity: 'blocker',
        title: 'Not wired',
        body: 'Nothing calls `answer`.',
      }),
    );

    const json = okValueFrom(await services.ura.export({ sessionId, target: 'agent-json' }));
    expect(json).toMatchObject({
      mediaType: 'application/json',
      verdict: 'request-changes',
      verdictSource: 'derived',
      itemCount: 2,
    });
    expect(JSON.parse(json.text)).toMatchObject({
      schema: 'beuve.ura/1',
      change: { scope: 'full', headSha: head, repository: { kind: 'local', headRef: 'feature' } },
      items: [{ title: 'Prefer <const>' }, { severity: 'blocker' }],
    });
    const xml = okValueFrom(await services.ura.export({ sessionId, target: 'agent-xml' }));
    expect(xml.mediaType).toBe('application/xml');
    expect(xml.text).toContain('<title>Prefer &lt;const&gt;</title>');
    const github = okValueFrom(
      await services.ura.export({ sessionId, target: 'github', verdict: 'comment' }),
    );
    expect(github).toMatchObject({ verdict: 'comment', verdictSource: 'chosen' });
    expect(JSON.parse(github.text)).toMatchObject({
      commit_id: head,
      event: 'COMMENT',
      comments: [{ path: 'src/app.ts', line: 2, side: 'RIGHT' }],
    });
    await expect(
      services.ura.export({ sessionId, target: 'github', verdict: 'approve' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'refused' } });

    okValueFrom(await services.ura.transition({ itemId: blocker.id, to: 'withdrawn' }));
    expect(
      okValueFrom(await services.ura.export({ sessionId, target: 'github', verdict: 'approve' })),
    ).toMatchObject({ verdict: 'approve', itemCount: 1 });
  });

  test('answers beuve_read_human_review with the agent JSON and its XML, defaulting the session', async ({
    expect,
    services,
    note,
  }) => {
    await note({ startLine: 5, endLine: 6, title: 'Below the edit' });
    const read = okValueFrom(await services.mcpTools.readHumanReview({}));
    expect(read.structured).toMatchObject({
      schema: 'beuve.ura/1',
      verdict: 'comment',
      counts: { issue: 1 },
      items: [{ anchor: { kind: 'lines', path: 'src/app.ts', startLine: 5, endLine: 6 } }],
    });
    expect(read.text).toContain('<beuve-review schema="beuve.ura/1" verdict="comment"');
    await expect(services.mcpTools.readHumanReview({ sessionId: 'nope' })).resolves.toMatchObject({
      ok: false,
    });
  });

  test('persists the reviewer-chosen verdict for exports and beuve_read_human_review', async ({
    expect,
    services,
    repo,
    sessionId,
    changes,
    note,
    db,
  }) => {
    await note({ startLine: 2, endLine: 2, title: 'Prefer const' });
    const read = async (): Promise<ReadReview> => {
      const review = await services.mcpTools.readHumanReview({});
      if (!review.ok) {
        throw new Error(review.error);
      }
      return { verdict: review.value.structured['verdict'], text: review.value.text };
    };
    const initial = await read();
    expect(initial.verdict).toBe('comment');

    const approvedChoice = services.ura.setVerdict({
      sessionId,

      verdict: 'approve',

      expectedHeadSha: await featureHead(repo),
    });

    expect(okValueFrom(approvedChoice)).toStrictEqual({
      sessionId,
      derivedVerdict: 'comment',
      chosenVerdict: 'approve',
    });
    expect(changes.at(-1)).toBe(sessionId);
    expect(okValueFrom(await services.ura.list({ sessionId }))).toMatchObject({
      derivedVerdict: 'comment',
      chosenVerdict: 'approve',
    });
    const approved = await read();
    expect(approved.verdict).toBe('approve');
    expect(approved.text).toContain('verdict="approve"');
    expect(okValueFrom(await services.ura.export({ sessionId, target: 'github' }))).toMatchObject({
      verdict: 'approve',
      verdictSource: 'chosen',
      derivedVerdict: 'comment',
    });
    expect(
      okValueFrom(
        await services.ura.export({ sessionId, target: 'github', verdict: 'request-changes' }),
      ),
    ).toMatchObject({ verdict: 'request-changes' });
    expect(okValueFrom(await services.ura.list({ sessionId })).chosenVerdict).toBe('approve');

    const stored = db.prepare('SELECT verdict FROM ura_verdict_choices;').all();
    expect(stored).toMatchObject([{ verdict: 'approve' }]);

    const followedChoice = services.ura.setVerdict({
      sessionId,

      verdict: 'comment',

      expectedHeadSha: await featureHead(repo),
    });

    expect(okValueFrom(followedChoice)).toStrictEqual({
      sessionId,
      derivedVerdict: 'comment',
    });
    expect(db.prepare('SELECT count(*) AS n FROM ura_verdict_choices;').get()).toMatchObject({
      n: 0,
    });
    const restored = await read();
    expect(restored.verdict).toBe('comment');
    expect(
      services.ura.setVerdict({
        sessionId: '99999999-9999-4999-8999-999999999999',
        verdict: 'comment',
        expectedHeadSha: await featureHead(repo),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
  });

  test('drops a chosen verdict when the head moves and says so until the reviewer chooses again', async ({
    expect,
    services,
    repo,
    sessionId,
    note,
  }) => {
    await note({ startLine: 2, endLine: 2, title: 'Prefer const' });
    okValueFrom(
      services.ura.setVerdict({
        sessionId,
        verdict: 'approve',
        expectedHeadSha: await featureHead(repo),
      }),
    );
    expect(okValueFrom(await services.ura.list({ sessionId })).chosenVerdict).toBe('approve');

    await repo.git('switch', '--quiet', 'feature');
    repo.write('src/more.ts', 'export const more = 1;\n');
    await repo.commit('author pushes more');
    await repo.git('switch', '--quiet', 'main');
    const moved = okValueFrom(await services.ura.list({ sessionId }));
    expect(moved.chosenVerdict).toBeUndefined();
    expect(moved.derivedVerdict).toBe('comment');
    expect(moved.verdictNotice).toBe('Verdict cleared: new commits since you chose it');
    const read = await services.mcpTools.readHumanReview({});
    expect(read.ok && read.value.structured['verdict']).toBe('comment');

    okValueFrom(
      services.ura.setVerdict({
        sessionId,
        verdict: 'request-changes',
        expectedHeadSha: await featureHead(repo),
      }),
    );
    expect(okValueFrom(await services.ura.list({ sessionId }))).toMatchObject({
      chosenVerdict: 'request-changes',
    });
    expect(okValueFrom(await services.ura.list({ sessionId })).verdictNotice).toBeUndefined();
  });

  test('refuses an explicit Approve stamped with a head the session has moved past', async ({
    expect,
    services,
    repo,
    sessionId,
    note,
    db,
  }) => {
    await note({ startLine: 2, endLine: 2, title: 'Prefer const' });
    const shown = await featureHead(repo);
    await repo.git('switch', '--quiet', 'feature');
    repo.write('src/more.ts', 'export const more = 1;\n');
    await repo.commit('author pushes more');
    await repo.git('switch', '--quiet', 'main');
    const listed = okValueFrom(await services.ura.list({ sessionId }));
    expect(listed.headSha).not.toBe(shown);

    expect(
      services.ura.setVerdict({ sessionId, verdict: 'approve', expectedHeadSha: shown }),
    ).toMatchObject({ ok: false, error: { code: 'stale-review' } });
    expect(db.prepare('SELECT count(*) AS n FROM ura_verdict_choices;').get()).toMatchObject({
      n: 0,
    });
    expect(okValueFrom(await services.ura.list({ sessionId })).chosenVerdict).toBeUndefined();

    expect(
      okValueFrom(
        services.ura.setVerdict({ sessionId, verdict: 'approve', expectedHeadSha: listed.headSha }),
      ),
    ).toMatchObject({ chosenVerdict: 'approve' });
    expect(db.prepare('SELECT head_sha FROM ura_verdict_choices;').get()).toMatchObject({
      head_sha: listed.headSha,
    });
  });

  test('clears an approval when a blocker is staged, says so, and refuses a new one', async ({
    expect,
    services,
    repo,
    sessionId,
    note,
  }) => {
    await note({ startLine: 2, endLine: 2, title: 'Prefer const' });
    okValueFrom(
      services.ura.setVerdict({
        sessionId,
        verdict: 'approve',
        expectedHeadSha: await featureHead(repo),
      }),
    );
    const blocker = okValueFrom(
      await services.ura.create({
        sessionId,
        anchor: { kind: 'file', path: 'src/app.ts' },
        severity: 'blocker',
        title: 'Not wired',
        body: '',
      }),
    );

    const listed = okValueFrom(await services.ura.list({ sessionId }));
    expect(listed.chosenVerdict).toBeUndefined();
    expect(listed.derivedVerdict).toBe('request-changes');
    expect(listed.verdictNotice).toContain('Approve verdict was cleared');
    const read = await services.mcpTools.readHumanReview({});
    expect(read.ok && read.value.structured['verdict']).toBe('request-changes');
    expect(
      services.ura.setVerdict({
        sessionId,
        verdict: 'approve',
        expectedHeadSha: await featureHead(repo),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });

    okValueFrom(await services.ura.transition({ itemId: blocker.id, to: 'withdrawn' }));
    expect(okValueFrom(await services.ura.list({ sessionId })).verdictNotice).toContain('cleared');
    okValueFrom(
      services.ura.setVerdict({
        sessionId,
        verdict: 'approve',
        expectedHeadSha: await featureHead(repo),
      }),
    );
    expect(okValueFrom(await services.ura.list({ sessionId }))).toMatchObject({
      chosenVerdict: 'approve',
    });
    expect(okValueFrom(await services.ura.list({ sessionId })).verdictNotice).toBeUndefined();
  });
});

async function featureHead(repo: TestRepository): Promise<string> {
  return repo.git('rev-parse', 'feature');
}

function reviewMessageId(): string {
  return '33333333-3333-4333-8333-333333333333';
}

function finding(title: string): ChatFinding {
  return {
    path: 'src/app.ts',
    startLine: 2,
    endLine: 2,
    severity: 'warning',
    category: 'edge-case',
    title,
    body: 'Check it.',
    confidence: 0.8,
    check: 'confirmed',
  };
}

/** Stores a completed `/review` answer with these findings, as the chat would. */
/** A `/review` answer to store: its session, the head it was asked at, and its findings. */
interface StoredReview {
  readonly sessionId: string;
  readonly head: string;
  readonly findings: readonly ChatFinding[];
}

function storeReview(db: DatabaseSync, { sessionId, head, findings }: StoredReview): void {
  const common = {
    sessionId: sessionId as SessionId,
    headSha: head as CommitSha,
    citations: [],
    createdAt: '2026-10-28T12:00:00.000Z',
  };
  appendChatMessage(db, {
    ...common,
    id: '22222222-2222-4222-8222-222222222222' as ChatMessageId,
    role: 'user',
    parts: [{ kind: 'text', id: 'p1', text: '/review' }],
  });
  const stored = appendChatMessage(db, {
    ...common,
    id: reviewMessageId() as ChatMessageId,
    role: 'assistant',
    kind: 'review',
    status: 'done',
    parts: findings.map((_, finding) => {
      return {
        kind: 'finding',
        id: `p${String(finding + 1)}`,
        finding,
      };
    }),
    review: {
      findings,
      dropped: {
        unknownFile: 0,
        outsideDiff: 0,
        lowConfidence: 0,
        duplicate: 0,
        overLimit: 0,
        unconfirmed: 0,
      },
      pathScope: [],
      fileCount: 2,
      verification: 'verified',
    },
  });
  if (!stored.ok) {
    throw new Error(stored.error.kind);
  }
}

/** What an agent reads back of the human review: its verdict and its text. */
interface ReadReview {
  readonly verdict: unknown;
  readonly text: string;
}
