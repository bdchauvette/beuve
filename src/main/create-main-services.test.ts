import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import type { CallHierarchyRequest, ReviewView } from '#contract/ipc-contract.ts';
import { pullRequestStackTemplate } from '#internal/git/testing/pull-request-stack-template.ts';
import { setLine } from '#internal/git/testing/set-line.ts';
import type { RepositoryTemplate, TestRepository } from '#internal/git/testing/test-repository.ts';
import type { TestRepositories } from '#internal/git/testing/test.ts';
import type { ImpactReport } from '#internal/impact/impact-report.ts';
import type { RecordingLogger } from '#testing/test.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';
import type { Result } from '#x/result/result.ts';

import { createImpactWorker } from './impact/create-impact-worker.ts';
import type { ImpactRunFailure, ImpactRunner } from './impact/create-impact-worker.ts';
import type { MainServices } from './main-services.ts';
import { lines } from './testing/lines.ts';
import { test } from './testing/test.ts';
import type { CreateServices } from './testing/test.ts';

describe('createMainServices (integration: SQLite + git, no Electron)', { timeout: 30_000 }, () => {
  test('reviews a branch in full, then only the amendment after a rebase', async ({
    expect,
    services: { sessions },
    repositories,
    signal,
  }) => {
    const {
      repo,
      value: { mergeBase },
    } = await repositories.fromTemplate(featureBranchTemplate());
    const created = okValueFrom(
      await sessions.createLocal({ repoPath: repo.directory, baseRef: 'main', headRef: 'feature' }),
    );
    expect(created.source).toStrictEqual({
      kind: 'local',
      repoPath: repo.directory,
      baseRef: 'main',
      headRef: 'feature',
    });
    const again = okValueFrom(
      await sessions.createLocal({ repoPath: repo.directory, baseRef: 'main', headRef: 'feature' }),
    );
    expect(again.id).toBe(created.id);
    expect(okValueFrom(sessions.list()).map(({ id }) => id)).toStrictEqual([created.id]);

    const full = okValueFrom(await sessions.getReview({ sessionId: created.id }, { signal }));
    expect(full.scope).toStrictEqual({ kind: 'full' });
    expect(full.baseSha).toBe(mergeBase);
    expect(fileSummary(full)).toStrictEqual([
      ['app.rs', 'modified', 1, 1],
      ['feature.rs', 'added', 3, 0],
    ]);
    expect(full.files[1]?.patch).toContain('+  1\n');

    const reviewed = okValueFrom(
      await sessions.markReviewed({ sessionId: created.id, expectedHeadSha: full.headSha }),
    );
    expect(reviewed.lastReviewedSha).toBe(full.headSha);
    const upToDate = okValueFrom(await sessions.getReview({ sessionId: created.id }, { signal }));
    expect(upToDate).toMatchObject({ scope: { kind: 'up-to-date' }, files: [] });

    const newBase = await upstreamAdvances(repo);
    await repo.git('switch', '--quiet', 'feature');
    await repo.git('rebase', '--quiet', 'main');
    repo.write('feature.rs', lines(featureLines().with(1, '  42')));
    await repo.git('commit', '--quiet', '--amend', '--no-edit', '--all');
    const newHead = await repo.git('rev-parse', 'feature');

    const interdiff = okValueFrom(await sessions.getReview({ sessionId: created.id }, { signal }));
    expect(interdiff.headSha).toBe(newHead);
    expect(interdiff.baseSha).toBe(newBase);
    expect(interdiff.session.headSha).toBe(newHead);
    expect(interdiff.scope).toStrictEqual({
      kind: 'interdiff',
      fromBaseSha: mergeBase,
      fromHeadSha: full.headSha,
      outcome: { kind: 'rebased' },
    });
    expect(fileSummary(interdiff)).toStrictEqual([['feature.rs', 'modified', 1, 1]]);
    expect(interdiff.files[0]?.patch).toContain('\n-  1\n+  42\n');

    await expect(
      sessions.markReviewed({ sessionId: created.id, expectedHeadSha: full.headSha }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'stale-review' } });
    okValueFrom(await sessions.markReviewed({ sessionId: created.id, expectedHeadSha: newHead }));
    expect(
      okValueFrom(await sessions.getReview({ sessionId: created.id }, { signal })),
    ).toMatchObject({
      scope: { kind: 'up-to-date' },
      baseSha: newBase,
      files: [],
    });
    expect(okValueFrom(sessions.list()).find(({ id }) => id === created.id)?.lastReviewedSha).toBe(
      newHead,
    );
  });

  test('shows an exact interdiff when the author pushes on an unmoved base', async ({
    expect,
    services: { sessions },
    repositories,
    signal,
  }) => {
    const { repo } = await repositories.fromTemplate(featureBranchTemplate());
    const { id } = okValueFrom(
      await sessions.createLocal({ repoPath: repo.directory, baseRef: 'main', headRef: 'feature' }),
    );
    okValueFrom(
      await sessions.markReviewed({
        sessionId: id,
        expectedHeadSha: await repo.git('rev-parse', 'feature'),
      }),
    );
    await repo.git('switch', '--quiet', 'feature');
    repo.write('notes.md', 'follow-up\n');
    await repo.commit('follow-up');

    const review = okValueFrom(await sessions.getReview({ sessionId: id }, { signal }));
    expect(review.scope).toMatchObject({ kind: 'interdiff', outcome: { kind: 'exact' } });
    expect(fileSummary(review)).toStrictEqual([['notes.md', 'added', 1, 0]]);
  });

  test('diffs a separately cached whitespace-ignoring variant with the same head lines', async ({
    expect,
    services,
    repo,
    signal,
  }) => {
    const { sessions } = services;
    repo.write('app.py', lines(['def run():', '  x=1', '  return x', '']));
    repo.write('spaces.txt', lines(['one']));
    await repo.commit('base');
    await repo.git('switch', '--quiet', '--create', 'feature');
    repo.write('app.py', lines(['def run():', '    x = 1', '    return x', '', 'run()']));
    repo.write('spaces.txt', lines(['one   ']));
    await repo.commit('reindent, then call');
    await repo.git('switch', '--quiet', 'main');
    const { id } = okValueFrom(
      await sessions.createLocal({ repoPath: repo.directory, baseRef: 'main', headRef: 'feature' }),
    );
    const shown = okValueFrom(await sessions.getReview({ sessionId: id }, { signal }));
    expect(shown.whitespace).toBe('shown');
    expect(fileSummary(shown)).toStrictEqual([
      ['app.py', 'modified', 3, 2],
      ['spaces.txt', 'modified', 1, 1],
    ]);
    const ignored = okValueFrom(
      await sessions.getReview({ sessionId: id, ignoreWhitespace: true }, { signal }),
    );
    expect(ignored.whitespace).toBe('ignored');
    expect(ignored.headSha).toBe(shown.headSha);
    expect(fileSummary(ignored)).toStrictEqual([['app.py', 'modified', 1, 0]]);
    expect(ignored.files[0]?.hunks).toStrictEqual([
      expect.objectContaining({ newStart: 2, newCount: 4 }),
    ]);
    expect(ignored.files[0]?.patch).toContain('\n+run()\n');
    expect(ignored.files[0]?.patch).toContain('\n     x = 1\n');

    const item = okValueFrom(
      await services.ura.create({
        sessionId: id,
        headSha: shown.headSha,
        anchor: { kind: 'lines', path: 'app.py', startLine: 5, endLine: 5 },
        severity: 'nit',
        title: 'Guard the call',
        body: '',
      }),
    );
    expect(item.placement).toStrictEqual({ kind: 'current', anchor: item.anchor });
    okValueFrom(await sessions.getReview({ sessionId: id, ignoreWhitespace: true }, { signal }));
    expect(
      okValueFrom(await services.ura.list({ sessionId: id })).items[0]?.placement,
    ).toStrictEqual({
      kind: 'current',
      anchor: { kind: 'lines', path: 'app.py', startLine: 5, endLine: 5 },
    });

    okValueFrom(await sessions.markReviewed({ sessionId: id, expectedHeadSha: shown.headSha }));
    await repo.git('switch', '--quiet', 'feature');
    repo.write('app.py', lines(['def run():', '\tx = 1', '\treturn x', '', 'run()', 'run()']));
    await repo.commit('tabs, and call twice');
    await repo.git('switch', '--quiet', 'main');
    const interdiff = okValueFrom(await sessions.getReview({ sessionId: id }, { signal }));
    expect(fileSummary(interdiff)).toStrictEqual([['app.py', 'modified', 3, 2]]);
    const quiet = okValueFrom(
      await sessions.getReview({ sessionId: id, ignoreWhitespace: true }, { signal }),
    );
    expect(quiet.scope).toMatchObject({ kind: 'interdiff', outcome: { kind: 'exact' } });
    expect(fileSummary(quiet)).toStrictEqual([['app.py', 'modified', 1, 0]]);
    expect(quiet.files[0]?.hunks).toStrictEqual([
      expect.objectContaining({ newStart: 3, newCount: 4 }),
    ]);
  });

  test('reviews a stacked child after its parent is squash-merged and it is retargeted', async ({
    expect,
    services: { sessions },
    repositories,
    signal,
  }) => {
    const { repo, value: stack } = await repositories.fromTemplate(pullRequestStackTemplate);
    await repo.git('update-ref', 'refs/review/base', 'pr1');
    const { id } = okValueFrom(
      await sessions.createLocal({
        repoPath: repo.directory,
        baseRef: 'refs/review/base',
        headRef: 'pr2',
      }),
    );
    const full = okValueFrom(await sessions.getReview({ sessionId: id }, { signal }));
    expect(fileSummary(full)).toStrictEqual([['b.txt', 'modified', 2, 2]]);
    okValueFrom(await sessions.markReviewed({ sessionId: id, expectedHeadSha: full.headSha }));

    await repo.git('switch', '--quiet', 'main');
    await repo.git('merge', '--quiet', '--squash', 'pr1');
    await repo.commit('pr1 (#1)');
    await repo.git('update-ref', 'refs/review/base', 'main');
    await repo.git('switch', '--quiet', 'pr2');
    setLine(repo, { file: 'b.txt', line: 25, content: 'pr2-b25' });
    const fixup = await repo.commit('pr2: b25');

    const retargeted = okValueFrom(await sessions.getReview({ sessionId: id }, { signal }));
    expect(retargeted.scope).toMatchObject({ kind: 'interdiff', outcome: { kind: 'exact' } });
    expect(retargeted.baseSha).toBe(stack.pr1[1]);
    expect(retargeted.forkPoint).toStrictEqual({
      reason: 'already-upstream',
      mergeBaseSha: stack.root,
      skippedCommits: 2,
    });
    expect(fileSummary(retargeted)).toStrictEqual([['b.txt', 'modified', 1, 1]]);
    expect(
      retargeted.commitPairs?.map(({ kind, subject }) => {
        return [kind, subject];
      }),
    ).toStrictEqual([
      ['unchanged', 'pr2: b5'],
      ['unchanged', 'pr2: b20'],
      ['added', 'pr2: b25'],
    ]);
    expect(retargeted.fileAttribution).toStrictEqual([
      { path: 'b.txt', pairIds: [stack.pr2[0], stack.pr2[1], fixup], hunkPairIds: [[fixup]] },
    ]);

    okValueFrom(await sessions.markReviewed({ sessionId: id, expectedHeadSha: fixup }));
    await repo.git('rebase', '--quiet', '--onto', 'main', stack.pr1[1] ?? '', 'pr2');
    const rebased = okValueFrom(await sessions.getReview({ sessionId: id }, { signal }));
    expect(rebased.scope).toMatchObject({ kind: 'interdiff', outcome: { kind: 'rebased' } });
    expect(rebased.files).toStrictEqual([]);
    expect(rebased.forkPoint).toBeUndefined();
    expect(rebased.commitPairs?.map(({ kind }) => kind)).toStrictEqual([
      'unchanged',
      'unchanged',
      'unchanged',
    ]);
  });

  test('refuses directories outside a repository and unknown refs with typed errors', async ({
    expect,
    services: { sessions },
    repositories,
    tempDir,
    signal,
  }) => {
    const { repo } = await repositories.fromTemplate(featureBranchTemplate());
    const outside = tempDir;
    await expect(
      sessions.createLocal({ repoPath: outside, baseRef: 'main', headRef: 'HEAD' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not-a-repository' } });
    await expect(
      sessions.createLocal({ repoPath: repo.directory, baseRef: 'main', headRef: 'nope' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'unknown-revision' } });
    await expect(
      sessions.createLocal({ repoPath: 'relative', baseRef: 'main', headRef: 'HEAD' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-request' } });
    await expect(
      sessions.getReview({ sessionId: 'not-a-uuid' }, { signal }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
    await expect(
      sessions.getReview({ sessionId: '00000000-0000-4000-8000-000000000000' }, { signal }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(okValueFrom(sessions.list())).toStrictEqual([]);
  });
});

describe('createMainServices (integration: ImpactGate, worktrees and typescript-language-server)', () => {
  test(
    'reports the added complex function as the one introduced finding, cached per diff',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, services, repositories, signal }) => {
      const { sessionId } = await openTypescriptSession(services, repositories);
      const review = okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));
      const impact = okValueFrom(await services.impact.getImpact({ sessionId }, { signal }));
      expect(impact).toMatchObject({ baseSha: review.baseSha, headSha: review.headSha });
      expect(impact.findings).toStrictEqual([
        expect.objectContaining({
          path: 'src/complex.ts',
          functionName: 'handleAuth',
          trend: 'introduced',
          limit: 15,
          startLine: 3,
        }),
      ]);
      expect(impact.findings[0]?.value).toBeGreaterThan(15);
      expect(
        impact.files.map((file) => {
          return [file.path, file.status];
        }),
      ).toStrictEqual([
        ['notes.md', 'skipped'],
        ['src/auth.ts', 'analyzed'],
        ['src/broken.ts', 'analyzed'],
        ['src/complex.ts', 'analyzed'],
      ]);
      expect(impact.files[0]).toMatchObject({ reason: 'unsupported-language' });
      const auth = impact.files[1];
      expect(auth?.status === 'analyzed' && auth.functions).toStrictEqual([
        expect.objectContaining({ name: 'validate', change: 'modified', inDiff: true }),
      ]);
      await expect(services.impact.getImpact({ sessionId }, { signal })).resolves.toStrictEqual({
        ok: true,
        value: impact,
      });
    },
  );

  test(
    'answers MCP diagnostics with 1-based lines from a checkout of the session head',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, services, repositories, worktreeRoot }) => {
      const { sessionId, repo } = await openTypescriptSession(services, repositories);
      const outcome = await services.mcpTools.getLspDiagnostics({ path: 'src/broken.ts' });
      expect(outcome).toMatchObject({
        ok: true,
        value: {
          sessionId,
          path: 'src/broken.ts',
          serverId: 'typescript',
          diagnostics: [
            { line: 1, column: 14, severity: 'error', code: '2322', source: 'typescript' },
          ],
        },
      });
      const clean = await services.mcpTools.getLspDiagnostics({ sessionId, path: 'src/auth.ts' });
      expect(clean).toMatchObject({ ok: true, value: { diagnostics: [] } });
      await expect(repo.git('status', '--porcelain')).resolves.toBe('');
      await expect(repo.git('branch', '--show-current')).resolves.toBe('main');
      expect(checkouts(worktreeRoot)).toStrictEqual([await repo.git('rev-parse', 'feature')]);
    },
  );

  test(
    'lists the callers of a modified callee, badged against the review diff',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, services, repositories }) => {
      const { sessionId, headSha } = await openTypescriptSession(services, repositories);
      const request = (): CallHierarchyRequest => {
        return {
          sessionId,
          expectedHeadSha: headSha,
          path: 'src/handler.ts',
          line: 1,
          direction: 'incoming',
        };
      };
      const hierarchy = okValueFrom(
        await services.lsp.callHierarchy({
          sessionId,
          expectedHeadSha: headSha,
          path: 'src/auth.ts',
          line: 2,
          direction: 'incoming',
        }),
      );
      expect(hierarchy.root).toMatchObject({
        name: 'validate',
        badge: 'modified',
        file: { kind: 'workspace', path: 'src/auth.ts' },
        startLine: 1,
      });
      const callers = hierarchy.calls
        .map((call) => {
          return [call.node.name, call.node.badge, call.callSiteLines] as const;
        })
        .toSorted(([a], [b]) => a.localeCompare(b));
      expect(callers).toStrictEqual([
        ['handleAuth', 'modified', [8]],
        ['handleRequest', 'untouched', [4]],
      ]);
      const handler = hierarchy.calls.find((call) => call.node.name === 'handleRequest');
      const outer = okValueFrom(
        await services.lsp.callHierarchy({
          sessionId,
          expectedHeadSha: headSha,
          path: 'src/handler.ts',
          line: 1,
          direction: 'incoming',
          nodeId: handler?.node.id ?? '',
        }),
      );
      expect(
        outer.calls.map((call) => {
          return [call.node.name, call.node.badge];
        }),
      ).toStrictEqual([['serve', 'untouched']]);
      await expect(
        services.lsp.callHierarchy({
          sessionId,
          expectedHeadSha: headSha,
          path: 'src/auth.ts',
          line: 5,
          direction: 'incoming',
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
      const added = okValueFrom(
        await services.lsp.callHierarchy({
          sessionId,
          expectedHeadSha: headSha,
          path: 'src/complex.ts',
          line: 1,
          direction: 'incoming',
        }),
      );
      expect(added).toMatchObject({ root: { name: 'handleAuth', badge: 'modified' }, calls: [] });
      expect(hierarchy.headSha).toBe(headSha);
      const stale = { ...request(), expectedHeadSha: 'f'.repeat(40) };
      await expect(services.lsp.callHierarchy(stale)).resolves.toMatchObject({
        ok: false,
        error: { code: 'stale-review' },
      });
      await expect(
        services.lsp.callHierarchy({ ...stale, nodeId: handler?.node.id ?? '' }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'stale-review' } });
    },
  );

  test(
    'jumps to definitions at the head and at an older pinned commit, and reads sheets there',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, services, repositories, worktreeRoot, signal }) => {
      const { sessionId, repo } = await openTypescriptSession(services, repositories);
      const [head, base] = await Promise.all([
        repo.git('rev-parse', 'feature'),
        repo.git('rev-parse', 'main'),
      ]);
      const atHead = okValueFrom(
        await services.lsp.definition({ sessionId, path: 'src/handler.ts', line: 4 }),
      );
      expect(atHead).toStrictEqual({
        sha: head,
        token: { startLine: 4, startCharacter: 9, endLine: 4, endCharacter: 17, text: 'validate' },
        targets: [
          {
            file: { kind: 'workspace', path: 'src/auth.ts' },
            startLine: 1,
            startCharacter: 16,
            endLine: 1,
            endCharacter: 24,
          },
        ],
      });
      const atBase = okValueFrom(
        await services.lsp.definition({ sessionId, sha: base, path: 'src/handler.ts', line: 3 }),
      );
      expect(atBase.sha).toBe(base);
      expect(atBase.token?.text).toBe('token');
      expect(new Set(checkouts(worktreeRoot))).toStrictEqual(new Set([base, head]));
      const own = okValueFrom(
        await services.lsp.definition({
          sessionId,
          path: 'src/handler.ts',
          line: 7,
          character: 18,
        }),
      );
      expect(own.targets).toMatchObject([{ file: { path: 'src/handler.ts' }, startLine: 7 }]);
      await expect(
        services.lsp.definition({ sessionId, sha: base, path: 'src/complex.ts', line: 1 }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });

      const sheet = okValueFrom(
        await services.sheets.getFile({ sessionId, sha: head, path: 'src/auth.ts' }, { signal }),
      );
      expect(sheet).toMatchObject({
        sha: head,
        headSha: head,
        baseSha: base,
        marks: { added: [], modified: [{ startLine: 2, endLine: 2 }], deletedAt: [] },
        notes: [],
      });
      expect(sheet.contents).toContain('token.length > 8');
      const old = okValueFrom(
        await services.sheets.getFile({ sessionId, sha: base, path: 'src/auth.ts' }, { signal }),
      );
      expect(old).toMatchObject({ sha: base, headSha: head, marks: { modified: [] } });
      expect(old.contents).toContain('token.length > 0');
    },
  );

  test(
    'links to a file at a commit on the primary remote',
    { timeout: 30_000 },
    async ({ expect, services, repositories }) => {
      const { sessionId, repo } = await openTypescriptSession(services, repositories);
      const base = await repo.git('rev-parse', 'main');
      const request = { sessionId, sha: base, path: 'src/auth.ts', startLine: 1, endLine: 2 };
      await expect(services.remote.permalink(request)).resolves.toStrictEqual({
        ok: true,
        value: { kind: 'no-remote' },
      });
      await repo.git('remote', 'add', 'backup', repo.scratch());
      await repo.git('remote', 'add', 'github', 'git@github.com:octo/handler.git');
      await expect(services.remote.permalink(request)).resolves.toStrictEqual({
        ok: true,
        value: {
          kind: 'link',
          remote: 'github',
          url: `https://github.com/octo/handler/blob/${base}/src/auth.ts#L1-L2`,
        },
      });
      await expect(services.remote.openPermalink(request)).resolves.toMatchObject({
        ok: false,
        error: { code: 'not-wired' },
      });
    },
  );

  test(
    'moves the session checkout when the head moves, and prunes it on startup',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, services, repositories, worktreeRoot, signal }) => {
      const { sessionId, repo } = await openTypescriptSession(services, repositories);
      const before = await repo.git('rev-parse', 'feature');
      await repo.git('switch', '--quiet', 'feature');
      repo.write('src/broken.ts', lines(['export const answer: number = 42;']));
      const after = await repo.commit('fix the type error');
      await repo.git('switch', '--quiet', 'main');

      const outcome = await services.mcpTools.getLspDiagnostics({
        sessionId,
        path: path.join(repo.directory, 'src/broken.ts'),
      });
      expect(outcome).toMatchObject({ ok: true, value: { headSha: after, diagnostics: [] } });
      expect(checkouts(worktreeRoot)).toStrictEqual([after]);
      expect(after).not.toBe(before);

      const impact = okValueFrom(await services.impact.getImpact({ sessionId }, { signal }));
      expect(impact.headSha).toBe(after);

      await repo.git(
        'worktree',
        'add',
        '--quiet',
        '--detach',
        path.join(worktreeRoot, 'stray', before),
        before,
      );
      await services.pruneWorktrees();
      expect(checkouts(worktreeRoot)).toStrictEqual([after]);
      expect(readdirSync(worktreeRoot)).toHaveLength(1);
    },
  );
});

