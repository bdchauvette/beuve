import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { GitObjectReader } from './git-object-reader.ts';
import type { CommitSha } from './object-id.ts';
import type { ObjectContent, ObjectLookup, ObjectSpec } from './object-spec.ts';
import { parseRevisionName } from './parse-revision-name.ts';
import type { RevisionName } from './parse-revision-name.ts';
import { parseTreePath } from './parse-tree-path.ts';
import type { TreePath } from './parse-tree-path.ts';
import { startHoldServer } from './testing/start-hold-server.ts';
import { test } from './testing/test.ts';
import type { TestRepository } from './testing/test-repository.ts';
import { writeCrashingGit } from './testing/write-crashing-git.ts';
import { writeHoldScript } from './testing/write-hold-script.ts';

function treePath(text: string): TreePath {
  return parseTreePath(text) ?? (text as TreePath);
}

function revision(text: string): RevisionName {
  return parseRevisionName(text) ?? (text as RevisionName);
}

/** A repository with a text file, a binary file and an 8 MiB file on `main`. */
/** The commit, and the object ids of its text and its 8 MiB file. */
interface TestObjects {
  readonly commit: CommitSha;
  readonly text: string;
  readonly big: string;
}

async function objects(repo: TestRepository): Promise<TestObjects> {
  repo.write('src/a.ts', 'export const a = 1;\n');
  repo.write('bin.dat', Uint8Array.from([0, 0x0d, 0x0a, 0xff, 0x0a, 0]));
  repo.write('big.txt', 'x'.repeat(8 * 1024 * 1024));
  const commit = await repo.commit('objects');
  return {
    commit,
    text: await repo.git('rev-parse', 'HEAD:src/a.ts'),
    big: await repo.git('rev-parse', 'HEAD:big.txt'),
  };
}

/**
 * Waits until a `read` queued before it has its `info` answered and its `contents` request sent:
 * an `info` queued now is answered after the earlier `info`s, and one turn of the event loop
 * later the follow-up `contents` has been flushed, while its megabytes are still arriving.
 */
