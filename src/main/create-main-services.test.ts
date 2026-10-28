import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IpcResult, ReviewProgressView, ReviewView } from '#contract/ipc-contract.ts';
import { createTestRepository } from '#internal/git/testing/create-test-repository.ts';
import type { TestRepository } from '#internal/git/testing/create-test-repository.ts';
import { writeFakeClaude } from '#internal/review/testing/write-fake-claude.ts';
import type { SessionDeps } from '#internal/session/session.ts';
import { createLogger } from '#pkg/logger/create-logger.ts';

import { createMainServices } from './create-main-services.ts';
import { openAppDatabase } from './database/open-app-database.ts';
import type { MainServices, SessionServices } from './main-services.ts';
import type { ClaudeCodeSettings } from './review/create-review-services.ts';

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
      deps: steppingDeps(),
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
    expect(value(sessions.open({ sessionId: created.id })).lastReviewedSha).toBe(newHead);
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
        deps: steppingDeps(),
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

describe('createMainServices (integration: preliminary review with a fake claude)', () => {
  let repo: TestRepository;
  let db: DatabaseSync;
  let services: MainServices | undefined;
  let worktreeRoot: string;
  let script: string;
  let events: ReviewProgressView[];

  beforeEach(() => {
    repo = createTestRepository();
    db = openAppDatabase(':memory:');
    worktreeRoot = path.join(repo.scratch(), 'worktrees');
    script = writeFakeClaude(repo.scratch());
    events = [];
    featureBranch(repo);
  });

  afterEach(async () => {
    await services?.dispose();
    services = undefined;
    db.close();
    repo.cleanup();
  });

  const start = async (claude: ClaudeCodeSettings): Promise<{ sessionId: string }> => {
    services = createMainServices({
      db,
      logger: silentLogger(),
      deps: steppingDeps(),
      worktreeRoot,
      claude: { killGraceMs: 200, ...claude },
    });
    services.review.onProgress((event) => {
      events.push(event);
    });
    const { id } = value(
      await services.sessions.createLocal({
        repoPath: repo.directory,
        baseRef: 'main',
        headRef: 'feature',
      }),
    );
    return { sessionId: id };
  };

  const scripted = (delayMs = 0): ClaudeCodeSettings => {
    const file = path.join(repo.scratch(), 'review.json');
    writeFileSync(file, JSON.stringify({ insights: reviewInsights, delayMs }));
    return { command: process.execPath, leadingArgs: [script, 'review', file] };
  };

  const finished = async (runId: string): Promise<ReviewProgressView> => {
    for (let waited = 0; waited < 15_000; waited += 20) {
      const last = events.find(
        (event) => event.runId === runId && (event.kind === 'completed' || event.kind === 'failed'),
      );
      if (last !== undefined) {
        return last;
      }
      await delay(20);
    }
    throw new Error(`run ${runId} did not finish`);
  };

  it('runs, stores and lists insights; reuses, joins and freshly reruns the run for a head', async () => {
    const claude = scripted(150);
    const { sessionId } = await start(claude);
    const review = must(services).review;
    const head = repo.git('rev-parse', 'feature');

    const first = value(await review.run({ sessionId }));
    expect(first).toMatchObject({ status: 'started', sessionId, headSha: head });
    expect(value(await review.run({ sessionId }))).toEqual({ ...first, status: 'attached' });
    expect(value(await review.listInsights({ sessionId }))).toMatchObject({
      activeRunId: first.runId,
      insights: [],
    });
    const done = await finished(first.runId);
    expect(done).toMatchObject({
      kind: 'completed',
      summary: {
        headSha: head,
        scope: 'full',
        model: 'fake-model-1',
        insightCount: 2,
        droppedCount: 2,
        dropped: { outsideDiff: 1, unknownFile: 1, lowConfidence: 0 },
        fileCount: 2,
      },
    });
    expect(events.filter((event) => event.runId === first.runId).map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(['started', 'progress', 'completed']),
    );
    const [call, ...others] = calls(claude);
    expect(others).toEqual([]);
    expect(call?.cwd).toBe(path.join(worktreeRoot, readdirSync(worktreeRoot)[0] ?? '', head));
    expect(call?.args).toContain('--tools=Read,Grep,Glob');
    expect(repo.git('status', '--porcelain')).toBe('');

    const listed = value(await review.listInsights({ sessionId }));
    expect(listed.activeRunId).toBeUndefined();
    expect(listed.run).toMatchObject({ insightCount: 2, droppedCount: 2 });
    expect(listed.insights.map((insight) => [insight.path, insight.lineStart])).toEqual([
      ['app.rs', 2],
      ['feature.rs', 2],
    ]);
    const [appInsight] = listed.insights;
    expect(
      review.setInsightStatus({ insightId: appInsight?.id ?? '', status: 'dismissed' }),
    ).toEqual({ ok: true, value: { insightId: appInsight?.id, status: 'dismissed' } });
    expect(
      review.setInsightStatus({
        insightId: '00000000-0000-4000-8000-00000000ffff',
        status: 'promoted',
      }),
    ).toMatchObject({ ok: false, error: { code: 'not-found' } });

    const plain = value(await review.run({ sessionId }));
    expect(plain).toMatchObject({
      status: 'reused',
      summary: { reviewRunId: done.kind === 'completed' ? done.summary.reviewRunId : '' },
    });
    expect(calls(claude)).toHaveLength(1);

    const scoped = value(await review.run({ sessionId, pathPrefixes: ['./feature.rs/'] }));
    expect(scoped.status).toBe('started');
    expect(scoped.runId).not.toBe(first.runId);
    const scopedDone = await finished(scoped.runId);
    expect(scopedDone).toMatchObject({
      kind: 'completed',
      summary: { insightCount: 1, fileCount: 1, pathPrefixes: ['feature.rs'] },
    });
    expect(calls(claude)).toHaveLength(2);
    expect(value(await review.run({ sessionId, pathPrefixes: ['feature.rs'] })).status).toBe(
      'reused',
    );
    expect(value(await review.run({ sessionId })).status).toBe('reused');
    expect(calls(claude)).toHaveLength(2);
    const both = value(await review.listInsights({ sessionId }));
    expect(both.insights.map((item) => [item.path, item.status])).toEqual([
      ['app.rs', 'dismissed'],
      ['feature.rs', 'pending'],
    ]);
    expect(both.run?.reviewRunId).toBe(storedId(scopedDone));

    const fresh = value(
      await review.run({ sessionId, fresh: true, pathPrefixes: ['feature.rs'], effort: 'low' }),
    );
    expect(fresh.status).toBe('started');
    expect(await finished(fresh.runId)).toMatchObject({
      kind: 'completed',
      summary: { insightCount: 1, fileCount: 1, pathPrefixes: ['feature.rs'] },
    });
    expect(calls(claude)[2]?.args).toContain('--effort=low');
    const rerun = value(await review.listInsights({ sessionId }));
    expect(rerun.insights.map((insight) => [insight.path, insight.status])).toEqual([
      ['app.rs', 'dismissed'],
      ['feature.rs', 'pending'],
    ]);

    const nothing = value(await review.run({ sessionId, fresh: true, pathPrefixes: ['docs'] }));
    expect(await finished(nothing.runId)).toMatchObject({
      kind: 'failed',
      error: { code: 'nothing-to-review' },
    });
  });

  it('keeps a plain and a scoped review of one head apart, and joins only the same scope', async () => {
    const claude = scripted(150);
    const { sessionId } = await start(claude);
    const review = must(services).review;

    const scoped = value(await review.run({ sessionId, pathPrefixes: ['feature.rs'] }));
    expect(scoped.status).toBe('started');
    expect(value(await review.run({ sessionId, pathPrefixes: ['./feature.rs'] }))).toEqual({
      ...scoped,
      status: 'attached',
    });
    const plain = value(await review.run({ sessionId }));
    expect(plain.status).toBe('started');
    expect(plain.runId).not.toBe(scoped.runId);
    expect(await finished(scoped.runId)).toMatchObject({
      kind: 'failed',
      error: { code: 'cancelled', reason: 'superseded' },
    });
    expect(await finished(plain.runId)).toMatchObject({
      kind: 'completed',
      summary: { insightCount: 2, fileCount: 2 },
    });
    expect(value(await review.run({ sessionId })).status).toBe('reused');
    expect(value(await review.run({ sessionId, pathPrefixes: ['feature.rs'] })).status).toBe(
      'started',
    );
    await finished(events.findLast((event) => event.kind === 'started')?.runId ?? 'none');
  });

  it('reuses a plain review for the next plain review without calling Claude Code again', async () => {
    const claude = scripted();
    const { sessionId } = await start(claude);
    const review = must(services).review;
    const first = value(await review.run({ sessionId }));
    const done = await finished(first.runId);
    expect(value(await review.run({ sessionId }))).toMatchObject({
      status: 'reused',
      summary: { reviewRunId: storedId(done) },
    });
    expect(calls(claude)).toHaveLength(1);
  });

  it('carries a dismissed insight over when --fresh replaces its run', async () => {
    const claude = scripted();
    const { sessionId } = await start(claude);
    const review = must(services).review;
    const first = value(await review.run({ sessionId }));
    await finished(first.runId);
    const [appInsight, featureInsight] = value(await review.listInsights({ sessionId })).insights;
    review.setInsightStatus({ insightId: appInsight?.id ?? '', status: 'dismissed' });
    review.setInsightStatus({ insightId: featureInsight?.id ?? '', status: 'promoted' });

    const fresh = value(await review.run({ sessionId, fresh: true }));
    expect(fresh.status).toBe('started');
    const freshDone = await finished(fresh.runId);
    expect(calls(claude)).toHaveLength(2);
    const listed = value(await review.listInsights({ sessionId }));
    expect(listed.run?.reviewRunId).toBe(storedId(freshDone));
    expect(
      listed.insights.map((item) => [item.path, item.status, item.id !== appInsight?.id]),
    ).toEqual([
      ['app.rs', 'dismissed', true],
      ['feature.rs', 'promoted', true],
    ]);
  });

  it('aborts the in-flight run when the head moves, killing Claude Code', async () => {
    const pidFile = path.join(repo.scratch(), 'pids.json');
    const { sessionId } = await start({
      command: process.execPath,
      leadingArgs: [script, 'hang', pidFile],
    });
    const review = must(services).review;
    const handle = value(await review.run({ sessionId }));
    for (let waited = 0; !existsSync(pidFile) && waited < 10_000; waited += 20) {
      await delay(20);
    }
    const { self } = JSON.parse(readFileSync(pidFile, 'utf8')) as { self: number };

    repo.git('switch', '--quiet', 'feature');
    repo.write('notes.md', 'moved\n');
    const moved = repo.commit('move the head');
    repo.git('switch', '--quiet', 'main');
    value(await must(services).sessions.getReview({ sessionId }));

    expect(await finished(handle.runId)).toMatchObject({
      kind: 'failed',
      error: { code: 'cancelled', reason: 'head-changed' },
    });
    expect(isAlive(self)).toBe(false);
    expect(value(await review.listInsights({ sessionId }))).toMatchObject({
      headSha: moved,
      insights: [],
    });
    expect(value(await review.listInsights({ sessionId })).run).toBeUndefined();
  });

  it('reports a missing claude as not-installed, naming BEUVE_CLAUDE_PATH', async () => {
    const { sessionId } = await start({
      env: { BEUVE_CLAUDE_PATH: path.join(repo.scratch(), 'claude'), PATH: '' },
    });
    const handle = value(await must(services).review.run({ sessionId }));
    const failed = await finished(handle.runId);
    expect(failed).toMatchObject({ kind: 'failed', error: { code: 'not-installed' } });
    expect(failed.kind === 'failed' && failed.error.message).toContain('BEUVE_CLAUDE_PATH');
  });

  it('maps a fixed command that does not exist to not-installed too', async () => {
    const { sessionId } = await start({ command: path.join(repo.scratch(), 'nope') });
    const handle = value(await must(services).review.run({ sessionId }));
    expect(await finished(handle.runId)).toMatchObject({
      kind: 'failed',
      error: { code: 'not-installed' },
    });
  });
});

