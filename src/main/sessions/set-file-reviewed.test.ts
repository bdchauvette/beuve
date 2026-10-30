import { describe } from 'vitest';

import type { ReviewView } from '#contract/ipc-contract.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import type { MainServices } from '../main-services.ts';
import { lines } from '../testing/lines.ts';
import { test } from '../testing/test.ts';

describe('review:set-file-reviewed (integration: SQLite + git)', { timeout: 30_000 }, () => {
  test('carries a mark over a push that leaves the file alone and flags a changed one', async ({
    expect,
    services: { sessions },
    repo,
    signal,
  }) => {
    const id = await startReview(repo, sessions);
    const first = okValueFrom(await sessions.getReview({ sessionId: id }, { signal }));
    expect(states(first)).toStrictEqual([
      ['a.txt', 'no'],
      ['b.txt', 'no'],
    ]);
    expect(first.reviewProgress).toStrictEqual({
      total: 2,
      reviewed: 0,
      changedSince: 0,
      unreviewed: 2,
    });

    const marked = okValueFrom(
      await sessions.setFileReviewed({
        sessionId: id,
        path: 'a.txt',
        reviewed: true,
        expectedHeadSha: first.headSha,
      }),
    );
    expect(marked).toMatchObject({
      reviewed: 'yes',
      progress: { total: 2, reviewed: 1, unreviewed: 1 },
    });
    okValueFrom(
      await sessions.setFileReviewed({
        sessionId: id,
        path: 'b.txt',
        reviewed: true,
        expectedHeadSha: await featureHead(repo),
      }),
    );

    await repo.git('switch', '--quiet', 'feature');
    repo.write('b.txt', lines(['b1', 'b2 changed again']));
    repo.write('c.txt', lines(['c']));
    await repo.commit('follow-up');
    const second = okValueFrom(await sessions.getReview({ sessionId: id }, { signal }));
    expect(second.scope).toMatchObject({ kind: 'full' });
    expect(states(second)).toStrictEqual([
      ['a.txt', 'yes'],
      ['b.txt', 'changed-since'],
      ['c.txt', 'no'],
    ]);
    expect(second.reviewProgress).toStrictEqual({
      total: 3,
      reviewed: 1,
      changedSince: 1,
      unreviewed: 1,
    });
  });

  test('keeps a mark when the head is rebased onto new upstream work', async ({
    expect,
    services: { sessions },
    repo,
    signal,
  }) => {
    const id = await startReview(repo, sessions);
    okValueFrom(
      await sessions.setFileReviewed({
        sessionId: id,
        path: 'a.txt',
        reviewed: true,
        expectedHeadSha: await featureHead(repo),
      }),
    );
    await repo.git('switch', '--quiet', 'main');
    repo.write('upstream.txt', lines(['new upstream']));
    await repo.commit('upstream');
    await repo.git('switch', '--quiet', 'feature');
    await repo.git('rebase', '--quiet', 'main');
    const rebased = okValueFrom(await sessions.getReview({ sessionId: id }, { signal }));
    expect(states(rebased)).toStrictEqual([
      ['a.txt', 'yes'],
      ['b.txt', 'no'],
    ]);
  });

  test('follows a renamed file and shows an interdiff file as changed since the mark', async ({
    expect,
    services: { sessions },
    repo,
    signal,
  }) => {
    const id = await startReview(repo, sessions);
    okValueFrom(
      await sessions.setFileReviewed({
        sessionId: id,
        path: 'a.txt',
        reviewed: true,
        expectedHeadSha: await featureHead(repo),
      }),
    );
    await repo.git('switch', '--quiet', 'feature');
    await repo.git('mv', 'a.txt', 'renamed.txt');
    await repo.commit('rename a');
    const renamed = okValueFrom(await sessions.getReview({ sessionId: id }, { signal }));
    expect(states(renamed)).toStrictEqual([
      ['b.txt', 'no'],
      ['renamed.txt', 'yes'],
    ]);
    okValueFrom(
      await sessions.setFileReviewed({
        sessionId: id,
        path: 'renamed.txt',
        reviewed: true,
        expectedHeadSha: await featureHead(repo),
      }),
    );

    okValueFrom(
      await sessions.markReviewed({ sessionId: id, expectedHeadSha: await featureHead(repo) }),
    );
    repo.write('renamed.txt', lines(['a1', 'a2', 'a3']));
    await repo.commit('extend');
    const interdiff = okValueFrom(await sessions.getReview({ sessionId: id }, { signal }));
    expect(interdiff.scope.kind).toBe('interdiff');
    expect(states(interdiff)).toStrictEqual([['renamed.txt', 'changed-since']]);
  });

  test('clears a mark, refuses a stale head and an unknown path', async ({
    expect,
    services: { sessions },
    repo,
  }) => {
    const id = await startReview(repo, sessions);
    okValueFrom(
      await sessions.setFileReviewed({
        sessionId: id,
        path: 'a.txt',
        reviewed: true,
        expectedHeadSha: await featureHead(repo),
      }),
    );
    const cleared = okValueFrom(
      await sessions.setFileReviewed({
        sessionId: id,
        path: 'a.txt',
        reviewed: false,
        expectedHeadSha: await featureHead(repo),
      }),
    );
    expect(cleared).toMatchObject({ reviewed: 'no', progress: { reviewed: 0, unreviewed: 2 } });
    await expect(
      sessions.setFileReviewed({
        sessionId: id,
        path: 'a.txt',
        reviewed: true,
        expectedHeadSha: 'a'.repeat(40),
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'stale-review' } });
    await expect(
      sessions.setFileReviewed({
        sessionId: id,
        path: 'nope.txt',
        reviewed: true,
        expectedHeadSha: await featureHead(repo),
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  test('keeps marks independent of the whitespace variant', async ({
    expect,
    services: { sessions },
    repo,
    signal,
  }) => {
    const id = await startReview(repo, sessions);
    okValueFrom(
      await sessions.setFileReviewed({
        sessionId: id,
        path: 'a.txt',
        reviewed: true,
        expectedHeadSha: await featureHead(repo),
      }),
    );
    const ignoring = okValueFrom(
      await sessions.getReview({ sessionId: id, ignoreWhitespace: true }, { signal }),
    );
    expect(states(ignoring)).toStrictEqual([
      ['a.txt', 'yes'],
      ['b.txt', 'no'],
    ]);
  });
});

/** main: base.txt; feature: adds a.txt and b.txt. Leaves main checked out. */
async function startReview(
  repo: TestRepository,
  sessions: MainServices['sessions'],
): Promise<string> {
  repo.write('base.txt', lines(['base']));
  await repo.commit('base');
  await repo.git('switch', '--quiet', '--create', 'feature');
  repo.write('a.txt', lines(['a1', 'a2']));
  repo.write('b.txt', lines(['b1', 'b2']));
  await repo.commit('add a and b');
  await repo.git('switch', '--quiet', 'main');
  const created = okValueFrom(
    await sessions.createLocal({ repoPath: repo.directory, baseRef: 'main', headRef: 'feature' }),
  );
  return created.id;
}

async function featureHead(repo: TestRepository): Promise<string> {
  return repo.git('rev-parse', 'feature');
}

function states(review: ReviewView): [string, string | undefined][] {
  return review.files.map((file) => [file.path, file.reviewed]);
}
