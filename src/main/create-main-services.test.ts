import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IpcResult, ReviewView } from '#contract/ipc-contract.ts';
import { createTestRepository } from '#internal/git/testing/create-test-repository.ts';
import type { TestRepository } from '#internal/git/testing/create-test-repository.ts';
import type { SessionDeps } from '#internal/session/session.ts';
import { createLogger } from '#pkg/logger/create-logger.ts';

import { createMainServices } from './create-main-services.ts';
import { openAppDatabase } from './database/open-app-database.ts';
import type { SessionServices } from './main-services.ts';

const featureLines = ['pub fn feature() -> u8 {', '  1', '}'];

describe('createMainServices (integration: SQLite + git, no Electron)', () => {
  let repo: TestRepository;
  let db: DatabaseSync;
  let sessions: SessionServices;

  beforeEach(() => {
    repo = createTestRepository();
    db = openAppDatabase(':memory:');
    sessions = createMainServices({
      db,
      logger: createLogger('test', { sink: (): void => undefined }),
      deps: steppingDeps(),
    }).sessions;
  });

  afterEach(() => {
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