async function contentsInFlight(objectsReader: GitObjectReader, oid: string): Promise<void> {
  okValueFrom(await objectsReader.info({ kind: 'object', oid }));
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function reader(
  repo: TestRepository,
  options: Partial<ConstructorParameters<typeof GitObjectReader>[0]> = {},
): GitObjectReader {
  return new GitObjectReader({ root: repo.directory, ...options });
}

describe('GitObjectReader', () => {
  test('reads objects by id, by path and by ref, byte for byte', async ({
    expect,
    repo,
    signal,
  }) => {
    const { commit, text } = await objects(repo);
    await using objectsReader = reader(repo);
    await expect(
      objectsReader.read({ kind: 'object', oid: text }, { signal }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        kind: 'content',
        oid: text,
        type: 'blob',
        size: 20,
        bytes: Buffer.from('export const a = 1;\n'),
      },
    });
    const binary = okValueFrom(
      await objectsReader.read({ kind: 'path', commit, path: treePath('bin.dat') }, { signal }),
    );
    expect(binary).toMatchObject({
      kind: 'content',
      bytes: Buffer.from([0, 0x0d, 0x0a, 0xff, 0x0a, 0]),
    });
    await expect(
      objectsReader.info({ kind: 'ref', ref: revision('main'), peel: 'commit' }, { signal }),
    ).resolves.toMatchObject({ ok: true, value: { kind: 'found', oid: commit, type: 'commit' } });
    await expect(
      objectsReader.info({ kind: 'ref', ref: commit, peel: 'tree' }, { signal }),
    ).resolves.toMatchObject({ ok: true, value: { kind: 'found', type: 'tree' } });
    expect(objectsReader.stats).toStrictEqual({ starts: 1, restarts: 0, isRunning: true });
  });

  test('answers missing, refuses invalid specs, and keeps going', async ({
    expect,
    repo,
    signal,
  }) => {
    const { commit, text } = await objects(repo);
    await using objectsReader = reader(repo);
    await expect(
      objectsReader.read({ kind: 'path', commit, path: treePath('nope.ts') }, { signal }),
    ).resolves.toStrictEqual({ ok: true, value: { kind: 'missing' } });
    await expect(
      objectsReader.info(
        { kind: 'ref', ref: revision('no-such-branch'), peel: 'commit' },
        { signal },
      ),
    ).resolves.toStrictEqual({ ok: true, value: { kind: 'missing' } });
    await expect(
      objectsReader.read({ kind: 'path', commit, path: '../etc/passwd' as TreePath }, { signal }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'invalid-argument' } });
    await expect(
      objectsReader.info(
        { kind: 'ref', ref: 'HEAD@{99}' as RevisionName, peel: 'commit' },
        { signal },
      ),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'invalid-argument' } });
    await expect(
      objectsReader.info({ kind: 'object', oid: 'abc' }, { signal }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument' },
    });
    await expect(
      objectsReader.info({ kind: 'object', oid: text }, { signal }),
    ).resolves.toMatchObject({
      ok: true,
      value: { kind: 'found', size: 20 },
    });
    expect(objectsReader.stats.restarts).toBe(0);
  });

  test('answers too-large from the size alone and stays in sync', async ({
    expect,
    repo,
    signal,
  }) => {
    const { big, text } = await objects(repo);
    await using objectsReader = reader(repo);
    const [large, small] = await Promise.all([
      objectsReader.read({ kind: 'object', oid: big }, { maxBytes: 1024, signal }),
      objectsReader.read({ kind: 'object', oid: text }, { maxBytes: 1024, signal }),
    ]);
    expect(large).toStrictEqual({
      ok: true,
      value: { kind: 'too-large', oid: big, type: 'blob', size: 8 * 1024 * 1024, limit: 1024 },
    });
    expect(okValueFrom(small)).toMatchObject({ kind: 'content', size: 20 });
  });

  test('pipelines many reads in order', async ({ expect, repo, signal }) => {
    const names = Array.from({ length: 50 }, (_, index) => `f${String(index)}.txt`);
    for (const [index, name] of names.entries()) {
      repo.write(name, `${String(index)}\n`.repeat(index + 1));
    }
    const commit = await repo.commit('many');
    await using objectsReader = reader(repo);
    const read = await Promise.all(
      names.map(async (name) => {
        return objectsReader.read({ kind: 'path', commit, path: treePath(name) }, { signal });
      }),
    );
    expect(
      read.map((result) => {
        const value = okValueFrom(result);
        if ('bytes' in value) {
          return value.bytes.toString('utf8');
        }
        return '';
      }),
    ).toStrictEqual(names.map((_, index) => `${String(index)}\n`.repeat(index + 1)));
    expect(objectsReader.stats.starts).toBe(1);
  });

  test('sees refs move while it runs', async ({ expect, repo, signal }) => {
    const first = await repo.commit('first');
    await using objectsReader = reader(repo);
    const main = { kind: 'ref', ref: revision('refs/heads/main'), peel: 'commit' } as const;
    await expect(objectsReader.info(main, { signal })).resolves.toMatchObject({
      value: { oid: first },
    });
    repo.write('b.txt', 'b\n');
    const second = await repo.commit('second');
    await expect(objectsReader.info(main, { signal })).resolves.toMatchObject({
      value: { oid: second },
    });
    await repo.git('pack-refs', '--all');
    await repo.git('update-ref', 'refs/heads/main', first);
    await expect(objectsReader.info(main, { signal })).resolves.toMatchObject({
      value: { oid: first },
    });
  });

  test('sees a packed ref that pack-refs rewrote at the same size within the second', async ({
    expect,
    repo,
    signal,
  }) => {
    const { first, second } = await refObjects(repo);
    await repo.git('update-ref', 'refs/heads/topic', first);
    await repo.git('update-ref', 'refs/heads/gone', first);
    await repo.git('pack-refs', '--all');
    await using objectsReader = reader(repo);
    const topic = commitOf('refs/heads/topic');
    await expect(objectsReader.info(topic, { signal })).resolves.toMatchObject({
      value: { oid: first },
    });
    await repo.git('update-ref', 'refs/heads/topic', second);
    await repo.git('update-ref', '-d', 'refs/heads/gone');
    await expect(objectsReader.info(topic, { signal })).resolves.toMatchObject({
      value: { oid: second },
    });
    await expect(objectsReader.info(commitOf('gone'), { signal })).resolves.toStrictEqual({
      ok: true,
      value: { kind: 'missing' },
    });
    // Same size, same second: git's own check of packed-refs misses this rewrite.
    await repo.git('pack-refs', '--all');
    await expect(objectsReader.info(topic, { signal })).resolves.toMatchObject({
      value: { oid: second },
    });
    expect(objectsReader.stats.restarts).toBe(0);
  });

  test('an abort answers at once and the abandoned bytes are skipped', async ({
    expect,
    repo,
    signal,
  }) => {
    const { big, text } = await objects(repo);
    await using objectsReader = reader(repo);
    const controller = new AbortController();
    const abandon = AbortSignal.any([controller.signal, signal]);
    const abandoned = objectsReader.read({ kind: 'object', oid: big }, { signal: abandon });
    const after = objectsReader.read({ kind: 'object', oid: text }, { signal });
    await contentsInFlight(objectsReader, text);
    controller.abort();
    await expect(abandoned).resolves.toMatchObject({ ok: false, error: { kind: 'aborted' } });
    expect(okValueFrom(await after)).toMatchObject({ kind: 'content', size: 20 });
    expect(objectsReader.stats).toMatchObject({ starts: 1, restarts: 0 });
  });

  test('restarts when abandoned requests owe too many bytes', async ({ expect, repo, signal }) => {
    const { big, text } = await objects(repo);
    await using objectsReader = reader(repo, { maxDrainBytes: 1024 });
    const controller = new AbortController();
    const abandon = AbortSignal.any([controller.signal, signal]);
    const abandoned = objectsReader.read({ kind: 'object', oid: big }, { signal: abandon });
    const after = objectsReader.read({ kind: 'object', oid: text }, { signal });
    await contentsInFlight(objectsReader, text);
    controller.abort();
    await expect(abandoned).resolves.toMatchObject({ ok: false, error: { kind: 'aborted' } });
    expect(okValueFrom(await after)).toMatchObject({ kind: 'content', size: 20 });
    expect(objectsReader.stats).toMatchObject({ starts: 2, restarts: 1 });
  });

  test('a request stuck at the head times out and the process restarts', async ({
    expect,
    repo,
    tempDir,
    signal,
  }) => {
    const { text } = await objects(repo);
    await using server = await startHoldServer(signal);
    const hold = writeHoldScript({ directory: tempDir, name: 'git' }, server.port, {
      kind: 'git',
      holds: [['cat-file']],
    });
    await using objectsReader = reader(repo, {
      gitBinary: hold.command,
      requestTimeout: Temporal.Duration.from({ milliseconds: 300 }),
    });
    const stuck = objectsReader.info({ kind: 'object', oid: text }, { signal });
    const behind = objectsReader.read({ kind: 'object', oid: text }, { signal });
    const first = await server.next();
    await expect(stuck).resolves.toMatchObject({ ok: false, error: { kind: 'timeout' } });
    await expect(first.ended).resolves.toBe('terminated');
    const second = await server.next();
    second.release();
    expect(okValueFrom(await behind)).toMatchObject({ kind: 'content', size: 20 });
    expect(objectsReader.stats).toMatchObject({ starts: 2, restarts: 1 });
  });

  test('after a crash, requests in flight are resent once', async ({
    expect,
    repo,
    tempDir,
    signal,
  }) => {
    const { commit, text } = await objects(repo);
    const crashOnce = writeCrashingGit(tempDir, { crashOn: text, times: 1 });
    await using objectsReader = reader(repo, { gitBinary: crashOnce });
    const [read, tree] = await Promise.all([
      objectsReader.read({ kind: 'object', oid: text }, { signal }),
      objectsReader.info({ kind: 'ref', ref: commit, peel: 'tree' }, { signal }),
    ]);
    expect(okValueFrom(read)).toMatchObject({ kind: 'content', size: 20 });
    expect(okValueFrom(tree)).toMatchObject({ kind: 'found', type: 'tree' });
    expect(objectsReader.stats).toMatchObject({ starts: 2, restarts: 1 });
  });

  test('a request that crashes it twice fails, and the next one works', async ({
    expect,
    repo,
    tempDir,
    signal,
  }) => {
    const { commit, text } = await objects(repo);
    const crashTwice = writeCrashingGit(tempDir, { crashOn: text, times: 2 });
    await using objectsReader = reader(repo, { gitBinary: crashTwice });
    await expect(
      objectsReader.info({ kind: 'object', oid: text }, { signal }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'command-failed', exitCode: 128 },
    });
    await expect(
      objectsReader.info({ kind: 'ref', ref: commit, peel: 'commit' }, { signal }),
    ).resolves.toMatchObject({ ok: true, value: { kind: 'found', oid: commit } });
  });

  test('stops when idle and starts again on the next request', async ({ expect, repo, signal }) => {
    const { text } = await objects(repo);
    await using objectsReader = reader(repo, {
      idleTimeout: Temporal.Duration.from({ seconds: 0 }),
    });
    okValueFrom(await objectsReader.info({ kind: 'object', oid: text }, { signal }));
    await expect
      .poll(
        () => {
          return objectsReader.stats.isRunning;
        },
        { timeout: 5000 },
      )
      .toBe(false);
    okValueFrom(await objectsReader.info({ kind: 'object', oid: text }, { signal }));
    expect(objectsReader.stats.starts).toBe(2);
  });

  test('disposing stops the process and answers aborted afterwards', async ({
    expect,
    repo,
    signal,
  }) => {
    const { text } = await objects(repo);
    // eslint-disable-next-line local/prefer-using -- the test is about what happens after disposal.
    const objectsReader = reader(repo);
    okValueFrom(await objectsReader.info({ kind: 'object', oid: text }, { signal }));
    await objectsReader[Symbol.asyncDispose]();
    expect(objectsReader.stats.isRunning).toBe(false);
    await expect(
      objectsReader.info({ kind: 'object', oid: text }, { signal }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'aborted' },
    });
  });

  test('a missing git answers git-not-found', async ({ expect, repo, tempDir, signal }) => {
    await using objectsReader = reader(repo, { gitBinary: `${tempDir}/no-such-git` });
    await expect(
      objectsReader.info({ kind: 'ref', ref: revision('HEAD'), peel: 'commit' }, { signal }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'git-not-found' } });
  });
});

