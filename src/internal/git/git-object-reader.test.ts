import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { GitObjectReader } from './git-object-reader.ts';
import type { CommitSha } from './object-id.ts';
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
async function objects(repo: TestRepository): Promise<{
  readonly commit: CommitSha;
  readonly text: string;
  readonly big: string;
}> {
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
        return 'bytes' in value ? value.bytes.toString('utf8') : '';
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
    const hold = writeHoldScript(tempDir, 'git', server.port, {
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
    const crashOnce = writeCrashingGit(tempDir, text, 1);
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
    const crashTwice = writeCrashingGit(tempDir, text, 2);
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