/**
 * main: a TypeScript project with `validate` and its caller `handleRequest`. feature: changes
 * `validate`, adds `handleAuth` (cognitive complexity 23) calling it, a type error and a note.
 */
async function typescriptBranch(repo: TestRepository): Promise<void> {
  repo.write(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'es2022',
        module: 'esnext',
        noEmit: true,
        types: [],
      },
      include: ['src'],
    }),
  );
  repo.write(
    'src/auth.ts',
    lines([
      'export function validate(token: string): boolean {',
      '  return token.length > 0;',
      '}',
    ]),
  );
  repo.write(
    'src/handler.ts',
    lines([
      "import { validate } from './auth';",
      '',
      'export function handleRequest(token: string): number {',
      '  return validate(token) ? 200 : 401;',
      '}',
      '',
      'export function serve(): number {',
      "  return handleRequest('t');",
      '}',
    ]),
  );
  await repo.commit('base');
  await repo.git('switch', '--quiet', '--create', 'feature');
  repo.write(
    'src/auth.ts',
    lines([
      'export function validate(token: string): boolean {',
      '  return token.length > 8;',
      '}',
    ]),
  );
  repo.write('src/complex.ts', lines(complexSource()));
  repo.write('src/broken.ts', lines(["export const answer: number = 'forty-two';"]));
  repo.write('notes.md', lines(['# notes']));
  await repo.commit('add auth handling');
  await repo.git('switch', '--quiet', 'main');
}

