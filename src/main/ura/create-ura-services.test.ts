import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import type { UraItemView } from '#contract/ipc-contract.ts';

import { appendChatMessage } from '#internal/chat/append-chat-message.ts';
import type { ChatMessageId, CommitSha, SessionId } from '#internal/chat/chat-message.ts';
import type { ChatFinding } from '#internal/chat/chat-review.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { lines } from '../testing/lines.ts';
import { appLines } from './testing/app-lines.ts';
import { test } from './testing/test.ts';

describe('URA services (integration: SQLite + git, no Electron)', { timeout: 30_000 }, () => {
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
        severity: 'todo',
        blocking: true,
        title: '  Missing tests  ',
        body: '',
      }),
    );
    expect(second).toMatchObject({ title: 'Missing tests', severity: 'todo', blocking: true });
    await expect(
      services.ura.create({
        sessionId,
        anchor: { kind: 'change' },
        severity: 'nitpick',
        title: 'Past the end',
        body: '',
        suggestions: [{ path: 'src/app.ts', startLine: 8, endLine: 8, replacement: 'x' }],
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-request' } });
    await expect(
      services.ura.create({
        sessionId,
        anchor: { kind: 'change' },
        severity: 'nitpick',
        title: 'No such file',
        body: '',
        suggestions: [{ path: 'src/none.ts', startLine: 1, endLine: 0, replacement: 'x' }],
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-request' } });

    const listed = okValueFrom(await services.ura.list({ sessionId }));
    expect(listed.items.map((item) => item.id)).toStrictEqual([first.id, second.id]);
    expect(listed.derivedVerdict).toBe('request-changes');

    const suggestion = {
      path: 'src/app.ts',
      startLine: 2,
      endLine: 2,
      replacement: '  const answer = 2;',
    };
    const edited = okValueFrom(
      await services.ura.update({
        itemId: first.id,
        severity: 'nitpick',
        suggestions: [suggestion],
      }),
    );
    expect(edited).toMatchObject({
      severity: 'nitpick',
      blocking: false,
      title: 'Name the constant',
    });
    expect(edited.suggestions).toStrictEqual([
      {
        ...suggestion,
        placement: { kind: 'current', path: 'src/app.ts', startLine: 2, endLine: 2 },
        patch: [
          '--- a/src/app.ts',
          '+++ b/src/app.ts',
          '@@ -1,5 +1,5 @@',
          ' export function answer(): number {',
          '-  const answer = 1;',
          '+  const answer = 2;',
          '   return answer;',
          ' }',
          ' export function other(): number {',
          '',
        ].join('\n'),
      },
    ]);
    expect(okValueFrom(await services.ura.list({ sessionId })).items[0]?.suggestions).toStrictEqual(
      edited.suggestions,
    );
    await expect(
      services.ura.update({
        itemId: first.id,
        suggestions: [{ ...suggestion, startLine: 9, endLine: 9 }],
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-request' } });
    expect(
      okValueFrom(await services.ura.update({ itemId: first.id, suggestions: [] })).suggestions,
    ).toStrictEqual([]);

    expect(
      okValueFrom(
        await services.ura.editMany({ itemIds: [second.id], change: { kind: 'withdraw' } }),
      ).itemIds,
    ).toStrictEqual([second.id]);
    expect(okValueFrom(await services.ura.list({ sessionId })).derivedVerdict).toBe('approve');
    await expect(
      services.ura.editMany({ itemIds: [second.id], change: { kind: 'mark-addressed' } }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });
    okValueFrom(await services.ura.editMany({ itemIds: [second.id], change: { kind: 'reopen' } }));
    await expect(
      services.ura.editMany({ itemIds: [first.id], change: { kind: 'mark-addressed' } }),
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
        suggestions: [
          { path: 'src/app.ts', startLine: 5, endLine: 6, replacement: 'moved' },
          { path: 'src/app.ts', startLine: 2, endLine: 2, replacement: 'replaced' },
        ],
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
    expect(
      byId.get(fileNote.id)?.suggestions.map((suggestion) => suggestion.placement),
    ).toStrictEqual([
      { kind: 'current', path: 'src/app.ts', startLine: 7, endLine: 8 },
      { kind: 'outdated', reason: 'lines-changed' },
    ]);
    expect(changes).toContain(sessionId);

    okValueFrom(
      await services.ura.editMany({ itemIds: [replaced.id], change: { kind: 'mark-addressed' } }),
    );
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

  test('deletes a note of any status and restores it to its old place', async ({
    expect,
    services,
    sessionId,
    note,
  }) => {
    const first = await note({ startLine: 2, endLine: 3, title: 'First' });
    const second = await note({ startLine: 2, endLine: 3, title: 'Second' });
    const third = await note({ startLine: 2, endLine: 3, title: 'Third' });
    okValueFrom(
      await services.ura.editMany({ itemIds: [second.id], change: { kind: 'withdraw' } }),
    );

    const deletion = okValueFrom(services.ura.delete({ itemIds: [second.id] }));
    expect(deletion).toStrictEqual({
      deletionId: deletion.deletionId,
      sessionId,
      itemIds: [second.id],
    });
    expect(
      okValueFrom(await services.ura.list({ sessionId })).items.map((item) => item.id),
    ).toStrictEqual([first.id, third.id]);
    expect(services.ura.delete({ itemIds: [second.id] })).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });

    expect(okValueFrom(services.ura.restore({ deletionId: deletion.deletionId }))).toStrictEqual({
      sessionId,
      itemIds: [second.id],
    });
    const listed = okValueFrom(await services.ura.list({ sessionId })).items;
    expect(listed.map((item) => item.id)).toStrictEqual([first.id, second.id, third.id]);
    expect(listed[1]).toMatchObject({ title: 'Second', status: { kind: 'withdrawn' } });
    expect(services.ura.restore({ deletionId: deletion.deletionId })).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
  });

  test('deletes several notes as one deletion and puts them all back in place', async ({
    expect,
    services,
    sessionId,
    note,
  }) => {
    const first = await note({ startLine: 2, endLine: 3, title: 'First' });
    const second = await note({ startLine: 2, endLine: 3, title: 'Second' });
    const third = await note({ startLine: 2, endLine: 3, title: 'Third' });
    const fourth = await note({ startLine: 2, endLine: 3, title: 'Fourth' });
    const ids = async (): Promise<string[]> => {
      return okValueFrom(await services.ura.list({ sessionId })).items.map((item) => item.id);
    };

    expect(services.ura.delete({ itemIds: [first.id, reviewMessageId()] })).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
    await expect(ids()).resolves.toStrictEqual([first.id, second.id, third.id, fourth.id]);

    const deletion = okValueFrom(services.ura.delete({ itemIds: [third.id, first.id] }));
    expect(deletion.itemIds).toStrictEqual([third.id, first.id]);
    await expect(ids()).resolves.toStrictEqual([second.id, fourth.id]);
    okValueFrom(services.ura.restore({ deletionId: deletion.deletionId }));
    await expect(ids()).resolves.toStrictEqual([first.id, second.id, third.id, fourth.id]);
  });

  test('changes the status, label or Blocking of several notes at once, all or none', async ({
    expect,
    services,
    sessionId,
    note,
  }) => {
    const first = await note({ startLine: 2, endLine: 3, title: 'First' });
    const second = await note({ startLine: 2, endLine: 3, title: 'Second' });
    const listed = async (): Promise<readonly UraItemView[]> => {
      return okValueFrom(await services.ura.list({ sessionId })).items;
    };
    const statuses = async (): Promise<string[]> => {
      const items = await listed();
      return items.map((item) => item.status.kind);
    };
    const labels = async (): Promise<(string | boolean)[][]> => {
      const items = await listed();
      return items.map((item) => {
        return [item.severity, item.blocking];
      });
    };

    okValueFrom(
      await services.ura.editMany({
        itemIds: [first.id],
        change: { kind: 'withdraw' },
      }),
    );
    expect(
      okValueFrom(
        await services.ura.editMany({
          itemIds: [first.id, second.id],
          change: { kind: 'withdraw' },
        }),
      ),
    ).toStrictEqual({ sessionId, itemIds: [second.id] });
    await expect(statuses()).resolves.toStrictEqual(['withdrawn', 'withdrawn']);

    okValueFrom(
      await services.ura.editMany({
        itemIds: [first.id, second.id],
        change: { kind: 'severity', severity: 'nitpick' },
      }),
    );
    okValueFrom(
      await services.ura.editMany({
        itemIds: [second.id, first.id],
        change: { kind: 'blocking', blocking: true },
      }),
    );
    await expect(labels()).resolves.toStrictEqual([
      ['nitpick', true],
      ['nitpick', true],
    ]);

    okValueFrom(
      await services.ura.editMany({
        itemIds: [second.id],
        change: { kind: 'reopen' },
      }),
    );
    await expect(
      services.ura.editMany({
        itemIds: [second.id, first.id],
        change: { kind: 'mark-addressed' },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'refused' } });
    await expect(statuses()).resolves.toStrictEqual(['withdrawn', 'staged']);
  });

  test('moves closed notes straight between addressed and withdrawn', async ({
    expect,
    services,
    sessionId,
    note,
    repo,
  }) => {
    const first = await note({ startLine: 2, endLine: 3, title: 'First' });
    const second = await note({ startLine: 2, endLine: 3, title: 'Second' });
    await repo.git('switch', '--quiet', 'feature');
    repo.write('NOTES.md', 'moved\n');
    await repo.commit('move the head');
    await repo.git('switch', '--quiet', 'main');
    okValueFrom(await services.ura.list({ sessionId }));
    const statuses = async (): Promise<string[]> => {
      const { items } = okValueFrom(await services.ura.list({ sessionId }));
      return items.map((item) => item.status.kind);
    };

    okValueFrom(
      await services.ura.editMany({
        itemIds: [first.id],
        change: { kind: 'mark-addressed' },
      }),
    );
    okValueFrom(
      await services.ura.editMany({
        itemIds: [first.id, second.id],
        change: { kind: 'withdraw' },
      }),
    );
    await expect(statuses()).resolves.toStrictEqual(['withdrawn', 'withdrawn']);
    okValueFrom(
      await services.ura.editMany({
        itemIds: [first.id, second.id],
        change: { kind: 'mark-addressed' },
      }),
    );
    await expect(statuses()).resolves.toStrictEqual(['addressed', 'addressed']);
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
      origin: { kind: 'chat-answer', messageId: reviewMessageId(), finding: 0, confidence: 0.8 },
      anchor: { kind: 'lines', path: 'src/app.ts', startLine: 2, endLine: 2 },
      title: 'Unchecked answer',
      body: 'Check it.',
    });
    const again = okValueFrom(
      await services.ura.stageReviewFinding({ messageId: reviewMessageId(), finding: 0 }),
    );
    expect(again).toStrictEqual({ item: staged.item, created: false });
    expect(okValueFrom(await services.ura.list({ sessionId })).items).toHaveLength(1);

    okValueFrom(
      await services.ura.editMany({ itemIds: [staged.item.id], change: { kind: 'withdraw' } }),
    );
    const restaged = okValueFrom(
      await services.ura.stageReviewFinding({
        messageId: reviewMessageId(),
        finding: 0,
        severity: 'smell',
      }),
    );
    expect(restaged).toMatchObject({
      created: false,
      item: { id: staged.item.id, status: { kind: 'staged' }, severity: 'issue', blocking: false },
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

  test('exports every target and refuses to approve over a blocking note', async ({
    expect,
    services,
    repo,
    sessionId,
    note,
  }) => {
    const head = await repo.git('rev-parse', 'feature');
    await note({ startLine: 2, endLine: 2, title: 'Prefer <const>' });
    const blocking = okValueFrom(
      await services.ura.create({
        sessionId,
        anchor: { kind: 'file', path: 'src/app.ts' },
        severity: 'issue',
        blocking: true,
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
      schema: 'beuve.ura/2',
      change: { scope: 'full', headSha: head, repository: { kind: 'local', headRef: 'feature' } },
      items: [{ title: 'Prefer <const>' }, { severity: 'issue', blocking: true }],
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

    okValueFrom(
      await services.ura.editMany({ itemIds: [blocking.id], change: { kind: 'withdraw' } }),
    );
    expect(
      okValueFrom(await services.ura.export({ sessionId, target: 'github', verdict: 'approve' })),
    ).toMatchObject({ verdict: 'approve', itemCount: 1 });
  });

  test('exports the agent JSON and its XML', async ({ expect, services, sessionId, note }) => {
    await note({ startLine: 5, endLine: 6, title: 'Below the edit' });
    const json = okValueFrom(await services.ura.export({ sessionId, target: 'agent-json' }));
    expect(JSON.parse(json.text)).toMatchObject({
      schema: 'beuve.ura/2',
      verdict: 'comment',
      counts: { issue: 1 },
      items: [{ anchor: { kind: 'lines', path: 'src/app.ts', startLine: 5, endLine: 6 } }],
    });
    const xml = okValueFrom(await services.ura.export({ sessionId, target: 'agent-xml' }));
    expect(xml.text).toContain('<beuve-review schema="beuve.ura/2" verdict="comment"');
    await expect(
      services.ura.export({ sessionId: 'nope', target: 'agent-json' }),
    ).resolves.toMatchObject({ ok: false });
  });

  test('carries the review summary into every export', async ({
    expect,
    services,
    sessionId,
    note,
  }) => {
    await note({ startLine: 5, endLine: 6, title: 'Below the edit' });
    const exported = async (target: 'agent-json' | 'agent-xml' | 'github'): Promise<string> => {
      const view = okValueFrom(
        await services.ura.export({ sessionId, target, summary: '  Mostly **fine**.\n' }),
      );
      return view.text;
    };
    expect(JSON.parse(await exported('agent-json'))).toMatchObject({
      summary: 'Mostly **fine**.',
    });
    await expect(exported('agent-xml')).resolves.toContain(
      '  <summary><![CDATA[Mostly **fine**.]]></summary>\n  <counts',
    );
    expect(JSON.parse(await exported('github'))).toMatchObject({ body: 'Mostly **fine**.' });
    const blank = okValueFrom(
      await services.ura.export({ sessionId, target: 'agent-json', summary: ' \n ' }),
    );
    expect('summary' in (JSON.parse(blank.text) as object)).toBe(false);
  });

  test('persists the reviewer-chosen verdict for exports', async ({
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
      const review = okValueFrom(await services.ura.export({ sessionId, target: 'agent-xml' }));
      return { verdict: review.verdict, text: review.text };
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
    const read = okValueFrom(await services.ura.export({ sessionId, target: 'agent-json' }));
    expect(read.verdict).toBe('comment');

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

  test('clears an approval when a blocking note is staged, says so, and refuses a new one', async ({
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
    const blocking = okValueFrom(
      await services.ura.create({
        sessionId,
        anchor: { kind: 'file', path: 'src/app.ts' },
        severity: 'question',
        blocking: true,
        title: 'Not wired',
        body: '',
      }),
    );

    const listed = okValueFrom(await services.ura.list({ sessionId }));
    expect(listed.chosenVerdict).toBeUndefined();
    expect(listed.derivedVerdict).toBe('request-changes');
    expect(listed.verdictNotice).toContain('Approve verdict was cleared');
    const read = okValueFrom(await services.ura.export({ sessionId, target: 'agent-json' }));
    expect(read.verdict).toBe('request-changes');
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

    okValueFrom(
      await services.ura.editMany({ itemIds: [blocking.id], change: { kind: 'withdraw' } }),
    );
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

/** What the agent export says of the human review: its verdict and its text. */
interface ReadReview {
  readonly verdict: unknown;
  readonly text: string;
}
