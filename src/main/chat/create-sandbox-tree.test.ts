import { spawn } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { describe } from 'vitest';

import { hostilePathNames } from '#internal/git/testing/hostile-path-names.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import { createReadOnlySandbox } from '#internal/llm/create-read-only-sandbox.ts';
import type { ReadOnlySandbox, SandboxLimits } from '#internal/llm/create-read-only-sandbox.ts';
import { systemSessionDeps } from '#internal/session/system-session-deps.ts';
import type { Closing, RecordingLogger } from '#testing/test.ts';

import { createGitCaches } from '../sessions/create-git-caches.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import { test } from '../testing/test.ts';
import { createSandboxTree } from './create-sandbox-tree.ts';

function sandboxAt(
  closing: Closing,
  logger: RecordingLogger,
  repository: GitRepository,
  commit: CommitSha,
  limits: SandboxLimits = {},
): ReadOnlySandbox {
  const context: SessionContext = {
    db: undefined as unknown as SessionContext['db'],
    logger: logger.logger,
    deps: systemSessionDeps,
    git: {},
    caches: closing(createGitCaches()),
  };
  return createReadOnlySandbox(createSandboxTree(context, repository, commit), limits);
}

/** What the checkout shows at `file` right now, or `gone` between the swapper's renames. */
async function readOrGone(file: string, signal: AbortSignal): Promise<string> {
  try {
    return await readFile(file, { encoding: 'utf8', signal });
  } catch {
    return 'gone';
  }
}

/** Swaps `directory` for a link to `outside` and back, as fast as it can, until killed. */
function swapper(directory: string, outside: string): string {
  return `
    const fs = require('node:fs');
    const [directory, outside] = ${JSON.stringify([directory, outside])};
    const parked = directory + '.parked';
    for (;;) {
      try {
        fs.renameSync(directory, parked);
        fs.symlinkSync(outside, directory);
        fs.unlinkSync(directory);
        fs.renameSync(parked, directory);
      } catch {}
    }
  `;
}

