import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import type { CommitSha } from '../object-id.ts';
import type { TestRepository } from './test-repository.ts';

/**
 * Drives the existing repository at `<home>/repo`. `home` is also its `HOME` and
 * `XDG_CONFIG_HOME`, isolating git from the caller's `GIT_*` environment, global and system
 * config, and holds `scratch` directories. `cleanup` removes `home`. Auto-maintenance is off: after
 * `git commit` it would otherwise keep a background `git maintenance` running, which creates and
 * removes `.git/objects/maintenance.lock` while a template is being copied (ENOENT in `fs.cp`).
 * `signal`, a test's, kills the git commands still running when it aborts.
 */
export function openTestRepository(home: string, signal?: AbortSignal): TestRepository {
  const directory = path.join(home, 'repo');
  let scratchCount = 0;
  const environment = testEnvironment(home);
  const execFileAsync = promisify(execFile);

  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync('git', args, {
      cwd: directory,
      env: environment,
      encoding: 'utf8',
      signal,
    });
    return stdout.trim();
  };

  return {
    directory,
    git,
    write: (file, content): void => {
      const target = path.join(directory, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    },
    commit: async (message): Promise<CommitSha> => {
      await git('add', '--all');
      await git('commit', '--quiet', '--allow-empty', '--message', message);
      return (await git('rev-parse', 'HEAD')) as CommitSha;
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
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'maintenance.auto',
    GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'gc.auto',
    GIT_CONFIG_VALUE_1: '0',
    LC_ALL: 'C',
  };
}
