import path from 'node:path';

import type { GitRepository } from '#internal/git/open-repository.ts';

/** Agents often pass paths in the user's checkout; those map to the same relative path. */
export function repositoryRelativePathFrom(repository: GitRepository, requested: string): string {
  if (!path.isAbsolute(requested)) {
    return requested;
  }
  const relative = path.relative(repository.root, requested);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return requested;
  }
  return relative;
}
