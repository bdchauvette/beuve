import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { resolveWorkspaceRoot } from './resolve-workspace-root.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';

/** Where to look for a server's root. */
export interface ServerRootRequest {
  /** The checkout (real path). Nothing outside it is looked at. */
  readonly workspace: WorkspaceRoot;
  /** Absolute real path of a file inside the checkout. */
  readonly file: string;
  /** Names of files or directories that mark a root, such as `go.mod` or `pyproject.toml`. */
  readonly markers: readonly string[];
}

/**
 * The root a language server should run in for `file` (ADR 0111): the nearest directory, from the
 * file's own up to the checkout, that holds one of the `markers`; the checkout itself when none
 * does or there are no markers. A monorepo with several Go modules thus gets one server per
 * module. Only names are listed: nothing a marker contains is read, and the walk never leaves the
 * checkout, so a marker outside it (or behind a link) cannot move a server's root.
 */
export async function findServerRoot(request: ServerRootRequest): Promise<WorkspaceRoot> {
  const { workspace, markers } = request;
  if (markers.length === 0) {
    return workspace;
  }
  let directory = path.dirname(request.file);
  while (isInside(workspace, directory)) {
    if (await hasAnyMarker(directory, markers)) {
      return await canonical(directory, workspace);
    }
    if (directory === workspace) {
      break;
    }
    directory = path.dirname(directory);
  }
  return workspace;
}

function isInside(workspace: WorkspaceRoot, directory: string): boolean {
  const relative = path.relative(workspace, directory);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function hasAnyMarker(directory: string, markers: readonly string[]): Promise<boolean> {
  try {
    const names = new Set(await readdir(directory));
    return markers.some((marker) => names.has(marker));
  } catch {
    return false;
  }
}

async function canonical(directory: string, workspace: WorkspaceRoot): Promise<WorkspaceRoot> {
  const resolved = await resolveWorkspaceRoot(directory);
  if (resolved.ok) {
    return resolved.value;
  }
  return workspace;
}