function complexSource(): string[] {
  return [
    "import { validate } from './auth';",
    '',
    'export function handleAuth(user: string, token: string, roles: readonly string[]): string {',
    '  if (user !== "") {',
    '    if (token !== "") {',
    '      for (const role of roles) {',
    "        if (role === 'admin') {",
    "          if (validate(token) && user !== 'root') {",
    "            return 'admin';",
    '          } else if (role.length > 3) {',
    '            continue;',
    '          }',
    '        } else {',
    '          while (role.length > 10) {',
    '            break;',
    '          }',
    '        }',
    '      }',
    '    }',
    '  }',
    "  return 'none';",
    '}',
  ];
}

/** The commit directories under the worktree root (`<root>/<repo>/<commit>`). */
function checkouts(root: string): string[] {
  return readdirSync(root).flatMap((repository) => readdirSync(path.join(root, repository)));
}

interface TypescriptSession {
  readonly repo: TestRepository;
  readonly sessionId: string;
  readonly headSha: string;
}

/** A session reviewing {@link typescriptBranch}, with the services around it. */
async function openTypescriptSession(
  services: MainServices,
  repositories: TestRepositories,
): Promise<TypescriptSession> {
  const { repo } = await repositories.fromTemplate(typescriptBranchTemplate());
  const created = await services.sessions.createLocal({
    repoPath: repo.directory,
    baseRef: 'main',
    headRef: 'feature',
  });
  const { id, headSha } = okValueFrom(created);
  return { repo, sessionId: id, headSha };
}

