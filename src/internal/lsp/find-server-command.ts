import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { LspError } from './lsp-error.ts';

export interface FindServerCommandRequest {
  readonly serverId: string;
  /** A bare executable name, or an absolute path that is only checked. */
  readonly command: string;
  /** Directories searched first, in order (e.g. beuve's own `node_modules/.bin`). */
  readonly searchDirectories: readonly string[];
  /** The `PATH` value searched last; `undefined` skips it. */
  readonly pathVariable: string | undefined;
}

/**
 * Locates a language server executable without a shell: an absolute `command` must be an
 * executable file; a bare name is looked up in `searchDirectories`, then in each absolute `PATH`
 * entry. Names with path separators other than absolute paths are refused.
 */
export async function findServerCommand(
  request: FindServerCommandRequest,
): Promise<Result<string, LspError>> {
  const { serverId, command } = request;
  if (path.isAbsolute(command)) {
    return (await isExecutableFile(command))
      ? ok(command)
      : err({ kind: 'server-not-found', serverId, command, searched: [command] });
  }
  if (
    command.length === 0 ||
    command.includes('/') ||
    command.includes('\\') ||
    command.includes('\0')
  ) {
    return err({ kind: 'server-not-found', serverId, command, searched: [] });
  }
  const pathEntries = (request.pathVariable ?? '')
    .split(path.delimiter)
    .filter((entry) => path.isAbsolute(entry));
  const directories = [...new Set([...request.searchDirectories, ...pathEntries])];
  const searched: string[] = [];
  for (const directory of directories) {
    const candidate = path.join(directory, command);
    searched.push(candidate);
    if (await isExecutableFile(candidate)) {
      return ok(candidate);
    }
  }
  return err({ kind: 'server-not-found', serverId, command, searched });
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    const stats = await stat(candidate);
    if (!stats.isFile()) {
      return false;
    }
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
