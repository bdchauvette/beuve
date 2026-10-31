import type { DiffFileView } from '#contract/ipc-contract.ts';

/** Changed Files Only switches between the package neighborhood and the changed files alone. */
export type RadarTreeMode = 'neighborhood' | 'diff-only';

/** The radar tree's git lanes; `ignored` is the dimmed lane generated files take (ADR 0052). */
export type RadarGitStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'ignored';

/** What the radar tree shows, as `@pierre/trees` takes it. */
export interface RadarTreePlan {
  readonly paths: readonly string[];
  /** Directories to open, each with all its ancestors. */
  readonly expandedPaths: readonly string[];
  readonly gitStatus: readonly { readonly path: string; readonly status: RadarGitStatus }[];
  /** For each changed file, the package root it belongs to (`''` for the repository root). */
  readonly packageOf: ReadonlyMap<string, string>;
}

export interface RadarTreeInput {
  /** Every path at the head (`session:get-tree`); empty until it has loaded. */
  readonly paths: readonly string[];
  readonly packageRoots: readonly string[];
  readonly files: readonly Pick<DiffFileView, 'path' | 'status'>[];
}

/**
 * The radar tree's contents (ADR 0026). Neighborhood mode lists every tracked path, plus deleted
 * files the head no longer has, and opens the directories leading to each changed file, so its
 * package and the siblings around it are in view while untouched packages stay closed. Diff-only
 * mode lists the changed files alone, all directories open. Both badge changed files with their
 * git status and map each to its innermost package root.
 */
export function planRadarTree(input: RadarTreeInput, mode: RadarTreeMode): RadarTreePlan {
  const changed = input.files.map((file) => file.path);
  const paths = treePaths(input, mode);
  const expanded = new Set(changed.flatMap((path) => ancestorsOf(path)));
  const roots = input.packageRoots.toSorted((a, b) => b.length - a.length);
  return {
    paths,
    expandedPaths: [...expanded].toSorted((a, b) => a.localeCompare(b)),
    gitStatus: input.files.map((file) => {
      return { path: file.path, status: gitStatusOf(file.status) };
    }),
    packageOf: new Map(
      changed.map((path) => {
        return [path, innermostRoot(roots, path)];
      }),
    ),
  };
}

function treePaths(input: RadarTreeInput, mode: RadarTreeMode): readonly string[] {
  const changed = input.files.map((file) => file.path);
  if (mode === 'diff-only') {
    return changed;
  }
  return [...new Set([...input.paths, ...changed])];
}

/** `a/b/c.ts` → `a`, `a/b`. */
function ancestorsOf(path: string): string[] {
  const parts = path.split('/').slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

function innermostRoot(rootsLongestFirst: readonly string[], path: string): string {
  return rootsLongestFirst.find((root) => root === '' || path.startsWith(`${root}/`)) ?? '';
}

function gitStatusOf(status: DiffFileView['status']): RadarGitStatus {
  if (status === 'copied') {
    return 'added';
  }
  return status;
}