function typescriptBranchTemplate(): RepositoryTemplate<undefined> {
  return {
    name: 'main: typescript branch',
    build: async (repo): Promise<undefined> => {
      await typescriptBranch(repo);
    },
  };
}

function featureBranchTemplate(): RepositoryTemplate<{ readonly mergeBase: string }> {
  return { name: 'main: feature branch', build: featureBranch };
}

/** main: app.rs + lib.rs; feature: edits app.rs, adds feature.rs. Leaves main checked out. */
async function featureBranch(repo: TestRepository): Promise<{ mergeBase: string }> {
  repo.write('app.rs', lines(['fn main() {', '  run();', '}']));
  repo.write('lib.rs', lines(['pub fn lib() {}']));
  const mergeBase = await repo.commit('base');
  await repo.git('switch', '--quiet', '--create', 'feature');
  repo.write('app.rs', lines(['fn main() {', '  run_fast();', '}']));
  await repo.commit('speed up');
  repo.write('feature.rs', lines(featureLines()));
  await repo.commit('add feature');
  await repo.git('switch', '--quiet', 'main');
  return { mergeBase };
}

async function upstreamAdvances(repo: TestRepository): Promise<string> {
  await repo.git('switch', '--quiet', 'main');
  repo.write('lib.rs', lines(['pub fn lib() {}', 'pub fn more() {}']));
  await repo.commit('upstream lib');
  repo.write('upstream.rs', lines(['// unrelated']));
  return await repo.commit('upstream file');
}

