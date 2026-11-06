import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { isWithinDirectory } from './is-within-directory.ts';
import type { LspError } from './lsp-error.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';

/** A server program that came with the checkout, and where to look for it. */
export interface ProjectCommand {
  readonly serverId: string;
  /** The checkout (real path); nothing outside it is run. */
  readonly workspace: WorkspaceRoot;
  /** A path relative to the checkout, such as `node_modules/.bin/eslint-language-server`. */
  readonly command: string;
}

/**
 * The file a `project` server (ADR 0111) runs: `command` taken relative to the checkout. This
 * is code from the branch under review, so the reviewer's own configuration must have asked for it
 * (the trust check's rule); here it must also stay inside the checkout after links are followed,
 * so a planted link cannot point at a program elsewhere. An absolute path, a missing file, a
 * directory or a path that leaves the checkout is `server-not-found`.
 */
export async function resolveProjectCommand(
  project: ProjectCommand,
): Promise<Result<string, LspError>> {
  const { serverId, workspace, command } = project;
  const notFound = (searched: string): LspError => {
    return { kind: 'server-not-found', serverId, command, searched: [searched] };
  };
  if (command.includes('\0') || path.isAbsolute(command)) {
    return err(notFound(workspace));
  }
  const candidate = path.resolve(workspace, command);
  if (!isWithinDirectory(workspace, candidate)) {
    return err(notFound(candidate));
  }
  try {
    const real = await realpath(candidate);
    const stats = await stat(real);
    if (!isWithinDirectory(workspace, real) || !stats.isFile()) {
      return err(notFound(candidate));
    }
    return ok(real);
  } catch {
    return err(notFound(candidate));
  }
}
