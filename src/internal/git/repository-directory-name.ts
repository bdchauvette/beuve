import { createHash } from 'node:crypto';
import path from 'node:path';

import type { RepositoryPath } from './open-repository.ts';

const unsafeNameCharacters = /[^\w.-]+/gu;
const leadingDotsOrDashes = /^[.-]+/u;

/**
 * The directory a repository's worktrees live in under a root: `<repo-name>-<hash of repo path>`.
 * Deterministic, and distinct for distinct repositories with the same name.
 */
export function repositoryDirectoryName(repositoryRoot: RepositoryPath): string {
  const name = path
    .basename(repositoryRoot)
    .replaceAll(unsafeNameCharacters, '-')
    .replace(leadingDotsOrDashes, '');
  const digest = createHash('sha256').update(repositoryRoot).digest('hex').slice(0, 12);
  return [name, digest].filter((part) => part !== '').join('-');
}