/** For the `featureBranch` diff: two insights on changed lines, one outside it, one elsewhere. */
const reviewInsights = [
  insight('feature.rs', 2, 'warning', 'The constant hides a missing computation'),
  insight('app.rs', 2, 'risk', 'run_fast may skip validation'),
  insight('app.rs', 40, 'info', 'Outside the diff'),
  insight('missing.rs', 1, 'info', 'Not in the diff'),
];

function insight(path: string, line: number, severity: string, title: string): unknown {
  return {
    path,
    lineStart: line,
    lineEnd: line,
    severity,
    category: 'edge-case',
    title,
    body: `**${title}**: check \`${path}\` line ${String(line)}.`,
    confidence: 0.8,
  };
}

function storedId(event: ReviewProgressView): string {
  return event.kind === 'completed' ? event.summary.reviewRunId : '';
}

/** The fake's `review` mode logs one `{ args, cwd }` line per run. */
function calls(settings: ClaudeCodeSettings): { args: string[]; cwd: string }[] {
  const file = `${settings.leadingArgs?.[2] ?? ''}.calls`;
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { args: string[]; cwd: string })
    : [];
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function must<T>(item: T | undefined): T {
  if (item === undefined) {
    throw new Error('expected a value');
  }
  return item;
}

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

function steppingDeps(): SessionDeps {
  let tick = 0;
  let id = 0;
  return {
    now: (): Date => new Date(Date.UTC(2026, 9, 28, 12, 0, tick++)),
    newId: (): string => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  };
}
