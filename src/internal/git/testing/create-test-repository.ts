import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import type { CommitSha } from '../object-id.ts';

/** A throwaway repository for integration tests, driven synchronously. */
export interface TestRepository {
  /** Real (symlink-free) path of the repository's top level. */
  readonly directory: string;
  /** Runs git in the repository and returns trimmed stdout; throws on failure. */
  readonly git: (...args: string[]) => string;
  /** Writes a file relative to the repository, creating parent directories. */
  readonly write: (file: string, content: string | Uint8Array) => void;
  /** Stages everything and commits, returning the new commit's sha. */
  readonly commit: (message: string) => CommitSha;
  /** A fresh empty temporary directory, removed by `cleanup`. */
  readonly scratch: () => string;
  readonly cleanup: () => void;
}

/**
 * Creates a repository on branch `main` in a new temporary directory, with a local identity and
 * signing off, isolated from the caller's `GIT_*` environment, global and system config.
 */
export function createTestRepository(): TestRepository {
  const prefix = path.join(os.tmpdir(), 'beuve-git-');
  const parent = realpathSync(mkdtempSync(prefix));
  const directory = path.join(parent, 'repo');
  mkdirSync(directory);
  let scratchCount = 0;

  const git = (...args: string[]): string =>
    execFileSync('git', args, {
      cwd: directory,
      env: testEnvironment(parent),
      encoding: 'utf8',
    }).trim();

  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'Beuve Test');
  git('config', 'user.email', 'test@beuve.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');

  return {
    directory,
    git,
    write: (file, content): void => {
      const target = path.join(directory, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    },
    commit: (message): CommitSha => {
      git('add', '--all');
      git('commit', '--quiet', '--allow-empty', '--message', message);
      return git('rev-parse', 'HEAD') as CommitSha;
    },
    scratch: (): string => {
      scratchCount += 1;
      const created = path.join(parent, `scratch-${String(scratchCount)}`);
      mkdirSync(created);
      return created;
    },
    cleanup: (): void => {
      rmSync(parent, { recursive: true, force: true });
    },
  };
}

function testEnvironment(home: string): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(
    ([key]) => !key.toUpperCase().startsWith('GIT_'),
  );
  return {
    ...Object.fromEntries(inherited),
    HOME: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
  };
}