/** Two commits on `main` (which ends at `second`) and an annotated tag `v1` of `first`. */
interface RefObjects {
  readonly first: CommitSha;
  readonly second: CommitSha;
  readonly tag: string;
}

async function refObjects(repo: TestRepository): Promise<RefObjects> {
  repo.write('a.txt', 'a\n');
  const first = await repo.commit('first');
  repo.write('b.txt', 'b\n');
  const second = await repo.commit('second');
  await repo.git('tag', '--annotate', '--message', 'v1', 'v1', first);
  return { first, second, tag: await repo.git('rev-parse', 'refs/tags/v1') };
}

/** The ref backend the repository uses, as its config records it (`files` has no entry). */
async function refStorageOf(repo: TestRepository): Promise<string> {
  return repo.git('config', '--default', 'files', 'extensions.refStorage');
}

function commitOf(ref: string): ObjectSpec {
  return { kind: 'ref', ref: revision(ref), peel: 'commit' };
}

/** The object id a lookup found, or what it answered instead. */
function oidOf(lookup: ObjectLookup | ObjectContent): string {
  if (lookup.kind === 'missing' || lookup.kind === 'ambiguous') {
    return lookup.kind;
  }
  return lookup.oid;
}

/** Where `ref` peels to a commit, through `objectsReader`. */
interface RefLookup {
  readonly ref: string;
  readonly signal: AbortSignal;
}

