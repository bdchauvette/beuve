import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { numberedLines } from './testing/numbered-lines.ts';
import { test } from './testing/test.ts';

/** Review edits through `createMainServices` with real git and a fake editor (ADR 0088). */
describe('createReviewEditsServices (integration: git + SQLite, no Electron)', () => {
  test('opens a writable branch at the reviewed head, in its own 0700 worktree', async ({
    expect,
    services,
    sessionId,
    repo,
    launches,
  }) => {
    const head = await repo.git('rev-parse', 'feature');
    await expect(services.reviewEdits.get({ sessionId })).resolves.toMatchObject({
      ok: true,
      value: { exists: false, branch: `review/session-${sessionId.slice(0, 8)}` },
    });
    const opened = okValueFrom(
      await services.reviewEdits.open({ sessionId, path: 'src/a.ts', line: 3 }),
    );
    expect(opened).toMatchObject({ editorName: 'Zed', created: true });
    expect(launches.spawned).toStrictEqual([[`${opened.path}/src/a.ts:3:1`]]);
    expect(opened.path).toContain(`${path.sep}review-edits${path.sep}`);
    expect(statSync(opened.path).mode & 0o777).toBe(0o700);
    await expect(repo.git('rev-parse', `refs/heads/${opened.branch}`)).resolves.toBe(head);
    await expect(repo.git('rev-parse', '--abbrev-ref', 'HEAD')).resolves.toBe('main');

    writeFileSync(path.join(opened.path, 'src/a.ts'), numberedLines({ 3: 'THREE', 4: 'four' }));
    await expect(services.reviewEdits.get({ sessionId })).resolves.toMatchObject({
      ok: true,
      value: { exists: true, path: opened.path, files: 1, commits: 0, isOnSessionHead: true },
    });
    const again = okValueFrom(await services.reviewEdits.open({ sessionId, path: 'src/a.ts' }));
    expect(again).toStrictEqual({ ...opened, created: false });
    expect(readFileSync(path.join(opened.path, 'src/a.ts'), 'utf8')).toContain('THREE');
  });

  test('refuses a branch of that name that is not beuve’s for the session', async ({
    expect,
    services,
    sessionId,
    repo,
  }) => {
    await repo.git('branch', `review/session-${sessionId.slice(0, 8)}`, 'main');
    await expect(services.reviewEdits.open({ sessionId, path: 'src/a.ts' })).resolves.toMatchObject(
      {
        ok: false,
        error: { code: 'refused', message: expect.stringContaining('already exists') as string },
      },
    );
  });

  test('turns every region into a suggestion of one note per file, and new files into notes, once', async ({
    expect,
    services,
    sessionId,
    repo,
  }) => {
    const opened = okValueFrom(await services.reviewEdits.open({ sessionId, path: 'src/a.ts' }));
    writeFileSync(
      path.join(opened.path, 'src/a.ts'),
      numberedLines({ 3: 'THREE', 4: 'four', 8: 'eight, edited' }),
    );
    writeFileSync(path.join(opened.path, 'src/new.ts'), 'export const n = 1;\n');
    const indexBefore = await repo.git('-C', opened.path, 'status', '--porcelain');

    const plan = okValueFrom(await services.reviewEdits.previewSuggestions({ sessionId }));
    expect(
      plan.edits.map((edit) => {
        return [edit.action, edit.kind, edit.title];
      }),
    ).toStrictEqual([
      ['create', 'suggestions', 'Suggested changes to `src/a.ts`'],
      ['create', 'note', 'New file `src/new.ts`'],
    ]);
    expect(plan.edits[0]?.suggestions).toMatchObject([
      { path: 'src/a.ts', startLine: 3, endLine: 3 },
      { path: 'src/a.ts', startLine: 8, endLine: 8 },
    ]);
    await expect(services.ura.list({ sessionId })).resolves.toMatchObject({
      ok: true,
      value: { items: [] },
    });

    await expect(
      services.reviewEdits.stageSuggestions({ sessionId, digest: plan.digest }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { created: 2, attached: 0, updated: 0, unchanged: 0 },
    });
    const { items } = okValueFrom(await services.ura.list({ sessionId }));
    expect(
      items.map((item) => {
        return [item.anchor, item.severity, item.suggestions.length, item.body.includes('```diff')];
      }),
    ).toStrictEqual([
      [{ kind: 'lines', path: 'src/a.ts', startLine: 3, endLine: 3 }, 'suggestion', 2, false],
      [{ kind: 'change' }, 'issue', 0, true],
    ]);
    expect(items[0]?.suggestions).toMatchObject([
      { path: 'src/a.ts', startLine: 3, endLine: 3, replacement: 'THREE' },
      { path: 'src/a.ts', startLine: 8, endLine: 8, replacement: 'eight, edited' },
    ]);
    expect(items[0]?.suggestions[0]?.patch).toContain('-three\n+THREE\n');

    const second = okValueFrom(await services.reviewEdits.previewSuggestions({ sessionId }));
    expect(second.edits.map((edit) => edit.action)).toStrictEqual(['unchanged', 'unchanged']);
    await expect(
      services.reviewEdits.stageSuggestions({ sessionId, digest: second.digest }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { created: 0, attached: 0, updated: 0, unchanged: 2 },
    });
    expect(okValueFrom(await services.ura.list({ sessionId })).items).toHaveLength(2);
    await expect(repo.git('-C', opened.path, 'status', '--porcelain')).resolves.toBe(indexBefore);
    await expect(repo.git('rev-parse', `refs/heads/${opened.branch}`)).resolves.toBe(
      await repo.git('rev-parse', 'feature'),
    );
  });

  test('attaches a suggestion to a staged note on those lines, and refuses a stale preview', async ({
    expect,
    services,
    sessionId,
  }) => {
    const note = okValueFrom(
      await services.ura.create({
        sessionId,
        anchor: { kind: 'lines', path: 'src/a.ts', startLine: 3, endLine: 4 },
        severity: 'issue',
        title: 'These names',
        body: 'Capitalize?',
      }),
    );
    const opened = okValueFrom(await services.reviewEdits.open({ sessionId, path: 'src/a.ts' }));
    writeFileSync(path.join(opened.path, 'src/a.ts'), numberedLines({ 3: 'THREE', 4: 'FOUR' }));
    const plan = okValueFrom(await services.reviewEdits.previewSuggestions({ sessionId }));
    expect(
      plan.edits.map((edit) => {
        return [edit.action, edit.kind];
      }),
    ).toStrictEqual([['attach', 'suggestions']]);
    writeFileSync(path.join(opened.path, 'src/a.ts'), numberedLines({ 3: 'Three', 4: 'FOUR' }));
    await expect(
      services.reviewEdits.stageSuggestions({ sessionId, digest: plan.digest }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'refused' } });

    const fresh = okValueFrom(await services.reviewEdits.previewSuggestions({ sessionId }));
    await expect(
      services.reviewEdits.stageSuggestions({ sessionId, digest: fresh.digest }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { created: 0, attached: 1, updated: 0, unchanged: 0 },
    });
    const [item] = okValueFrom(await services.ura.list({ sessionId })).items;
    expect(item).toMatchObject({ id: note.id, title: 'These names', body: 'Capitalize?' });
    expect(item?.suggestions[0]?.patch).toContain('-three\n-four\n+Three\n+FOUR\n');
  });

  test('discards only what the confirmation showed, then the branch and worktree are gone', async ({
    expect,
    services,
    sessionId,
    repo,
  }) => {
    const opened = okValueFrom(await services.reviewEdits.open({ sessionId, path: 'src/a.ts' }));
    writeFileSync(path.join(opened.path, 'src/b.ts'), 'export const b = 2;\n');
    const loss = okValueFrom(await services.reviewEdits.previewDiscard({ sessionId }));
    expect(loss).toMatchObject({ commits: 0, files: ['src/b.ts'] });
    writeFileSync(path.join(opened.path, 'src/c.ts'), 'more\n');
    await expect(
      services.reviewEdits.discard({ sessionId, digest: loss.digest }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'refused' } });
    expect(existsSync(path.join(opened.path, 'src/c.ts'))).toBe(true);

    const now = okValueFrom(await services.reviewEdits.previewDiscard({ sessionId }));
    await expect(
      services.reviewEdits.discard({ sessionId, digest: now.digest }),
    ).resolves.toStrictEqual({ ok: true, value: { branch: opened.branch } });
    expect(existsSync(opened.path)).toBe(false);
    await expect(repo.git('branch', '--list', opened.branch)).resolves.toBe('');
    await expect(services.reviewEdits.get({ sessionId })).resolves.toMatchObject({
      ok: true,
      value: { exists: false },
    });
  });

  test('keeps the edits when the head moves, and anchors them to the reviewed head', async ({
    expect,
    services,
    sessionId,
    repo,
    signal,
  }) => {
    const reviewed = await repo.git('rev-parse', 'feature');
    const opened = okValueFrom(await services.reviewEdits.open({ sessionId, path: 'src/a.ts' }));
    writeFileSync(path.join(opened.path, 'src/a.ts'), numberedLines({ 3: 'THREE', 4: 'four' }));
    await repo.git('switch', '--quiet', 'feature');
    repo.write('src/b.ts', 'export const b = 3;\n');
    await repo.commit('more');
    await repo.git('switch', '--quiet', 'main');
    await services.sessions.getReview({ sessionId }, { signal });
    await expect(services.reviewEdits.get({ sessionId })).resolves.toMatchObject({
      ok: true,
      value: { exists: true, baseSha: reviewed, isOnSessionHead: false, files: 1 },
    });
    const plan = okValueFrom(await services.reviewEdits.previewSuggestions({ sessionId }));
    expect(plan.headSha).toBe(reviewed);
    expect(readFileSync(path.join(opened.path, 'src/a.ts'), 'utf8')).toContain('THREE');
  });
});