function fileSummary(review: ReviewView): [string, string, number, number][] {
  return review.files.map((file) => {
    return [file.path, file.status, file.additions, file.deletions];
  });
}

describe('createMainServices (integration: ImpactGate in a worker thread)', () => {
  test(
    'answers other channels while a large computation runs, then ships the slim view',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, createServices, repositories, logger, signal }) => {
      const { services, sessionId } = await openLargeSession(createServices, repositories, logger);
      const computing = services.impact.getImpactForRenderer({ sessionId }, { signal });
      const review = await services.sessions.getReview({ sessionId }, { signal });
      expect(review.ok).toBe(true);
      const state = await Promise.race([computing, Promise.resolve('pending')]);
      expect(state).toBe('pending');

      const slim = okValueFrom(await computing);
      expect(slim.files).toHaveLength(60);
      const first = slim.files[0];
      expect(first?.status === 'analyzed' && first.functions).toHaveLength(8);
      expect(first).toMatchObject({ omittedFunctions: 12, aggregate: { changedFunctions: 20 } });
      const full = okValueFrom(await services.impact.getImpact({ sessionId }, { signal }));
      const fullFirst = full.files[0];
      expect(fullFirst?.status === 'analyzed' && fullFirst.functions).toHaveLength(20);
      expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(full).length / 2);
    },
  );

  test(
    'cancels the computation when the session head moves',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, createServices, repositories, logger, signal }) => {
      const { services, sessionId, repo, runner } = await openLargeSession(
        createServices,
        repositories,
        logger,
      );
      await advance(repo, 'src/first.ts');
      okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));
      const held = runner.hold();
      const computing = services.impact.getImpact({ sessionId }, { signal });
      await held.started;
      await advance(repo, 'src/second.ts');
      okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));
      await expect(computing).resolves.toMatchObject({
        ok: false,
        error: { code: 'stale-review' },
      });
      const moved = okValueFrom(await services.impact.getImpact({ sessionId }, { signal }));
      expect(moved.files.map((file) => file.path)).toContain('src/second.ts');
    },
  );

  test(
    'does not answer a request whose diff was loading when the head moved',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, createServices, repositories, logger, signal }) => {
      const { services, sessionId } = await openLargeSession(createServices, repositories, logger);
      const loading = services.impact.getImpact({ sessionId }, { signal });
      services.impact.observeHead(sessionId, 'f'.repeat(40));
      await expect(loading).resolves.toMatchObject({ ok: false, error: { code: 'stale-review' } });
    },
  );
});