async function oidAt(objectsReader: GitObjectReader, { ref, signal }: RefLookup): Promise<string> {
  const found = await objectsReader.info(commitOf(ref), { signal });
  return oidOf(okValueFrom(found));
}

/** Moves `main` between `first` and `second` 40 times from separate git processes. */
async function keepMovingMain(repo: TestRepository, { first, second }: RefObjects): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    await repo.git('update-ref', 'refs/heads/main', first);
    await repo.git('update-ref', 'refs/heads/main', second);
  }
}

/**
 * The reader against the newest git's ref backend (ADR 0087): reftable where git is 2.45 or
 * newer, which CI guarantees with `BEUVE_REQUIRE_REFTABLE=1`; the files backend elsewhere.
 */
describe('GitObjectReader on the newest git’s ref backend', () => {
  test('looks up branches, tags, HEAD and full ref names', async ({
    expect,
    newestGitRepo: { repo, git },
    signal,
  }) => {
    await expect(refStorageOf(repo)).resolves.toBe(git.refFormat);
    const { first, second, tag } = await refObjects(repo);
    await repo.git('branch', 'feature/nested', first);
    await repo.git('tag', 'light', second);
    await using objectsReader = reader(repo, { gitBinary: git.binary });
    const refs = ['main', 'refs/heads/main', 'HEAD', 'feature/nested', 'light', 'v1'];
    const found = await Promise.all(
      refs.map(async (ref) => {
        return oidAt(objectsReader, { ref, signal });
      }),
    );
    expect(found).toStrictEqual([second, second, second, first, second, first]);
    await expect(objectsReader.info(commitOf('no-such-branch'), { signal })).resolves.toStrictEqual(
      { ok: true, value: { kind: 'missing' } },
    );
    await expect(
      objectsReader.info({ kind: 'object', oid: tag }, { signal }),
    ).resolves.toMatchObject({ ok: true, value: { kind: 'found', type: 'tag' } });
    expect(objectsReader.stats).toStrictEqual({ starts: 1, restarts: 0, isRunning: true });
  });

  test('sees refs another git process moves, makes and deletes while it runs', async ({
    expect,
    newestGitRepo: { repo, git },
    signal,
  }) => {
    const { first, second } = await refObjects(repo);
    await using objectsReader = reader(repo, { gitBinary: git.binary });
    const main = commitOf('refs/heads/main');
    await expect(objectsReader.info(main, { signal })).resolves.toMatchObject({
      value: { oid: second },
    });
    await repo.git('update-ref', 'refs/heads/main', first);
    await expect(objectsReader.info(main, { signal })).resolves.toMatchObject({
      value: { oid: first },
    });
    await repo.git('update-ref', 'refs/heads/late', second);
    await expect(objectsReader.info(commitOf('late'), { signal })).resolves.toMatchObject({
      value: { oid: second },
    });
    await repo.git('update-ref', '-d', 'refs/heads/late');
    await expect(objectsReader.info(commitOf('late'), { signal })).resolves.toStrictEqual({
      ok: true,
      value: { kind: 'missing' },
    });
    expect(objectsReader.stats).toMatchObject({ starts: 1, restarts: 0 });
  });

  test('answers every lookup while another process keeps moving the ref', async ({
    expect,
    newestGitRepo: { repo, git },
    signal,
  }) => {
    const objects = await refObjects(repo);
    await using objectsReader = reader(repo, { gitBinary: git.binary });
    const main = commitOf('refs/heads/main');
    const lookups: Promise<string>[] = [];
    const state = { isMoving: true };
    const moving = (async (): Promise<void> => {
      await keepMovingMain(repo, objects);
      state.isMoving = false;
    })();
    while (state.isMoving) {
      const batch = Array.from({ length: 8 }, async () => {
        return oidAt(objectsReader, { ref: 'refs/heads/main', signal });
      });
      lookups.push(...batch);
      await Promise.all(batch);
    }
    await moving;
    const seen = new Set(await Promise.all(lookups));
    expect(lookups.length).toBeGreaterThan(8);
    expect(seen).toStrictEqual(new Set([objects.first, objects.second]));
    await expect(objectsReader.info(main, { signal })).resolves.toMatchObject({
      value: { oid: objects.second },
    });
    expect(objectsReader.stats).toMatchObject({ starts: 1, restarts: 0 });
  });

  test('stays fresh across packing and compaction, during reads too', async ({
    expect,
    newestGitRepo: { repo, git },
    signal,
  }) => {
    const { first, second } = await refObjects(repo);
    await using objectsReader = reader(repo, { gitBinary: git.binary });
    const names = Array.from({ length: 30 }, (_, index) => `refs/heads/many-${String(index)}`);
    for (const name of names) {
      // One process per ref: the reftable backend compacts its stack as tables pile up.
      await repo.git('update-ref', name, first);
    }
    await expect(objectsReader.info(commitOf('many-29'), { signal })).resolves.toMatchObject({
      value: { oid: first },
    });
    const reads = Promise.all(
      names.map(async (name) => {
        return oidAt(objectsReader, { ref: name, signal });
      }),
    );
    await repo.git('pack-refs', '--all');
    await expect(reads).resolves.toStrictEqual(names.map(() => first));
    await repo.git('update-ref', 'refs/heads/many-0', second);
    await repo.git('update-ref', '-d', 'refs/heads/many-1');
    await expect(objectsReader.info(commitOf('many-0'), { signal })).resolves.toMatchObject({
      value: { oid: second },
    });
    await expect(objectsReader.info(commitOf('many-1'), { signal })).resolves.toStrictEqual({
      ok: true,
      value: { kind: 'missing' },
    });
    await repo.git('pack-refs', '--all');
    await expect(objectsReader.info(commitOf('many-0'), { signal })).resolves.toMatchObject({
      value: { oid: second },
    });
    await expect(objectsReader.info(commitOf('main'), { signal })).resolves.toMatchObject({
      value: { oid: second },
    });
    expect(objectsReader.stats.restarts).toBe(0);
  });

  test('info and read by ref and peel', async ({
    expect,
    newestGitRepo: { repo, git },
    signal,
  }) => {
    const { first } = await refObjects(repo);
    const tree = await repo.git('rev-parse', 'v1^{tree}');
    await using objectsReader = reader(repo, { gitBinary: git.binary });
    await expect(
      objectsReader.info({ kind: 'ref', ref: revision('v1'), peel: 'tree' }, { signal }),
    ).resolves.toMatchObject({ ok: true, value: { kind: 'found', oid: tree, type: 'tree' } });
    const commit = okValueFrom(await objectsReader.read(commitOf('v1'), { signal }));
    expect(commit).toMatchObject({
      kind: 'content',
      oid: first,
      type: 'commit',
      bytes: Buffer.from(`${await repo.git('cat-file', 'commit', first)}\n`),
    });
    const mainTree = okValueFrom(
      await objectsReader.read({ kind: 'ref', ref: revision('main'), peel: 'tree' }, { signal }),
    );
    expect(mainTree).toMatchObject({ kind: 'content', type: 'tree' });
    await repo.git('update-ref', 'refs/heads/main', first);
    await expect(objectsReader.read(commitOf('main'), { signal })).resolves.toMatchObject({
      ok: true,
      value: { kind: 'content', oid: first },
    });
    await expect(
      objectsReader.read(commitOf('main'), { signal, maxBytes: 1 }),
    ).resolves.toMatchObject({ ok: true, value: { kind: 'too-large', oid: first } });
  });
});
