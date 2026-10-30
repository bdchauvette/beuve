import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IpcResult, ReviewView } from '#contract/ipc-contract.ts';
import { buildPullRequestStack } from '#internal/git/testing/build-pull-request-stack.ts';
import { createTestRepository } from '#internal/git/testing/create-test-repository.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import type { SessionDeps } from '#internal/session/session.ts';
import type { ImpactReport } from '#internal/impact/impact-report.ts';
import { createLogger } from '#x/log/create-logger.ts';
import type { Result } from '#x/result/result.ts';

import { createMainServices } from './create-main-services.ts';
import { createImpactWorker } from './impact/create-impact-worker.ts';
import type { ImpactRunFailure, ImpactRunner } from './impact/create-impact-worker.ts';
import { openAppDatabase } from './database/open-app-database.ts';
import type { MainServices, SessionServices } from './main-services.ts';

const featureLines = ['pub fn feature() -> u8 {', '  1', '}'];

describe('createMainServices (integration: SQLite + git, no Electron)', () => {
  let repo: TestRepository;
  let db: DatabaseSync;
  let services: MainServices;
  let sessions: SessionServices;

  beforeEach(() => {
    repo = createTestRepository();
    db = openAppDatabase(':memory:');
    services = createMainServices({
      db,
      logger: silentLogger(),
      deps: countingDeps(),
      worktreeRoot: path.join(repo.scratch(), 'worktrees'),
    });
    sessions = services.sessions;
  });

  afterEach(async () => {
    await services.dispose();
    db.close();
    repo.cleanup();
  });

  it('reviews a branch in full, then only the amendment after a rebase', async () => {
    const { mergeBase } = featureBranch(repo);
    const created = value(
      await sessions.createLocal({ repoPath: repo.directory, baseRef: 'main', headRef: 'feature' }),
    );
    expect(created.source).toEqual({
      kind: 'local',
      repoPath: repo.directory,
      baseRef: 'main',
      headRef: 'feature',
    });
    const again = value(
      await sessions.createLocal({ repoPath: repo.directory, baseRef: 'main', headRef: 'feature' }),
    );
    expect(again.id).toBe(created.id);
    expect(value(sessions.list()).map(({ id }) => id)).toEqual([created.id]);

    const full = value(await sessions.getReview({ sessionId: created.id }));
    expect(full.scope).toEqual({ kind: 'full' });
    expect(full.baseSha).toBe(mergeBase);
    expect(fileSummary(full)).toEqual([
      ['app.rs', 'modified', 1, 1],
      ['feature.rs', 'added', 3, 0],
    ]);
    expect(full.files[1]?.patch).toContain('+  1\n');

    const reviewed = value(
      await sessions.markReviewed({ sessionId: created.id, expectedHeadSha: full.headSha }),
    );
    expect(reviewed.lastReviewedSha).toBe(full.headSha);
    const upToDate = value(await sessions.getReview({ sessionId: created.id }));
    expect(upToDate).toMatchObject({ scope: { kind: 'up-to-date' }, files: [] });

    const newBase = upstreamAdvances(repo);
    repo.git('switch', '--quiet', 'feature');
    repo.git('rebase', '--quiet', 'main');
    repo.write('feature.rs', lines(featureLines.with(1, '  42')));
    repo.git('commit', '--quiet', '--amend', '--no-edit', '--all');
    const newHead = repo.git('rev-parse', 'feature');

    const interdiff = value(await sessions.getReview({ sessionId: created.id }));
    expect(interdiff.headSha).toBe(newHead);
    expect(interdiff.baseSha).toBe(newBase);
    expect(interdiff.session.headSha).toBe(newHead);
    expect(interdiff.scope).toEqual({
      kind: 'interdiff',
      fromBaseSha: mergeBase,
      fromHeadSha: full.headSha,
      outcome: { kind: 'rebased' },
    });
    expect(fileSummary(interdiff)).toEqual([['feature.rs', 'modified', 1, 1]]);
    expect(interdiff.files[0]?.patch).toContain('\n-  1\n+  42\n');

    expect(
      await sessions.markReviewed({ sessionId: created.id, expectedHeadSha: full.headSha }),
    ).toMatchObject({ ok: false, error: { code: 'stale-review' } });
    value(await sessions.markReviewed({ sessionId: created.id, expectedHeadSha: newHead }));
    expect(value(await sessions.getReview({ sessionId: created.id }))).toMatchObject({
      scope: { kind: 'up-to-date' },
      baseSha: newBase,
      files: [],
    });
    expect(value(sessions.list()).find(({ id }) => id === created.id)?.lastReviewedSha).toBe(
      newHead,
    );
  });

  it('shows an exact interdiff when the author pushes on an unmoved base', async () => {
    featureBranch(repo);
    const { id } = value(
      await sessions.createLocal({ repoPath: repo.directory, baseRef: 'main', headRef: 'feature' }),
    );
    value(await sessions.markReviewed({ sessionId: id }));
    repo.git('switch', '--quiet', 'feature');
    repo.write('notes.md', 'follow-up\n');
    repo.commit('follow-up');

    const review = value(await sessions.getReview({ sessionId: id }));
    expect(review.scope).toMatchObject({ kind: 'interdiff', outcome: { kind: 'exact' } });
    expect(fileSummary(review)).toEqual([['notes.md', 'added', 1, 0]]);
  });

  it('diffs a separately cached whitespace-ignoring variant with the same head lines', async () => {
    repo.write('app.py', lines(['def run():', '  x=1', '  return x', '']));
    repo.write('spaces.txt', lines(['one']));
    repo.commit('base');
    repo.git('switch', '--quiet', '--create', 'feature');
    repo.write('app.py', lines(['def run():', '    x = 1', '    return x', '', 'run()']));
    repo.write('spaces.txt', lines(['one   ']));
    repo.commit('reindent, then call');
    repo.git('switch', '--quiet', 'main');
    const { id } = value(
      await sessions.createLocal({ repoPath: repo.directory, baseRef: 'main', headRef: 'feature' }),
    );
    const shown = value(await sessions.getReview({ sessionId: id }));
    expect(shown.whitespace).toBe('shown');
    expect(fileSummary(shown)).toEqual([
      ['app.py', 'modified', 3, 2],
      ['spaces.txt', 'modified', 1, 1],
    ]);
    const ignored = value(await sessions.getReview({ sessionId: id, ignoreWhitespace: true }));
    expect(ignored.whitespace).toBe('ignored');
    expect(ignored.headSha).toBe(shown.headSha);
    expect(fileSummary(ignored)).toEqual([['app.py', 'modified', 1, 0]]);
    expect(ignored.files[0]?.hunks).toEqual([
      expect.objectContaining({ newStart: 2, newCount: 4 }),
    ]);
    expect(ignored.files[0]?.patch).toContain('\n+run()\n');
    expect(ignored.files[0]?.patch).toContain('\n     x = 1\n');

    const item = value(
      await services.ura.create({
        sessionId: id,
        headSha: shown.headSha,
        anchor: { kind: 'lines', path: 'app.py', startLine: 5, endLine: 5 },
        severity: 'nit',
        title: 'Guard the call',
        body: '',
      }),
    );
    expect(item.placement).toEqual({ kind: 'current', anchor: item.anchor });
    value(await sessions.getReview({ sessionId: id, ignoreWhitespace: true }));
    expect(value(await services.ura.list({ sessionId: id })).items[0]?.placement).toEqual({
      kind: 'current',
      anchor: { kind: 'lines', path: 'app.py', startLine: 5, endLine: 5 },
    });

    value(await sessions.markReviewed({ sessionId: id, expectedHeadSha: shown.headSha }));
    repo.git('switch', '--quiet', 'feature');
    repo.write('app.py', lines(['def run():', '\tx = 1', '\treturn x', '', 'run()', 'run()']));
    repo.commit('tabs, and call twice');
    repo.git('switch', '--quiet', 'main');
    const interdiff = value(await sessions.getReview({ sessionId: id }));
    expect(fileSummary(interdiff)).toEqual([['app.py', 'modified', 3, 2]]);
    const quiet = value(await sessions.getReview({ sessionId: id, ignoreWhitespace: true }));
    expect(quiet.scope).toMatchObject({ kind: 'interdiff', outcome: { kind: 'exact' } });
    expect(fileSummary(quiet)).toEqual([['app.py', 'modified', 1, 0]]);
    expect(quiet.files[0]?.hunks).toEqual([expect.objectContaining({ newStart: 3, newCount: 4 })]);
  });

  it('reviews a stacked child after its parent is squash-merged and it is retargeted', async () => {
    const stack = buildPullRequestStack(repo);
    repo.git('update-ref', 'refs/review/base', 'pr1');
    const { id } = value(
      await sessions.createLocal({
        repoPath: repo.directory,
        baseRef: 'refs/review/base',
        headRef: 'pr2',
      }),
    );
    const full = value(await sessions.getReview({ sessionId: id }));
    expect(fileSummary(full)).toEqual([['b.txt', 'modified', 2, 2]]);
    value(await sessions.markReviewed({ sessionId: id, expectedHeadSha: full.headSha }));

    repo.git('switch', '--quiet', 'main');
    repo.git('merge', '--quiet', '--squash', 'pr1');
    repo.commit('pr1 (#1)');
    repo.git('update-ref', 'refs/review/base', 'main');
    repo.git('switch', '--quiet', 'pr2');
    const fixup = stack.commitLine('b.txt', 25, 'pr2-b25', 'pr2: b25');

    const retargeted = value(await sessions.getReview({ sessionId: id }));
    expect(retargeted.scope).toMatchObject({ kind: 'interdiff', outcome: { kind: 'exact' } });
    expect(retargeted.baseSha).toBe(stack.pr1[1]);
    expect(retargeted.forkPoint).toEqual({
      reason: 'already-upstream',
      mergeBaseSha: stack.root,
      skippedCommits: 2,
    });
    expect(fileSummary(retargeted)).toEqual([['b.txt', 'modified', 1, 1]]);
    expect(retargeted.commitPairs?.map(({ kind, subject }) => [kind, subject])).toEqual([
      ['unchanged', 'pr2: b5'],
      ['unchanged', 'pr2: b20'],
      ['added', 'pr2: b25'],
    ]);
    expect(retargeted.fileAttribution).toEqual([
      { path: 'b.txt', pairIds: [stack.pr2[0], stack.pr2[1], fixup], hunkPairIds: [[fixup]] },
    ]);

    value(await sessions.markReviewed({ sessionId: id, expectedHeadSha: fixup }));
    repo.git('rebase', '--quiet', '--onto', 'main', stack.pr1[1] ?? '', 'pr2');
    const rebased = value(await sessions.getReview({ sessionId: id }));
    expect(rebased.scope).toMatchObject({ kind: 'interdiff', outcome: { kind: 'rebased' } });
    expect(rebased.files).toEqual([]);
    expect(rebased.forkPoint).toBeUndefined();
    expect(rebased.commitPairs?.map(({ kind }) => kind)).toEqual([
      'unchanged',
      'unchanged',
      'unchanged',
    ]);
  });

  it('refuses directories outside a repository and unknown refs with typed errors', async () => {
    featureBranch(repo);
    const outside = repo.scratch();
    expect(
      await sessions.createLocal({ repoPath: outside, baseRef: 'main', headRef: 'HEAD' }),
    ).toMatchObject({ ok: false, error: { code: 'not-a-repository' } });
    expect(
      await sessions.createLocal({ repoPath: repo.directory, baseRef: 'main', headRef: 'nope' }),
    ).toMatchObject({ ok: false, error: { code: 'unknown-revision' } });
    expect(
      await sessions.createLocal({ repoPath: 'relative', baseRef: 'main', headRef: 'HEAD' }),
    ).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
    expect(await sessions.getReview({ sessionId: 'not-a-uuid' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
    expect(
      await sessions.getReview({ sessionId: '00000000-0000-4000-8000-000000000000' }),
    ).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(value(sessions.list())).toEqual([]);
  });
});

describe(
  'createMainServices (integration: ImpactGate, worktrees and typescript-language-server)',
  { timeout: 60_000 },
  () => {
    let repo: TestRepository;
    let db: DatabaseSync;
    let services: MainServices;
    let worktreeRoot: string;
    let sessionId: string;

    beforeAll(async () => {
      repo = createTestRepository();
      db = openAppDatabase(':memory:');
      worktreeRoot = path.join(repo.scratch(), 'worktrees');
      services = createMainServices({
        db,
        logger: silentLogger(),
        deps: countingDeps(),
        worktreeRoot,
      });
      typescriptBranch(repo);
      sessionId = value(
        await services.sessions.createLocal({
          repoPath: repo.directory,
          baseRef: 'main',
          headRef: 'feature',
        }),
      ).id;
    });

    afterAll(async () => {
      await services.dispose();
      db.close();
      repo.cleanup();
    });

    it('reports the added complex function as the one introduced finding, cached per diff', async () => {
      const review = value(await services.sessions.getReview({ sessionId }));
      const impact = value(await services.impact.getImpact({ sessionId }));
      expect(impact).toMatchObject({ baseSha: review.baseSha, headSha: review.headSha });
      expect(impact.findings).toEqual([
        expect.objectContaining({
          path: 'src/complex.ts',
          functionName: 'handleAuth',
          trend: 'introduced',
          limit: 15,
          startLine: 3,
        }),
      ]);
      expect(impact.findings[0]?.value).toBeGreaterThan(15);
      expect(impact.files.map((file) => [file.path, file.status])).toEqual([
        ['notes.md', 'skipped'],
        ['src/auth.ts', 'analyzed'],
        ['src/broken.ts', 'analyzed'],
        ['src/complex.ts', 'analyzed'],
      ]);
      expect(impact.files[0]).toMatchObject({ reason: 'unsupported-language' });
      const auth = impact.files[1];
      expect(auth?.status === 'analyzed' && auth.functions).toEqual([
        expect.objectContaining({ name: 'validate', change: 'modified', inDiff: true }),
      ]);
      expect(await services.impact.getImpact({ sessionId })).toEqual({ ok: true, value: impact });
    });

    it('answers MCP diagnostics with 1-based lines from a checkout of the session head', async () => {
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
      expect(repo.git('status', '--porcelain')).toBe('');
      expect(repo.git('branch', '--show-current')).toBe('main');
      expect(checkouts(worktreeRoot)).toEqual([repo.git('rev-parse', 'feature')]);
    });

    it('lists the callers of a modified callee, badged against the review diff', async () => {
      const hierarchy = value(
        await services.lsp.callHierarchy({
          sessionId,
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
        .map((call) => [call.node.name, call.node.badge, call.callSiteLines] as const)
        .toSorted(([a], [b]) => a.localeCompare(b));
      expect(callers).toEqual([
        ['handleAuth', 'modified', [8]],
        ['handleRequest', 'untouched', [4]],
      ]);
      const handler = hierarchy.calls.find((call) => call.node.name === 'handleRequest');
      const outer = value(
        await services.lsp.callHierarchy({
          sessionId,
          path: 'src/handler.ts',
          line: 1,
          direction: 'incoming',
          nodeId: handler?.node.id ?? '',
        }),
      );
      expect(outer.calls.map((call) => [call.node.name, call.node.badge])).toEqual([
        ['serve', 'untouched'],
      ]);
      expect(
        await services.lsp.callHierarchy({
          sessionId,
          path: 'src/auth.ts',
          line: 5,
          direction: 'incoming',
        }),
      ).toMatchObject({ ok: false, error: { code: 'not-found' } });
      const added = value(
        await services.lsp.callHierarchy({
          sessionId,
          path: 'src/complex.ts',
          line: 1,
          direction: 'incoming',
        }),
      );
      expect(added).toMatchObject({ root: { name: 'handleAuth', badge: 'modified' }, calls: [] });
    });

    it('moves the session checkout when the head moves, and prunes it on startup', async () => {
      const before = repo.git('rev-parse', 'feature');
      repo.git('switch', '--quiet', 'feature');
      repo.write('src/broken.ts', lines(['export const answer: number = 42;']));
      const after = repo.commit('fix the type error');
      repo.git('switch', '--quiet', 'main');

      const outcome = await services.mcpTools.getLspDiagnostics({
        sessionId,
        path: path.join(repo.directory, 'src/broken.ts'),
      });
      expect(outcome).toMatchObject({ ok: true, value: { headSha: after, diagnostics: [] } });
      expect(checkouts(worktreeRoot)).toEqual([after]);
      expect(after).not.toBe(before);

      const impact = value(await services.impact.getImpact({ sessionId }));
      expect(impact.headSha).toBe(after);

      repo.git(
        'worktree',
        'add',
        '--quiet',
        '--detach',
        path.join(worktreeRoot, 'stray', before),
        before,
      );
      await services.pruneWorktrees();
      expect(checkouts(worktreeRoot)).toEqual([after]);
      expect(readdirSync(worktreeRoot)).toHaveLength(1);
    });
  },
);

/**
 * main: a TypeScript project with `validate` and its caller `handleRequest`. feature: changes
 * `validate`, adds `handleAuth` (cognitive complexity 23) calling it, a type error and a note.
 */
function typescriptBranch(repo: TestRepository): void {
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
  repo.commit('base');
  repo.git('switch', '--quiet', '--create', 'feature');
  repo.write(
    'src/auth.ts',
    lines([
      'export function validate(token: string): boolean {',
      '  return token.length > 8;',
      '}',
    ]),
  );
  repo.write('src/complex.ts', lines(complexSource));
  repo.write('src/broken.ts', lines(["export const answer: number = 'forty-two';"]));
  repo.write('notes.md', lines(['# notes']));
  repo.commit('add auth handling');
  repo.git('switch', '--quiet', 'main');
}

const complexSource = [
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

/** The commit directories under the worktree root (`<root>/<repo>/<commit>`). */
function checkouts(root: string): string[] {
  return readdirSync(root).flatMap((repository) => readdirSync(path.join(root, repository)));
}

function silentLogger(): ReturnType<typeof createLogger> {
  return createLogger('test', { sink: (): void => undefined });
}

/** main: app.rs + lib.rs; feature: edits app.rs, adds feature.rs. Leaves main checked out. */
function featureBranch(repo: TestRepository): { mergeBase: string } {
  repo.write('app.rs', lines(['fn main() {', '  run();', '}']));
  repo.write('lib.rs', lines(['pub fn lib() {}']));
  const mergeBase = repo.commit('base');
  repo.git('switch', '--quiet', '--create', 'feature');
  repo.write('app.rs', lines(['fn main() {', '  run_fast();', '}']));
  repo.commit('speed up');
  repo.write('feature.rs', lines(featureLines));
  repo.commit('add feature');
  repo.git('switch', '--quiet', 'main');
  return { mergeBase };
}

function upstreamAdvances(repo: TestRepository): string {
  repo.git('switch', '--quiet', 'main');
  repo.write('lib.rs', lines(['pub fn lib() {}', 'pub fn more() {}']));
  repo.commit('upstream lib');
  repo.write('upstream.rs', lines(['// unrelated']));
  return repo.commit('upstream file');
}

function fileSummary(review: ReviewView): [string, string, number, number][] {
  return review.files.map((file) => [file.path, file.status, file.additions, file.deletions]);
}

function value<T>(result: IpcResult<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function lines(content: readonly string[]): string {
  return content.map((line) => `${line}\n`).join('');
}

function countingDeps(): SessionDeps {
  let id = 0;
  return {
    newId: (): string => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  };
}

describe(
  'createMainServices (integration: ImpactGate in a worker thread)',
  { timeout: 60_000 },
  () => {
    let repo: TestRepository;
    let db: DatabaseSync;
    let services: MainServices;
    let sessionId: string;
    const runner = createHoldableImpactRunner();

    beforeAll(async () => {
      repo = createTestRepository();
      db = openAppDatabase(':memory:');
      services = createMainServices({
        db,
        logger: silentLogger(),
        deps: countingDeps(),
        worktreeRoot: path.join(repo.scratch(), 'worktrees'),
        impactRunner: runner.runner,
      });
      repo.write('README.md', '# large\n');
      repo.commit('base');
      repo.git('switch', '--quiet', '-c', 'feature');
      for (let index = 0; index < 60; index++) {
        repo.write(`src/module-${String(index)}.ts`, largeModule(index));
      }
      repo.commit('add sixty modules');
      repo.git('switch', '--quiet', 'main');
      sessionId = value(
        await services.sessions.createLocal({
          repoPath: repo.directory,
          baseRef: 'main',
          headRef: 'feature',
        }),
      ).id;
      value(await services.sessions.getReview({ sessionId }));
    });

    afterAll(async () => {
      await services.dispose();
      db.close();
      repo.cleanup();
    });

    it('answers other channels while a large computation runs, then ships the slim view', async () => {
      const computing = services.impact.getImpactForRenderer({ sessionId });
      const review = await services.sessions.getReview({ sessionId });
      expect(review.ok).toBe(true);
      const state = await Promise.race([computing, Promise.resolve('pending')]);
      expect(state).toBe('pending');

      const slim = value(await computing);
      expect(slim.files).toHaveLength(60);
      const first = slim.files[0];
      expect(first?.status === 'analyzed' && first.functions).toHaveLength(8);
      expect(first).toMatchObject({ omittedFunctions: 12, aggregate: { changedFunctions: 20 } });
      const full = value(await services.impact.getImpact({ sessionId }));
      const fullFirst = full.files[0];
      expect(fullFirst?.status === 'analyzed' && fullFirst.functions).toHaveLength(20);
      expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(full).length / 2);
    });

    it('cancels the computation when the session head moves', async () => {
      advance(repo, 'src/first.ts');
      value(await services.sessions.getReview({ sessionId }));
      const held = runner.hold();
      const computing = services.impact.getImpact({ sessionId });
      await held.started;
      advance(repo, 'src/second.ts');
      value(await services.sessions.getReview({ sessionId }));
      expect(await computing).toMatchObject({ ok: false, error: { code: 'stale-review' } });
      const moved = value(await services.impact.getImpact({ sessionId }));
      expect(moved.files.map((file) => file.path)).toContain('src/second.ts');
    });

    it('does not answer a request whose diff was loading when the head moved', async () => {
      const loading = services.impact.getImpact({ sessionId });
      services.impact.observeHead(sessionId, 'f'.repeat(40));
      expect(await loading).toMatchObject({ ok: false, error: { code: 'stale-review' } });
    });
  },
);

interface HoldableImpactRunner {
  readonly runner: ImpactRunner;
  /** The next run waits until its signal aborts; `started` settles once that run has begun. */
  readonly hold: () => { readonly started: Promise<undefined> };
}

/** The real worker, except that a held run is parked in the runner instead of racing the test. */
function createHoldableImpactRunner(): HoldableImpactRunner {
  const real = createImpactWorker({ logger: silentLogger() });
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
  return Array.from({ length: 20 }, (_, index) =>
    [
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
    ].join('\n'),
  ).join('\n');
}

function advance(repo: TestRepository, file: string): void {
  repo.git('switch', '--quiet', 'feature');
  repo.write(file, `export const value = ${JSON.stringify(file)};\n`);
  repo.commit(`add ${file}`);
  repo.git('switch', '--quiet', 'main');
}
