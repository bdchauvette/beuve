import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import type { CommitSha } from '../object-id.ts';
import type { TestRepository } from './test-repository.ts';

/**
 * Drives the existing repository at `<home>/repo`. `home` is also its `HOME` and
 * `XDG_CONFIG_HOME`, isolating git from the caller's `GIT_*` environment, global and system
 * config, and holds `scratch` directories. `cleanup` removes `home`.
 */
export function openTestRepository(home: string): TestRepository {
  const directory = path.join(home, 'repo');
  let scratchCount = 0;
  const environment = testEnvironment(home);

  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: directory, env: environment, encoding: 'utf8' }).trim();

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
      const created = path.join(home, `scratch-${String(scratchCount)}`);
      mkdirSync(created);
      return created;
    },
    cleanup: (): void => {
      rmSync(home, { recursive: true, force: true });
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
