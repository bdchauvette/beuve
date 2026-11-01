import path from 'node:path';

import type { TreeEntry } from './tree-entry.ts';
import { isIgnoredDependencyPath } from './is-ignored-dependency-path.ts';

const linkMode = '120000';

/**
 * The file names of a tree listing, by repository-relative directory (`''` for the top level).
 * Links and anything under a dependency or build directory are left out: they are never
 * lockfiles beuve installs from.
 */
export function namesByDirectory(entries: readonly TreeEntry[]): Map<string, Set<string>> {
  const directories = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.mode === linkMode || isIgnoredDependencyPath(entry.path)) {
      continue;
    }
    let directory = path.posix.dirname(entry.path);
    if (directory === '.') {
      directory = '';
    }
    directories
      .getOrInsertComputed(directory, () => new Set())
      .add(path.posix.basename(entry.path));
  }
  return directories;
}