interface LargeSession {
  readonly services: MainServices;
  readonly repo: TestRepository;
  readonly runner: HoldableImpactRunner;
  readonly sessionId: string;
}

/** A session on sixty new modules, whose review is loaded, with a holdable ImpactGate runner. */
async function openLargeSession(
  createServices: CreateServices,
  repositories: TestRepositories,
  logger: RecordingLogger,
): Promise<LargeSession> {
  const { repo } = await repositories.fromTemplate(sixtyModulesTemplate());
  const runner = createHoldableImpactRunner(logger.logger);
  const services = createServices({ impactRunner: runner.runner });
  const sessionId = okValueFrom(
    await services.sessions.createLocal({
      repoPath: repo.directory,
      baseRef: 'main',
      headRef: 'feature',
    }),
  ).id;
  okValueFrom(await services.sessions.getReview({ sessionId }));
  return { services, repo, runner, sessionId };
}

function sixtyModulesTemplate(): RepositoryTemplate<undefined> {
  return {
    name: 'main: sixty modules',
    build: async (repo): Promise<undefined> => {
      repo.write('README.md', '# large\n');
      await repo.commit('base');
      await repo.git('switch', '--quiet', '-c', 'feature');
      for (let index = 0; index < 60; index++) {
        repo.write(`src/module-${String(index)}.ts`, largeModule(index));
      }
      await repo.commit('add sixty modules');
      await repo.git('switch', '--quiet', 'main');
    },
  };
}

