import path from 'node:path';

import type { GitRepository } from '#internal/git/open-repository.ts';

/** Agents often pass paths in the user's checkout; those map to the same relative path. */
export function toRepositoryRelativePath(repository: GitRepository, requested: string): string {
  if (!path.isAbsolute(requested)) {
    return requested;
  }
  const relative = path.relative(repository.root, requested);
  return relative.startsWith('..') || path.isAbsolute(relative) ? requested : relative;
}
