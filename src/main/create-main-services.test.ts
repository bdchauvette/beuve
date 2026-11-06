import { readdirSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { describe } from 'vitest';

import type { CallHierarchyRequest, DefinitionView, ReviewView } from '#contract/ipc-contract.ts';
import type { ServerTrustDecision } from '#internal/lsp/check-server-trust.ts';
import type { ServerDefinition } from '#internal/lsp/server-definition.ts';
import { pullRequestStackTemplate } from '#internal/git/testing/pull-request-stack-template.ts';
import { setLine } from '#internal/git/testing/set-line.ts';
import type { RepositoryTemplate, TestRepository } from '#internal/git/testing/test-repository.ts';
import type { TestRepositories } from '#internal/git/testing/test.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { writeFakeLanguageServer } from '#internal/lsp/testing/write-fake-language-server.ts';
import { createLanguageServerRegistry } from './language-servers/create-language-server-registry.ts';
import { createTypescriptServer } from './lsp/create-typescript-server.ts';
import type { MainServices } from './main-services.ts';
import type { ShellEnvironments } from './shell-environment/create-shell-environments.ts';
import { lines } from './testing/lines.ts';
import { test } from './testing/test.ts';

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

describe('createMainServices (integration: worktrees and typescript-language-server)', () => {
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
    'reports diagnostics at the head only, and says so for other commits and files',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, services, repositories }) => {
      const { sessionId, repo } = await openTypescriptSession(services, repositories);
      const [head, base] = await Promise.all([
        repo.git('rev-parse', 'feature'),
        repo.git('rev-parse', 'main'),
      ]);
      const broken = okValueFrom(
        await services.lsp.diagnostics({ sessionId, path: 'src/broken.ts' }),
      );
      expect(broken).toMatchObject({ sha: head, state: 'settled', omitted: 0 });
      expect(broken.diagnostics).toStrictEqual([
        {
          severity: 'error',
          message: expect.stringContaining('not assignable') as string,
          code: '2322',
          source: 'typescript',
          serverId: 'typescript',
          startLine: 1,
          startCharacter: 13,
          endLine: 1,
          endCharacter: 19,
        },
      ]);
      const clean = okValueFrom(await services.lsp.diagnostics({ sessionId, path: 'src/auth.ts' }));
      expect(clean).toMatchObject({ state: 'settled', diagnostics: [] });

      const older = okValueFrom(
        await services.lsp.diagnostics({ sessionId, sha: base, path: 'src/broken.ts' }),
      );
      expect(older).toStrictEqual({ sha: base, state: 'not-head', diagnostics: [], omitted: 0 });
      const atHead = okValueFrom(
        await services.lsp.diagnostics({ sessionId, sha: head, path: 'src/broken.ts' }),
      );
      expect(atHead.diagnostics).toHaveLength(1);
      const unsupported = okValueFrom(
        await services.lsp.diagnostics({ sessionId, path: 'tsconfig.json' }),
      );
      expect(unsupported).toStrictEqual({
        sha: head,
        state: 'unavailable',
        diagnostics: [],
        omitted: 0,
      });
      await expect(repo.git('status', '--porcelain')).resolves.toBe('');
    },
  );

  test(
    'does not start a server the trust check refuses, and says so',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, createServices, repositories }) => {
      const services = createServices({
        lsp: {
          trust: (): ServerTrustDecision => {
            return { allowed: false, reason: 'denied for the test' };
          },
        },
      });
      const { sessionId } = await openTypescriptSession(services, repositories);
      const answer = okValueFrom(
        await services.lsp.diagnostics({ sessionId, path: 'src/broken.ts' }),
      );
      expect(answer).toMatchObject({
        state: 'untrusted',
        diagnostics: [],
        notice: 'denied for the test',
      });
      await expect(
        services.lsp.hover({ sessionId, path: 'src/handler.ts', line: 4, character: 10 }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'refused' } });
      expect(okValueFrom(services.lsp.status()).servers).toStrictEqual([]);
    },
  );

  test(
    'applies the reviewer’s language server configuration per repository, and re-reads it on restart',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, createServices, repositories, tempDir, logger, signal }) => {
      const file = path.join(tempDir, 'language-servers.json');
      await writeFile(file, '{}', { signal });
      const languageServers = await createLanguageServerRegistry({
        paths: [file],
        home: tempDir,
        logger: logger.logger,
      });
      const services = createServices({ languageServers });
      const { sessionId, repo } = await openTypescriptSession(services, repositories);
      const before = okValueFrom(
        await services.lsp.diagnostics({ sessionId, path: 'src/broken.ts' }),
      );
      expect(before).toMatchObject({ state: 'settled' });
      expect(before.diagnostics).toHaveLength(1);

      const elsewhere = {
        match: { path: '/nowhere/**' },
        servers: { typescript: { enabled: false } },
      };
      const here = { match: { path: repo.directory }, servers: { typescript: { enabled: false } } };
      await writeFile(file, JSON.stringify({ overrides: [elsewhere, here] }), { signal });
      okValueFrom(await services.lsp.restart({ sessionId }));
      const off = okValueFrom(await services.lsp.diagnostics({ sessionId, path: 'src/broken.ts' }));
      expect(off).toMatchObject({ state: 'unavailable', diagnostics: [] });

      await writeFile(file, JSON.stringify({ overrides: [elsewhere] }), { signal });
      okValueFrom(await services.lsp.restart({ sessionId }));
      const back = okValueFrom(
        await services.lsp.diagnostics({ sessionId, path: 'src/broken.ts' }),
      );
      expect(back.diagnostics).toHaveLength(1);
    },
  );

  test(
    'tells a Go reviewer, with the default servers, when gopls is not installed',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, createServices, repositories }) => {
      const services = createServices({ lsp: { environment: { PATH: '' } } });
      const { repo } = await repositories.fromTemplate(goBranchTemplate());
      const created = await services.sessions.createLocal({
        repoPath: repo.directory,
        baseRef: 'main',
        headRef: 'feature',
      });
      const { id: sessionId } = okValueFrom(created);
      const answer = okValueFrom(await services.lsp.diagnostics({ sessionId, path: 'main.go' }));
      expect(answer).toMatchObject({ state: 'unavailable', diagnostics: [] });
      expect(answer.notice).toContain('The gopls language server is not installed');
      expect(answer.notice).toContain('restart the language servers');
      expect(okValueFrom(services.lsp.status()).servers).toStrictEqual([]);
    },
  );

  test(
    'runs a server the configuration defines beside the built-in one, and tags each diagnostic with its server',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, createServices, repositories, tempDir, logger, signal }) => {
      const script = writeFakeLanguageServer(tempDir);
      const file = path.join(tempDir, 'language-servers.json');
      const custom = {
        command: process.execPath,
        args: [script, 'normal'],
        extensions: { '.ts': 'typescript' },
        diagnosticsQuietMs: 20,
      };
      await writeFile(file, JSON.stringify({ servers: { scripted: custom } }), { signal });
      const languageServers = await createLanguageServerRegistry({
        paths: [file],
        home: tempDir,
        logger: logger.logger,
      });
      const services = createServices({ languageServers });
      const { sessionId } = await openTypescriptSession(services, repositories);
      const answer = okValueFrom(
        await services.lsp.diagnostics({ sessionId, path: 'src/broken.ts' }),
      );
      expect(answer.state).toBe('settled');
      const tagged = answer.diagnostics.map((item) => {
        return [item.serverId, item.severity];
      });
      expect(tagged).toStrictEqual([
        ['typescript', 'error'],
        ['scripted', 'warning'],
      ]);
    },
  );

  test(
    'hides a server’s diagnostics but keeps it answering hover, when the configuration says so',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, createServices, repositories, tempDir, logger, signal }) => {
      const file = path.join(tempDir, 'language-servers.json');
      await writeFile(file, '{"servers":{"typescript":{"diagnostics":false}}}', { signal });
      const languageServers = await createLanguageServerRegistry({
        paths: [file],
        home: tempDir,
        logger: logger.logger,
      });
      const services = createServices({ languageServers });
      const { sessionId } = await openTypescriptSession(services, repositories);
      const diagnostics = okValueFrom(
        await services.lsp.diagnostics({ sessionId, path: 'src/broken.ts' }),
      );
      expect(diagnostics).toMatchObject({ state: 'unavailable', diagnostics: [] });
      const hover = okValueFrom(
        await services.lsp.hover({ sessionId, path: 'src/handler.ts', line: 4, character: 10 }),
      );
      expect(hover.hover?.markdown).toContain('validate');
    },
  );

  test(
    'says what is wrong with the configuration beside the diagnostics, and keeps beuve’s own servers',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, createServices, repositories, tempDir, logger, signal }) => {
      const file = path.join(tempDir, 'language-servers.json');
      await writeFile(file, '{"servers":{"go":{"cmd":"gopls"}}}', { signal });
      const languageServers = await createLanguageServerRegistry({
        paths: [file],
        home: tempDir,
        logger: logger.logger,
      });
      const services = createServices({ languageServers });
      const { sessionId } = await openTypescriptSession(services, repositories);
      const answer = okValueFrom(
        await services.lsp.diagnostics({ sessionId, path: 'src/broken.ts' }),
      );
      expect(answer.state).toBe('settled');
      expect(answer.diagnostics).toHaveLength(1);
      expect(answer.notice).toContain(file);
      expect(answer.notice).toContain('cmd');
    },
  );

  test(
    'shows the diagnostics of the servers it started, and says which it did not',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, createServices, repositories, nodeRuntime }) => {
      const typescript = createTypescriptServer(okValueFrom(nodeRuntime));
      const fromProject: ServerDefinition = {
        ...typescript,
        id: 'project-typescript',
        source: 'project',
      };
      const services = createServices({ lsp: { servers: [typescript, fromProject] } });
      const { sessionId } = await openTypescriptSession(services, repositories);
      const answer = okValueFrom(
        await services.lsp.diagnostics({ sessionId, path: 'src/broken.ts' }),
      );
      expect(answer.state).toBe('settled');
      expect(answer.diagnostics.map((item) => item.serverId)).toStrictEqual(['typescript']);
      expect(answer.notice).toContain('project-typescript language server');
      expect(answer.notice).toContain('not trusted');
    },
  );

  test(
    'runs the servers in the checkout’s shell environment, forgets it on restart, and passes on its note',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, createServices, repositories }) => {
      const roots: string[] = [];
      const forgotten: string[] = [];
      const shellEnvironments: ShellEnvironments = {
        forRoot: async (root) => {
          roots.push(root);
          await Promise.resolve();
          return { variables: process.env };
        },
        forget: (root) => {
          forgotten.push(root);
        },
        noticeFor: (): string => {
          return 'The shell environment of this checkout could not be read.';
        },
      };
      const services = createServices({ shellEnvironments });
      const { sessionId, repo } = await openTypescriptSession(services, repositories);
      const answer = okValueFrom(
        await services.lsp.diagnostics({ sessionId, path: 'src/broken.ts' }),
      );
      expect(answer.state).toBe('settled');
      expect(answer.diagnostics).toHaveLength(1);
      expect(answer.notice).toBe('The shell environment of this checkout could not be read.');
      expect(roots).toHaveLength(1);
      okValueFrom(await services.lsp.restart({ sessionId }));
      expect(forgotten.map((root) => realpathSync(root))).toStrictEqual(
        roots.map((root) => realpathSync(root)),
      );
      expect(realpathSync(roots[0] ?? '')).not.toBe(realpathSync(repo.directory));
    },
  );

  test(
    'hovers at the head and at an older pinned commit, and refuses a line the file lacks',
    { concurrent: false, timeout: 60_000 },
    async ({ expect, services, repositories, worktreeRoot }) => {
      const { sessionId, repo } = await openTypescriptSession(services, repositories);
      const [head, base] = await Promise.all([
        repo.git('rev-parse', 'feature'),
        repo.git('rev-parse', 'main'),
      ]);
      const atHead = okValueFrom(
        await services.lsp.hover({ sessionId, path: 'src/handler.ts', line: 4, character: 10 }),
      );
      expect(atHead.sha).toBe(head);
      expect(atHead.hover?.markdown).toContain('validate');
      expect(atHead.hover?.range).toMatchObject({ startLine: 4, endLine: 4 });
      await expect(repo.git('status', '--porcelain')).resolves.toBe('');
      await expect(repo.git('branch', '--show-current')).resolves.toBe('main');
      expect(checkouts(worktreeRoot)).toStrictEqual([head]);
      const atBase = okValueFrom(
        await services.lsp.hover({
          sessionId,
          sha: base,
          path: 'src/handler.ts',
          line: 3,
          character: 10,
        }),
      );
      expect(atBase.sha).toBe(base);
      await expect(
        services.lsp.hover({ sessionId, path: 'src/handler.ts', line: 999, character: 0 }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-request' } });
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
      const link = async (at: LinkAt): Promise<DefinitionView> => {
        return okValueFrom(
          await services.lsp.definition({
            sessionId,
            path: 'src/handler.ts',
            ...at,
            link: true,
          }),
        );
      };
      const linked = await link({ line: 4, character: 12 });
      expect(linked.token).toMatchObject({ startCharacter: 9, endCharacter: 17, text: 'validate' });
      expect(linked.targets).toMatchObject([{ file: { path: 'src/auth.ts' }, startLine: 1 }]);
      const unlinked = await Promise.all([
        link({ line: 4, character: 17 }),
        link({ line: 4, character: 4 }),
        link({ line: 4, character: 0 }),
        link({ line: 3, character: 20 }),
      ]);
      expect(unlinked.map((view) => view.targets)).toStrictEqual([[], [], [], []]);
      const specifier = await link({ line: 1, character: 28 });
      expect(specifier.token).toMatchObject({
        startCharacter: 26,
        endCharacter: 32,
        text: './auth',
      });
      expect(specifier.targets).toMatchObject([
        { file: { kind: 'workspace', path: 'src/auth.ts' } },
      ]);
      const clicked = okValueFrom(
        await services.lsp.definition({
          sessionId,
          path: 'src/handler.ts',
          line: 1,
          character: 28,
        }),
      );
      expect(clicked.targets).toStrictEqual(specifier.targets);
      const onQuote = await link({ line: 1, character: 25 });
      expect(onQuote.targets).toStrictEqual([]);
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
    async ({ expect, services, repositories, worktreeRoot }) => {
      const { sessionId, repo } = await openTypescriptSession(services, repositories);
      const before = await repo.git('rev-parse', 'feature');
      await repo.git('switch', '--quiet', 'feature');
      repo.write('src/broken.ts', lines(['export const answer: number = 42;']));
      const after = await repo.commit('fix the type error');
      await repo.git('switch', '--quiet', 'main');

      const hovered = okValueFrom(
        await services.lsp.hover({ sessionId, path: 'src/broken.ts', line: 1, character: 14 }),
      );
      expect(hovered.sha).toBe(after);
      expect(checkouts(worktreeRoot)).toStrictEqual([after]);
      expect(after).not.toBe(before);

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
 * `validate`, adds `handleAuth` calling it, a type error and a note.
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

/** main: a Go module with `main.go`. feature: changes `main.go`. */
function goBranchTemplate(): RepositoryTemplate<undefined> {
  return {
    name: 'main: go branch',
    build: async (repo): Promise<undefined> => {
      repo.write('go.mod', lines(['module example.com/sample', '', 'go 1.24']));
      repo.write('main.go', lines(['package main', '', 'func main() {}']));
      await repo.commit('base');
      await repo.git('switch', '--quiet', '--create', 'feature');
      repo.write('main.go', lines(['package main', '', 'func main() {', '\tprintln("hi")', '}']));
      await repo.commit('feature');
      await repo.git('switch', '--quiet', 'main');
    },
  };
}

function featureBranchTemplate(): RepositoryTemplate<FeatureBranch> {
  return { name: 'main: feature branch', build: featureBranch };
}

/** main: app.rs + lib.rs; feature: edits app.rs, adds feature.rs. Leaves main checked out. */
async function featureBranch(repo: TestRepository): Promise<FeatureBranch> {
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

/** The feature branch template's merge base with main. */
interface FeatureBranch {
  readonly mergeBase: string;
}

function featureLines(): string[] {
  return ['pub fn feature() -> u8 {', '  1', '}'];
}

interface LinkAt {
  readonly line: number;
  readonly character: number;
}
