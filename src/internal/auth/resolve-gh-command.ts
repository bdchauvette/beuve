import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { AuthError } from './auth-error.ts';

const executableNames: Partial<Record<NodeJS.Platform, string>> = { win32: 'gh.exe' };

export interface ResolveGhCommandOptions {
  /** Where `BEUVE_GH_PATH` and `PATH` are read. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** For `~/.local/bin/gh`. Defaults to `os.homedir()`. */
  readonly homeDirectory?: string;
  /** Tried after the override and before `PATH`. Defaults to Homebrew, `/usr/local` and `~/.local`. */
  readonly wellKnownPaths?: readonly string[];
}

/**
 * The absolute path of the user's `gh`. GUI apps on macOS start with a minimal `PATH` that lacks
 * Homebrew, so this tries, in order: `BEUVE_GH_PATH` (which must then be an executable file:
 * a broken override fails instead of silently using another `gh`), `/opt/homebrew/bin/gh`,
 * `/usr/local/bin/gh`, `~/.local/bin/gh`, then each absolute `PATH` entry.
 */
export async function resolveGhCommand(
  options: ResolveGhCommandOptions = {},
): Promise<Result<string, Extract<AuthError, { kind: 'cli-not-installed' }>>> {
  const env = options.env ?? process.env;
  const override = env['BEUVE_GH_PATH'];
  if (override !== undefined && override !== '') {
    if (path.isAbsolute(override) && (await isExecutableFile(override))) {
      return ok(override);
    }
    return err({
      kind: 'cli-not-installed',
      searched: [override],
      reason: 'BEUVE_GH_PATH is not an absolute path to an executable file',
    });
  }
  const home = options.homeDirectory ?? os.homedir();
  const wellKnown = options.wellKnownPaths ?? [
    '/opt/homebrew/bin/gh',
    '/usr/local/bin/gh',
    path.join(home, '.local', 'bin', 'gh'),
  ];
  const name = executableNames[process.platform] ?? 'gh';
  const fromPath = (env['PATH'] ?? '')
    .split(path.delimiter)
    .filter((directory) => path.isAbsolute(directory))
    .map((directory) => path.join(directory, name));
  const candidates = [...new Set([...wellKnown, ...fromPath])];
  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) {
      return ok(candidate);
    }
  }
  return err({ kind: 'cli-not-installed', searched: candidates });
}

async function isExecutableFile(file: string): Promise<boolean> {
  try {
    const stats = await stat(file);
    if (!stats.isFile()) {
      return false;
    }
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
