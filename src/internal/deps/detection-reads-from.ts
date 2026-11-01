import type { TreeEntry } from './tree-entry.ts';
import { ecosystemRows } from './ecosystem-rows.ts';
import { joinPath } from './join-path.ts';
import { namesByDirectory } from './names-by-directory.ts';

/**
 * The files whose text `detectInstallUnits` needs: `package.json` and `pnpm-workspace.yaml` in
 * every directory with a Node lockfile (for `packageManager` and workspaces).
 */
export function detectionReadsFrom(entries: readonly TreeEntry[]): readonly string[] {
  const nodeLockfiles = new Set(
    ecosystemRows
      .filter((row) => row.ecosystem === 'node')
      .flatMap((row) => {
        return row.lockfiles.filter((name) => typeof name === 'string');
      }),
  );
  const reads: string[] = [];
  for (const [directory, names] of namesByDirectory(entries)) {
    if (names.isDisjointFrom(nodeLockfiles)) {
      continue;
    }
    for (const name of ['package.json', 'pnpm-workspace.yaml']) {
      if (names.has(name)) {
        reads.push(joinPath({ directory, name }));
      }
    }
  }
  return reads;
}