interface HoldableImpactRunner {
  readonly runner: ImpactRunner;
  /** The next run waits until its signal aborts; `started` settles once that run has begun. */
  readonly hold: () => { readonly started: Promise<undefined> };
}

/** The real worker, except that a held run is parked in the runner instead of racing the test. */
function createHoldableImpactRunner(logger: Logger): HoldableImpactRunner {
  const real = createImpactWorker({ logger });
  let onStart: (() => void) | undefined;
  return {
    runner: {
      run: async (sources, signal): Promise<Result<ImpactReport, ImpactRunFailure>> => {
        if (onStart === undefined) {
          return real.run(sources, signal);
        }
        const started = onStart;
        onStart = undefined;
        started();
        const parked = Promise.withResolvers<Result<ImpactReport, ImpactRunFailure>>();
        const cancel = (): void => {
          parked.resolve({ ok: false, error: { kind: 'cancelled' } });
        };
        if (signal?.aborted === true) {
          cancel();
        }
        signal?.addEventListener('abort', cancel, { once: true });
        return parked.promise;
      },
      dispose: (): void => {
        real.dispose();
      },
    },
    hold: (): { readonly started: Promise<undefined> } => {
      const started = Promise.withResolvers<undefined>();
      onStart = (): void => {
        started.resolve(undefined);
      };
      return { started: started.promise };
    },
  };
}

/** Twenty functions with branching, so a file has real work for the parser and the metrics. */
function largeModule(seed: number): string {
  return Array.from({ length: 20 }, (_, index) => {
    return [
      `export function task${String(seed)}x${String(index)}(input: number[], limit: number): number {`,
      '  let total = 0;',
      '  for (const value of input) {',
      '    if (value > limit && value % 2 === 0) {',
      '      total += value;',
      '    } else if (value < 0 || value === limit) {',
      '      total -= value;',
      '    }',
      '  }',
      '  return total;',
      '}',
      '',
    ].join('\n');
  }).join('\n');
}

async function advance(repo: TestRepository, file: string): Promise<void> {
  await repo.git('switch', '--quiet', 'feature');
  repo.write(file, `export const value = ${JSON.stringify(file)};\n`);
  await repo.commit(`add ${file}`);
  await repo.git('switch', '--quiet', 'main');
}

function featureLines(): string[] {
  return ['pub fn feature() -> u8 {', '  1', '}'];
}