describe('the chat sandbox over git objects (ADR 0087)', { timeout: 60_000 }, () => {
  test('reads, globs and greps the pinned commit, never the checkout', async ({
    expect,
    repo,
    repository,
    closing,
    logger,
  }) => {
    repo.write('src/a.ts', 'export const a = 1;\n');
    repo.write('src/b.ts', 'import { a } from "./a.ts";\n');
    const commit = await repo.commit('pinned');
    repo.write('src/a.ts', 'export const a = 2; // edited after the commit\n');
    repo.write('untracked.ts', 'export const a = 3;\n');
    const sandbox = sandboxAt(closing, logger, repository, commit);
    await expect(sandbox.run('read_file', '{"path":"src/a.ts"}')).resolves.toStrictEqual({
      output: '1\texport const a = 1;\n2\t',
      denied: false,
    });
    await expect(sandbox.run('glob', '{"pattern":"**/*.ts"}')).resolves.toStrictEqual({
      output: 'src/a.ts\nsrc/b.ts',
      denied: false,
    });
    await expect(sandbox.run('grep', '{"pattern":"const a"}')).resolves.toStrictEqual({
      output: 'src/a.ts:1: export const a = 1;',
      denied: false,
    });
    await expect(sandbox.run('read_file', '{"path":"untracked.ts"}')).resolves.toStrictEqual({
      output: 'not found: untracked.ts',
      denied: false,
    });
  });

  test('a directory swapped for a link to outside the checkout never leaks', async ({
    expect,
    repo,
    repository,
    closing,
    logger,
    tempDir,
    signal,
  }) => {
    repo.write('dir/a.txt', 'inside\n');
    const commit = await repo.commit('inside');
    const outside = path.join(tempDir, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'a.txt'), 'secret\n');
    const directory = path.join(repo.directory, 'dir');
    const child = spawn(process.execPath, ['-e', swapper(directory, outside)], {
      stdio: 'ignore',
      signal,
    });
    closing({
      dispose: (): void => {
        child.kill('SIGKILL');
      },
    });
    const sandbox = sandboxAt(closing, logger, repository, commit);
    const seen = { sandbox: new Set<string>(), checkout: new Set<string>() };
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const [read, onDisk] = await Promise.all([
        sandbox.run('read_file', '{"path":"dir/a.txt"}'),
        readOrGone(path.join(directory, 'a.txt'), signal),
      ]);
      seen.sandbox.add(read.output);
      seen.checkout.add(onDisk.trim());
    }
    expect(seen.checkout).toContain('secret');
    expect([...seen.sandbox]).toStrictEqual(['1\tinside\n2\t']);
  });

  test('lists, reads and greps hostile file names', async ({
    expect,
    repo,
    repository,
    closing,
    logger,
  }) => {
    const names = hostilePathNames();
    for (const name of names) {
      repo.write(name, `content of ${JSON.stringify(name)}\n`);
    }
    const commit = await repo.commit('hostile');
    const sandbox = sandboxAt(closing, logger, repository, commit);
    const globbed = await sandbox.run('glob', '{"pattern":"**"}');
    // `*` and `**` never span a newline, so the name holding one is left out, as before.
    expect(new Set(globbed.output.split('\n'))).toStrictEqual(
      new Set(names.filter((name) => !name.includes('\n'))),
    );
    const read = await Promise.all(
      names.map(async (name) => sandbox.run('read_file', JSON.stringify({ path: name }))),
    );
    expect(read.map((result) => result.output)).toStrictEqual(
      names.map((name) => `1\tcontent of ${JSON.stringify(name)}\n2\t`),
    );
    const grepped = await sandbox.run('grep', '{"pattern":"content of"}');
    expect(grepped.output.split('\n')).toHaveLength(names.length + 1);
  });

  test('follows in-tree links, refuses links out, and leaves the filesystem alone', async ({
    expect,
    repo,
    repository,
    closing,
    logger,
  }) => {
    repo.write('src/a.ts', 'export const a = 1;\n');
    symlinkSync('src', path.join(repo.directory, 'lib'));
    symlinkSync('/etc/passwd', path.join(repo.directory, 'passwd'));
    symlinkSync('../outside', path.join(repo.directory, 'up'));
    const commit = await repo.commit('links');
    const sandbox = sandboxAt(closing, logger, repository, commit);
    await expect(sandbox.run('read_file', '{"path":"lib/a.ts"}')).resolves.toStrictEqual({
      output: '1\texport const a = 1;\n2\t',
      denied: false,
    });
    await expect(sandbox.run('read_file', '{"path":"passwd"}')).resolves.toStrictEqual({
      output: 'refused: passwd links outside the working directory',
      denied: true,
    });
    await expect(sandbox.run('read_file', '{"path":"up"}')).resolves.toStrictEqual({
      output: 'refused: up links outside the working directory',
      denied: true,
    });
  });

  test('refuses oversized and binary blobs, and cuts long ones', async ({
    expect,
    repo,
    repository,
    closing,
    logger,
  }) => {
    repo.write('big.txt', 'x'.repeat(2 * 1024 * 1024));
    repo.write('long.txt', `${'y'.repeat(100)}\n`);
    repo.write('image.png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
    const commit = await repo.commit('sizes');
    const sandbox = sandboxAt(closing, logger, repository, commit, {
      maxBlobBytes: 1024 * 1024,
      maxFileBytes: 10,
    });
    await expect(sandbox.run('read_file', '{"path":"big.txt"}')).resolves.toStrictEqual({
      output: 'not a readable text file: big.txt',
      denied: false,
    });
    await expect(sandbox.run('read_file', '{"path":"long.txt"}')).resolves.toStrictEqual({
      output: '1\tyyyyyyyyyy\n[cut at 10 bytes]',
      denied: false,
    });
    await expect(sandbox.run('read_file', '{"path":"image.png"}')).resolves.toStrictEqual({
      output: 'not a readable text file: image.png',
      denied: false,
    });
    await expect(sandbox.run('grep', '{"pattern":"PNG"}')).resolves.toStrictEqual({
      output: 'no matches',
      denied: false,
    });
  });
});
